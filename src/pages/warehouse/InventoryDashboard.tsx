import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Search, Package, AlertTriangle, RefreshCw, Building2, TrendingDown, TrendingUp, Layers } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

  const filtered = (inventory as any[]).filter(item =>
    !search || item.product?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const totalItems = filtered.length;
  const lowStockCount = filtered.filter((i: any) => i.quantity < (i.min_threshold ?? 50)).length;
  const outOfStock = filtered.filter((i: any) => i.quantity === 0).length;
  const totalValue = filtered.reduce((s: number, i: any) => s + (i.quantity * (i.product?.grade_a_price ?? 0)), 0);

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
          { label: 'Inventory Value', value: `₹${(totalValue / 1000).toFixed(1)}k`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
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
            </div>
          </div>
        ))}
      </div>

      <div className="zoho-card !p-0 overflow-hidden border-slate-200 shadow-sm">
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

        <div className="zoho-table-container border-none rounded-none">
          <table className="zoho-table">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Product Information</th>
                <th>Hub / Location</th>
                <th>QC Photos</th>
                <th className="text-right">Current Stock</th>
                <th className="text-right">Min Level</th>
                <th className="text-center">Health</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-[#2C64E3]" />
                      <span>Loading inventory assets...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
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
      </div>

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

      <div className="flex items-center justify-between text-slate-400 px-1">
        <p className="text-[11px] italic">* Estimated value calculated based on Grade A wholesale pricing.</p>
        <p className="text-[11px] font-medium flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
          Live connection active
        </p>
      </div>
    </div>
  );
}
