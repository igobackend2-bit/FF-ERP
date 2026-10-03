import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, Globe, Loader2, Search, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface WebsiteCustomer {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  signed_up_at: string;
  last_sign_in_at: string | null;
  provider: string;
  phone_verified: boolean;
  email_verified: boolean;
  shop_orders: number;
  ff_orders: number;
  last_order_at: string | null;
}

const fmt = (d: string | null) => (d ? format(new Date(d), 'dd MMM yyyy, hh:mm a') : '—');
const showPhone = (p: string | null) => {
  if (!p) return '—';
  const digits = p.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? `+91 ${digits.slice(2)}` : `+${digits}`;
};

// Website / customer-portal sign-ups. These are customers, not staff, so they live here and not in
// User Management. Read-only list; the data comes from an admin-only database function.
export default function AdminWebsiteCustomersPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-website-customers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_website_customers');
      if (error) throw error;
      return (data ?? []) as WebsiteCustomer[];
    },
  });

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.name ?? '').toLowerCase().includes(q) ||
      (r.phone ?? '').includes(q.replace(/\D/g, '') || '\u0000') ||
      (r.email ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const newThisWeek = rows.filter(r => new Date(r.signed_up_at).getTime() > weekAgo).length;
  const withOrders = rows.filter(r => r.shop_orders + r.ff_orders > 0).length;
  const neverVerified = rows.filter(r => !r.phone_verified && !r.email_verified).length;

  const exportCsv = () => {
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Name', 'Phone', 'Email', 'Signed up', 'Last sign-in', 'Shop orders', 'Sales orders (by phone)', 'Last order'];
    const body = filtered.map(r => [r.name, showPhone(r.phone), r.email, r.signed_up_at, r.last_sign_in_at, r.shop_orders, r.ff_orders, r.last_order_at].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `website_customers_${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} customers`);
  };

  const setupNeeded = (error as any)?.code === 'PGRST202' || (error as any)?.message?.includes('admin_website_customers');

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center"><Globe className="w-5 h-5 text-emerald-700" /></div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-800">Website Customers</h1>
          <p className="text-[13px] text-slate-500">
            People who signed in on the customer portal or the shop with a mobile OTP. They are customers, not staff, so they are listed here and not in User Management.
          </p>
        </div>
      </div>

      {setupNeeded && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>One-time setup needed: run <code>ADD_WEBSITE_CUSTOMERS_LIST_2026-10-03.sql</code> in the Supabase SQL Editor, then refresh.</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Total sign-ups', rows.length],
          ['New in the last 7 days', newThisWeek],
          ['Have placed an order', withOrders],
          ['Never verified', neverVerified],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone or email"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {['Name', 'Phone', 'Email', 'Signed up', 'Last sign-in', 'Orders', 'Last order'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline h-5 w-5 animate-spin" /></td></tr>
              ) : error && !setupNeeded ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-red-600">Could not load: {(error as any).message}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">No website customers{search ? ' match your search' : ' yet'}.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-800">{r.name || <span className="text-slate-400 font-normal">No name yet</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {showPhone(r.phone)}
                    {r.phone && !r.phone_verified && <span className="ml-1 text-[10px] text-amber-600">unverified</span>}
                  </td>
                  <td className="px-3 py-2">{r.email || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmt(r.signed_up_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmt(r.last_sign_in_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title={`${r.shop_orders} shop orders · ${r.ff_orders} sales orders matched by phone`}>
                    {r.shop_orders + r.ff_orders}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmt(r.last_order_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {filtered.length} of {rows.length} · view only. Orders = shop orders placed with their login plus sales orders that carry their mobile number.
        </div>
      </div>
    </div>
  );
}
