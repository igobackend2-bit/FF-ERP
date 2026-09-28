import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom'; // Link kept for ExpandedOrderDetail
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays, startOfWeek } from 'date-fns';
import {
  ShoppingBag, Search, Clock,
  CheckCircle2, Truck, XCircle, RefreshCw,
  ChevronRight, ChevronDown, User2, IndianRupee, X,
  Phone, MapPin, Repeat, Package, FileText, ShoppingCart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveOrderCustomer } from '@/lib/resolveOrderCustomer';

/* ─── Status config ───────────────────────────────────────────────────────── */
const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  draft:      { label: 'Draft',      className: 'bg-slate-100 text-slate-600',  icon: <Clock className="h-3 w-3" /> },
  pending:    { label: 'Pending',    className: 'bg-amber-100 text-amber-700',  icon: <Clock className="h-3 w-3" /> },
  confirmed:  { label: 'Confirmed',  className: 'bg-blue-50 text-[#2C64E3]',   icon: <CheckCircle2 className="h-3 w-3" /> },
  dispatched: { label: 'Dispatched', className: 'bg-purple-50 text-purple-700',icon: <Truck className="h-3 w-3" /> },
  delivered:  { label: 'Delivered',  className: 'bg-green-50 text-green-700',  icon: <CheckCircle2 className="h-3 w-3" /> },
  cancelled:  { label: 'Cancelled',  className: 'bg-red-50 text-red-600',      icon: <XCircle className="h-3 w-3" /> },
  partial:    { label: 'Partial',    className: 'bg-orange-50 text-orange-700',icon: <Clock className="h-3 w-3" /> },
};

const DATE_RANGES = [
  { label: 'Today',     value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'week' },
  { label: 'Custom',    value: 'custom' },
  { label: 'All',       value: 'all' },
] as const;

type DateRange = typeof DATE_RANGES[number]['value'];
type StatusFilter = 'all' | 'submit_po' | keyof typeof STATUS_CONFIG;

function getDateRange(range: DateRange, customFrom: string, customTo: string): { from: string; to: string } | null {
  const today = format(new Date(), 'yyyy-MM-dd');
  if (range === 'today')     return { from: today, to: today };
  if (range === 'yesterday') { const y = format(subDays(new Date(), 1), 'yyyy-MM-dd'); return { from: y, to: y }; }
  if (range === 'week')      return { from: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: today };
  if (range === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-slate-100 text-slate-600', icon: <Clock className="h-3 w-3" /> };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', cfg.className)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

/* ─── Expanded Order Detail Row ──────────────────────────────────────────── */
function ExpandedOrderDetail({ orderId, onRepeat, hideActions }: { orderId: string; onRepeat: (id: string) => void; hideActions?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['order-expand', orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales_orders')
        .select(`
          *,
          customer:customers(shop_name, first_name, last_name, owner_name, phone, mobile, area, city, gst_number, credit_limit, outstanding_balance),
          items:sales_order_items(id, product_name, qty_kg, unit_price, total_price, qc_grade, unit, notes, product:products(name, category, unit))
        `)
        .eq('id', orderId).single();
      return data;
    },
  });

  if (isLoading) return (
    <tr><td colSpan={8} className="px-6 py-4 text-center text-xs text-slate-400">
      <RefreshCw className="h-4 w-4 animate-spin inline mr-1" /> Loading details…
    </td></tr>
  );
  if (!data) return null;

  const customer = (data as any).customer;
  const items    = (data as any).items ?? [];
  const subtotal = items.reduce((s: number, i: any) => s + Number(i.total_price || 0), 0);
  const customerName = customer?.shop_name || `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim();
  // No linked customers row (website/app orders) -- recover name/phone/address
  // from the order's own columns instead of showing a blank card.
  const fallback = !customerName ? resolveOrderCustomer(data as any) : null;

  return (
    <tr>
      <td colSpan={8} className="bg-slate-50/80 border-b border-slate-200 px-0 py-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">

          {/* Customer card */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Customer Details</p>
            <p className="text-sm font-bold text-slate-800">
              {customerName || fallback?.name || '—'}
            </p>
            {customer?.owner_name && <p className="text-xs text-slate-500">{customer.owner_name}</p>}
            {(customer?.phone || customer?.mobile || fallback?.phone) && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Phone className="h-3 w-3 text-slate-400" />
                <a href={`tel:${customer?.mobile || customer?.phone || fallback?.phone}`} className="hover:underline text-blue-600">
                  {customer?.mobile || customer?.phone || fallback?.phone}
                </a>
              </div>
            )}
            {(customer?.area || customer?.city) ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <MapPin className="h-3 w-3 text-slate-400" />
                {[customer.area, customer.city].filter(Boolean).join(', ')}
              </div>
            ) : fallback?.address && (
              <div className="flex items-start gap-1.5 text-xs text-slate-600">
                <MapPin className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                {fallback.address}
              </div>
            )}
            {customer?.gst_number && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <FileText className="h-3 w-3 text-slate-400" /> {customer.gst_number}
              </div>
            )}
            {Number(customer?.outstanding_balance) > 0 && (
              <div className="text-xs font-semibold text-red-600 bg-red-50 rounded px-2 py-1">
                Outstanding: ₹{Number(customer.outstanding_balance).toLocaleString()}
              </div>
            )}
            {Number(customer?.credit_limit) > 0 && (
              <div className="text-xs text-slate-500">Credit limit: ₹{Number(customer.credit_limit).toLocaleString()}</div>
            )}
          </div>

          {/* Items table */}
          <div className="lg:col-span-1 px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
              Order Items ({items.length})
            </p>
            <div className="space-y-1.5">
              {items.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-slate-700 truncate">{item.product?.name || item.product_name || 'Custom item'}</span>
                    <span className="text-slate-400 ml-1.5">
                      {item.qty_kg} {item.unit || item.product?.unit || 'kg'}
                      {Number(item.discount_pct) > 0 && <span className="text-green-600 ml-1">-{item.discount_pct}%</span>}
                    </span>
                    {item.notes && <p className="text-slate-400 text-[10px] italic">{item.notes}</p>}
                  </div>
                  <span className="font-semibold text-slate-800 ml-2">₹{Number(item.total_price || 0).toLocaleString('en-IN')}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-2 mt-2 text-xs">
                <span>Net Total</span>
                <span className="text-green-700">₹{Number((data as any).net_amount ?? subtotal).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {/* Meta + actions */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Order Info</p>
            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Created by</span>
                <span className="font-medium">FF Operations</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Date</span>
                <span className="font-medium">{format(new Date((data as any).created_at), 'd MMM yyyy, h:mm a')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment</span>
                <span className="font-medium uppercase">{(data as any).payment_mode || 'COD'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pay status</span>
                <span className={cn('font-bold uppercase', (data as any).payment_status === 'paid' ? 'text-green-600' : 'text-amber-600')}>
                  {(data as any).payment_status || 'Unpaid'}
                </span>
              </div>
              {(data as any).notes && (
                <div className="bg-amber-50 rounded px-2 py-1 text-amber-700 text-[10px] mt-1">
                  Note: {(data as any).notes}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-3">
              <Link to={`/sales/orders/${orderId}`}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700">
                <Package className="h-3.5 w-3.5" /> View Full Order
              </Link>
              {!hideActions && (
                <button onClick={() => onRepeat(orderId)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-gray-50">
                  <Repeat className="h-3.5 w-3.5" /> Repeat This Order
                </button>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function OrderListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isManagement = ['ceo', 'gm', 'admin', 'director', 'nsm'].includes((user as any)?.role ?? '');
  // Admin's and CEO's sidebar links to this page are meant as read-only
  // visibility — hide every affordance that leads toward creating/repeating
  // an order for those two roles specifically.
  const hideCreateActions = ['admin', 'ceo'].includes((user as any)?.role);

  // Filters
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange]     = useState<DateRange>('all');
  const [customFrom, setCustomFrom]   = useState('');
  const [customTo, setCustomTo]       = useState('');
  const [minAmount, setMinAmount]     = useState('');
  const [maxAmount, setMaxAmount]     = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);

  const handleRepeat = (orderId: string) =>
    navigate(`/sales/new-order?repeat_order_id=${orderId}`);

  const range = getDateRange(dateRange, customFrom, customTo);

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['all-sales-orders', dateRange, statusFilter, customFrom, customTo],
    queryFn: async () => {
      let q = supabase
        .from('sales_orders')
        .select(`
          id, order_number, status, net_amount, total_amount,
          payment_mode, payment_status, order_date, created_at, source,
          customer_name, customer_phone, delivery_address,
          customer:customers(shop_name, name, first_name, last_name, phone, mobile, area)
        `)
        .order('created_at', { ascending: false })
        .limit(500);

      if (range) q = q.gte('created_at', range.from).lte('created_at', range.to + 'T23:59:59');
      // 'submit_po' is a UI-only filter — maps to 'confirmed' in the DB
      const dbStatus = statusFilter === 'submit_po' ? 'confirmed' : statusFilter;
      if (dbStatus !== 'all') q = q.eq('status', dbStatus);
      if (!isManagement && (user as any)?.hub_id)
        q = (q as any).or(`hub_id.eq.${(user as any).hub_id},hub_id.is.null`);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  /* ── Client-side filtering (search + price range) ── */
  const filtered = (orders as any[]).filter((o: any) => {
    // Search
    if (search.trim()) {
      const s = search.toLowerCase();
      const match =
        (o.order_number ?? '').toLowerCase().includes(s) ||
        (o.customer?.shop_name ?? '').toLowerCase().includes(s) ||
        (o.customer?.name ?? '').toLowerCase().includes(s) ||
        (o.customer?.area ?? '').toLowerCase().includes(s);
      if (!match) return false;
    }
    // Price range
    const amt = Number(o.net_amount ?? o.total_amount) || 0;
    if (minAmount && amt < Number(minAmount)) return false;
    if (maxAmount && amt > Number(maxAmount)) return false;
    return true;
  });

  const statusCounts = (orders as any[]).reduce<Record<string, number>>((acc, o: any) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalValue = filtered.reduce((s: number, o: any) => s + (Number(o.net_amount ?? o.total_amount) || 0), 0);

  const hasActiveFilters = minAmount || maxAmount || (dateRange === 'custom' && (customFrom || customTo));

  const clearPriceFilter = () => { setMinAmount(''); setMaxAmount(''); };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sales Orders</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            <ShoppingBag className="h-3.5 w-3.5" />
            {filtered.length} order{filtered.length !== 1 ? 's' : ''}
            <span className="text-slate-300">·</span>
            <span className="font-semibold text-slate-700">₹{totalValue.toLocaleString('en-IN')}</span>
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 text-slate-400 hover:text-[#2C64E3] hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-colors"
        >
          <RefreshCw className={cn('h-5 w-5', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* ── Filter card ── */}
      <div className="zoho-card p-0 flex flex-col divide-y divide-slate-100">

        {/* Row 1: Search only */}
        <div className="p-4">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search by order #, customer, area, or creator name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')}><X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" /></button>
            )}
          </div>
        </div>

        {/* Row 2: Date filter + Amount Range on same line */}
        <div className="px-4 py-3 flex flex-wrap items-center gap-4 border-t border-slate-100">

          {/* Date tabs */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1 flex-shrink-0">
            {DATE_RANGES.map(dr => (
              <button
                key={dr.value}
                onClick={() => setDateRange(dr.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-all',
                  dateRange === dr.value ? 'bg-white text-[#2C64E3] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {dr.label}
              </button>
            ))}
          </div>

          {/* Custom date pickers — inline when custom selected */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-xs font-semibold text-slate-400">To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {/* Divider */}
          <div className="h-6 w-px bg-slate-200 hidden md:block" />

          {/* Amount range */}
          <div className="flex items-center gap-2">
            <IndianRupee className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-500 flex-shrink-0">Amount:</span>
            <input
              type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)}
              placeholder="Min ₹" min="0"
              className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400 text-xs">—</span>
            <input
              type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
              placeholder="Max ₹" min="0"
              className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(minAmount || maxAmount) && (
              <button onClick={clearPriceFilter}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <span className="ml-auto text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              Filters active
            </span>
          )}
        </div>

        {/* Row 3: Status tabs */}
        <div className="px-4 py-2 flex items-center gap-4 overflow-x-auto border-b border-slate-100">
          {/* ALL */}
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              'text-xs font-bold uppercase tracking-wider pb-2 border-b-2 transition-all flex-shrink-0',
              statusFilter === 'all' ? 'border-[#2C64E3] text-[#2C64E3]' : 'border-transparent text-slate-400 hover:text-slate-600'
            )}
          >
            All ({orders.length})
          </button>

          {/* Dynamic status tabs */}
          {Object.entries(STATUS_CONFIG).map(([key, config]) => {
            const count = statusCounts[key] ?? 0;
            if (count === 0 && statusFilter !== key) return null;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key as StatusFilter)}
                className={cn(
                  'text-xs font-bold uppercase tracking-wider pb-2 border-b-2 transition-all flex-shrink-0',
                  statusFilter === key ? 'border-[#2C64E3] text-[#2C64E3]' : 'border-transparent text-slate-400 hover:text-slate-600'
                )}
              >
                {config.label} ({count})
              </button>
            );
          })}

          {/* Divider */}
          <div className="h-4 w-px bg-slate-200 flex-shrink-0" />

          {/* Submit for PO — shows confirmed orders ready for procurement */}
          {!hideCreateActions && (
            <button
              onClick={() => setStatusFilter('submit_po')}
              className={cn(
                'flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider pb-2 border-b-2 transition-all flex-shrink-0',
                statusFilter === 'submit_po'
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-amber-500 hover:text-amber-700'
              )}
            >
              <ShoppingCart className="h-3 w-3" />
              Submit for PO
              {(statusCounts['confirmed'] ?? 0) > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-black',
                  statusFilter === 'submit_po'
                    ? 'bg-amber-500 text-white'
                    : 'bg-amber-100 text-amber-700'
                )}>
                  {statusCounts['confirmed'] ?? 0}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Submit for PO Banner */}
      {!hideCreateActions && statusFilter === 'submit_po' && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <ShoppingCart className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">Confirmed orders — ready for Purchase Order creation</p>
            <p className="text-xs text-amber-600 mt-0.5">Click <strong>Create PO</strong> on any row to go to the Auto PO page and raise a purchase order for that order.</p>
          </div>
          <button
            onClick={() => navigate('/purchase/auto-po')}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
          >
            <ShoppingCart className="h-3.5 w-3.5" /> Go to Auto PO
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="zoho-table-container">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white">
            <RefreshCw className="h-10 w-10 text-[#2C64E3]/20 animate-spin" />
            <p className="text-slate-400 text-sm mt-4">Fetching orders…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white">
            <ShoppingBag className="h-12 w-12 text-gray-200 mb-3" />
            <h3 className="text-slate-700 font-bold">No orders found</h3>
            <p className="text-slate-400 text-sm mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
          <table className="zoho-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th>Payment</th>
                <th>Created By</th>
                <th>Date &amp; Time</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((order: any) => {
                const amount = Number(order.net_amount ?? order.total_amount) || 0;
                const createdAt = order.created_at ? new Date(order.created_at) : null;
                const creatorName = 'FF Operations';
                const isExpanded = expandedId === order.id;
                const rowCustomerName = order.customer?.shop_name ||
                  `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() ||
                  order.customer?.name;
                const rowFallback = !rowCustomerName ? resolveOrderCustomer(order) : null;

                return (
                  <>
                    <tr
                      key={order.id}
                      onClick={() => setExpandedId(isExpanded ? null : order.id)}
                      className={cn('cursor-pointer group transition-colors', isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/60')}
                    >
                      {/* Order # */}
                      <td>
                        <span className="font-bold text-[#2C64E3] text-xs">
                          #{order.order_number}
                        </span>
                      </td>

                      {/* Customer */}
                      <td>
                        <div className="font-semibold text-slate-800 text-sm">
                          {rowCustomerName || rowFallback?.name || 'Walk-in'}
                        </div>
                        {order.customer?.area && <div className="text-[11px] text-slate-400">{order.customer.area}</div>}
                        {(order.customer?.mobile || order.customer?.phone || (order as any).customer_phone || rowFallback?.phone) && (
                          <div className="text-[10px] text-slate-400">{order.customer?.mobile || order.customer?.phone || (order as any).customer_phone || rowFallback?.phone}</div>
                        )}
                      </td>

                      {/* Status */}
                      <td><StatusBadge status={order.status} /></td>

                      {/* Amount */}
                      <td className="text-right">
                        <span className="font-bold text-slate-800">₹{amount.toLocaleString('en-IN')}</span>
                      </td>

                      {/* Payment */}
                      <td>
                        <div className="text-xs font-semibold text-slate-600 uppercase">{order.payment_mode || 'COD'}</div>
                        <div className={cn('text-[10px] font-bold', order.payment_status === 'paid' ? 'text-green-600' : 'text-amber-600')}>
                          {order.payment_status?.toUpperCase() || 'UNPAID'}
                        </div>
                      </td>

                      {/* Created By */}
                      <td>
                        <div className="flex items-center gap-1.5">
                          <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                            <User2 className="h-3 w-3 text-slate-400" />
                          </div>
                          <span className="text-xs text-slate-700 truncate max-w-[100px]">{creatorName}</span>
                        </div>
                      </td>

                      {/* Date & Time — order_date alongside created_at, same "label: date" pattern as the Purchase Report's PO/Delivery Date column */}
                      <td>
                        {createdAt || order.order_date ? (
                          <div>
                            {order.order_date && (
                              <div className="text-xs text-slate-700">
                                <span className="text-slate-400">Order:</span> {format(new Date(order.order_date), 'd MMM yyyy')}
                              </div>
                            )}
                            {createdAt && (
                              <div className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {order.order_date ? 'Created ' : ''}{format(createdAt, order.order_date ? 'd MMM, h:mm a' : 'd MMM yyyy, h:mm a')}
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      <td onClick={e => e.stopPropagation()}>
                        {!hideCreateActions && statusFilter === 'submit_po' ? (
                          <button
                            onClick={() => navigate('/purchase/auto-po')}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg whitespace-nowrap transition-colors"
                          >
                            <ShoppingCart className="h-3 w-3" /> Create PO
                          </button>
                        ) : (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-[#2C64E3]" />
                            : <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-[#2C64E3] transition-colors" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <ExpandedOrderDetail
                        key={`expand-${order.id}`}
                        orderId={order.id}
                        onRepeat={handleRepeat}
                        hideActions={hideCreateActions}
                      />
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-center text-[11px] text-slate-400">
          Showing {filtered.length} of {orders.length} orders
        </p>
      )}
    </div>
  );
}
