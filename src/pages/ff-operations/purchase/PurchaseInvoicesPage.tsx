// Purchase Invoices — the document generated automatically the moment a PO
// is saved (see ensurePurchaseBillForPO in src/lib/purchaseBillHelper.ts,
// called from savePOToStore). This is a record/GST document only: it does
// not post to the ledger. Purchases/Creditors are still recognised
// exclusively when a vendor payment is raised against the PO, exactly as
// before — see acct_sync_ff_vendor_payment. The "Payment" column here is a
// best-effort match on po_number (ff_vendor_payments has no po_id FK, only
// a po_breakdown jsonb blob), not a guaranteed link.
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { FileText, Search, RefreshCw, CheckCircle2, Clock, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PurchaseBill {
  id: string; bill_number: string; po_number: string; vendor_name: string | null;
  hub_id: string | null; bill_date: string; amount: number; status: 'draft' | 'issued' | 'cancelled';
  items: { itemName: string; quantity: number; rate: number }[] | null;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  issued:    { label: 'Issued',    cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-600 border-red-200' },
};

function BillDetail({ bill, onClose, onFinalize, finalizing }: { bill: PurchaseBill; onClose: () => void; onFinalize: () => void; finalizing: boolean }) {
  const items = bill.items ?? [];
  const lineTotal = (it: any) => Number(it.quantity || 0) * Number(it.rate || 0);
  const total = items.reduce((s, it) => s + lineTotal(it), 0) || Number(bill.amount) || 0;
  const cfg = STATUS_CFG[bill.status] || STATUS_CFG.draft;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:bg-transparent" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div id="purchase-bill-print-area" className="p-6 space-y-5">
          <div className="flex items-start justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <img src="/ff-logo.jpg" alt="Farmers Factory" className="w-14 h-14 object-contain rounded-lg" />
              <div>
                <p className="text-sm font-bold text-slate-800">Farmers Factory</p>
                <p className="text-xs text-slate-400 uppercase tracking-wider mt-0.5">Purchase Invoice</p>
                <h2 className="text-base font-bold text-slate-700 font-mono">{bill.bill_number}</h2>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-slate-400">Vendor</p><p className="font-medium text-slate-700">{bill.vendor_name || '—'}</p></div>
            <div><p className="text-xs text-slate-400">PO Reference</p><p className="font-medium text-slate-700">{bill.po_number}</p></div>
            <div><p className="text-xs text-slate-400">Bill Date</p><p className="font-medium text-slate-700">{bill.bill_date ? format(new Date(bill.bill_date), 'd MMM yyyy') : '—'}</p></div>
            <div><p className="text-xs text-slate-400">Amount</p><p className="font-medium text-slate-700">₹{Number(bill.amount).toLocaleString()}</p></div>
          </div>

          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Line Items</p>
            {items.length === 0 ? (
              <p className="text-sm text-slate-400">No line items recorded for this bill.</p>
            ) : (
              <table className="w-full text-sm border border-slate-100 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Rate</th><th className="text-right px-3 py-2">Total</th></tr>
                </thead>
                <tbody>
                  {items.map((it: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{it.itemName}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{it.quantity}</td>
                      <td className="px-3 py-2 text-right text-slate-600">₹{Number(it.rate).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">₹{lineTotal(it).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-3 py-2 text-slate-700" colSpan={3}>Grand Total</td>
                    <td className="px-3 py-2 text-right text-slate-800">₹{total.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 flex justify-end gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5 mr-1.5" /> Print</Button>
          {bill.status === 'draft' && <Button size="sm" onClick={onFinalize} disabled={finalizing} className="bg-blue-600 hover:bg-blue-700">{finalizing ? 'Finalizing…' : 'Finalize'}</Button>}
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #purchase-bill-print-area, #purchase-bill-print-area * { visibility: visible; }
          #purchase-bill-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; padding: 24px !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  );
}

export default function PurchaseInvoicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewing, setViewing] = useState<PurchaseBill | null>(null);

  const { data: bills = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['purchase-bills'],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_bills').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PurchaseBill[];
    },
  });

  // Best-effort payment status per PO — matches po_number against the free-text
  // po_breakdown jsonb on ff_vendor_payments (there's no real FK to join on).
  const { data: paymentByPO = {} } = useQuery({
    queryKey: ['ff-vendor-payments-po-breakdown'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ff_vendor_payments').select('po_breakdown, payment_status');
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data || []) {
        const text = JSON.stringify(row.po_breakdown ?? '');
        const matches = text.match(/PO-[A-Za-z0-9-]+/g) || [];
        for (const po of matches) {
          if (!map[po] || row.payment_status === 'paid') map[po] = row.payment_status;
        }
      }
      return map;
    },
  });

  const finalize = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('purchase_bills').update({ status: 'issued' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      toast.success('Bill finalized');
      qc.invalidateQueries({ queryKey: ['purchase-bills'] });
      setViewing((prev) => (prev && prev.id === id ? { ...prev, status: 'issued' } : prev));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => bills.filter((b) => {
    const matchSearch = !search || b.po_number?.toLowerCase().includes(search.toLowerCase()) || b.vendor_name?.toLowerCase().includes(search.toLowerCase()) || b.bill_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || b.status === statusFilter;
    return matchSearch && matchStatus;
  }), [bills, search, statusFilter]);

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12 pt-2 px-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-800 tracking-tight">Purchase Invoices</h1>
          <p className="text-[13px] text-slate-500">One bill per Purchase Order, generated automatically the moment it's saved.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['all', 'draft', 'issued', 'cancelled'].map((s) => {
          const items = s === 'all' ? bills : bills.filter((b) => b.status === s);
          return (
            <Card key={s} className={`cursor-pointer ${statusFilter === s ? 'ring-1 ring-blue-500' : ''}`} onClick={() => setStatusFilter(s)}>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500 capitalize">{s === 'all' ? 'Total' : s}</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{items.length}</p>
                <p className="text-xs text-slate-400">₹{items.reduce((sum, b) => sum + Number(b.amount || 0), 0).toLocaleString()}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search PO #, vendor, bill #…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No purchase invoices yet — they're generated automatically when a PO is saved.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50">
                  {['Bill #', 'PO #', 'Vendor', 'Bill Date', 'Amount', 'Payment', 'Status', ''].map((h) => (
                    <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((b) => {
                    const cfg = STATUS_CFG[b.status] || STATUS_CFG.draft;
                    const payStatus = paymentByPO[b.po_number];
                    return (
                      <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setViewing(b)}>
                        <td className="px-4 py-3 font-mono text-blue-600 text-xs underline decoration-dotted underline-offset-2">{b.bill_number}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{b.po_number}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{b.vendor_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{b.bill_date ? format(new Date(b.bill_date), 'd MMM yyyy') : '—'}</td>
                        <td className="px-4 py-3 text-slate-800 font-medium">₹{Number(b.amount).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {payStatus ? (
                            <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', payStatus === 'paid' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                              {payStatus === 'paid' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />} {payStatus === 'paid' ? 'Paid' : 'Payment raised'}
                            </span>
                          ) : <span className="text-xs text-gray-400">No payment yet</span>}
                        </td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span></td>
                        <td className="px-4 py-3 text-right">
                          {b.status === 'draft' && (
                            <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={(e) => { e.stopPropagation(); finalize.mutate(b.id); }}>Finalize</Button>
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
      {viewing && (
        <BillDetail bill={viewing} onClose={() => setViewing(null)} onFinalize={() => finalize.mutate(viewing.id)} finalizing={finalize.isPending} />
      )}
    </div>
  );
}
