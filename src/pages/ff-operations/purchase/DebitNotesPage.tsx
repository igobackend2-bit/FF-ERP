import { useState, useMemo } from 'react';
import { Plus, Search, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useMakerChecker, logAudit } from '@/hooks/useAccounts';

interface DebitNote {
  id: string; debit_note_number: string; vendor_name: string;
  invoice_reference: string; amount: number; reason: string;
  status: 'draft' | 'issued' | 'applied' | 'cancelled';
  issued_date: string; created_at: string;
}
interface VendorOption { id: string; name: string }
interface HubOption { id: string; name: string }

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'bg-slate-100 text-slate-500 border-slate-200' },
  issued:    { label: 'Issued',    color: 'bg-blue-50 text-blue-600 border-blue-200' },
  applied:   { label: 'Applied',   color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  cancelled: { label: 'Cancelled', color: 'bg-red-50 text-red-600 border-red-200' },
};

const emptyForm = { vendor_id: '', vendor_name: '', hub_id: '', invoice_reference: '', amount: '', reason: '', issued_date: new Date().toISOString().split('T')[0] };

export default function DebitNotesPage() {
  const { user } = useAuth();
  const { needsApproval } = useMakerChecker();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, hub_id: (user as any)?.hub_id || '' });
  const [vendorQuery, setVendorQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: notes = [], isLoading, refetch } = useQuery({
    queryKey: ['debit-notes'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('debit_notes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DebitNote[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-for-debit-note'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, name').order('name');
      if (error) throw error;
      return (data || []) as VendorOption[];
    },
    enabled: showForm,
  });

  const { data: hubs = [] } = useQuery({
    queryKey: ['hubs-for-debit-note'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hubs').select('id, name').order('name');
      if (error) throw error;
      return (data || []) as HubOption[];
    },
    enabled: showForm,
  });

  const vendorMatches = useMemo(() => {
    if (!vendorQuery || form.vendor_id) return [];
    const q = vendorQuery.toLowerCase();
    return vendors.filter(v => v.name?.toLowerCase().includes(q)).slice(0, 8);
  }, [vendors, vendorQuery, form.vendor_id]);

  const filtered = notes.filter(n => {
    const matchSearch = !search || n.vendor_name?.toLowerCase().includes(search.toLowerCase()) || n.debit_note_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || n.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = async () => {
    if (!form.vendor_id || !form.amount || !form.reason || !form.hub_id) { toast.error('Select a vendor, hub, amount and reason'); return; }
    setSaving(true);
    try {
      const number = `DN-${Date.now()}`;
      const { data: inserted, error } = await (supabase as any).from('debit_notes').insert({
        debit_note_number: number,
        vendor_id: form.vendor_id,
        vendor_name: form.vendor_name,
        hub_id: form.hub_id,
        invoice_reference: form.invoice_reference || null,
        amount: parseFloat(form.amount),
        reason: form.reason, status: needsApproval ? 'draft' : 'issued',
        issued_date: form.issued_date, created_by: user?.id,
      }).select('id').single();
      if (error) throw error;
      await logAudit({ record_type: 'DebitNote', record_id: inserted.id, action: needsApproval ? 'submitted_for_approval' : 'issued', performed_by_name: user?.name, remarks: number });
      toast.success(needsApproval ? 'Debit note submitted for approval' : 'Debit note created and posted to the books');
      setShowForm(false);
      setForm({ ...emptyForm, hub_id: (user as any)?.hub_id || '' });
      setVendorQuery('');
      refetch();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12 pt-2 px-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-800 tracking-tight">Debit Notes</h1>
          <p className="text-[13px] text-slate-500">Manage debit adjustments raised against vendors</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="bg-red-600 hover:bg-red-700"><Plus className="w-4 h-4 mr-2" />New Debit Note</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['all','draft','issued','applied','cancelled'].map(s => {
          const items = s === 'all' ? notes : notes.filter(n => n.status === s);
          return (
            <Card key={s} className={`cursor-pointer ${statusFilter === s ? 'ring-1 ring-red-500' : ''}`} onClick={() => setStatusFilter(s)}>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500 capitalize">{s === 'all' ? 'Total' : s}</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{items.length}</p>
                <p className="text-xs text-slate-400">₹{items.reduce((s,n)=>s+Number(n.amount||0),0).toLocaleString()}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Debit Note</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <label className="text-xs text-slate-500 mb-1 block">Vendor *</label>
                <Input
                  value={form.vendor_id ? form.vendor_name : vendorQuery}
                  onChange={e => { setVendorQuery(e.target.value); setForm(f => ({ ...f, vendor_id: '', vendor_name: '' })); }}
                  placeholder="Search vendor by name..."
                />
                {vendorMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {vendorMatches.map(v => (
                      <button key={v.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => { setForm(f => ({ ...f, vendor_id: v.id, vendor_name: v.name })); setVendorQuery(''); }}>
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Hub *</label>
                <select value={form.hub_id} onChange={e=>setForm(f=>({...f,hub_id:e.target.value}))} className="w-full h-9 rounded-md border border-slate-200 px-3 text-sm">
                  <option value="">Select hub...</option>
                  {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-slate-500 mb-1 block">Invoice Reference</label><Input value={form.invoice_reference} onChange={e=>setForm(f=>({...f,invoice_reference:e.target.value}))} placeholder="PO/BILL-XXXX"/></div>
              <div><label className="text-xs text-slate-500 mb-1 block">Amount (₹) *</label><Input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/></div>
              <div><label className="text-xs text-slate-500 mb-1 block">Issue Date</label><Input type="date" value={form.issued_date} onChange={e=>setForm(f=>({...f,issued_date:e.target.value}))}/></div>
              <div className="md:col-span-2"><label className="text-xs text-slate-500 mb-1 block">Reason *</label><Input value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} placeholder="Reason for debit note"/></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={()=>setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-red-600 hover:bg-red-700">{saving?'Creating...':'Create'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." className="pl-9"/>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="flex items-center justify-center h-32 text-sm text-slate-400">Loading...</div>
          : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400">
              <FileText className="w-8 h-8 mb-2 opacity-40"/><p className="text-sm">No debit notes found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50">
                  {['Debit Note #','Vendor','Invoice Ref','Amount','Reason','Status','Date'].map(h=>(
                    <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map(n => {
                    const s = STATUS_CONFIG[n.status]||STATUS_CONFIG.draft;
                    return (
                      <tr key={n.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-red-600 text-xs">{n.debit_note_number}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{n.vendor_name}</td>
                        <td className="px-4 py-3 text-slate-500">{n.invoice_reference||'—'}</td>
                        <td className="px-4 py-3 text-slate-800 font-medium">₹{Number(n.amount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{n.reason}</td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full border ${s.color}`}>{s.label}</span></td>
                        <td className="px-4 py-3 text-slate-500">{n.issued_date||n.created_at?.split('T')[0]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
