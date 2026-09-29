// @ts-nocheck
// Customers & Vendors — the accounts-side view of the same customers/vendors
// tables Sales and Purchase use, showing only the fields Accounts cares about
// (credit limit, payment terms, GSTIN, MSME status). Full onboarding (phone,
// hub, address, banking) stays on the existing Sales/Purchase master pages —
// this page edits only the accounting fields, it never creates a party.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAccountsRole } from '@/hooks/useAccounts';
import { BooksPage, FilterBar, Field, inputCls, LoadState, RefreshButton, downloadCsv } from '@/components/accounts/BooksUI';

const MSME_OPTIONS = [['', 'Not registered'], ['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium']];

function useCustomers() {
  return useQuery({
    queryKey: ['accounts', 'parties', 'customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers')
        .select('id, name, shop_name, gst_number, credit_limit, credit_days, payment_terms, is_active')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useVendors() {
  return useQuery({
    queryKey: ['accounts', 'parties', 'vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors')
        .select('id, name, gst_number, credit_limit, payment_terms, msme_status, is_active')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function EditModal({ kind, row, onClose, onSaved }: { kind: 'customer' | 'vendor'; row: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    credit_limit: row.credit_limit ?? '',
    payment_terms: row.payment_terms ?? '',
    credit_days: row.credit_days ?? '',
    msme_status: row.msme_status ?? '',
    is_active: row.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const table = kind === 'customer' ? 'customers' : 'vendors';
    const patch: any = { payment_terms: f.payment_terms || null, is_active: f.is_active };
    if (kind === 'customer') { patch.credit_limit = f.credit_limit === '' ? null : Number(f.credit_limit); patch.credit_days = f.credit_days === '' ? null : Number(f.credit_days); }
    else { patch.credit_limit = f.credit_limit === '' ? null : Number(f.credit_limit); patch.msme_status = f.msme_status || null; }
    const { error } = await supabase.from(table).update(patch).eq('id', row.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Accounting details · {row.name || row.shop_name}</h2>
        <p className="text-xs text-gray-500">Contact, hub and banking details are managed on the {kind === 'customer' ? 'Sales Customers' : 'Purchase Vendors'} page — this only edits accounting fields.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Credit limit (₹)"><input type="number" className={inputCls} value={f.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} /></Field>
          {kind === 'customer' ? (
            <Field label="Credit days"><input type="number" className={inputCls} value={f.credit_days} onChange={(e) => set('credit_days', e.target.value)} /></Field>
          ) : (
            <Field label="MSME status">
              <select className={inputCls} value={f.msme_status} onChange={(e) => set('msme_status', e.target.value)}>
                {MSME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          )}
          <Field label="Payment terms" className="col-span-2"><input className={inputCls} placeholder="e.g. 30d, Net 15, Advance" value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

export default function PartiesPage() {
  const navigate = useNavigate();
  const { canWrite } = useAccountsRole();
  const [tab, setTab] = useState<'customers' | 'vendors'>('customers');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const customersQ = useCustomers();
  const vendorsQ = useVendors();
  const q = tab === 'customers' ? customersQ : vendorsQ;

  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (!search.trim()) return all;
    const s = search.trim().toLowerCase();
    return all.filter((r: any) => (r.name || r.shop_name || '').toLowerCase().includes(s) || (r.gst_number || '').toLowerCase().includes(s));
  }, [q.data, search]);

  const exportCsv = () => downloadCsv(`${tab}-accounts.csv`, [
    tab === 'customers' ? ['Name', 'GSTIN', 'Credit Limit', 'Credit Days', 'Terms', 'Status']
      : ['Name', 'GSTIN', 'Credit Limit', 'Terms', 'MSME', 'Status'],
    ...rows.map((r: any) => tab === 'customers'
      ? [r.name || r.shop_name, r.gst_number, r.credit_limit ?? '', r.credit_days ?? '', r.payment_terms ?? '', r.is_active ? 'Active' : 'Inactive']
      : [r.name, r.gst_number, r.credit_limit ?? '', r.payment_terms ?? '', r.msme_status ?? '', r.is_active ? 'Active' : 'Inactive']),
  ]);

  return (
    <BooksPage title="Customers & Vendors" subtitle="Accounting terms for every party — full onboarding stays on the Sales/Purchase master pages."
      actions={<>
        <RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />
        <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Export CSV</button>
        {canWrite && (
          <button onClick={() => navigate(tab === 'customers' ? '/sales/customers' : '/purchase/vendors')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" /> New {tab === 'customers' ? 'Customer' : 'Vendor'} <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </>}>
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {[['customers', 'Customers'], ['vendors', 'Vendors']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)} className={cn('px-4 py-1.5 rounded-md text-sm', tab === k ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-gray-50')}>{l}</button>
        ))}
      </div>
      <FilterBar>
        <Field label="Search"><input className={inputCls + ' w-64'} placeholder="Name or GSTIN…" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      </FilterBar>
      <LoadState isLoading={q.isLoading} error={q.error} empty={!rows.length} emptyText={`No ${tab} yet.`}>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">GSTIN</th>
                <th className="text-right px-3 py-2.5">Credit Limit</th>
                {tab === 'vendors' && <th className="text-left px-3 py-2.5">MSME</th>}
                <th className="text-left px-3 py-2.5">Terms</th>
                <th className="text-left px-3 py-2.5">Status</th>
                {canWrite && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-emerald-50/40">
                  <td className="px-4 py-2 text-slate-700">{r.name || r.shop_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.gst_number || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.credit_limit != null ? `₹${Number(r.credit_limit).toLocaleString('en-IN')}` : '—'}</td>
                  {tab === 'vendors' && <td className="px-3 py-2 text-xs capitalize text-gray-500">{r.msme_status || '—'}</td>}
                  <td className="px-3 py-2 text-xs text-gray-500">{tab === 'customers' && r.credit_days ? `${r.credit_days}d` : (r.payment_terms || '—')}</td>
                  <td className="px-3 py-2">
                    <span className={cn('text-xs px-2 py-1 rounded-full border', r.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canWrite && <td className="px-2"><button onClick={() => setEditing(r)} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil className="w-3.5 h-3.5" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LoadState>
      {editing && <EditModal kind={tab === 'customers' ? 'customer' : 'vendor'} row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.refetch(); }} />}
    </BooksPage>
  );
}
