// @ts-nocheck — acct_* tables/functions are not in the stale generated types.ts yet
// ─────────────────────────────────────────────────────────────
//  FFERP Accounts — shared data layer for the double-entry books
//  (ADD_ACCOUNTS_LEDGER_CORE.sql). All writes go through the
//  acct_* RPCs so the balance / lock / approval rules are enforced
//  in the database, never only in the UI.
// ─────────────────────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type RootType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Account {
  id: string; code: string; name: string; parent_id: string | null; is_group: boolean;
  root_type: RootType; account_type: string | null; system_key: string | null;
  gst_component: string | null; is_active: boolean; description: string | null;
}

export interface TBRow {
  account_id: string; code: string; name: string; parent_id: string | null; root_type: RootType;
  account_type: string | null; opening: number; period_debit: number; period_credit: number; closing: number;
}

export const ROOT_LABEL: Record<RootType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
};

export const VOUCHER_TYPE_LABEL: Record<string, string> = {
  journal: 'Journal', sales_invoice: 'Sales', receipt: 'Receipt', purchase: 'Purchase', payment: 'Payment',
  credit_note: 'Credit Note', debit_note: 'Debit Note', wastage: 'Wastage', contra: 'Contra',
  opening: 'Opening', reversal: 'Reversal', period_closing: 'Year Close',
};

export const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  pending_approval: 'bg-amber-100 text-amber-700 border-amber-200',
  posted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
};

// Credit-nature accounts show their balance as a positive number on statements.
export const isCreditNature = (root: RootType) => root === 'liability' || root === 'equity' || root === 'income';

export function inr(n: number | null | undefined, decimals = 2) {
  const v = Number(n || 0);
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Signed balance → "₹1,200.00 Dr" / "₹300.00 Cr" (debit-positive convention from the DB). */
export function drCr(n: number | null | undefined) {
  const v = Number(n || 0);
  if (Math.abs(v) < 0.005) return '—';
  return `${inr(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`;
}

/** Indian financial year (Apr–Mar) containing the given date. */
export function fyOf(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` };
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Page through a PostgREST call so results are never silently capped at 1000 rows. */
async function fetchAll<T>(build: (from: number, to: number) => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Is Maker-Checker on, and can the current user skip straight to posted? Used by the
 *  four document pages (Credit/Debit Notes, Vendor Credits, Sales Invoices) that insert
 *  directly instead of going through the acct_vouchers approval flow. */
export function useMakerChecker() {
  const { data } = useQuery({
    queryKey: ['acct', 'settings', 'maker-checker'],
    queryFn: async () => {
      const { data, error } = await supabase.from('acct_settings').select('maker_checker_enabled').eq('id', 1).single();
      if (error) throw error;
      return !!data?.maker_checker_enabled;
    },
    staleTime: 30_000,
  });
  const { canApprove } = useAccountsRole();
  const enabled = !!data;
  return { enabled, needsApproval: enabled && !canApprove };
}

export function useAccountsRole() {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  return {
    canWrite: role === 'accounts' || role === 'admin',
    canApprove: role === 'admin' || role === 'ceo',
    role,
  };
}

// ── Master data ──────────────────────────────────────────────
export function useChartOfAccounts() {
  return useQuery({
    queryKey: ['acct', 'accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('acct_accounts').select('*').order('code');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
    staleTime: 60_000,
  });
}

export function useHubs() {
  return useQuery({
    queryKey: ['acct', 'hubs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hubs').select('id, code, name').order('code');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAcctSettings() {
  return useQuery({
    queryKey: ['acct', 'settings'],
    queryFn: async () => {
      const [{ data: s, error: e1 }, { data: fy, error: e2 }] = await Promise.all([
        supabase.from('acct_settings').select('*').eq('id', 1).single(),
        supabase.from('acct_fiscal_years').select('*').order('start_date'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { settings: s, fiscalYears: fy ?? [] };
    },
  });
}

/** Search customers / vendors for a party picker. */
export async function searchParties(type: string, term: string) {
  const t = term.trim();
  if (type === 'customer') {
    let q = supabase.from('customers').select('id, name, shop_name, phone').limit(20);
    if (t) q = q.or(`name.ilike.%${t}%,shop_name.ilike.%${t}%,phone.ilike.%${t}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((c: any) => ({ id: c.id, name: c.shop_name || c.name || c.phone, sub: c.phone }));
  }
  if (type === 'vendor') {
    let q = supabase.from('vendors').select('id, name, phone').eq('is_active', true).limit(20);
    if (t) q = q.ilike('name', `%${t}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((v: any) => ({ id: v.id, name: v.name, sub: v.phone }));
  }
  if (type === 'driver' || type === 'employee') {
    let q = supabase.from('profiles').select('id, name, role').limit(20);
    if (type === 'driver') q = q.eq('role', 'driver');
    if (t) q = q.ilike('name', `%${t}%`);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((p: any) => ({ id: p.id, name: p.name, sub: p.role }));
  }
  return [];
}

// ── Reports ──────────────────────────────────────────────────
export function useTrialBalance(from: string, to: string, hubId?: string | null) {
  return useQuery({
    queryKey: ['acct', 'tb', from, to, hubId || 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('acct_trial_balance', { p_from: from, p_to: to, p_hub: hubId || null });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r, opening: +r.opening, period_debit: +r.period_debit, period_credit: +r.period_credit, closing: +r.closing,
      })) as TBRow[];
    },
    enabled: !!from && !!to,
  });
}

export function useAccountLedger(args: {
  accountId?: string | null; from: string; to: string; hubId?: string | null;
  partyType?: string | null; partyId?: string | null;
}) {
  const { accountId, from, to, hubId, partyType, partyId } = args;
  return useQuery({
    queryKey: ['acct', 'ledger', accountId, from, to, hubId, partyType, partyId],
    enabled: !!(accountId || partyId) && !!from && !!to,
    queryFn: async () => {
      const params = {
        p_account: accountId || null, p_from: from, p_to: to, p_hub: hubId || null,
        p_party_type: partyType || null, p_party: partyId || null,
      };
      return fetchAll<any>((a, b) => supabase.rpc('acct_account_ledger', params).range(a, b));
    },
  });
}

export function useAgeing(kind: 'receivable' | 'payable', asOf: string) {
  return useQuery({
    queryKey: ['acct', 'ageing', kind, asOf],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('acct_party_ageing', { p_kind: kind, p_as_of: asOf });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useVouchers(f: { from: string; to: string; type?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['acct', 'vouchers', f],
    queryFn: async () => fetchAll<any>((a, b) => {
      let q = supabase.from('acct_vouchers')
        .select('id, voucher_no, voucher_type, posting_date, party_name, reference_no, narration, status, total_debit, is_auto, is_opening, reversal_of, reversed_by, created_at, hub_id')
        .gte('posting_date', f.from).lte('posting_date', f.to)
        .order('posting_date', { ascending: false }).order('voucher_no', { ascending: false });
      if (f.type) q = q.eq('voucher_type', f.type);
      if (f.status) q = q.eq('status', f.status);
      if (f.search?.trim()) {
        const s = f.search.trim().replace(/[,()]/g, ' ');
        q = q.or(`voucher_no.ilike.%${s}%,party_name.ilike.%${s}%,reference_no.ilike.%${s}%,narration.ilike.%${s}%`);
      }
      return q.range(a, b);
    }),
  });
}

export function usePendingVouchers() {
  return useQuery({
    queryKey: ['acct', 'vouchers', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase.from('acct_vouchers')
        .select('id, voucher_no, voucher_type, posting_date, party_name, narration, total_debit, created_by, submitted_at')
        .eq('status', 'pending_approval').order('submitted_at');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useVoucherDetail(id?: string | null) {
  return useQuery({
    queryKey: ['acct', 'voucher', id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: v, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
        supabase.from('acct_vouchers').select('*').eq('id', id).single(),
        supabase.from('acct_voucher_lines').select('*, acct_accounts(code, name)').eq('voucher_id', id).order('line_no'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { voucher: v, lines: lines ?? [] };
    },
  });
}

export function usePostingErrors() {
  return useQuery({
    queryKey: ['acct', 'posting-errors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('acct_posting_errors')
        .select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Mutations ────────────────────────────────────────────────
function useAcctMutation<TVars>(fn: (v: TVars) => Promise<any>, success: string | ((r: any) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      toast.success(typeof success === 'function' ? success(r) : success);
      qc.invalidateQueries({ queryKey: ['acct'] });
    },
    onError: (e: any) => {
      console.error('[accounts]', e);
      toast.error(e?.message || 'Something went wrong');
    },
  });
}

async function rpc(name: string, params: Record<string, any>) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

export const useCreateVoucher = () => useAcctMutation(
  (v: { payload: any; action: 'draft' | 'submit' }) => rpc('acct_create_voucher', { p: v.payload, p_action: v.action }),
  'Voucher saved',
);
export const useSubmitVoucher  = () => useAcctMutation((id: string) => rpc('acct_submit_voucher', { p_id: id }), 'Voucher submitted');
export const useApproveVoucher = () => useAcctMutation((id: string) => rpc('acct_approve_voucher', { p_id: id }), 'Voucher approved and posted');
export const useRejectVoucher  = () => useAcctMutation(
  (v: { id: string; reason: string }) => rpc('acct_reject_voucher', { p_id: v.id, p_reason: v.reason }), 'Voucher cancelled');
export const useReverseVoucher = () => useAcctMutation(
  (v: { id: string; reason: string; date?: string }) =>
    rpc('acct_reverse_voucher', { p_id: v.id, p_reason: v.reason, p_date: v.date || null }),
  'Reversal posted');

export function useSaveAccount() {
  return useAcctMutation(async (a: Partial<Account>) => {
    const row = {
      code: a.code?.trim(), name: a.name?.trim(), parent_id: a.parent_id || null, is_group: !!a.is_group,
      root_type: a.root_type, account_type: a.account_type || null, is_active: a.is_active ?? true,
      description: a.description || null,
    };
    const { error } = a.id
      ? await supabase.from('acct_accounts').update(row).eq('id', a.id)
      : await supabase.from('acct_accounts').insert(row);
    if (error) throw error;
  }, 'Account saved');
}

export function useUpdateSettings() {
  const { user } = useAuth();
  return useAcctMutation(async (patch: { lock_date?: string | null; company_state_code?: string; maker_checker_enabled?: boolean }) => {
    const { data, error } = await supabase.from('acct_settings')
      .update({ ...patch, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', 1).select();
    if (error) throw error;
    if (!data?.length) throw new Error('Only Admin or CEO can change these settings');
  }, 'Settings saved');
}

export function useAddFiscalYear() {
  return useAcctMutation(async (fy: { name: string; short_code: string; start_date: string; end_date: string }) => {
    const { error } = await supabase.from('acct_fiscal_years').insert(fy);
    if (error) throw error;
  }, 'Fiscal year added');
}

// ── Audit log (generic `audit_logs` table, shared across the ERP) ──────────
const ACCOUNTS_AUDIT_RECORD_TYPES = ['SalesInvoice', 'JournalEntry', 'Voucher', 'CreditNote', 'DebitNote', 'VendorCredit', 'PaymentReceived'];

export function useAuditLogs(limit = 100) {
  return useQuery({
    queryKey: ['acct', 'audit-logs', limit],
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_logs')
        .select('id, created_at, record_type, record_id, action, performed_by_name, remarks')
        .in('record_type', ACCOUNTS_AUDIT_RECORD_TYPES)
        .order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function logAudit(entry: { record_type: string; record_id: string; action: string; performed_by_name?: string; performed_by_role?: string; remarks?: string }) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('audit_logs').insert({ ...entry, performed_by: user?.id });
}

// ── Maker-checker pending queue for the 4 direct-insert document types ─────
export function usePendingDocuments() {
  return useQuery({
    queryKey: ['acct', 'pending-documents'],
    queryFn: async () => {
      const [cn, dn, vc, inv] = await Promise.all([
        supabase.from('credit_notes').select('id, credit_note_number, customer_name, amount, created_at').eq('status', 'pending_approval'),
        supabase.from('debit_notes').select('id, debit_note_number, vendor_name, amount, created_at').eq('status', 'draft'),
        supabase.from('vendor_credits').select('id, credit_note_number, vendor_name, credit_amount, created_at').eq('status', 'pending_approval'),
        supabase.from('invoices').select('id, invoice_number, customer_name, total_amount, created_at').eq('status', 'draft'),
      ]);
      const rows = [
        ...(cn.data ?? []).map((r: any) => ({ type: 'Credit Note', number: r.credit_note_number, party: r.customer_name, amount: r.amount, id: r.id, created_at: r.created_at })),
        ...(dn.data ?? []).map((r: any) => ({ type: 'Debit Note', number: r.debit_note_number, party: r.vendor_name, amount: r.amount, id: r.id, created_at: r.created_at })),
        ...(vc.data ?? []).map((r: any) => ({ type: 'Vendor Credit', number: r.credit_note_number, party: r.vendor_name, amount: r.credit_amount, id: r.id, created_at: r.created_at })),
        ...(inv.data ?? []).map((r: any) => ({ type: 'Sales Invoice', number: r.invoice_number, party: r.customer_name, amount: r.total_amount, id: r.id, created_at: r.created_at })),
      ];
      return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
  });
}

// ── Bank reconciliation ─────────────────────────────────────────────────────
export function useBankAccounts() {
  const q = useChartOfAccounts();
  return { ...q, data: (q.data ?? []).filter((a) => a.system_key === 'bank_default' || a.system_key === 'cash') };
}

export function useBankStatementLines(accountId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['acct', 'bank-statement-lines', accountId, from, to],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_statement_lines').select('*')
        .eq('bank_account_id', accountId).gte('statement_date', from).lte('statement_date', to)
        .order('statement_date');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Posted GL lines for the bank account that aren't matched to any statement line yet. */
export function useUnreconciledGlLines(accountId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['acct', 'unreconciled-gl', accountId, from, to],
    enabled: !!accountId,
    queryFn: async () => {
      const [{ data: gl, error: e1 }, { data: matched, error: e2 }] = await Promise.all([
        supabase.from('acct_gl').select('id, posting_date, voucher_no, narration, party_name, debit, credit')
          .eq('account_id', accountId).gte('posting_date', from).lte('posting_date', to).order('posting_date'),
        supabase.from('bank_statement_lines').select('matched_gl_id').eq('bank_account_id', accountId).not('matched_gl_id', 'is', null),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const matchedIds = new Set((matched ?? []).map((m: any) => m.matched_gl_id));
      return (gl ?? []).filter((g: any) => !matchedIds.has(g.id));
    },
  });
}

export function useImportBankStatementLines() {
  const { user } = useAuth();
  return useAcctMutation(async (v: { bankAccountId: string; rows: { statement_date: string; description?: string; reference_no?: string; debit: number; credit: number }[] }) => {
    const batchId = crypto.randomUUID();
    const { error } = await supabase.from('bank_statement_lines').insert(
      v.rows.map((r) => ({ ...r, bank_account_id: v.bankAccountId, imported_batch_id: batchId, imported_by: user?.id })),
    );
    if (error) throw error;
    return { count: v.rows.length };
  }, (r) => `Imported ${r.count} statement line(s)`);
}

export function useMatchBankLine() {
  return useAcctMutation(async (v: { statementLineId: string; glId: string | null }) => {
    const { error } = await supabase.from('bank_statement_lines')
      .update({ matched_gl_id: v.glId, status: v.glId ? 'matched' : 'unmatched' }).eq('id', v.statementLineId);
    if (error) throw error;
  }, 'Match updated');
}

export function useIgnoreBankLine() {
  return useAcctMutation(async (statementLineId: string) => {
    const { error } = await supabase.from('bank_statement_lines').update({ status: 'ignored' }).eq('id', statementLineId);
    if (error) throw error;
  }, 'Line ignored');
}

export function useResolvePostingError() {
  const { user } = useAuth();
  return useAcctMutation(async (id: string) => {
    const { error } = await supabase.from('acct_posting_errors')
      .update({ resolved: true, resolved_by: user?.id, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }, 'Marked as resolved');
}

// ── Tree helpers ─────────────────────────────────────────────
export interface TreeNode<T> { item: T; children: TreeNode<T>[]; depth: number }

export function buildTree<T extends { id: string; parent_id: string | null; code: string }>(items: T[]): TreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const it of items) {
    const k = it.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  }
  const walk = (pid: string | null, depth: number): TreeNode<T>[] =>
    (byParent.get(pid) ?? []).sort((a, b) => a.code.localeCompare(b.code))
      .map((item) => ({ item, depth, children: walk(item.id, depth + 1) }));
  return walk(null, 0);
}

/** Roll leaf trial-balance figures up into every group account. */
export function rollUp(accounts: Account[], tb: TBRow[]) {
  const sums = new Map<string, { opening: number; debit: number; credit: number; closing: number }>();
  const parent = new Map(accounts.map((a) => [a.id, a.parent_id]));
  for (const r of tb) {
    let id: string | null = r.account_id;
    while (id) {
      const s = sums.get(id) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
      s.opening += r.opening; s.debit += r.period_debit; s.credit += r.period_credit; s.closing += r.closing;
      sums.set(id, s);
      id = parent.get(id) ?? null;
    }
  }
  return sums;
}
