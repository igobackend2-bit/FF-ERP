import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { addDays, format, parseISO } from 'date-fns';
import { Search, Package, AlertTriangle, RefreshCw, Building2, TrendingDown, TrendingUp, Layers, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface MovementRow {
  hub_id: string;
  product_id: string;
  hub_name: string | null;
  product_name: string | null;
  opening: number;
  received: number;
  sold: number;
  wastage: number;
  other: number;
  closing: number;
}

const fmtKg = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface QcPhotoInspection {
  id: string;
  hub_id: string;
  product_id: string;
  grn_number: string | null;
  created_at: string;
  overall_grade: string | null;
  gross_weight_kg: number | null;
  tare_weight_kg: number | null;
  photo_urls: string[];
}

export default function InventoryDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [hubFilter, setHubFilter] = useState((user as any)?.hub_id ? (user as any).hub_id : '');
  const [viewing, setViewing] = useState<{ name: string; hub: string; inspections: QcPhotoInspection[] } | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');
  const [view, setView] = useState<'stock' | 'movement'>('stock');
  const [moveFrom, setMoveFrom] = useState(today);
  const [moveTo, setMoveTo] = useState(today);
  const [showIdle, setShowIdle] = useState(false);
  // Buying-cost correction (admin / FF ops manager / accounts only)
  const canSetCost = ['admin', 'ff_operations_manager', 'accounts'].includes(((user as any)?.role ?? '').toLowerCase());
  const [costEdit, setCostEdit] = useState<{ item: any; value: string; reason: string } | null>(null);

  const { data: hubs = [] } = useQuery({
    queryKey: ['hubs'],
    queryFn: async () => {
      const { data } = await supabase.from('hubs').select('id, name, display_name').eq('is_active', true);
      return data ?? [];
    }
  });

  // Reads inventory.quantity / min_threshold — the columns the EOD PO
  // Engine, GMOperationsDashboard, and SmartInventoryPage already rely on
  // for real restocking decisions. min_stock_level is a stale column from
  // an earlier schema version and can drift independently of this one.
  const { data: inventory = [], isLoading, refetch } = useQuery({
    queryKey: ['inventory', hubFilter],
    queryFn: async () => {
      let query = supabase
        .from('inventory')
        .select(`
          *,
          product:products(name, unit, grade_a_price, min_order_kg),
          hub:hubs(id, name, display_name)
        `)
        .order('quantity', { ascending: true });

      if (hubFilter) query = query.eq('hub_id', hubFilter);

      const { data } = await query;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  // Photos the hub manager attached while inspecting each delivery (qc_inspections.photo_urls),
  // newest first, grouped by hub + product so each stock row can show its latest QC evidence.
  const { data: qcPhotoRows = [], isError: qcPhotosError } = useQuery({
    queryKey: ['inventory-qc-photos', hubFilter],
    queryFn: async () => {
      let query = supabase
        .from('qc_inspections')
        .select('id, hub_id, product_id, grn_number, created_at, overall_grade, gross_weight_kg, tare_weight_kg, photo_urls')
        .not('photo_urls', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (hubFilter) query = query.eq('hub_id', hubFilter);
      const { data, error } = await query;
      if (error) {
        console.error('[InventoryDashboard] QC photos query failed:', error.message);
        throw error;
      }
      return ((data ?? []) as unknown as QcPhotoInspection[]).filter(r => Array.isArray(r.photo_urls) && r.photo_urls.length > 0);
    },
    refetchInterval: 30000,
  });

  const photosByStock = useMemo(() => {
    const map = new Map<string, QcPhotoInspection[]>();
    for (const r of qcPhotoRows) {
      const key = `${r.hub_id}:${r.product_id}`;
      const list = map.get(key);
      if (list) list.push(r); else map.set(key, [r]);
    }
    return map;
  }, [qcPhotoRows]);

  // Daily movement: opening / received / sold / wastage / closing for a date range, worked out in the
  // database from the stock ledger (inventory_log) so it is exact and not capped at 1000 rows.
  const rangeValid = !!moveFrom && !!moveTo && moveFrom <= moveTo;
  const { data: movement = [], isLoading: movementLoading, error: movementError } = useQuery({
    queryKey: ['inventory-movement', hubFilter, moveFrom, moveTo],
    enabled: view === 'movement' && rangeValid,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('inventory_movement_summary', {
        p_from: moveFrom, p_to: moveTo, p_hub: hubFilter || null,
      });
      if (error) {
        console.error('[InventoryDashboard] movement summary failed:', error.message);
        throw error;
      }
      return ((data ?? []) as any[]).map(r => ({
        ...r,
        opening: Number(r.opening), received: Number(r.received), sold: Number(r.sold),
        wastage: Number(r.wastage), other: Number(r.other), closing: Number(r.closing),
      })) as MovementRow[];
    },
    retry: false,
  });

  // Whether sales are currently taking stock out (inventory_outbound_settings).
  const { data: outbound, error: outboundError } = useQuery({
    queryKey: ['inventory-outbound-settings'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('inventory_outbound_settings').select('enabled, start_date').maybeSingle();
      if (error) throw error;
      return data as { enabled: boolean; start_date: string } | null;
    },
    retry: false,
    staleTime: 60000,
  });
  const outboundMissing = ['PGRST205', '42P01'].includes((outboundError as any)?.code);

  // Sale lines in the period that could not be matched to a product in stock (so were not deducted).
  const { data: unmatchedLines = 0 } = useQuery({
    queryKey: ['inventory-unmatched-lines', moveFrom, moveTo],
    enabled: view === 'movement' && rangeValid && !!outbound,
    queryFn: async () => {
      const startIso = new Date(`${moveFrom}T00:00:00+05:30`).toISOString();
      const endIso = new Date(`${format(addDays(parseISO(moveTo), 1), 'yyyy-MM-dd')}T00:00:00+05:30`).toISOString();
      const { data, error } = await (supabase as any)
        .from('inventory_order_deductions').select('unmatched')
        .is('skipped_reason', null).gte('deducted_at', startIso).lt('deducted_at', endIso).limit(1000);
      if (error) {
        console.error('[InventoryDashboard] unmatched lines query failed:', error.message);
        throw error;
      }
      return (data ?? []).reduce((s: number, r: any) => s + (Array.isArray(r.unmatched) ? r.unmatched.length : 0), 0);
    },
    retry: false,
  });

  const movementRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (movement as MovementRow[]).filter(r =>
      (!q || (r.product_name ?? '').toLowerCase().includes(q)) &&
      (showIdle || r.received !== 0 || r.sold !== 0 || r.wastage !== 0 || r.other !== 0));
  }, [movement, search, showIdle]);
  const movementTotals = useMemo(() => movementRows.reduce(
    (t, r) => ({
      opening: t.opening + r.opening, received: t.received + r.received, sold: t.sold + r.sold,
      wastage: t.wastage + r.wastage, other: t.other + r.other, closing: t.closing + r.closing,
    }),
    { opening: 0, received: 0, sold: 0, wastage: 0, other: 0, closing: 0 },
  ), [movementRows]);
  const showOther = movementRows.some(r => r.other !== 0);
  const movementMissingSql = (movementError as any)?.code === 'PGRST202';

  const filtered = (inventory as any[]).filter(item =>
    !search || item.product?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const totalItems = filtered.length;
  const lowStockCount = filtered.filter((i: any) => i.quantity < (i.min_threshold ?? 50)).length;
  const outOfStock = filtered.filter((i: any) => i.quantity === 0).length;
  // Value = quantity x what we PAID (moving-average purchase cost), not the selling price.
  // Lines with no cost yet are left out of the total and counted, never valued at zero silently.
  const totalValue = filtered.reduce((s: number, i: any) => s + (Number(i.avg_cost) > 0 ? i.quantity * Number(i.avg_cost) : 0), 0);
  const uncostedCount = filtered.filter((i: any) => i.quantity > 0 && !(Number(i.avg_cost) > 0)).length;

  const saveCost = useMutation({
    mutationFn: async () => {
      if (!costEdit) return;
      const { error } = await (supabase as any).rpc('inv_set_unit_cost', {
        p_hub: costEdit.item.hub_id, p_product: costEdit.item.product_id,
        p_cost: Number(costEdit.value), p_reason: costEdit.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Buying cost saved');
      setCostEdit(null);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e: any) => toast.error(e?.message?.includes('inv_set_unit_cost')
      ? 'The cost functions are not installed yet - run ADD_INVENTORY_COST_2026-10-04.sql first.'
      : (e?.message || 'Could not save the cost')),
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[22px] font-bold text-slate-800 tracking-tight">Inventory Dashboard</h1>
          <p className="text-[13px] text-slate-500">Real-time stock levels across hubs</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-400">Last sync: {format(new Date(), 'HH:mm:ss')}</p>
          <button
            onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ['inventory'] }); }}
            className="btn-zoho-primary flex items-center gap-2 py-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Sync Data</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Items', value: totalItems, icon: Layers, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Low Stock', value: lowStockCount, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Out of Stock', value: outOfStock, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Inventory Value (at purchase cost)', value: `₹${(totalValue / 1000).toFixed(1)}k`, note: uncostedCount > 0 ? `${uncostedCount} line${uncostedCount === 1 ? '' : 's'} without cost yet - not included` : undefined, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 pt-5 pb-4 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <div className={`p-2 ${card.bg} rounded-lg`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
              </div>
              <p className="text-[13px] text-slate-500 font-medium mb-1">{card.label}</p>
              <p className="text-[24px] font-bold text-slate-800 tracking-tight">{card.value}</p>
              {(card as any).note && <p className="text-[11px] text-amber-600 mt-0.5">{(card as any).note}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="zoho-card !p-0 overflow-hidden border-slate-200 shadow-sm">
        <div className="px-4 pt-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
            {([['stock', 'Stock now'], ['movement', 'Daily movement']] as const).map(([key, label]) => (
              <button
                key={key} type="button" onClick={() => setView(key)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  view === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'movement' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="move-from" className="text-slate-500">From</label>
              <input
                id="move-from" type="date" value={moveFrom} max={today}
                onChange={e => setMoveFrom(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500/20 outline-none"
              />
              <label htmlFor="move-to" className="text-slate-500">To</label>
              <input
                id="move-to" type="date" value={moveTo} min={moveFrom} max={today}
                onChange={e => setMoveTo(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-500/20 outline-none"
              />
              <button
                type="button" onClick={() => { setMoveFrom(today); setMoveTo(today); }}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              >Today</button>
              <button
                type="button"
                onClick={() => {
                  const y = format(addDays(new Date(), -1), 'yyyy-MM-dd');
                  setMoveFrom(y); setMoveTo(y);
                }}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              >Yesterday</button>
              <label className="flex items-center gap-1.5 text-slate-600 ml-1 cursor-pointer">
                <input type="checkbox" checked={showIdle} onChange={e => setShowIdle(e.target.checked)} />
                Include products with no movement
              </label>
            </div>
          )}

          <p className={`sm:ml-auto text-xs font-medium ${
            outbound?.enabled ? 'text-green-700' : outbound ? 'text-amber-700' : 'text-slate-400'
          }`}>
            {outbound?.enabled
              ? `Sales deduction ON since ${format(parseISO(outbound.start_date), 'd MMM yyyy')}`
              : outbound
                ? 'Sales deduction is OFF — stock changes only from QC and wastage'
                : outboundMissing ? 'Sales deduction not set up yet' : ''}
          </p>
        </div>

        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              placeholder="Filter by product name..."
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Building2 className="h-4 w-4 text-slate-400" />
            {!(user as any)?.hub_id ? (
              <select
                value={hubFilter}
                onChange={e => setHubFilter(e.target.value)}
                className="flex-1 sm:w-48 px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
              >
                <option value="">All Hubs</option>
                {(hubs as any[]).map(h => <option key={h.id} value={h.id}>{h.display_name || h.name}</option>)}
              </select>
            ) : (
              <span className="text-sm font-medium text-slate-700">
                {(hubs as any[]).find(h => h.id === hubFilter)?.display_name || 'My Hub'}
              </span>
            )}
          </div>
        </div>

        {view === 'stock' ? (
        <div className="zoho-table-container border-none rounded-none">
          <table className="zoho-table">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Product Information</th>
                <th>Hub / Location</th>
                <th>QC Photos</th>
                <th className="text-right">Current Stock</th>
                <th className="text-right">Buying Cost</th>
                <th className="text-right">Stock Value</th>
                <th className="text-right">Min Level</th>
                <th className="text-center">Health</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-[#2C64E3]" />
                      <span>Loading inventory assets...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Package className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                    <p>No inventory records matching your criteria.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((item: any, index: number) => {
                  const isLow = item.quantity < (item.min_threshold ?? 50);
                  const isOut = item.quantity === 0;
                  const maxLevel = item.max_stock_level ?? 500;
                  const pct = Math.min(100, (item.quantity / maxLevel) * 100);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="text-slate-400 font-mono text-xs">{index + 1}</td>
                      <td>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">{item.product?.name}</span>
                          <span className="text-xs text-slate-500 uppercase">Unit: {item.product?.unit || 'kg'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Building2 className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-sm">{item.hub?.display_name || item.hub?.name}</span>
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const inspections = photosByStock.get(`${item.hub_id}:${item.product_id}`) ?? [];
                          const allPhotos = inspections.flatMap(r => r.photo_urls);
                          if (allPhotos.length === 0) return <span className="text-slate-300 text-xs">—</span>;
                          return (
                            <button
                              type="button"
                              title="View QC photos"
                              onClick={() => setViewing({
                                name: item.product?.name ?? 'Product',
                                hub: item.hub?.display_name || item.hub?.name || '',
                                inspections,
                              })}
                              className="group flex items-center gap-1"
                            >
                              {allPhotos.slice(0, 3).map(url => (
                                <img
                                  key={url} src={url} alt="" loading="lazy"
                                  onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
                                  className="h-9 w-9 rounded-md object-cover border border-slate-200 group-hover:border-blue-400 transition-colors"
                                />
                              ))}
                              {allPhotos.length > 3 && (
                                <span className="ml-1 text-[11px] font-semibold text-slate-500">+{allPhotos.length - 3}</span>
                              )}
                            </button>
                          );
                        })()}
                      </td>
                      <td className="text-right">
                        <div className="flex flex-col items-end">
                          <span className={`font-bold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                            {item.quantity.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-400 uppercase font-medium">Kilograms</span>
                        </div>
                      </td>
                      <td className="text-right">
                        {Number(item.avg_cost) > 0 ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-medium text-slate-800">₹{Number(item.avg_cost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                            {canSetCost && (
                              <button type="button" title="Correct buying cost" className="text-slate-300 hover:text-blue-600"
                                onClick={() => setCostEdit({ item, value: String(Number(item.avg_cost)), reason: '' })}>
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-xs text-slate-400">not set</span>
                            {canSetCost && (
                              <button type="button" title="Set buying cost" className="text-slate-300 hover:text-blue-600"
                                onClick={() => setCostEdit({ item, value: '', reason: '' })}>
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                        {item.cost_source && <div className="text-[10px] text-slate-400">{String(item.cost_source).replace(/_/g, ' ')}</div>}
                      </td>
                      <td className="text-right font-semibold text-slate-800">
                        {Number(item.avg_cost) > 0 ? `₹${Math.round(item.quantity * Number(item.avg_cost)).toLocaleString('en-IN')}` : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="text-right text-slate-500 font-medium">
                        {item.min_threshold ?? 50}
                      </td>
                      <td className="px-4 min-w-[120px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                            <span>{pct.toFixed(0)}%</span>
                            <span>Target: {maxLevel}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isOut ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-green-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="text-center">
                        {isOut ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 ring-1 ring-inset ring-red-600/20">
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Critical
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 ring-1 ring-inset ring-green-600/20">
                            Healthy
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="zoho-table-container border-none rounded-none">
          <table className="zoho-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Hub</th>
                <th className="text-right">Opening</th>
                <th className="text-right">Received (QC)</th>
                <th className="text-right">Sold</th>
                <th className="text-right">Wastage</th>
                {showOther && <th className="text-right">Other</th>}
                <th className="text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {!rangeValid ? (
                <tr><td colSpan={showOther ? 8 : 7} className="py-12 text-center text-slate-400">Pick a From date that is on or before the To date.</td></tr>
              ) : movementLoading ? (
                <tr>
                  <td colSpan={showOther ? 8 : 7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-[#2C64E3]" />
                      <span>Working out stock movement…</span>
                    </div>
                  </td>
                </tr>
              ) : movementError ? (
                <tr>
                  <td colSpan={showOther ? 8 : 7} className="py-12 text-center text-red-600 text-sm">
                    {movementMissingSql
                      ? 'The daily movement view needs a one-time database update. Run ADD_INVENTORY_OUTBOUND_2026-10-03.sql in the Supabase SQL Editor.'
                      : `Could not load stock movement: ${(movementError as any)?.message ?? 'unknown error'}`}
                  </td>
                </tr>
              ) : movementRows.length === 0 ? (
                <tr>
                  <td colSpan={showOther ? 8 : 7} className="py-12 text-center text-slate-400">
                    <Package className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                    <p>No stock movement in this period.</p>
                    <p className="text-xs mt-1">Tick “Include products with no movement” to list every product.</p>
                  </td>
                </tr>
              ) : (
                <>
                  {movementRows.map(r => (
                    <tr key={`${r.hub_id}:${r.product_id}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="font-semibold text-slate-900">{r.product_name ?? 'Unknown product'}</td>
                      <td>
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Building2 className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-sm">{r.hub_name}</span>
                        </div>
                      </td>
                      <td className="text-right text-slate-600">{fmtKg(r.opening)}</td>
                      <td className={`text-right font-medium ${r.received > 0 ? 'text-green-700' : 'text-slate-400'}`}>{r.received > 0 ? `+${fmtKg(r.received)}` : '—'}</td>
                      <td className={`text-right font-medium ${r.sold > 0 ? 'text-red-600' : 'text-slate-400'}`}>{r.sold > 0 ? `−${fmtKg(r.sold)}` : '—'}</td>
                      <td className={`text-right font-medium ${r.wastage > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{r.wastage > 0 ? `−${fmtKg(r.wastage)}` : '—'}</td>
                      {showOther && <td className="text-right text-slate-600">{r.other === 0 ? '—' : fmtKg(r.other)}</td>}
                      <td className="text-right font-bold text-slate-900">{fmtKg(r.closing)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold text-slate-800">
                    <td colSpan={2}>Total ({movementRows.length} products)</td>
                    <td className="text-right">{fmtKg(movementTotals.opening)}</td>
                    <td className="text-right">{fmtKg(movementTotals.received)}</td>
                    <td className="text-right">{fmtKg(movementTotals.sold)}</td>
                    <td className="text-right">{fmtKg(movementTotals.wastage)}</td>
                    {showOther && <td className="text-right">{fmtKg(movementTotals.other)}</td>}
                    <td className="text-right">{fmtKg(movementTotals.closing)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {view === 'movement' && rangeValid && !movementError && (
        <div className="text-xs text-slate-500 px-1 space-y-1">
          <p>Opening and closing are worked back from the stock ledger. There was no recorded stock before QC inspections began on 2 Oct 2026.</p>
          {unmatchedLines > 0 && (
            <p className="text-amber-700">
              {unmatchedLines} sale {unmatchedLines === 1 ? 'line' : 'lines'} in this period could not be matched to a product in stock, so {unmatchedLines === 1 ? 'it was' : 'they were'} not deducted.
            </p>
          )}
        </div>
      )}

      {qcPhotosError && (
        <p className="text-xs text-red-600 px-1">QC photos could not be loaded right now. Stock levels above are unaffected.</p>
      )}

      <Dialog open={!!viewing} onOpenChange={open => { if (!open) setViewing(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>QC photos — {viewing?.name}</DialogTitle>
            <DialogDescription>
              {viewing?.hub} · newest inspection first. Click a photo to open it full size.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {viewing?.inspections.map(r => (
              <div key={r.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{r.grn_number ?? 'No GRN'}</span>
                  <span>{format(new Date(r.created_at), 'dd MMM yyyy, hh:mm a')}</span>
                  {r.overall_grade && <span>Grade {r.overall_grade}</span>}
                  <span>Net {(Number(r.gross_weight_kg ?? 0) - Number(r.tare_weight_kg ?? 0)).toLocaleString()} kg</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {r.photo_urls.map(url => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={url} alt={`QC photo ${r.grn_number ?? ''}`} loading="lazy"
                        className="w-full aspect-square object-cover rounded-lg border border-slate-200"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!costEdit} onOpenChange={open => { if (!open) setCostEdit(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buying cost — {costEdit?.item?.product?.name}</DialogTitle>
            <DialogDescription>
              {costEdit?.item?.hub?.display_name || costEdit?.item?.hub?.name}. Enter what we paid per unit (₹). Stock value = stock × this cost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs text-slate-500">Cost per unit (₹)
              <input type="number" min="0" step="0.01" value={costEdit?.value ?? ''}
                onChange={e => setCostEdit(c => c && { ...c, value: e.target.value })}
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            </label>
            <label className="block text-xs text-slate-500">Reason (required)
              <input value={costEdit?.reason ?? ''} placeholder="e.g. vendor bill rate, checked with purchase"
                onChange={e => setCostEdit(c => c && { ...c, reason: e.target.value })}
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCostEdit(null)} className="h-9 px-3 rounded-lg border border-slate-200 text-sm">Cancel</button>
              <button type="button" onClick={() => saveCost.mutate()}
                disabled={saveCost.isPending || !(Number(costEdit?.value) > 0) || !(costEdit?.reason ?? '').trim()}
                className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50">
                {saveCost.isPending ? 'Saving…' : 'Save cost'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between text-slate-400 px-1">
        <p className="text-[11px] italic">* Value = stock × average buying cost (taken from purchase orders at QC). Selling price is not used.</p>
        <p className="text-[11px] font-medium flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
          Live connection active
        </p>
      </div>
    </div>
  );
}
