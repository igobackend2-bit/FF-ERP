// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import type { ElementType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Package, ChevronDown, ChevronRight, RefreshCw,
  ShoppingCart, Clock, CheckCircle2, XCircle, Loader2,
  Calendar, Hash, ShoppingBag, Pencil, Plus, Trash2,
  Upload, FileWarning, CheckCircle, AlertCircle as AlertCircleIcon,
  Building2, Landmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { savePOToStore, fetchMaxPOSerial, type StoredPO } from '@/lib/purchaseStore';
import { parsePOFile, matchVendor, matchHub, normName, type ParsedPO } from '@/lib/poImportParsers';
import { fetchStoredVendors, vendorDisplayName } from '@/lib/vendorStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// ── Types ──────────────────────────────────────────────────────────────────────
interface POItem {
  id?: number | string;
  itemName?: string;
  product_name?: string;
  item_name?: string;
  quantity?: number;
  required_qty?: number;
  rate?: number;
  unit_price?: number;
  estimated_price?: number;
  unit?: string;
  ordered_qty?: number | null;
  customerDetails?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  hub_id: string | null;
  hub_name: string | null;
  status: string;
  total_amount: number | null;
  sub_total?: number | null;
  vendor_name?: string | null;
  delivery_date?: string | null;
  order_date?: string | null;
  created_at: string;
  notes?: string | null;
  items: POItem[];
}

function itemName(i: POItem) { return i.itemName || i.product_name || i.item_name || '—'; }
function itemQty(i: POItem)  { return Number(i.quantity ?? i.required_qty ?? 0); }
function itemRate(i: POItem) { return Number(i.rate ?? i.unit_price ?? i.estimated_price ?? 0); }

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; cls: string; icon: ElementType }> = {
  pending_approval: { label: 'Pending Approval', cls: 'bg-yellow-100 text-yellow-700', icon: Clock        },
  pending:          { label: 'Pending',           cls: 'bg-amber-100  text-amber-700',  icon: Clock        },
  approved:         { label: 'Approved',          cls: 'bg-blue-100   text-blue-700',   icon: CheckCircle2 },
  ordered:          { label: 'Ordered',           cls: 'bg-purple-100 text-purple-700', icon: ShoppingBag  },
  received:         { label: 'Received',          cls: 'bg-green-100  text-green-700',  icon: CheckCircle2 },
  billed:           { label: 'Billed',            cls: 'bg-indigo-100 text-indigo-700', icon: CheckCircle2 },
  rejected:         { label: 'Rejected',          cls: 'bg-red-100    text-red-600',    icon: XCircle      },
  cancelled:        { label: 'Cancelled',         cls: 'bg-red-100    text-red-600',    icon: XCircle      },
  partial:          { label: 'Partial',           cls: 'bg-orange-100 text-orange-700', icon: Package      },
  open:             { label: 'Open',              cls: 'bg-sky-100    text-sky-700',    icon: CheckCircle2 },
};

// Manual status-update options — same canonical set as the Purchase Report page.
const STATUS_OPTIONS = [
  { value: 'pending',   label: 'Pending' },
  { value: 'approved',  label: 'Approved' },
  { value: 'ordered',   label: 'Ordered' },
  { value: 'received',  label: 'Received' },
  { value: 'billed',    label: 'Billed' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

function StatusBadge({ status, poId, canEdit, onChanged }: { status: string; poId?: string; canEdit?: boolean; onChanged?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const cfg = STATUS[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600', icon: Package };
  const Icon = cfg.icon;

  if (canEdit && editing) {
    return (
      <select
        autoFocus defaultValue={status} disabled={saving}
        onClick={e => e.stopPropagation()}
        onBlur={() => setEditing(false)}
        onChange={async e => {
          const value = e.target.value;
          if (value === status) { setEditing(false); return; }
          setSaving(true);
          const { error } = await supabase.from('purchase_orders').update({ status: value }).eq('id', poId);
          setSaving(false);
          setEditing(false);
          if (error) { toast.error(error.message); return; }
          toast.success(`Status updated to ${STATUS_OPTIONS.find(o => o.value === value)?.label ?? value}`);
          onChanged?.();
        }}
        className="text-xs rounded-full border border-gray-200 px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <span
      onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
      title={canEdit ? 'Click to update status' : undefined}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold capitalize',
        canEdit && 'cursor-pointer hover:opacity-75 transition-opacity',
        cfg.cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {saving ? '…' : cfg.label}
    </span>
  );
}

// ── Create / Edit PO Dialog ──────────────────────────────────────────────────────
interface EditableItem { key: string; itemName: string; quantity: number; rate: number; }

function poToEditableItems(po: PurchaseOrder | null): EditableItem[] {
  if (!po || !Array.isArray(po.items) || po.items.length === 0) {
    return [{ key: Math.random().toString(36).slice(2), itemName: '', quantity: 0, rate: 0 }];
  }
  return po.items.map((it, idx) => ({
    key: `${idx}-${Math.random().toString(36).slice(2)}`,
    itemName: itemName(it),
    quantity: itemQty(it),
    rate: itemRate(it),
  }));
}

function PODialog({
  open, onClose, po, hubs, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
  hubs: Array<{ id: string; name: string }>;
  onSaved: () => void;
}) {
  const isNew = !po;
  const [hubId, setHubId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHubId(po?.hub_id ?? '');
    setVendorName(po?.vendor_name ?? '');
    setDeliveryDate((po?.delivery_date ?? '').slice(0, 10));
    setNotes(po?.notes ?? '');
    setItems(poToEditableItems(po));
  }, [open, po]);

  const addItem = () => setItems(prev => [...prev, { key: Math.random().toString(36).slice(2), itemName: '', quantity: 0, rate: 0 }]);
  const removeItem = (key: string) => setItems(prev => prev.filter(i => i.key !== key));
  const updateItem = (key: string, patch: Partial<EditableItem>) =>
    setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch } : i));

  const subTotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);

  const handleSave = async () => {
    if (!hubId) { toast.error('Select a delivery hub'); return; }
    const validItems = items.filter(i => i.itemName.trim() && i.quantity > 0);
    if (!validItems.length) { toast.error('Add at least one item with name and qty'); return; }

    setSaving(true);
    try {
      const hub = hubs.find(h => h.id === hubId);
      let poNumber = po?.po_number;
      if (isNew) {
        const serial = (await fetchMaxPOSerial()) + 1;
        poNumber = `PO-${String(serial).padStart(5, '0')}`;
      }

      const stored: StoredPO = {
        id: po?.id ?? '',
        poNumber: poNumber!,
        vendorName,
        date: po?.order_date ?? new Date().toISOString().split('T')[0],
        deliveryDate,
        paymentTerms: 'Due on Receipt',
        status: (po?.status ?? 'pending') as any,
        items: validItems.map((it, idx) => ({
          id: idx + 1,
          itemName: it.itemName.trim(),
          account: 'Cost of Goods Sold',
          quantity: Number(it.quantity),
          rate: Number(it.rate),
          tax: 'GST 5%',
          discount: 0,
          customerDetails: '',
        })),
        subTotal,
        total: subTotal,
        notes,
        hub_id: hubId,
        hub_name: hub?.name ?? '',
      };

      const { id: savedId, error: saveError } = await savePOToStore(stored);
      if (!savedId) { toast.error(saveError ? `Failed to save PO: ${saveError}` : 'Failed to save PO'); return; }
      toast.success(isNew ? 'Purchase order created' : 'Purchase order updated');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New Purchase Order' : `Edit ${po?.po_number}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Delivery Hub *</Label>
              <Select value={hubId} onValueChange={setHubId}>
                <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery Date</Label>
              <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Vendor name (optional)" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <button onClick={addItem} className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>
            {items.map(item => (
              <div key={item.key} className="grid grid-cols-[1fr_70px_80px_auto] gap-2 items-center">
                <Input
                  value={item.itemName}
                  onChange={e => updateItem(item.key, { itemName: e.target.value })}
                  placeholder="Product name"
                  className="text-sm"
                />
                <Input
                  type="number"
                  value={item.quantity || ''}
                  onChange={e => updateItem(item.key, { quantity: Number(e.target.value) })}
                  placeholder="Qty"
                  className="text-sm"
                />
                <Input
                  type="number"
                  value={item.rate || ''}
                  onChange={e => updateItem(item.key, { rate: Number(e.target.value) })}
                  placeholder="Rate"
                  className="text-sm"
                />
                <button onClick={() => removeItem(item.key)} disabled={items.length <= 1} className="text-red-400 hover:text-red-600 disabled:opacity-30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <p className="text-right text-sm font-bold text-slate-700 pt-1">
              Total: ₹{subTotal.toLocaleString('en-IN')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (isNew ? 'Create PO' : 'Save Changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Import PO(s) Dialog — PDF / CSV / XLSX ──────────────────────────────────────
interface ReviewRow extends ParsedPO {
  key: string;
  hubId: string;
  vendorId: string;          // '' → will create a new vendor from vendorNameOverride
  vendorNameOverride: string;
  include: boolean;
  status: 'pending' | 'importing' | 'done' | 'error';
  errorMsg?: string;
}

function ImportPODialog({
  open, onClose, hubs, vendors, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  hubs: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [batchHubId, setBatchHubId] = useState('');

  const reset = () => { setRows([]); setFileName(''); setExpanded(null); };
  const resetAll = () => { reset(); setBatchHubId(''); };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setRows([]);
    try {
      const parsed = await parsePOFile(file);
      if (!parsed.length) {
        toast.error('No purchase orders could be read from this file.');
        return;
      }
      const reviewRows: ReviewRow[] = parsed.map((p, i) => {
        const hub = matchHub(p.hubRaw, hubs);
        const vendor = matchVendor(p.vendorRaw, vendors);
        return {
          ...p,
          key: `${i}-${p.sourceRef}`,
          hubId: hub?.id ?? batchHubId,
          vendorId: vendor?.id ?? '',
          vendorNameOverride: vendor?.name ?? p.vendorRaw,
          include: true,
          status: 'pending',
        };
      });
      setRows(reviewRows);
      toast.success(`Parsed ${reviewRows.length} PO${reviewRows.length > 1 ? 's' : ''} — review before importing`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  };

  const updateRow = (key: string, patch: Partial<ReviewRow>) =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

  const includedCount = rows.filter(r => r.include).length;
  const readyCount = rows.filter(r => r.include && r.hubId).length;

  const handleImport = async () => {
    setImporting(true);
    let serial = await fetchMaxPOSerial();
    let created = 0, failed = 0;
    // A batch often repeats the same unmatched vendor name across many rows
    // (e.g. 9 POs for the same supplier in one file). Each row's vendorId
    // was resolved once at parse time against the vendor list as it stood
    // then, so without this cache every one of those rows would insert its
    // own duplicate "new vendor" row here — this makes rows later in the
    // same batch reuse whichever vendor an earlier row in this batch just
    // created, instead of creating a fresh duplicate every time.
    const createdVendorCache = new Map<string, string>();

    for (const row of rows) {
      if (!row.include) continue;
      if (!row.hubId) {
        updateRow(row.key, { status: 'error', errorMsg: 'No hub selected' });
        failed++;
        continue;
      }
      updateRow(row.key, { status: 'importing' });
      try {
        let vendorId = row.vendorId;
        if (!vendorId) {
          const name = row.vendorNameOverride.trim();
          if (!name) throw new Error('No vendor name');
          const cacheKey = normName(name);
          if (createdVendorCache.has(cacheKey)) {
            vendorId = createdVendorCache.get(cacheKey)!;
          } else {
            const { data: newVendor, error: vErr } = await supabase
              .from('vendors')
              .insert({ name, type: 'dynamic', is_active: true })
              .select('id')
              .single();
            if (vErr) throw vErr;
            vendorId = newVendor.id;
            createdVendorCache.set(cacheKey, vendorId);
          }
        }

        serial += 1;
        const hub = hubs.find(h => h.id === row.hubId);
        const poNumber = `PO-${String(serial).padStart(5, '0')}`;
        const stored: StoredPO = {
          id: '',
          poNumber,
          vendorName: row.vendorNameOverride,
          date: row.date,
          deliveryDate: row.date,
          paymentTerms: 'Due on Receipt',
          status: 'pending',
          items: row.items.map((it, idx) => ({
            id: idx + 1,
            itemName: it.name,
            account: 'Cost of Goods Sold',
            quantity: it.qty,
            rate: it.rate,
            tax: 'GST 5%',
            discount: 0,
            customerDetails: '',
          })),
          subTotal: row.parsedTotal,
          total: row.parsedTotal,
          notes: `Imported from ${row.sourceRef}`,
          hub_id: row.hubId,
          hub_name: hub?.name ?? '',
          vendor_id: vendorId,
        };

        const { id: savedId, error: saveError } = await savePOToStore(stored);
        if (!savedId) throw new Error(saveError || 'Save failed');
        updateRow(row.key, { status: 'done' });
        created++;
      } catch (e: any) {
        updateRow(row.key, { status: 'error', errorMsg: e.message || 'Failed' });
        failed++;
      }
    }

    setImporting(false);
    if (created) onSaved();
    toast[failed ? 'error' : 'success'](
      failed ? `Imported ${created}, ${failed} failed — see rows below` : `Imported ${created} purchase order${created > 1 ? 's' : ''}`
    );
  };

  const batchHub = hubs.find(h => h.id === batchHubId);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); resetAll(); } }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Purchase Orders</DialogTitle>
        </DialogHeader>

        {!rows.length ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-semibold text-gray-600">Which hub are these purchase orders for?</Label>
              <Select value={batchHubId} onValueChange={setBatchHubId} disabled={parsing}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder="Select hub first…" />
                </SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">
                Every imported PO will default to this hub — you can still change a row's hub after parsing if the file mixes hubs.
              </p>
            </div>

            <label className={cn(
              'flex flex-col items-center justify-center gap-2 w-full h-40 rounded-xl border-2 border-dashed transition-colors',
              !batchHubId ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' :
              parsing ? 'border-blue-300 bg-blue-50 cursor-pointer' : 'border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer'
            )}>
              {parsing ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  <span className="text-sm text-blue-600">Reading {fileName}…</span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-gray-400" />
                  <span className="text-sm font-medium text-gray-600">
                    {batchHubId ? 'Upload a PDF, CSV, or XLSX purchase order' : 'Select a hub above to enable upload'}
                  </span>
                  <span className="text-xs text-gray-400">One PO per page (PDF) or grouped by PO number (CSV/XLSX)</span>
                </>
              )}
              <input
                type="file" accept=".pdf,.csv,.xlsx,.xls" className="hidden" disabled={!batchHubId}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                {fileName} — {rows.length} PO{rows.length > 1 ? 's' : ''} parsed, {includedCount} selected, {readyCount} ready
                {batchHub && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">Hub: {batchHub.name}</span>}
              </span>
              <button onClick={reset} className="text-blue-600 hover:underline font-medium">Upload a different file</button>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {rows.map(row => (
                <div key={row.key} className={cn(
                  'border rounded-lg overflow-hidden',
                  row.status === 'error' ? 'border-red-300 bg-red-50' :
                  row.status === 'done' ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
                )}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input type="checkbox" checked={row.include} disabled={importing}
                      onChange={e => updateRow(row.key, { include: e.target.checked })} />
                    <button onClick={() => setExpanded(v => v === row.key ? null : row.key)} className="p-0.5 text-gray-400">
                      {expanded === row.key ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-xs font-mono text-gray-400 w-20 shrink-0">{row.sourceRef}</span>

                    <Select value={row.hubId} onValueChange={v => updateRow(row.key, { hubId: v })} disabled={importing}>
                      <SelectTrigger className={cn('h-8 text-xs flex-1', !row.hubId && 'border-amber-400 text-amber-700')}>
                        <SelectValue placeholder="Select hub…" />
                      </SelectTrigger>
                      <SelectContent>
                        {hubs.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    <Input
                      value={row.vendorNameOverride} disabled={importing}
                      onChange={e => updateRow(row.key, { vendorNameOverride: e.target.value, vendorId: '' })}
                      className={cn('h-8 text-xs flex-1', !row.vendorId && 'border-amber-300')}
                      placeholder="Vendor name"
                    />

                    <span className="text-xs font-semibold text-gray-700 w-20 text-right shrink-0">
                      ₹{row.parsedTotal.toLocaleString('en-IN')}
                    </span>

                    {row.status === 'importing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                    {row.status === 'done' && <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />}
                    {row.status === 'error' && <AlertCircleIcon className="h-4 w-4 text-red-500 shrink-0" title={row.errorMsg} />}
                  </div>

                  {!row.vendorId && (
                    <p className="px-3 pb-1.5 -mt-1 text-[10px] text-amber-600">New vendor — will be created on import</p>
                  )}
                  {row.declaredTotal != null && Math.abs(row.declaredTotal - row.parsedTotal) > 1 && (
                    <p className="px-3 pb-1.5 -mt-1 text-[10px] text-red-500 flex items-center gap-1">
                      <FileWarning className="h-3 w-3" /> File shows total ₹{row.declaredTotal.toLocaleString('en-IN')}, parsed items sum to ₹{row.parsedTotal.toLocaleString('en-IN')} — check items before importing
                    </p>
                  )}
                  {row.status === 'error' && row.errorMsg && (
                    <p className="px-3 pb-1.5 -mt-1 text-[10px] text-red-600">{row.errorMsg}</p>
                  )}

                  {expanded === row.key && (
                    <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/60">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left font-medium py-1">Item</th>
                            <th className="text-right font-medium py-1">Qty</th>
                            <th className="text-right font-medium py-1">Rate</th>
                            <th className="text-right font-medium py-1">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.items.map((it, idx) => (
                            <tr key={idx} className="border-t border-gray-100">
                              <td className="py-1 text-gray-700">{it.name}</td>
                              <td className="py-1 text-right text-gray-600">{it.qty} {it.unit}</td>
                              <td className="py-1 text-right text-gray-600">₹{it.rate.toFixed(2)}</td>
                              <td className="py-1 text-right font-medium text-gray-800">₹{it.amount.toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => { onClose(); resetAll(); }} disabled={importing}>Close</Button>
            <Button onClick={handleImport} disabled={importing || readyCount === 0}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Import ${readyCount} PO${readyCount === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── PO Row (expandable) ────────────────────────────────────────────────────────
function PORow({ po, showBuy, canEdit, onEdit, vendorMap, onStatusChanged }: { po: PurchaseOrder; showBuy: boolean; canEdit: boolean; onEdit: (po: PurchaseOrder) => void; vendorMap: (name: string) => any; onStatusChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const items = Array.isArray(po.items) ? po.items : [];
  const dateLabel = po.delivery_date || po.order_date || po.created_at;
  const vendor = po.vendor_name ? vendorMap(po.vendor_name) : null;
  const bank = vendor?.banks?.[0];

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 bg-white hover:bg-slate-50 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
          <div>
            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">PO Number</p>
            <p className="text-sm font-bold text-blue-700">{po.po_number}</p>
            {po.vendor_name && <p className="text-[11px] font-semibold text-gray-700 mt-0.5">{po.vendor_name}</p>}
            {po.hub_name && (
              <p className="text-[11px] text-gray-500 flex items-center gap-1">
                <Building2 className="h-3 w-3 text-gray-300" />{po.hub_name}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            <div>
              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Date</p>
              <p className="text-sm font-semibold text-gray-700">
                {dateLabel ? format(new Date(dateLabel), 'd MMM yyyy') : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-gray-400" />
            <div>
              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Items / Amount</p>
              <p className="text-sm font-semibold text-gray-700">
                {items.length} items · ₹{Number(po.total_amount ?? po.sub_total ?? 0).toLocaleString('en-IN')}
              </p>
            </div>
          </div>

          <div className="flex justify-end md:justify-start">
            <StatusBadge status={po.status} poId={po.id} canEdit={canEdit} onChanged={onStatusChanged} />
          </div>
        </div>

        {canEdit && (
          <button
            onClick={e => {
              e.stopPropagation();
              onEdit(po);
            }}
            className="shrink-0 px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        )}

        {showBuy && (
          <button
            onClick={e => {
              e.stopPropagation();
              navigate('/purchase/buy', { state: { poId: po.id, poNumber: po.po_number } });
            }}
            className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Buy
          </button>
        )}
      </button>

      {open && (
        <div className="bg-gray-50 border-t border-gray-100 px-5 py-3">
          {po.vendor_name && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-3 mb-3 border-b border-gray-100 text-xs">
              <span className="font-semibold text-gray-800">{po.vendor_name}</span>
              {vendor?.gstin && <span className="text-gray-500 font-mono">GSTIN: {vendor.gstin}</span>}
              {bank?.bankName ? (
                <span className="flex items-center gap-1 text-gray-500">
                  <Landmark className="h-3 w-3 text-gray-300" />
                  {bank.bankName}{bank.accountNumber && ` · A/C ${bank.accountNumber}`}{bank.ifscCode && ` · ${bank.ifscCode}`}
                </span>
              ) : (
                <span className="text-amber-600">No bank details on file — add them from the Purchase Report page</span>
              )}
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No items in this PO.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-200">
                  <th className="text-left py-2 font-semibold">Product</th>
                  <th className="text-right py-2 font-semibold">Qty</th>
                  <th className="text-right py-2 font-semibold">Rate</th>
                  <th className="text-right py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white transition-colors">
                    <td className="py-2.5 font-medium text-gray-800">{itemName(item)}</td>
                    <td className="py-2.5 text-right text-gray-700">{itemQty(item).toFixed(1)} {item.unit || 'kg'}</td>
                    <td className="py-2.5 text-right text-gray-700">
                      {itemRate(item) ? `₹${itemRate(item).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-2.5 text-right text-gray-700">
                      {itemRate(item) ? `₹${(itemQty(item) * itemRate(item)).toLocaleString('en-IN')}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {po.notes && <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">{po.notes}</p>}
        </div>
      )}
    </div>
  );
}

// ── Hub name helpers — handle spelling variants (Palikarani vs Pallikaranai)
const normHub = (s: string) =>
  (s ?? '').toLowerCase().replace(/\s*hub\s*/gi, '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
// Two hub names match if normalised forms share ≥8 char prefix
// e.g. "palikarani" vs "palikaranai" → share "palikaran" (9) → same hub
const hubNormMatch = (a: string, b: string) => {
  if (!a || !b || a.length < 5 || b.length < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 8;
};

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const hubId = (user as any)?.hub_id ?? null;
  const isManagement = ['ceo', 'gm', 'admin', 'director', 'ff_operations_manager'].includes(user?.role ?? '');
  const showBuy = user?.role === 'shift_employee';
  // Anyone who can reach this page at all (see App.tsx's OPS_ROLES on
  // /purchase/orders) can also create/edit a PO here — matches the ask to
  // extend PO add/edit to everyone with visibility into this dashboard,
  // not just Ops Manager/Hub Manager. ff_payment_access flag holders are
  // included too, for parity with the rest of the FF payment/PO surface.
  // 'admin' and 'ceo' intentionally excluded — their sidebar links to
  // Purchase Orders are meant as a read-only overview, not an edit surface.
  // 'field_executive' removed 2026-10-01 — this is a field sales/collection
  // role, not a purchase role, and should see POs read-only, no Edit button.
  // A named individual can still get edit access via the separate
  // ff_payment_access profile flag below, same as any other role.
  const PO_EDIT_ROLES = new Set([
    'director', 'gm', 'gmo', 'smo', 'boi', 'nsm',
    'hr', 'accounts', 'back_office',
    'purchase_manager', 'purchase_head', 'warehouse_manager', 'qc_manager',
    'tele_caller', 'bde',
    'ff_operations_manager', 'hub_manager', 'l1_manager', 'shift_employee',
  ]);
  const canEditPO = PO_EDIT_ROLES.has(user?.role ?? '') || (user as any)?.ff_payment_access === true;
  const [filter, setFilter] = useState<'all' | 'pending' | 'ordered' | 'received'>('all');
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: hubs = [] } = useQuery({
    queryKey: ['hubs-active-po-edit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hubs').select('id, name, address, city').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: canEditPO,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-active-po-import'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: canEditPO,
  });

  // Full vendor records (with bank details) for showing vendor name + bank
  // info next to each PO — available to anyone who can view this page.
  // Fuzzy-matched (not an exact-string key) since a PO's free-text vendor
  // name ("MS. KRP TRADERS") rarely matches a vendor record's stored name
  // exactly — same tolerant matching the PO import review screen uses.
  const { data: vendorList = [] } = useQuery({
    queryKey: ['vendors-list-po-view'],
    queryFn: fetchStoredVendors,
  });
  // A batch PO import repeating the same vendor name across many rows can
  // create several duplicate vendor rows for that one name — only one of
  // which usually has bank details. Prefer whichever same-named vendor
  // actually has bank details instead of an arbitrary/empty duplicate.
  const vendorMap = useMemo(() => {
    const cache = new Map<string, any>();
    return (rawName: string) => {
      if (!rawName) return null;
      if (cache.has(rawName)) return cache.get(rawName);
      const norm = normName(rawName);
      const exactMatches = vendorList.filter((v: any) => normName(vendorDisplayName(v)) === norm);
      let result: any = null;
      if (exactMatches.length) {
        result = exactMatches.find((v: any) => v.banks?.[0]?.accountNumber) ?? exactMatches[0];
      } else {
        const candidates = vendorList.map((v: any) => ({ id: v.id, name: vendorDisplayName(v) }));
        const m = matchVendor(rawName, candidates);
        result = m ? vendorList.find((v: any) => v.id === m.id) ?? null : null;
      }
      cache.set(rawName, result);
      return result;
    };
  }, [vendorList]);

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['purchase-orders-exec', hubId],
    queryFn: async () => {
      // Fetch all POs — filter client-side so spelling variants of hub names still match
      // (DB may have duplicate hub records: "Palikarani Hub" vs "Pallikarani Hub" with different UUIDs)
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, po_number, hub_id, hub_name, status, total_amount, sub_total, vendor_name, delivery_date, order_date, created_at, notes, items, assigned_executive_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      let result = (data ?? []).map((po: any) => ({
        ...po,
        items: Array.isArray(po.items) ? po.items : [],
      })) as PurchaseOrder[];

      // Purchase Executives only see POs actually assigned to them by their hub
      // manager (via the PO Assignment page) — not every PO for their hub.
      if (user?.role === 'shift_employee') {
        result = result.filter(po => po.assigned_executive_id === user.id);
      } else if (!isManagement && hubId) {
        // Non-management, non-exec roles (e.g. hub_manager): keep only this hub's POs
        // Fetch exec's canonical hub name for fuzzy fallback matching
        const { data: hubRow } = await (supabase as any)
          .from('hubs').select('name').eq('id', hubId).maybeSingle();
        const execNorm = normHub(hubRow?.name ?? '');

        result = result.filter(po =>
          po.hub_id === hubId ||                                          // exact UUID match (fast path)
          (execNorm.length >= 5 && hubNormMatch(normHub(po.hub_name ?? ''), execNorm)) // fuzzy name fallback
        );
      }

      return result;
    },
    enabled: !!user,
  });

  const filtered = filter === 'all'
    ? orders
    : filter === 'pending'
      ? orders.filter(o => o.status === 'pending' || o.status === 'pending_approval')
      : orders.filter(o => o.status === filter);

  const grouped = filtered.reduce<Record<string, PurchaseOrder[]>>((acc, po) => {
    const raw = po.order_date ?? po.delivery_date ?? po.created_at;
    const key = raw ? raw.slice(0, 10) : 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(po);
    return acc;
  }, {});

  const tabs: Array<{ key: typeof filter; label: string }> = [
    { key: 'all',      label: 'All POs'  },
    { key: 'pending',  label: 'Pending'  },
    { key: 'ordered',  label: 'Ordered'  },
    { key: 'received', label: 'Received' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 pt-4 px-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-blue-600" />
            My Purchase Orders
          </h1>
          <p className="text-[13px] text-slate-500">All EOD-generated POs assigned to your hub</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditPO && (
            <>
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5"
              >
                <Upload className="h-4 w-4" />
                Import
              </Button>
              <Button
                onClick={() => { setEditingPO(null); setDialogOpen(true); }}
                className="flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                New PO
              </Button>
            </>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total POs', value: orders.length,                                                                              color: 'text-blue-700',   bg: 'bg-blue-50'   },
          { label: 'Pending',   value: orders.filter(o => o.status === 'pending' || o.status === 'pending_approval').length,       color: 'text-amber-700',  bg: 'bg-amber-50'  },
          { label: 'Ordered',   value: orders.filter(o => o.status === 'ordered').length,                                          color: 'text-purple-700', bg: 'bg-purple-50' },
          { label: 'Received',  value: orders.filter(o => o.status === 'received').length,                                         color: 'text-green-700',  bg: 'bg-green-50'  },
        ].map(s => (
          <div key={s.label} className={cn('rounded-xl border border-gray-100 px-5 py-4 shadow-sm', s.bg)}>
            <p className="text-[12px] font-medium text-slate-500 mb-1">{s.label}</p>
            <p className={cn('text-2xl font-black', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px',
              filter === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
            {t.key !== 'all' && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-500">
                {orders.filter(o => o.status === t.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Package className="h-12 w-12 mb-3 opacity-30" />
          <p className="font-medium">No purchase orders found</p>
          <p className="text-sm">EOD-generated POs will appear here</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, pos]) => (
              <div key={date}>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                    {date !== 'Unknown' ? format(new Date(date), 'd MMMM yyyy') : 'Unknown Date'}
                  </h3>
                  <span className="text-xs text-gray-400">({pos.length} PO{pos.length !== 1 ? 's' : ''})</span>
                </div>
                <div className="space-y-2">
                  {pos.map(po => (
                    <PORow
                      key={po.id}
                      po={po}
                      showBuy={showBuy}
                      canEdit={canEditPO}
                      onEdit={p => { setEditingPO(p); setDialogOpen(true); }}
                      vendorMap={vendorMap}
                      onStatusChanged={refetch}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {canEditPO && (
        <PODialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          po={editingPO}
          hubs={hubs}
          onSaved={() => refetch()}
        />
      )}

      {canEditPO && (
        <ImportPODialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          hubs={hubs}
          vendors={vendors}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}
