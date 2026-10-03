// @ts-nocheck
// Generic read-only table: filters + paging + CSV export. SELECT queries only.
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { Download, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { ListConfig } from './overviewConfig';

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_CAP = 20000;

const today = () => format(new Date(), 'yyyy-MM-dd');

// Same filters for the on-screen page and the CSV export
function buildQuery(cfg: ListConfig, f: { from: string; to: string; hub: string; status: string; search: string }, withCount: boolean, selectOverride?: string) {
  let q = supabase.from(cfg.table).select(selectOverride ?? cfg.select, withCount ? { count: 'exact' } : undefined);
  if (cfg.dateColumn && f.from) {
    q = cfg.dateType === 'ts' ? q.gte(cfg.dateColumn, `${f.from}T00:00:00+05:30`) : q.gte(cfg.dateColumn, f.from);
  }
  if (cfg.dateColumn && f.to) {
    q = cfg.dateType === 'ts' ? q.lte(cfg.dateColumn, `${f.to}T23:59:59.999+05:30`) : q.lte(cfg.dateColumn, f.to);
  }
  if (cfg.hubColumn && f.hub) q = q.eq(cfg.hubColumn, f.hub);
  if (cfg.statusColumn && f.status) q = q.eq(cfg.statusColumn, f.status);
  const term = f.search.trim().replace(/[,()%]/g, ' ');
  if (term && cfg.searchColumns?.length) {
    q = q.or(cfg.searchColumns.map(c => `${c}.ilike.%${term}%`).join(','));
  }
  for (const o of cfg.order) q = q.order(o.column, { ascending: o.ascending });
  return q;
}

const csvCell = (v: any) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function ReadOnlyList({ cfg, hubs }: { cfg: ListConfig; hubs: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(cfg.defaultDays != null ? format(subDays(new Date(), cfg.defaultDays), 'yyyy-MM-dd') : '');
  const [to, setTo] = useState(cfg.defaultDays != null ? today() : '');
  const [hub, setHub] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const filters = { from, to, hub, status, search };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['overview-list', cfg.key, from, to, hub, status, search, page],
    queryFn: async () => {
      const { data, count, error } = await buildQuery(cfg, filters, true).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });

  // Totals strip (e.g. stock value) over every row that matches the filters, not just this page
  const { data: totalRows } = useQuery({
    queryKey: ['overview-totals', cfg.key, from, to, hub, status, search],
    enabled: !!cfg.totals,
    queryFn: async () => {
      const { data, error } = await buildQuery(cfg, filters, false, cfg.totalsSelect).limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: any[] = [];
      while (all.length < EXPORT_CAP) {
        const { data: chunk, error } = await buildQuery(cfg, filters, false).range(all.length, all.length + EXPORT_CHUNK - 1);
        if (error) throw error;
        all.push(...(chunk ?? []));
        if (!chunk || chunk.length < EXPORT_CHUNK) break;
      }
      const header = cfg.columns.map(c => csvCell(c.label)).join(',');
      const body = all.map(r => cfg.columns.map(c => csvCell(c.value(r))).join(','));
      const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.key}_${from || 'all'}_${to || 'all'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length.toLocaleString('en-IN')} rows${all.length >= EXPORT_CAP ? ' (limit reached — narrow the dates for the rest)' : ''}`);
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message || 'unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  const inputCls = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {cfg.dateColumn && (
          <>
            <label className="text-xs text-slate-500">From
              <input type="date" value={from} max={to || undefined} onChange={e => resetPage(setFrom)(e.target.value)} className={`${inputCls} block mt-1`} />
            </label>
            <label className="text-xs text-slate-500">To
              <input type="date" value={to} min={from || undefined} onChange={e => resetPage(setTo)(e.target.value)} className={`${inputCls} block mt-1`} />
            </label>
          </>
        )}
        {cfg.hubColumn && (
          <label className="text-xs text-slate-500">Hub
            <select value={hub} onChange={e => resetPage(setHub)(e.target.value)} className={`${inputCls} block mt-1 min-w-[150px]`}>
              <option value="">All hubs</option>
              {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        )}
        {cfg.statusOptions && (
          <label className="text-xs text-slate-500">Status
            <select value={status} onChange={e => resetPage(setStatus)(e.target.value)} className={`${inputCls} block mt-1 min-w-[150px]`}>
              <option value="">All</option>
              {cfg.statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        )}
        {cfg.searchColumns && (
          <label className="text-xs text-slate-500 flex-1 min-w-[200px]">Search
            <span className="relative block mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={search} onChange={e => resetPage(setSearch)(e.target.value)} placeholder={cfg.searchHint}
                className={`${inputCls} w-full pl-8`} />
            </span>
          </label>
        )}
        <button onClick={exportCsv} disabled={exporting || total === 0}
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
        </button>
      </div>

      {cfg.totals && totalRows && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cfg.totals.map(t => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</div>
              <div className="mt-1 text-xl font-bold text-slate-800 tabular-nums">{t.compute(totalRows)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {cfg.columns.map(c => (
                  <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={cfg.columns.length} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline h-5 w-5 animate-spin" /></td></tr>
              ) : error ? (
                <tr><td colSpan={cfg.columns.length} className="px-3 py-10 text-center text-red-600">Could not load: {(error as any).message}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cfg.columns.length} className="px-3 py-10 text-center text-slate-400">No records for these filters.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  {cfg.columns.map(c => {
                    const v = c.value(r);
                    return (
                      <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}`}>
                        {c.render ? c.render(r) : (v == null || v === '' ? '—' : String(v).replace(/_/g, ' '))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          <span>{total.toLocaleString('en-IN')} record{total === 1 ? '' : 's'}{isFetching && !isLoading ? ' · updating…' : ''}</span>
          <span className="inline-flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            Page {page + 1} of {pages}
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      </div>
    </div>
  );
}
