import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Plus, RefreshCw, Loader2, Building2, PlayCircle, Archive, Tag, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AssetAccount { id: string; code: string; name: string }
interface Asset {
  id: string; asset_name: string; asset_code: string | null; asset_tag_code: string | null; account_id: string;
  purchase_date: string; purchase_cost: number; salvage_value: number; useful_life_years: number;
  accumulated_depreciation: number; status: 'active' | 'disposed'; hub_id: string | null;
  assigned_to: string | null; disposal_date: string | null; disposal_value: number | null;
}
interface Staff { id: string; name: string }

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const emptyForm = { asset_name: '', asset_code: '', account_id: '', hub_id: '', purchase_date: format(new Date(), 'yyyy-MM-dd'), purchase_cost: '', funding: 'bank', salvage_value: '0', useful_life_years: '5', notes: '' };

export default function FixedAssetRegisterPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [depMonth, setDepMonth] = useState(format(new Date(), 'yyyy-MM-01'));

  const { data: accounts = [] } = useQuery({
    queryKey: ['fixed-asset-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('acct_accounts').select('id, code, name').eq('account_type', 'fixed_asset').order('code');
      if (error) throw error;
      return (data || []) as AssetAccount[];
    },
  });

  const { data: hubs = [] } = useQuery({
    queryKey: ['hubs-active'],
    queryFn: async () => {
      const { data } = await supabase.from('hubs').select('id, name').eq('is_active', true);
      return data ?? [];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff-for-asset-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, name').not('name', 'is', null).order('name');
      if (error) throw error;
      return (data || []) as Staff[];
    },
  });

  const [reassignTarget, setReassignTarget] = useState<Asset | null>(null);
  const [reassignHub, setReassignHub] = useState('');
  const [reassignStaff, setReassignStaff] = useState('');

  const [tagTarget, setTagTarget] = useState<Asset | null>(null);
  const [tagQR, setTagQR] = useState<string | null>(null);

  const openTag = async (a: Asset) => {
    setTagTarget(a);
    const url = `${window.location.origin}/assets/lookup/${a.id}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
    setTagQR(dataUrl);
  };
  const closeTag = () => { setTagTarget(null); setTagQR(null); };

  const openReassign = (a: Asset) => {
    setReassignTarget(a);
    setReassignHub(a.hub_id || '');
    setReassignStaff(a.assigned_to || '');
  };

  const reassignMutation = useMutation({
    mutationFn: async () => {
      if (!reassignTarget) return;
      const { error } = await supabase.from('fixed_assets')
        .update({ hub_id: reassignHub || null, assigned_to: reassignStaff || null } as any)
        .eq('id', reassignTarget.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Custody updated'); setReassignTarget(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: assets = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_assets').select('*').order('purchase_date', { ascending: false });
      if (error) throw error;
      return (data || []) as Asset[];
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['fixed-asset-depreciation-runs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_asset_depreciation_runs').select('*').order('run_month', { ascending: false }).limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? '—';
  const staffName = (id: string | null) => (id ? staff.find(s => s.id === id)?.name ?? '—' : '—');
  const hubName = (id: string | null) => (id ? (hubs as any[]).find(h => h.id === id)?.name ?? '—' : '—');

  const totals = useMemo(() => {
    const activeAssets = assets.filter(a => a.status === 'active');
    const cost = activeAssets.reduce((s, a) => s + Number(a.purchase_cost), 0);
    const dep = activeAssets.reduce((s, a) => s + Number(a.accumulated_depreciation), 0);
    return { count: activeAssets.length, cost, dep, nbv: cost - dep };
  }, [assets]);

  const handleCreate = async () => {
    if (!form.asset_name || !form.account_id || !form.purchase_cost || !form.useful_life_years) {
      toast.error('Fill in asset name, category, cost and useful life'); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('fixed_assets').insert({
        asset_name: form.asset_name,
        asset_code: form.asset_code || null,
        account_id: form.account_id,
        hub_id: form.hub_id || null,
        purchase_date: form.purchase_date,
        purchase_cost: parseFloat(form.purchase_cost),
        funding: form.funding,
        salvage_value: parseFloat(form.salvage_value) || 0,
        useful_life_years: parseFloat(form.useful_life_years),
        notes: form.notes || null,
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success('Asset added to the register');
      setShowForm(false);
      setForm(emptyForm);
      refetch();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const disposeAsset = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fixed_assets')
        .update({ status: 'disposed', disposal_date: format(new Date(), 'yyyy-MM-dd') })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Asset marked disposed'); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const runDepreciation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('acct_run_depreciation', { p_month: depMonth });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.run) {
        toast.success(`Depreciation posted: ${inr(result.total_depreciation)} across ${result.assets_processed} asset(s)`);
      } else {
        toast.error(result?.reason || 'Nothing to depreciate for this month');
      }
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      qc.invalidateQueries({ queryKey: ['fixed-asset-depreciation-runs'] });
    },
    onError: (e: any) => toast.error(e.message || 'Depreciation run failed'),
  });

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12 pt-2 px-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-800 tracking-tight">Fixed Asset Register</h1>
          <p className="text-[13px] text-slate-500">Vehicles, equipment, furniture — cost, depreciation, net book value</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700"><Plus className="h-4 w-4 mr-2" />New Asset</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Active Assets</p><p className="text-xl font-bold text-slate-800">{totals.count}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Total Cost</p><p className="text-xl font-bold text-slate-800">{inr(totals.cost)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Accumulated Depreciation</p><p className="text-xl font-bold text-red-600">{inr(totals.dep)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Net Book Value</p><p className="text-xl font-bold text-green-700">{inr(totals.nbv)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PlayCircle className="h-4 w-4 text-blue-600" /> Run Monthly Depreciation</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <Input type="date" value={depMonth} onChange={e => setDepMonth(e.target.value)} className="w-44" />
          <Button size="sm" onClick={() => runDepreciation.mutate()} disabled={runDepreciation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
            {runDepreciation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Run for {format(new Date(depMonth), 'MMMM yyyy')}
          </Button>
          <p className="text-xs text-slate-400">Posts one voucher for the month, straight-line, capped at each asset's depreciable value. Safe to click once per month — re-running an already-closed month is blocked.</p>
        </CardContent>
        {runs.length > 0 && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {(runs as any[]).map(r => (
                <span key={r.id} className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                  {format(new Date(r.run_month), 'MMM yyyy')}: {inr(r.total_depreciation)} · {r.assets_processed} asset(s)
                </span>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Fixed Asset</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-xs text-slate-500 mb-1 block">Asset Name *</label><Input value={form.asset_name} onChange={e => setForm(f => ({ ...f, asset_name: e.target.value }))} placeholder="e.g. Delivery Van - TN01AB1234" /></div>
              <div><label className="text-xs text-slate-500 mb-1 block">Asset Code / Tag</label><Input value={form.asset_code} onChange={e => setForm(f => ({ ...f, asset_code: e.target.value }))} placeholder="Optional" /></div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Category *</label>
                <select value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="">Select category…</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Hub / Location</label>
                <select value={form.hub_id} onChange={e => setForm(f => ({ ...f, hub_id: e.target.value }))} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="">Not hub-specific</option>
                  {(hubs as any[]).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-slate-500 mb-1 block">Purchase Date *</label><Input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} /></div>
              <div><label className="text-xs text-slate-500 mb-1 block">Purchase Cost (₹) *</label><Input type="number" value={form.purchase_cost} onChange={e => setForm(f => ({ ...f, purchase_cost: e.target.value }))} placeholder="0.00" /></div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Paid from</label>
                <select value={form.funding} onChange={e => setForm(f => ({ ...f, funding: e.target.value }))} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="bank">Bank (Kotak)</option>
                  <option value="cash">Cash in hand</option>
                  <option value="opening">Already owned — opening balance</option>
                </select>
              </div>
              <div><label className="text-xs text-slate-500 mb-1 block">Salvage Value (₹)</label><Input type="number" value={form.salvage_value} onChange={e => setForm(f => ({ ...f, salvage_value: e.target.value }))} /></div>
              <div><label className="text-xs text-slate-500 mb-1 block">Useful Life (years) *</label><Input type="number" value={form.useful_life_years} onChange={e => setForm(f => ({ ...f, useful_life_years: e.target.value }))} /></div>
              <div className="md:col-span-2"><label className="text-xs text-slate-500 mb-1 block">Notes</label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Saving…' : 'Add Asset'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading…</div>
          ) : assets.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" /> No assets in the register yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50">
                  {['Asset', 'Category', 'Custody', 'Purchase Date', 'Cost', 'Accum. Depreciation', 'Net Book Value', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {assets.map(a => {
                    const nbv = Number(a.purchase_cost) - Number(a.accumulated_depreciation);
                    return (
                      <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {a.asset_name}{a.asset_code ? <span className="text-slate-400 font-normal"> · {a.asset_code}</span> : null}
                          {a.asset_tag_code && <p className="text-[11px] font-mono font-normal text-slate-400">{a.asset_tag_code}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{accountName(a.account_id)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          <p className="text-xs">{hubName(a.hub_id)}</p>
                          <p className="text-xs text-slate-400">{staffName(a.assigned_to)}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{format(new Date(a.purchase_date), 'd MMM yyyy')}</td>
                        <td className="px-4 py-3 text-slate-700">{inr(a.purchase_cost)}</td>
                        <td className="px-4 py-3 text-red-600">{inr(a.accumulated_depreciation)}</td>
                        <td className="px-4 py-3 font-semibold text-green-700">{inr(nbv)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full border ${a.status === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                          <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-slate-500 hover:text-blue-600" onClick={() => openTag(a)}>
                            <Tag className="h-3.5 w-3.5 mr-1" /> Tag
                          </Button>
                          {a.status === 'active' && (
                            <>
                              <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-slate-500 hover:text-blue-600" onClick={() => openReassign(a)}>
                                Reassign
                              </Button>
                              <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-slate-500 hover:text-red-600" onClick={() => disposeAsset.mutate(a.id)}>
                                <Archive className="h-3.5 w-3.5 mr-1" /> Dispose
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReassignTarget(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">Reassign · {reassignTarget.asset_name}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Hub / Location</label>
                <select value={reassignHub} onChange={e => setReassignHub(e.target.value)} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="">Not hub-specific</option>
                  {(hubs as any[]).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Assigned To (staff)</label>
                <select value={reassignStaff} onChange={e => setReassignStaff(e.target.value)} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setReassignTarget(null)}>Cancel</Button>
                <Button size="sm" onClick={() => reassignMutation.mutate()} disabled={reassignMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                  {reassignMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:bg-transparent" onClick={closeTag}>
          <Card className="w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            <CardContent id="asset-tag-print-area" className="p-6 flex flex-col items-center text-center gap-2">
              {tagQR ? <img src={tagQR} alt="Asset QR tag" className="h-40 w-40" /> : <Loader2 className="h-8 w-8 animate-spin text-slate-300" />}
              <p className="font-semibold text-slate-800 mt-1">{tagTarget.asset_name}</p>
              {tagTarget.asset_tag_code && <p className="text-sm font-mono text-slate-500">{tagTarget.asset_tag_code}</p>}
              <p className="text-[11px] text-slate-400">Scan to look up this asset</p>
            </CardContent>
            <CardContent className="pt-0 flex gap-2 justify-end print:hidden">
              <Button variant="outline" size="sm" onClick={closeTag}>Close</Button>
              <Button size="sm" onClick={() => window.print()} disabled={!tagQR} className="bg-blue-600 hover:bg-blue-700">
                <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
              </Button>
            </CardContent>
          </Card>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #asset-tag-print-area, #asset-tag-print-area * { visibility: visible; }
              #asset-tag-print-area {
                position: absolute !important; left: 0 !important; top: 0 !important;
                width: 100% !important; padding: 24px !important; margin: 0 !important;
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
