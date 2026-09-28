// @ts-nocheck — several FF tables here (purchase_orders, ff_vendor_payments, acct_vouchers, …)
// are missing from the generated Supabase types.ts, same as the rest of this page family.
// ─────────────────────────────────────────────────────────────
//  Day Open / Day Close KPIs — admin & FF Operations Manager.
//
//  Built after a manual live-data audit found the daily pipeline quietly
//  stalling in the middle (PO assignment, buying, warehouse receiving) with
//  nothing in the app surfacing it. This page makes that visible every day:
//  "Day Open" = what came in overnight and needs action today; "Day Close"
//  = what actually happened today, plus what's unresolved and rolling into
//  tomorrow. Both sections sit on one page — no time-of-day switching.
// ─────────────────────────────────────────────────────────────
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { AnalyticsMetricCard } from '@/components/analytics/AnalyticsMetricCard';
import {
  Sunrise, Sunset, ShoppingCart, FileText, AlertTriangle, Banknote, Clock,
  Boxes, PackageX, ShoppingBag, CheckCircle2, FileBarChart, Wallet, Truck,
  RefreshCw,
} from 'lucide-react';

const TODAY = format(new Date(), 'yyyy-MM-dd');
const ACTIVE_PAYMENT_STATUSES = ['pending_ff_ops', 'pending_l1', 'pending_admin', 'pending_ceo', 'pending_accounts'];

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// ── Day Open queries ────────────────────────────────────────────

function useTodayOrders() {
  return useQuery({
    queryKey: ['day-kpis-orders-today'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('id, total_amount', { count: 'exact' })
        .eq('order_date', TODAY)
        .neq('status', 'cancelled');
      if (error) throw error;
      const revenue = (data ?? []).reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0);
      return { count: data?.length ?? 0, revenue };
    },
  });
}

// Today's EOD-generated POs — also the source data for the "zero buying
// activity" backlog callout below, so it's fetched once and used twice.
function useOvernightPOs() {
  return useQuery({
    queryKey: ['day-kpis-pos-overnight'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('id, po_number, hub_name, total_amount')
        .eq('eod_date', TODAY);
      if (error) throw error;
      const rows = data ?? [];
      return { count: rows.length, total: rows.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0), rows };
    },
  });
}

function useUnassignedBacklog() {
  return useQuery({
    queryKey: ['day-kpis-unassigned-pos'],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('purchase_orders')
        .select('id, po_number, hub_name, eod_date, total_amount', { count: 'exact' })
        .eq('status', 'pending')
        .is('assigned_executive_id', null)
        .order('eod_date', { ascending: true })
        .limit(20);
      if (error) throw error;
      return { count: count ?? 0, rows: data ?? [] };
    },
  });
}

// One fetch covers the payment-queue-depth tile, the aged-5-days tile, and
// the per-stage oldest-in-stage backlog breakdown — all derived from the
// same small set of currently-active vendor + transport payments.
function usePaymentQueue() {
  return useQuery({
    queryKey: ['day-kpis-payment-queue'],
    queryFn: async () => {
      const [vendorRes, transportRes] = await Promise.all([
        supabase.from('ff_vendor_payments')
          .select('id, payment_status, created_at, net_amount, gross_amount')
          .in('payment_status', ACTIVE_PAYMENT_STATUSES),
        supabase.from('ff_transport_payments')
          .select('id, payment_status, created_at, total_amount')
          .in('payment_status', ACTIVE_PAYMENT_STATUSES),
      ]);
      if (vendorRes.error) throw vendorRes.error;
      if (transportRes.error) throw transportRes.error;

      const rows = [
        ...(vendorRes.data ?? []).map((r: any) => ({ status: r.payment_status, created_at: r.created_at, amount: Number(r.net_amount ?? r.gross_amount ?? 0) })),
        ...(transportRes.data ?? []).map((r: any) => ({ status: r.payment_status, created_at: r.created_at, amount: Number(r.total_amount ?? 0) })),
      ];

      const now = Date.now();
      const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
      const aged = rows.filter(r => now - new Date(r.created_at).getTime() >= fiveDaysMs);

      const byStage = new Map<string, { count: number; oldest: string }>();
      rows.forEach(r => {
        const cur = byStage.get(r.status);
        if (!cur || r.created_at < cur.oldest) byStage.set(r.status, { count: (cur?.count ?? 0) + 1, oldest: r.created_at });
        else cur.count++;
      });

      return {
        activeCount: rows.length,
        activeAmount: rows.reduce((s, r) => s + r.amount, 0),
        agedCount: aged.length,
        agedAmount: aged.reduce((s, r) => s + r.amount, 0),
        byStage: Array.from(byStage.entries()).map(([status, v]) => ({
          status,
          count: v.count,
          oldestDays: Math.floor((now - new Date(v.oldest).getTime()) / (24 * 60 * 60 * 1000)),
        })).sort((a, b) => b.oldestDays - a.oldestDays),
      };
    },
  });
}

// Shared by both Day Open ("going into today") and Day Close ("still
// unresolved at close") — same live snapshot, no date filter (it's stock
// on hand, not an event).
function useStockLevels() {
  return useQuery({
    queryKey: ['day-kpis-stock-levels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('quantity, min_threshold');
      if (error) throw error;
      const rows = data ?? [];
      let outOfStock = 0, lowStock = 0;
      rows.forEach((r: any) => {
        const qty = Number(r.quantity ?? 0);
        const min = Number(r.min_threshold ?? 0);
        if (qty === 0) outOfStock++;
        else if (min > 0 && qty <= min) lowStock++;
      });
      return { outOfStock, lowStock, totalLines: rows.length };
    },
  });
}

function useWarehouseBacklog() {
  return useQuery({
    queryKey: ['day-kpis-warehouse-backlog'],
    queryFn: async () => {
      const [transitRes, qcRes] = await Promise.all([
        supabase.from('transit_records').select('id', { count: 'exact', head: true }).not('status', 'eq', 'completed'),
        supabase.from('qc_inspections').select('id', { count: 'exact', head: true }).neq('review_status', 'reviewed'),
      ]);
      return { transitOpen: transitRes.count ?? 0, qcOpen: qcRes.count ?? 0 };
    },
  });
}

// ── Day Close queries ───────────────────────────────────────────

function useBuysToday() {
  return useQuery({
    queryKey: ['day-kpis-buys-today'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_entries')
        .select('id, total_amount')
        .gte('created_at', `${TODAY}T00:00:00`);
      if (error) throw error;
      const rows = data ?? [];
      return { count: rows.length, total: rows.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0) };
    },
  });
}

function usePaymentsPaidToday() {
  return useQuery({
    queryKey: ['day-kpis-payments-paid-today'],
    queryFn: async () => {
      const [vendorRes, transportRes] = await Promise.all([
        supabase.from('ff_vendor_payments').select('id, net_amount, gross_amount').eq('payment_status', 'paid').gte('paid_at', `${TODAY}T00:00:00`),
        supabase.from('ff_transport_payments').select('id, total_amount').eq('payment_status', 'paid').gte('paid_at', `${TODAY}T00:00:00`),
      ]);
      const vendorRows = vendorRes.data ?? [];
      const transportRows = transportRes.data ?? [];
      const total = vendorRows.reduce((s, r: any) => s + Number(r.net_amount ?? r.gross_amount ?? 0), 0)
        + transportRows.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0);
      return { count: vendorRows.length + transportRows.length, total };
    },
  });
}

function useReceivingToday() {
  return useQuery({
    queryKey: ['day-kpis-receiving-today'],
    queryFn: async () => {
      const [transitRes, qcRes] = await Promise.all([
        supabase.from('transit_records').select('id', { count: 'exact', head: true }).gte('created_at', `${TODAY}T00:00:00`),
        supabase.from('qc_inspections').select('id', { count: 'exact', head: true }).gte('created_at', `${TODAY}T00:00:00`),
      ]);
      return { transitCount: transitRes.count ?? 0, qcCount: qcRes.count ?? 0 };
    },
  });
}

function useCashCollectedToday() {
  return useQuery({
    queryKey: ['day-kpis-cash-collected-today'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_collections')
        .select('amount')
        .eq('collection_date', TODAY)
        .eq('status', 'verified');
      if (error) throw error;
      return { total: (data ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0) };
    },
  });
}

function useVouchersToday() {
  return useQuery({
    queryKey: ['day-kpis-vouchers-today'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acct_vouchers')
        .select('id, total_debit')
        .eq('posting_date', TODAY)
        .eq('status', 'posted');
      if (error) throw error;
      const rows = data ?? [];
      return { count: rows.length, total: rows.reduce((s, r: any) => s + Number(r.total_debit ?? 0), 0) };
    },
  });
}

// POs generated today that nobody has bought against yet, at all. Cross-
// references useOvernightPOs' rows against every purchase_entries.po_id
// ever recorded (the whole table is a handful of rows, no paging needed).
function useZeroBuyPOs(overnightPOs: { id: string; po_number: string; hub_name: string; total_amount: number }[]) {
  return useQuery({
    queryKey: ['day-kpis-zero-buy-pos', overnightPOs.map(p => p.id).join(',')],
    enabled: overnightPOs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_entries').select('po_id');
      if (error) throw error;
      const boughtIds = new Set((data ?? []).map((r: any) => r.po_id));
      return overnightPOs.filter(po => !boughtIds.has(po.id));
    },
  });
}

// ── UI ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2.5 rounded-xl bg-primary/10">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function BacklogPanel({ title, rows, renderRow, viewAllHref, viewAllLabel }: {
  title: string; rows: any[]; renderRow: (r: any) => React.ReactNode; viewAllHref: string; viewAllLabel: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-card/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {rows.map(renderRow)}
      </div>
      <a href={viewAllHref} className="inline-block mt-3 text-xs font-semibold text-primary hover:underline">
        {viewAllLabel} →
      </a>
    </div>
  );
}

export default function DayKPIsPage() {
  const ordersToday = useTodayOrders();
  const overnightPOs = useOvernightPOs();
  const unassigned = useUnassignedBacklog();
  const paymentQueue = usePaymentQueue();
  const stock = useStockLevels();
  const warehouseBacklog = useWarehouseBacklog();

  const buysToday = useBuysToday();
  const paymentsPaid = usePaymentsPaidToday();
  const receivingToday = useReceivingToday();
  const cashCollected = useCashCollectedToday();
  const vouchersToday = useVouchersToday();
  const zeroBuyPOs = useZeroBuyPOs(overnightPOs.data?.rows ?? []);

  const anyError = [ordersToday, overnightPOs, unassigned, paymentQueue, stock, warehouseBacklog,
    buysToday, paymentsPaid, receivingToday, cashCollected, vouchersToday, zeroBuyPOs]
    .find(q => q.isError);

  const refreshAll = () => {
    ordersToday.refetch(); overnightPOs.refetch(); unassigned.refetch(); paymentQueue.refetch();
    stock.refetch(); warehouseBacklog.refetch(); buysToday.refetch(); paymentsPaid.refetch();
    receivingToday.refetch(); cashCollected.refetch(); vouchersToday.refetch(); zeroBuyPOs.refetch();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-8 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Day Open / Day Close KPIs</h1>
          <p className="text-sm text-muted-foreground">As of {format(new Date(), 'd MMM yyyy, h:mm a')}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="#day-open" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors">
            <Sunrise className="w-3.5 h-3.5 inline mr-1" /> Day Open
          </a>
          <a href="#day-close" className="px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 transition-colors">
            <Sunset className="w-3.5 h-3.5 inline mr-1" /> Day Close
          </a>
          <button onClick={refreshAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-border hover:bg-muted transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {anyError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
          <span>Some KPIs failed to load — the numbers below may be incomplete.</span>
          <button onClick={refreshAll} className="font-semibold hover:underline">Retry</button>
        </div>
      )}

      {/* ── Day Open ── */}
      <section id="day-open" style={{ scrollMarginTop: '80px' }}>
        <SectionHeader icon={Sunrise} title="Day Open — Morning Snapshot" subtitle="What came in overnight, and what needs action today" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <AnalyticsMetricCard title="Orders Today" value={ordersToday.data?.count ?? '—'} subValue={ordersToday.data ? inr(ordersToday.data.revenue) : undefined} icon={ShoppingCart} colorScheme="blue" />
          <AnalyticsMetricCard title="POs Generated Overnight" value={overnightPOs.data?.count ?? '—'} subValue={overnightPOs.data ? inr(overnightPOs.data.total) : undefined} icon={FileText} colorScheme="indigo" />
          <AnalyticsMetricCard title="POs Unassigned" value={unassigned.data?.count ?? '—'} subValue="Waiting for a purchase executive" icon={AlertTriangle} colorScheme="amber" />
          <AnalyticsMetricCard title="Payment Queue" value={paymentQueue.data?.activeCount ?? '—'} subValue={paymentQueue.data ? inr(paymentQueue.data.activeAmount) : undefined} icon={Banknote} colorScheme="purple" />
          <AnalyticsMetricCard title="Payments Aged 5+ Days" value={paymentQueue.data?.agedCount ?? '—'} subValue={paymentQueue.data ? inr(paymentQueue.data.agedAmount) : undefined} icon={Clock} colorScheme="rose" />
          <AnalyticsMetricCard title="Low / Out of Stock" value={stock.data ? stock.data.outOfStock + stock.data.lowStock : '—'} subValue={stock.data ? `${stock.data.outOfStock} out, ${stock.data.lowStock} low` : undefined} icon={Boxes} colorScheme="amber" />
          <AnalyticsMetricCard title="Warehouse Backlog Carried Over" value={warehouseBacklog.data ? warehouseBacklog.data.transitOpen + warehouseBacklog.data.qcOpen : '—'} subValue={warehouseBacklog.data && warehouseBacklog.data.transitOpen + warehouseBacklog.data.qcOpen === 0 ? 'Warehouse receiving not yet in use' : undefined} icon={Truck} colorScheme="slate" />
        </div>

        <BacklogPanel
          title={`${unassigned.data?.count ?? 0} purchase orders waiting for assignment`}
          rows={unassigned.data?.rows ?? []}
          viewAllHref="/purchase/orders"
          viewAllLabel="View all in Purchase Orders"
          renderRow={(po: any) => (
            <div key={po.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
              <span className="font-mono font-semibold">{po.po_number}</span>
              <span className="text-muted-foreground">{po.hub_name}</span>
              <span className="text-muted-foreground">{po.eod_date}</span>
              <span className="font-semibold">{inr(po.total_amount)}</span>
            </div>
          )}
        />
      </section>

      {/* ── Day Close ── */}
      <section id="day-close" style={{ scrollMarginTop: '80px' }}>
        <SectionHeader icon={Sunset} title="Day Close — Today's Activity" subtitle="What actually happened today" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <AnalyticsMetricCard title="Orders Fulfilled" value={ordersToday.data?.count ?? '—'} subValue={ordersToday.data ? inr(ordersToday.data.revenue) : undefined} icon={ShoppingCart} colorScheme="blue" />
          <AnalyticsMetricCard title="Buys Completed" value={buysToday.data?.count ?? '—'} subValue={buysToday.data ? inr(buysToday.data.total) : undefined} icon={ShoppingBag} colorScheme="blue" />
          <AnalyticsMetricCard title="Payments Paid Today" value={paymentsPaid.data?.count ?? '—'} subValue={paymentsPaid.data ? inr(paymentsPaid.data.total) : undefined} icon={CheckCircle2} colorScheme="emerald" />
          <AnalyticsMetricCard title="Goods Received Today" value={receivingToday.data ? receivingToday.data.transitCount + receivingToday.data.qcCount : '—'} subValue="Gate entries + QC done" icon={Truck} colorScheme="slate" />
          <AnalyticsMetricCard title="Cash Collected Today" value={cashCollected.data ? inr(cashCollected.data.total) : '—'} subValue={cashCollected.data?.total === 0 ? 'No verified collections today' : undefined} icon={Wallet} colorScheme="emerald" />
          <AnalyticsMetricCard title="Vouchers Posted Today" value={vouchersToday.data?.count ?? '—'} subValue={vouchersToday.data ? inr(vouchersToday.data.total) : undefined} icon={FileBarChart} colorScheme="slate" />
        </div>

        {/* Carrying forward to tomorrow — deliberately visually distinct, not just more tiles */}
        <div className="mt-6 rounded-2xl border-2 border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-amber-700 uppercase tracking-wide">Carrying Forward to Tomorrow</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <AnalyticsMetricCard title="POs Still Unassigned" value={unassigned.data?.count ?? '—'} icon={AlertTriangle} colorScheme="amber" />
            <AnalyticsMetricCard title="Today's POs With Zero Buying" value={zeroBuyPOs.data?.length ?? '—'} subValue={overnightPOs.data ? `of ${overnightPOs.data.count} generated today` : undefined} icon={PackageX} colorScheme="rose" />
            <AnalyticsMetricCard title="Payments Aged 5+ Days" value={paymentQueue.data?.agedCount ?? '—'} icon={Clock} colorScheme="rose" />
            <AnalyticsMetricCard title="Low / Out of Stock" value={stock.data ? stock.data.outOfStock + stock.data.lowStock : '—'} icon={Boxes} colorScheme="amber" />
          </div>

          {paymentQueue.data && paymentQueue.data.byStage.length > 0 && (
            <div className="mt-4 pt-4 border-t border-amber-500/20">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-2">Payment queue by stage — oldest first</p>
              <div className="space-y-1">
                {paymentQueue.data.byStage.map(s => (
                  <div key={s.status} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{s.status}</span>
                    <span className="text-muted-foreground">{s.count} payment{s.count !== 1 ? 's' : ''}</span>
                    <span className={s.oldestDays >= 5 ? 'font-bold text-rose-600' : 'text-muted-foreground'}>{s.oldestDays}d oldest</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <BacklogPanel
            title="Purchase orders generated today with no buying activity yet"
            rows={zeroBuyPOs.data?.slice(0, 20) ?? []}
            viewAllHref="/reports/purchase"
            viewAllLabel="View all in Purchase Report"
            renderRow={(po: any) => (
              <div key={po.id} className="flex items-center justify-between text-xs py-1 border-b border-amber-500/10 last:border-0">
                <span className="font-mono font-semibold">{po.po_number}</span>
                <span className="text-muted-foreground">{po.hub_name}</span>
                <span className="font-semibold">{inr(po.total_amount)}</span>
              </div>
            )}
          />
        </div>
      </section>
    </div>
  );
}
