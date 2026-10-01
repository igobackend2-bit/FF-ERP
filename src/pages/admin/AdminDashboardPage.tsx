import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Users, Banknote, Truck, Package, ShoppingCart, Boxes, Camera,
  RotateCcw, FileSearch, RefreshCw, ChevronRight, ClipboardList, Layers, MapPin,
  Sunrise, PackageX, Wallet, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

// ── KPI Card ───────────────────────────────────────────────────────────────────
// Colored top accent + gradient icon badge per card, so a dense grid of 15
// metrics still scans quickly by category color. Click affordance is a
// chevron that slides in on hover instead of a boxed "Details" button —
// keeps the card body focused on the number.
function KpiCard({
  label, value, sub, icon: Icon, color, onClick, isLoading, notAvailable,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  isLoading?: boolean;
  notAvailable?: boolean;
}) {
  return (
    <div
      className={cn('group relative rounded-xl p-3.5 pt-[14px] overflow-hidden transition-all duration-200', onClick && 'cursor-pointer')}
      style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      onClick={onClick}
      onMouseEnter={e => {
        if (!onClick) return;
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 10px 24px -8px ${color}40`;
        el.style.borderColor = color + '50';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
        el.style.borderColor = '#E5E7EB';
        el.style.transform = 'translateY(0)';
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, ${color}00)` }} />

      <div className="flex items-start justify-between mb-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${color}26, ${color}0D)` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {onClick && (
          <ChevronRight
            className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 mt-0.5"
            style={{ color: '#9CA3AF' }}
          />
        )}
      </div>

      <div className="space-y-0.5">
        <span className="text-[11px] font-medium block truncate" style={{ color: '#6B7280' }}>{label}</span>
        {isLoading ? (
          <div className="h-6 w-14 rounded-lg animate-pulse" style={{ background: '#F3F4F6' }} />
        ) : (
          <span className="text-[20px] font-bold leading-tight tabular-nums block" style={{ color: notAvailable ? '#D1D5DB' : '#111827' }}>{value}</span>
        )}
        {sub && <span className="text-[10.5px] block truncate" style={{ color: '#9CA3AF' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── Quick Action Button ───────────────────────────────────────────────────────
function QuickAction({ label, icon: Icon, path, color }: {
  label: string; icon: React.ElementType; path: string; color: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all duration-150 group"
      style={{ color: '#374151' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
        (e.currentTarget as HTMLElement).style.color = '#111827';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = '#374151';
      }}
    >
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: color + '12', border: `1px solid ${color}25` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <span className="text-[13px] font-medium flex-1 truncate">{label}</span>
      <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#9CA3AF' }} />
    </button>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export function AdminDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logs, isLoading: logsLoading } = useAuditLogs();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [queryClient]);

  const { data: activeEmployeeCount, isLoading: employeesLoading } = useQuery({
    queryKey: ['admin-active-employee-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: vendorPendingAdmin, isLoading: vendorPendingLoading } = useQuery({
    queryKey: ['admin-vendor-payments-pending'],
    queryFn: async () => {
      const { count, error } = await supabase.from('ff_vendor_payments').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending_admin');
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: transportPendingAdmin, isLoading: transportPendingLoading } = useQuery({
    queryKey: ['admin-transport-payments-pending'],
    queryFn: async () => {
      const { count, error } = await supabase.from('ff_transport_payments').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending_admin');
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: pendingPOCount, isLoading: poLoading } = useQuery({
    queryKey: ['admin-purchase-orders-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: todaySalesCount, isLoading: salesLoading } = useQuery({
    queryKey: ['admin-today-sales-orders', today],
    queryFn: async () => {
      const { count, error } = await supabase.from('sales_orders').select('id', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00`).lte('created_at', `${today}T23:59:59`);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: inventoryRows, isLoading: inventoryLoading } = useQuery({
    queryKey: ['admin-inventory-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('quantity');
      if (error) throw error;
      return data ?? [];
    },
  });
  const availableInventory = (inventoryRows || []).reduce((s, i: any) => s + Number(i.quantity || 0), 0);
  const hasInventoryRows = (inventoryRows || []).length > 0;

  const { data: shiftSessionsToday, isLoading: shiftLoading } = useQuery({
    queryKey: ['admin-shift-sessions-today', today],
    queryFn: async () => {
      const { data, error } = await supabase.from('shift_sessions').select('id, login_time').eq('date', today);
      if (error) throw error;
      return data ?? [];
    },
  });
  const presentTodayCount = (shiftSessionsToday || []).filter((s: any) => s.login_time).length;

  const { data: pendingReversals, isLoading: reversalsLoading } = useQuery({
    queryKey: ['admin-pending-reversals-count'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lop_entries').select('id').eq('reversal_requested', true).eq('reversal_status', 'REV_PENDING_ADMIN');
      if (error) throw error;
      return data;
    },
  });
  const pendingReversalsCount = pendingReversals?.length || 0;

  // ── FF Operations KPIs ──────────────────────────────────────────────
  // Headline numbers from the Day Open/Close pipeline (/ff-operations/day-kpis)
  // and FF Operations Overview, condensed here so the admin doesn't have to
  // leave the dashboard to see today's revenue, the overnight PO backlog,
  // stock-outs, or today's collections.
  const { data: todayOrdersSummary, isLoading: todayOrdersLoading } = useQuery({
    queryKey: ['admin-ff-ops-today-orders', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_orders')
        .select('total_amount')
        .eq('order_date', today)
        .neq('status', 'cancelled');
      if (error) throw error;
      const rows = data ?? [];
      return { revenue: rows.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0) };
    },
  });

  const { data: overnightPOs, isLoading: overnightPOsLoading } = useQuery({
    queryKey: ['admin-ff-ops-overnight-pos', today],
    queryFn: async () => {
      const { count, error } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('eod_date', today);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: unassignedPOCount, isLoading: unassignedPOLoading } = useQuery({
    queryKey: ['admin-ff-ops-unassigned-pos'],
    queryFn: async () => {
      const { count, error } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending').is('assigned_executive_id', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: stockAlerts, isLoading: stockAlertsLoading } = useQuery({
    queryKey: ['admin-ff-ops-stock-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('quantity, min_threshold');
      if (error) throw error;
      let outOfStock = 0, lowStock = 0;
      (data ?? []).forEach((r: any) => {
        const qty = Number(r.quantity ?? 0);
        const min = Number(r.min_threshold ?? 0);
        if (qty === 0) outOfStock++;
        else if (min > 0 && qty <= min) lowStock++;
      });
      return outOfStock + lowStock;
    },
  });

  const { data: cashCollectedToday, isLoading: cashCollectedLoading } = useQuery({
    queryKey: ['admin-ff-ops-cash-collected', today],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_collections').select('amount').eq('collection_date', today).eq('status', 'verified');
      if (error) throw error;
      return (data ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0);
    },
  });

  const { data: activePaymentQueue, isLoading: activePaymentQueueLoading } = useQuery({
    queryKey: ['admin-ff-ops-active-payment-queue'],
    queryFn: async () => {
      const ACTIVE_STATUSES = ['pending_ff_ops', 'pending_l1', 'pending_admin', 'pending_ceo', 'pending_accounts'];
      const [vendorRes, transportRes] = await Promise.all([
        supabase.from('ff_vendor_payments').select('id', { count: 'exact', head: true }).in('payment_status', ACTIVE_STATUSES),
        supabase.from('ff_transport_payments').select('id', { count: 'exact', head: true }).in('payment_status', ACTIVE_STATUSES),
      ]);
      if (vendorRes.error) throw vendorRes.error;
      if (transportRes.error) throw transportRes.error;
      return (vendorRes.count ?? 0) + (transportRes.count ?? 0);
    },
  });

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#111827' }}>
            Admin Dashboard
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>
            {format(new Date(), 'EEEE, d MMMM yyyy')} · Central control &amp; monitoring
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={isRefreshing} className="gap-2 text-[12px]">
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Active Employees" value={activeEmployeeCount ?? 0} sub="active users"
          icon={Users} color="#1B6FD8" onClick={() => navigate('/admin/employees')} isLoading={employeesLoading}
        />
        <KpiCard
          label="Vendor Payments" value={vendorPendingAdmin ?? 0} sub="awaiting admin approval"
          icon={Banknote} color="#D97706" onClick={() => navigate('/admin/ff-payments')} isLoading={vendorPendingLoading}
        />
        <KpiCard
          label="Transport Payments" value={transportPendingAdmin ?? 0} sub="awaiting admin approval"
          icon={Truck} color="#DC2626" onClick={() => navigate('/admin/ff-transport-payments')} isLoading={transportPendingLoading}
        />
        <KpiCard
          label="Pending POs" value={pendingPOCount ?? 0} sub="purchase orders"
          icon={Package} color="#0891B2" onClick={() => navigate('/purchase/orders')} isLoading={poLoading}
        />
        <KpiCard
          label="Sales Orders Today" value={todaySalesCount ?? 0} sub="raised today"
          icon={ShoppingCart} color="#0E8A6B" onClick={() => navigate('/sales/orders')} isLoading={salesLoading}
        />
        <KpiCard
          label="Available Inventory" value={hasInventoryRows ? `${availableInventory.toLocaleString('en-IN')} kg` : '—'}
          sub={hasInventoryRows ? 'all hubs' : 'no inventory rows found'}
          icon={Boxes} color="#7C3AED" isLoading={inventoryLoading} notAvailable={!hasInventoryRows}
        />
        <KpiCard
          label="Present Today" value={presentTodayCount} sub="shift staff checked in"
          icon={Camera} color="#0EA5E9" onClick={() => navigate('/admin/shift-attendance')} isLoading={shiftLoading}
        />
        <KpiCard
          label="LOP Reversals" value={pendingReversalsCount} sub="pending admin"
          icon={RotateCcw} color="#DC2626" onClick={() => navigate('/admin-lop')} isLoading={reversalsLoading}
        />
        <KpiCard
          label="Audit Entries" value={logs.length} sub="recent system events"
          icon={FileSearch} color="#6B7A8D" onClick={() => navigate('/audit-logs')} isLoading={logsLoading}
        />
      </div>

      {/* ── FF Operations KPIs ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-bold" style={{ color: '#111827' }}>FF Operations KPIs</h2>
          <button
            onClick={() => navigate('/ff-operations/day-kpis')}
            className="text-[12px] font-medium"
            style={{ color: '#2563EB' }}
          >
            View Day Open / Close KPIs →
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard
            label="Today's Order Revenue" value={`₹${(todayOrdersSummary?.revenue ?? 0).toLocaleString('en-IN')}`} sub="non-cancelled orders"
            icon={ShoppingCart} color="#0E8A6B" onClick={() => navigate('/sales/orders')} isLoading={todayOrdersLoading}
          />
          <KpiCard
            label="Overnight POs" value={overnightPOs ?? 0} sub="generated by EOD engine today"
            icon={Sunrise} color="#D97706" onClick={() => navigate('/purchase/orders')} isLoading={overnightPOsLoading}
          />
          <KpiCard
            label="Unassigned PO Backlog" value={unassignedPOCount ?? 0} sub="pending, no executive assigned"
            icon={Clock} color="#DC2626" onClick={() => navigate('/purchase/orders')} isLoading={unassignedPOLoading}
          />
          <KpiCard
            label="Stock Alerts" value={stockAlerts ?? 0} sub="out of stock + low stock lines"
            icon={PackageX} color="#DC2626" onClick={() => navigate('/ff-operations/day-kpis')} isLoading={stockAlertsLoading}
          />
          <KpiCard
            label="Cash Collected Today" value={`₹${(cashCollectedToday ?? 0).toLocaleString('en-IN')}`} sub="verified collections"
            icon={Wallet} color="#0891B2" onClick={() => navigate('/sales/collections')} isLoading={cashCollectedLoading}
          />
          <KpiCard
            label="Active Payment Queue" value={activePaymentQueue ?? 0} sub="vendor + transport, all stages"
            icon={Banknote} color="#7C3AED" onClick={() => navigate('/accounts/batch-history')} isLoading={activePaymentQueueLoading}
          />
        </div>
      </div>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden max-w-md"
        style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="px-4 py-3.5" style={{ borderBottom: '1px solid #F3F4F6' }}>
          <span className="text-[13px] font-black" style={{ color: '#111827' }}>Quick Actions</span>
        </div>
        <div className="p-3 space-y-1.5">
          <QuickAction label="Sales Orders"               icon={ClipboardList} path="/sales/orders"                     color="#0E8A6B" />
          <QuickAction label="Purchase Orders"             icon={ShoppingCart}  path="/purchase/orders"                  color="#0891B2" />
          <QuickAction label="Vendor Payment Approval"     icon={Banknote}      path="/admin/ff-payments"                color="#D97706" />
          <QuickAction label="Transport Payment Approval"  icon={Truck}         path="/admin/ff-transport-payments"      color="#DC2626" />
          <QuickAction label="Bulk Vendor Payment"         icon={Layers}        path="/ff-operations/vendor-bulk-payment" color="#7C3AED" />
          <QuickAction label="Shift Attendance"            icon={Camera}        path="/admin/shift-attendance"           color="#0EA5E9" />
          <QuickAction label="Pallikaranai Hub"            icon={MapPin}        path="/admin/hubs/palikarani"            color="#38BDF8" />
          <QuickAction label="Vanagaram Hub"                icon={MapPin}        path="/admin/hubs/vanagaram"             color="#2563EB" />
          <QuickAction label="Hyderabad Hub"               icon={MapPin}        path="/admin/hubs/hyderabad"             color="#A78BFA" />
        </div>
      </div>
    </motion.div>
  );
}
