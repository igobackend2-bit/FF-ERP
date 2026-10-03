// @ts-nocheck
// Read-only list definitions for the Management Overview role.
// Every entry here is a SELECT description — this module (and the whole pages/overview
// folder) must never contain insert / update / delete / upsert / rpc calls.
import type { ReactNode } from 'react';
import { format } from 'date-fns';

export type TabKey =
  | 'summary' | 'sales-orders' | 'purchase-orders' | 'collections' | 'cash-closing'
  | 'vendor-payments' | 'transport-payments' | 'invoices' | 'stock';

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  value: (row: any) => string | number | null;       // plain value (CSV + default display)
  render?: (row: any) => ReactNode;                   // optional rich display
}

export interface ListConfig {
  key: TabKey;
  title: string;
  table: string;
  select: string;
  order: { column: string; ascending: boolean }[];
  dateColumn?: string;
  dateType?: 'date' | 'ts';
  hubColumn?: string;
  searchColumns?: string[];
  searchHint?: string;
  statusColumn?: string;
  statusOptions?: string[];
  statusGroups?: { value: string; label: string; like: string }[];   // e.g. every 'pending_*' stage in one pick
  defaultDays?: number;          // default window (days back from today); omit = no date filter
  columns: Column[];
  // Optional strip above the table, computed over ALL rows matching the filters (not just the page)
  totalsSelect?: string;
  totals?: { label: string; compute: (rows: any[]) => string }[];
}

export const inr = (n: any) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const day = (d: any) => (d ? format(new Date(d), 'dd MMM yyyy') : '—');
const dayTime = (d: any) => (d ? format(new Date(d), 'dd MMM yyyy, hh:mm a') : '—');
const label = (s: any) => String(s ?? '—').replace(/_/g, ' ');

export const LISTS: Record<Exclude<TabKey, 'summary'>, ListConfig> = {
  'sales-orders': {
    key: 'sales-orders', title: 'Sales Orders', table: 'sales_orders',
    select: 'id, order_number, customer_name, customer_phone, order_date, delivery_date, status, payment_mode, payment_status, total_amount, hub_name, source, created_at',
    order: [{ column: 'order_date', ascending: false }, { column: 'created_at', ascending: false }],
    dateColumn: 'order_date', dateType: 'date', hubColumn: 'hub_id', defaultDays: 6,
    searchColumns: ['order_number', 'customer_name', 'customer_phone'], searchHint: 'Order no, customer or phone',
    statusColumn: 'status', statusOptions: ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled'],
    columns: [
      { key: 'order_number', label: 'Order', value: r => r.order_number },
      { key: 'customer', label: 'Customer', value: r => r.customer_name },
      { key: 'phone', label: 'Phone', value: r => r.customer_phone },
      { key: 'hub', label: 'Hub', value: r => r.hub_name },
      { key: 'order_date', label: 'Order date', value: r => r.order_date, render: r => day(r.order_date) },
      { key: 'delivery_date', label: 'Delivery', value: r => r.delivery_date, render: r => day(r.delivery_date) },
      { key: 'status', label: 'Status', value: r => r.status },
      { key: 'payment', label: 'Payment', value: r => `${r.payment_mode ?? ''} ${r.payment_status ?? ''}`.trim() },
      { key: 'total', label: 'Amount', align: 'right', value: r => Number(r.total_amount || 0), render: r => inr(r.total_amount) },
    ],
  },
  'purchase-orders': {
    key: 'purchase-orders', title: 'Purchase Orders', table: 'purchase_orders',
    select: 'id, po_number, vendor_name, hub_name, eod_date, status, items_count, total_amount, total_estimated, created_at',
    order: [{ column: 'eod_date', ascending: false }, { column: 'created_at', ascending: false }],
    dateColumn: 'eod_date', dateType: 'date', hubColumn: 'hub_id', defaultDays: 6,
    searchColumns: ['po_number', 'vendor_name'], searchHint: 'PO no or vendor',
    statusColumn: 'status', statusOptions: ['pending', 'assigned', 'purchasing', 'purchased', 'received', 'cancelled'],
    columns: [
      { key: 'po_number', label: 'PO', value: r => r.po_number },
      { key: 'vendor', label: 'Vendor', value: r => r.vendor_name },
      { key: 'hub', label: 'Hub', value: r => r.hub_name },
      { key: 'eod_date', label: 'PO date', value: r => r.eod_date, render: r => day(r.eod_date) },
      { key: 'status', label: 'Status', value: r => r.status },
      { key: 'items', label: 'Items', align: 'right', value: r => Number(r.items_count || 0) },
      { key: 'total', label: 'Amount', align: 'right',
        value: r => Number(r.total_amount || r.total_estimated || 0), render: r => inr(r.total_amount || r.total_estimated) },
    ],
  },
  'collections': {
    key: 'collections', title: 'Cash Collections', table: 'cash_collections',
    select: 'id, collection_date, shop_name, customer_name, order_number, order_amount, collected_amount, amount, payment_mode, status, created_at, hubs(name), collector:profiles!cash_collections_collector_id_fkey(name)',
    order: [{ column: 'collection_date', ascending: false }, { column: 'created_at', ascending: false }],
    dateColumn: 'collection_date', dateType: 'date', hubColumn: 'hub_id', defaultDays: 6,
    searchColumns: ['shop_name', 'customer_name', 'order_number'], searchHint: 'Shop, customer or order no',
    statusColumn: 'status', statusOptions: ['collected', 'verified', 'deposited'],
    columns: [
      { key: 'date', label: 'Date', value: r => r.collection_date, render: r => day(r.collection_date) },
      { key: 'shop', label: 'Shop / customer', value: r => r.shop_name || r.customer_name },
      { key: 'order', label: 'Order', value: r => r.order_number },
      { key: 'hub', label: 'Hub', value: r => r.hubs?.name },
      { key: 'collector', label: 'Collector', value: r => r.collector?.name },
      { key: 'mode', label: 'Mode', value: r => r.payment_mode },
      { key: 'billed', label: 'Order amount', align: 'right', value: r => Number(r.order_amount || 0), render: r => inr(r.order_amount) },
      { key: 'collected', label: 'Collected', align: 'right',
        value: r => Number(r.collected_amount ?? r.amount ?? 0), render: r => inr(r.collected_amount ?? r.amount) },
      { key: 'status', label: 'Status', value: r => r.status },
    ],
  },
  'cash-closing': {
    key: 'cash-closing', title: 'Daily Cash Closing', table: 'daily_cash_closings',
    select: 'id, closing_date, opening_cash, cash_collected, upi_collected, cash_expenses, cash_deposited, actual_cash, notes, hubs(name)',
    order: [{ column: 'closing_date', ascending: false }],
    dateColumn: 'closing_date', dateType: 'date', hubColumn: 'hub_id', defaultDays: 13,
    columns: [
      { key: 'date', label: 'Date', value: r => r.closing_date, render: r => day(r.closing_date) },
      { key: 'hub', label: 'Hub', value: r => r.hubs?.name },
      { key: 'open', label: 'Opening cash', align: 'right', value: r => Number(r.opening_cash || 0), render: r => inr(r.opening_cash) },
      { key: 'cash', label: 'Cash collected', align: 'right', value: r => Number(r.cash_collected || 0), render: r => inr(r.cash_collected) },
      { key: 'upi', label: 'UPI collected', align: 'right', value: r => Number(r.upi_collected || 0), render: r => inr(r.upi_collected) },
      { key: 'exp', label: 'Expenses', align: 'right', value: r => Number(r.cash_expenses || 0), render: r => inr(r.cash_expenses) },
      { key: 'dep', label: 'Deposited', align: 'right', value: r => Number(r.cash_deposited || 0), render: r => inr(r.cash_deposited) },
      { key: 'actual', label: 'Actual cash', align: 'right', value: r => Number(r.actual_cash || 0), render: r => inr(r.actual_cash) },
      { key: 'variance', label: 'Variance', align: 'right',
        value: r => Number(r.actual_cash || 0) - (Number(r.opening_cash || 0) + Number(r.cash_collected || 0) - Number(r.cash_expenses || 0) - Number(r.cash_deposited || 0)),
        render: r => {
          const v = Number(r.actual_cash || 0) - (Number(r.opening_cash || 0) + Number(r.cash_collected || 0) - Number(r.cash_expenses || 0) - Number(r.cash_deposited || 0));
          return <span className={v === 0 ? 'text-slate-500' : v < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>{inr(v)}</span>;
        } },
    ],
  },
  'vendor-payments': {
    key: 'vendor-payments', title: 'Vendor Payments', table: 'ff_vendor_payments',
    select: 'id, created_at, payment_status, gross_amount, deduction_amount, net_amount, utr_number, paid_at, is_bulk, vendors(name), hubs(name), purchase_orders(po_number)',
    order: [{ column: 'created_at', ascending: false }],
    dateColumn: 'created_at', dateType: 'ts', hubColumn: 'hub_id',   // no default date window: raised payments must always be visible
    searchColumns: ['utr_number'], searchHint: 'UTR number',
    statusColumn: 'payment_status',
    statusGroups: [{ value: '__pending__', label: 'All pending (raised, not yet paid)', like: 'pending%' }],
    statusOptions: ['pending_ff_ops', 'pending_gm', 'pending_l1', 'pending_auditor', 'pending_ceo', 'pending_admin', 'pending_accounts', 'approved', 'paid', 'rejected'],
    columns: [
      { key: 'created', label: 'Raised', value: r => r.created_at, render: r => dayTime(r.created_at) },
      { key: 'vendor', label: 'Vendor', value: r => r.vendors?.name, render: r => <>{r.vendors?.name ?? '—'}{r.is_bulk && <span className="ml-1 text-[10px] text-slate-400">bulk</span>}</> },
      { key: 'po', label: 'PO', value: r => r.purchase_orders?.po_number },
      { key: 'hub', label: 'Hub', value: r => r.hubs?.name },
      { key: 'stage', label: 'Stage', value: r => r.payment_status, render: r => label(r.payment_status) },
      { key: 'gross', label: 'Gross', align: 'right', value: r => Number(r.gross_amount || 0), render: r => inr(r.gross_amount) },
      { key: 'ded', label: 'Deduction', align: 'right', value: r => Number(r.deduction_amount || 0), render: r => inr(r.deduction_amount) },
      { key: 'net', label: 'Net', align: 'right', value: r => Number(r.net_amount || 0), render: r => inr(r.net_amount) },
      { key: 'utr', label: 'UTR', value: r => r.utr_number },
      { key: 'paid', label: 'Paid on', value: r => r.paid_at, render: r => day(r.paid_at) },
    ],
  },
  'transport-payments': {
    key: 'transport-payments', title: 'Transport Payments', table: 'ff_transport_payments',
    select: 'id, trip_date, payment_status, vehicle_number, origin, destination, km_covered, total_amount, utr_number, paid_at, hubs(name)',
    order: [{ column: 'trip_date', ascending: false }, { column: 'created_at', ascending: false }],
    dateColumn: 'trip_date', dateType: 'date', hubColumn: 'hub_id',
    searchColumns: ['vehicle_number', 'utr_number'], searchHint: 'Vehicle or UTR',
    statusColumn: 'payment_status',
    statusGroups: [{ value: '__pending__', label: 'All pending (raised, not yet paid)', like: 'pending%' }],
    statusOptions: ['pending_ff_ops', 'pending_gm', 'pending_l1', 'pending_auditor', 'pending_ceo', 'pending_admin', 'pending_accounts', 'approved', 'paid', 'rejected'],
    columns: [
      { key: 'trip', label: 'Trip date', value: r => r.trip_date, render: r => day(r.trip_date) },
      { key: 'vehicle', label: 'Vehicle', value: r => r.vehicle_number },
      { key: 'route', label: 'Route', value: r => `${r.origin ?? ''} → ${r.destination ?? ''}` },
      { key: 'hub', label: 'Hub', value: r => r.hubs?.name },
      { key: 'km', label: 'Km', align: 'right', value: r => Number(r.km_covered || 0) },
      { key: 'stage', label: 'Stage', value: r => r.payment_status, render: r => label(r.payment_status) },
      { key: 'total', label: 'Amount', align: 'right', value: r => Number(r.total_amount || 0), render: r => inr(r.total_amount) },
      { key: 'utr', label: 'UTR', value: r => r.utr_number },
      { key: 'paid', label: 'Paid on', value: r => r.paid_at, render: r => day(r.paid_at) },
    ],
  },
  'invoices': {
    key: 'invoices', title: 'Invoices', table: 'invoices',
    select: 'id, invoice_number, invoice_date, customer_name, hub_name, total_amount, payment_mode, status, created_at',
    order: [{ column: 'invoice_date', ascending: false }, { column: 'created_at', ascending: false }],
    dateColumn: 'invoice_date', dateType: 'date', hubColumn: 'hub_id', defaultDays: 6,
    searchColumns: ['invoice_number', 'customer_name'], searchHint: 'Invoice no or customer',
    statusColumn: 'status', statusOptions: ['draft', 'issued', 'unpaid', 'paid', 'cancelled'],
    columns: [
      { key: 'no', label: 'Invoice', value: r => r.invoice_number },
      { key: 'date', label: 'Date', value: r => r.invoice_date, render: r => day(r.invoice_date) },
      { key: 'customer', label: 'Customer', value: r => r.customer_name },
      { key: 'hub', label: 'Hub', value: r => r.hub_name },
      { key: 'mode', label: 'Mode', value: r => r.payment_mode },
      { key: 'status', label: 'Status', value: r => r.status },
      { key: 'total', label: 'Amount', align: 'right', value: r => Number(r.total_amount || 0), render: r => inr(r.total_amount) },
    ],
  },
  'stock': {
    key: 'stock', title: 'Stock now', table: 'inventory',
    select: 'id, product_name, unit, quantity, min_threshold, updated_at, avg_cost, cost_source, hubs(name), products(name, unit)',
    totalsSelect: 'quantity, min_threshold, avg_cost',
    totals: [
      { label: 'Stock value (at purchase cost)', compute: rows => inr(rows.reduce((s, r) => s + (Number(r.avg_cost) > 0 ? Number(r.quantity || 0) * Number(r.avg_cost) : 0), 0)) },
      { label: 'Stock lines', compute: rows => rows.length.toLocaleString('en-IN') },
      { label: 'Lines with no cost yet (not in the value)', compute: rows => { const no = rows.filter(r => Number(r.quantity || 0) > 0 && !(Number(r.avg_cost) > 0)); return `${no.length.toLocaleString('en-IN')} lines · ${no.reduce((s, r) => s + Number(r.quantity || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} qty`; } },
    ],
    order: [{ column: 'quantity', ascending: true }],
    hubColumn: 'hub_id',
    searchColumns: ['product_name'], searchHint: 'Product name',
    columns: [
      { key: 'product', label: 'Product', value: r => r.products?.name || r.product_name },
      { key: 'hub', label: 'Hub', value: r => r.hubs?.name },
      { key: 'qty', label: 'In stock', align: 'right', value: r => Number(r.quantity || 0),
        render: r => {
          const low = r.min_threshold != null && Number(r.quantity || 0) <= Number(r.min_threshold);
          return <span className={low ? 'text-red-600 font-semibold' : ''}>{Number(r.quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} {r.products?.unit || r.unit || ''}</span>;
        } },
      { key: 'min', label: 'Minimum', align: 'right', value: r => (r.min_threshold == null ? null : Number(r.min_threshold)) },
      { key: 'cost', label: 'Buying cost (avg)', align: 'right',
        value: r => (Number(r.avg_cost) > 0 ? Number(r.avg_cost) : null),
        render: r => (Number(r.avg_cost) > 0 ? inr(r.avg_cost) : <span className="text-slate-400">not set</span>) },
      { key: 'value', label: 'Stock value (at cost)', align: 'right',
        value: r => (Number(r.avg_cost) > 0 ? Math.round(Number(r.quantity || 0) * Number(r.avg_cost) * 100) / 100 : null),
        render: r => (Number(r.avg_cost) > 0 ? <span className="font-semibold">{inr(Number(r.quantity || 0) * Number(r.avg_cost))}</span> : <span className="text-slate-300">—</span>) },
      { key: 'updated', label: 'Last updated', value: r => r.updated_at, render: r => dayTime(r.updated_at) },
    ],
  },
};

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'sales-orders', label: 'Sales Orders' },
  { key: 'purchase-orders', label: 'Purchase Orders' },
  { key: 'collections', label: 'Cash Collections' },
  { key: 'cash-closing', label: 'Cash Closing' },
  { key: 'vendor-payments', label: 'Vendor Payments' },
  { key: 'transport-payments', label: 'Transport Payments' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'stock', label: 'Stock now' },
];
