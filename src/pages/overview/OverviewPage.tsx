// @ts-nocheck
// Management Overview — view-only. Every query in this folder is a SELECT; there are no
// buttons or handlers that change data, so nothing here can edit, approve or delete.
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Eye, ShoppingBag, ShoppingCart, Wallet, Banknote, PackageSearch, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ReadOnlyList from './ReadOnlyList';
import { LISTS, TABS, inr, type TabKey } from './overviewConfig';

function Kpi({ to, icon: Icon, label, value, sub, tone }: any) {
  return (
    <Link to={to} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition-shadow block">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${tone}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-800 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Link>
  );
}

function Summary() {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const { data, isLoading, error } = useQuery({
    queryKey: ['overview-summary', todayStr],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [orders, openPOs, coll, pay, stock] = await Promise.all([
        supabase.from('sales_orders').select('total_amount, status').eq('order_date', todayStr).limit(1000),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'assigned', 'purchasing', 'purchased']),
        supabase.from('cash_collections').select('collected_amount, amount').eq('collection_date', todayStr).limit(1000),
        supabase.from('ff_vendor_payments').select('net_amount').like('payment_status', 'pending%').limit(1000),
        // Prefer the view (cost + selling price); fall back to the table if the view is not installed yet
        supabase.from('inventory_valuation_v').select('quantity, min_threshold, avg_cost, so_price').limit(1000)
          .then(async r => (r.error ? await supabase.from('inventory').select('quantity, min_threshold, avg_cost').limit(1000) : r)),
      ]);
      // Stock is optional here: if the cost columns are not installed yet the other cards must still load
      for (const r of [orders, openPOs, coll, pay]) if (r.error) throw r.error;

      const live = (orders.data ?? []).filter(o => o.status !== 'cancelled');
      return {
        orderCount: live.length,
        orderValue: live.reduce((s, o) => s + Number(o.total_amount || 0), 0),
        openPOs: openPOs.count ?? 0,
        collected: (coll.data ?? []).reduce((s, c) => s + Number(c.collected_amount ?? c.amount ?? 0), 0),
        collectedCount: (coll.data ?? []).length,
        payPending: (pay.data ?? []).length,
        payPendingValue: (pay.data ?? []).reduce((s, p) => s + Number(p.net_amount || 0), 0),
        stockOk: !stock.error,
        stockValue: (stock.data ?? []).reduce((s, i) => s + (Number(i.avg_cost) > 0 ? Number(i.quantity || 0) * Number(i.avg_cost) : 0), 0),
        stockLines: (stock.data ?? []).length,
        expectedSales: (stock.data ?? []).filter(i => Number(i.avg_cost) > 0 && i.so_price != null).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.so_price), 0),
        expectedProfit: (stock.data ?? []).filter(i => Number(i.avg_cost) > 0 && i.so_price != null).reduce((s, i) => s + Number(i.quantity || 0) * (Number(i.so_price) - Number(i.avg_cost)), 0),
        hasSellingPrices: (stock.data ?? []).some(i => i.so_price != null),
        stockNoCost: (stock.data ?? []).filter(i => Number(i.quantity || 0) > 0 && !(Number(i.avg_cost) > 0)).length,
        lowStock: (stock.data ?? []).filter(i => i.min_threshold != null && Number(i.quantity || 0) <= Number(i.min_threshold)).length,
      };
    },
  });

  if (isLoading) return <div className="py-16 text-center text-slate-400"><Loader2 className="inline h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="py-10 text-center text-red-600">Could not load the summary: {(error as any).message}</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Today, {format(new Date(), 'dd MMM yyyy')} — refreshes every minute. Click a card for the full list.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Kpi to="/overview/sales-orders" icon={ShoppingBag} tone="bg-emerald-100 text-emerald-700"
          label="Today's orders" value={data.orderCount} sub={`${inr(data.orderValue)} order value (cancelled excluded)`} />
        <Kpi to="/overview/purchase-orders" icon={ShoppingCart} tone="bg-blue-100 text-blue-700"
          label="Open purchase orders" value={data.openPOs} sub="pending, assigned, purchasing or purchased" />
        <Kpi to="/overview/collections" icon={Wallet} tone="bg-amber-100 text-amber-700"
          label="Cash collected today" value={inr(data.collected)} sub={`${data.collectedCount} collection entr${data.collectedCount === 1 ? 'y' : 'ies'}`} />
        <Kpi to="/overview/vendor-payments" icon={Banknote} tone="bg-purple-100 text-purple-700"
          label="Vendor payments pending" value={data.payPending} sub={`${inr(data.payPendingValue)} waiting in the approval chain`} />
        <Kpi to="/overview/stock" icon={PackageSearch} tone="bg-teal-100 text-teal-700"
          label="Stock value today (at purchase cost)" value={data.stockOk ? inr(data.stockValue) : '—'}
          sub={data.stockOk
            ? `${data.stockLines} stock lines${data.stockNoCost ? ` · ${data.stockNoCost} with no cost yet, not included` : ''}${data.hasSellingPrices ? ` · expected sales ${inr(data.expectedSales)}, profit ${inr(data.expectedProfit)}` : ''}`
            : 'Cost data is not set up yet'} />
        <Kpi to="/overview/stock" icon={PackageSearch} tone="bg-red-100 text-red-700"
          label="Stock lines at or below minimum" value={data.lowStock} sub="across all hubs" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { tab = 'summary' } = useParams();

  const { data: hubs = [] } = useQuery({
    queryKey: ['overview-hubs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hubs').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (tab !== 'summary' && !LISTS[tab]) return <Navigate to="/overview" replace />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-emerald-100 flex items-center justify-center"><Eye className="h-5 w-5 text-emerald-700" /></div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-800">Management Overview</h1>
          <p className="text-[13px] text-slate-500">View only — see everything that is happening; nothing here can be changed.</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(t => (
          <Link key={t.key} to={t.key === 'summary' ? '/overview' : `/overview/${t.key}`}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'summary' ? <Summary /> : <ReadOnlyList key={tab} cfg={LISTS[tab as Exclude<TabKey, 'summary'>]} hubs={hubs} />}
    </div>
  );
}
