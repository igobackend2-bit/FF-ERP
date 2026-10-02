// ─────────────────────────────────────────────────────────────
//  Admin Day Backup — builds a ZIP of CSV files (one per table, grouped by module)
//  through the admin-only functions in ADD_ADMIN_DAY_BACKUP_RPC_2026-10-02.sql.
//
//  Why RPCs and not plain table reads: RLS means an admin session can't be assumed
//  to see every table, and PostgREST silently stops at 1000 rows. The functions read
//  every public table, and the manifest's exact row counts let us prove the export is
//  complete instead of trusting it.
// ─────────────────────────────────────────────────────────────
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export type BackupScope = 'full' | 'day';
export type TableStatus = 'ok' | 'mismatch' | 'failed' | 'empty' | 'skipped';

export interface ManifestEntry {
  table: string;
  rows: number;
  day_filtered: boolean;
}

export interface BackupTableResult {
  table: string;
  module: string;
  expected: number;
  exported: number;
  status: TableStatus;
  dayFiltered: boolean;
  error?: string;
}

export interface BackupProgress {
  phase: 'manifest' | 'tables' | 'zip';
  done: number;
  total: number;
  current: string;
}

export interface BackupOptions {
  scope: BackupScope;
  /** yyyy-MM-dd, required when scope is 'day' */
  date?: string;
  includeHeavy: boolean;
  generatedBy: string;
  onProgress?: (p: BackupProgress) => void;
}

export interface BackupResult {
  fileName: string;
  tables: BackupTableResult[];
  totalRows: number;
  incomplete: boolean;
}

export const BACKUP_AUDIT_ACTION = 'DAY_BACKUP_DOWNLOADED';
export const BACKUP_RPC_MISSING = 'BACKUP_RPC_MISSING';

const PAGE_SIZE = 2000;

// Large GPS / analytics logs: most of the file size, rarely needed for a daily backup.
export const HEAVY_TABLES = new Set(['user_location_logs', 'analytics_events']);

// First match wins. Tables are discovered dynamically, so a table that matches nothing still
// gets exported — it just lands in "Other".
const MODULE_RULES: Array<[RegExp, string]> = [
  [/^acct_/, 'Accounts'],
  [/^(ff_.*payment|vendor_payments$|transport_|payment)/, 'Payments'],
  [/^(purchase_|po_|vendors?$)/, 'Purchase'],
  [/^(sales_|orders$|order_|customers?$|customer_|invoices?$|credit_notes|debit_notes|payments_received$|cash_collections$|leads$|call_logs$|followup|cart$|wishlist$)/, 'Sales'],
  [/^(qc_|inventory|transit_|boxes$|wastage|stock_|daily_stock_counts$|crate)/, 'Warehouse'],
  [/^(shift_|hourly_|day_|eod_|lop_|leave_|selfie_|profiles$|user_location_logs$|employee|attendance)/, 'People_Workflow'],
  [/^(hubs?$|hub_|products?$|product_|delivery_zones$|app_|site_settings$|web_access_config$|banners$)/, 'Masters_Settings'],
  [/^(audit_logs$|notifications$|ff_user_notifications$|analytics_events$|feedback$)/, 'System_Logs'],
];

export function moduleOf(table: string): string {
  for (const [re, name] of MODULE_RULES) if (re.test(table)) return name;
  return 'Other';
}

function toCsv(rows: Record<string, unknown>[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); columns.push(k); }
    }
  }
  const data = rows.map(r => columns.map(k => {
    const v = r[k];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v as string | number | boolean;
  }));
  // BOM so Excel reads UTF-8 (Tamil/Hindi names) correctly.
  return '﻿' + Papa.unparse({ fields: columns, data });
}

async function loadManifest(date: string | null): Promise<ManifestEntry[]> {
  const { data, error } = await (supabase as any).rpc('admin_backup_manifest', { p_date: date });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) {
      throw new Error(BACKUP_RPC_MISSING);
    }
    throw new Error(error.message || 'Could not read the table list');
  }
  return (data ?? []) as ManifestEntry[];
}

async function fetchTableRows(table: string, expected: number, date: string | null): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const maxOffset = Math.max(expected * 2, 100000);
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (offset > maxOffset) throw new Error('Export did not finish — too many pages');
    const { data, error } = await (supabase as any).rpc('admin_backup_rows', {
      p_table: table, p_offset: offset, p_limit: PAGE_SIZE, p_date: date,
    });
    if (error) throw new Error(error.message || 'Page fetch failed');
    const page = (data ?? []) as Record<string, unknown>[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

export async function runBackup(opts: BackupOptions): Promise<BackupResult> {
  const date = opts.scope === 'day' ? (opts.date ?? null) : null;
  if (opts.scope === 'day' && !date) throw new Error('Pick a date for the day backup');

  opts.onProgress?.({ phase: 'manifest', done: 0, total: 1, current: 'Counting rows in every table…' });
  const manifest = await loadManifest(date);
  if (manifest.length === 0) throw new Error('The database returned no tables to back up');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const results: BackupTableResult[] = [];

  const willExport = (m: ManifestEntry) => m.rows > 0 && (opts.includeHeavy || !HEAVY_TABLES.has(m.table));
  const total = manifest.filter(willExport).length;
  let done = 0;

  for (const m of manifest) {
    const mod = moduleOf(m.table);
    const base = { table: m.table, module: mod, expected: m.rows, exported: 0, dayFiltered: m.day_filtered };

    if (m.rows === 0) { results.push({ ...base, status: 'empty' }); continue; }
    if (!willExport(m)) { results.push({ ...base, status: 'skipped' }); continue; }

    opts.onProgress?.({ phase: 'tables', done, total, current: m.table });
    try {
      const rows = await fetchTableRows(m.table, m.rows, date);
      zip.file(`${mod}/${m.table}.csv`, toCsv(rows));
      // More rows than counted is fine (inserted during the run); fewer means something was missed.
      results.push({ ...base, exported: rows.length, status: rows.length < m.rows ? 'mismatch' : 'ok' });
    } catch (e: any) {
      console.error(`[dayBackup] ${m.table} failed:`, e);
      results.push({ ...base, status: 'failed', error: e?.message || String(e) });
    }
    done++;
  }

  const incomplete = results.some(r => r.status === 'failed' || r.status === 'mismatch');
  const totalRows = results.reduce((s, r) => s + r.exported, 0);
  const now = new Date();
  const generatedAt = now.toISOString();

  const summaryCsv = '﻿' + Papa.unparse(results.map(r => ({
    table: r.table,
    module: r.module,
    status: r.status,
    rows_expected: r.expected,
    rows_exported: r.exported,
    scope: opts.scope === 'full' ? 'full backup' : `day activity ${date}`,
    whole_table_in_day_mode: opts.scope === 'day' && !r.dayFiltered ? 'yes (no date column)' : '',
    generated_at: generatedAt,
    generated_by: opts.generatedBy,
    error: r.error ?? '',
  })));
  zip.file('_SUMMARY.csv', summaryCsv);
  zip.file('_README.txt', [
    'Farmers Factory ERP - data backup',
    `Generated: ${format(now, 'dd MMM yyyy, hh:mm a')} by ${opts.generatedBy}`,
    `Scope: ${opts.scope === 'full' ? 'FULL backup (every row of every table)' : `DAY activity for ${date} (rows created or changed that day, India time)`}`,
    `Status: ${incomplete ? 'INCOMPLETE - see _SUMMARY.csv for the tables marked failed or mismatch' : 'complete - every table matched its expected row count'}`,
    '',
    'One folder per module, one CSV file per table. _SUMMARY.csv lists every table with expected vs exported rows.',
    'Not included: files in storage (photos, selfies, payment proofs - only their links are in the CSVs) and login credentials.',
    opts.includeHeavy ? '' : 'Skipped on purpose: user_location_logs and analytics_events (large GPS/analytics logs).',
    '',
    'This file contains bank details, phone numbers and financial records. Keep it in a secure, access-controlled place.',
  ].join('\r\n'));

  opts.onProgress?.({ phase: 'zip', done: total, total, current: 'Packing the ZIP file…' });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  const stamp = format(now, 'yyyy-MM-dd-HHmm');
  const fileName = (opts.scope === 'full'
    ? `FFERP-backup-full-${stamp}`
    : `FFERP-backup-day-${date}-made-${stamp}`) + (incomplete ? '-INCOMPLETE' : '') + '.zip';
  saveAs(blob, fileName);

  return { fileName, tables: results, totalRows, incomplete };
}

/** Records the download so the dashboard can show "last backup" and warn when it is overdue. */
export async function logBackupDownload(
  by: { id: string; name: string; role: string },
  scope: BackupScope,
  date: string | null,
  result: BackupResult,
): Promise<boolean> {
  const { error } = await (supabase.from('audit_logs') as any).insert({
    action: BACKUP_AUDIT_ACTION,
    performed_by: by.id,
    performed_by_name: by.name,
    performed_by_role: by.role,
    record_type: 'backup',
    record_id: result.fileName,
    after_state: {
      scope,
      date,
      tables: result.tables.filter(t => t.status === 'ok' || t.status === 'mismatch').length,
      rows: result.totalRows,
      incomplete: result.incomplete,
      file: result.fileName,
    },
    remarks: `${by.name} downloaded a ${scope === 'full' ? 'full' : `day (${date})`} backup`,
  });
  if (error) console.error('[dayBackup] audit log insert failed:', error.message);
  return !error;
}
