// ─────────────────────────────────────────────────────────────
//  Shared Purchase-Order store — Supabase only (no localStorage)
// ─────────────────────────────────────────────────────────────

import { supabase } from '@/integrations/supabase/client';
import { ensurePurchaseBillForPO } from '@/lib/purchaseBillHelper';

export interface StoredPOItem {
  id: number;
  itemName: string;
  account: string;
  quantity: number;
  rate: number;
  tax: string;
  discount: number;
  customerDetails: string;
}

export interface StoredPO {
  id: string;
  poNumber: string;
  vendorName: string;
  date: string;
  deliveryDate: string;
  paymentTerms: string;
  status: 'draft' | 'pending_approval' | 'open' | 'rejected' | 'billed' | 'cancelled';
  rejectionReason?: string;
  approvedBy?: string;
  approvedAt?: string;
  items: StoredPOItem[];
  subTotal: number;
  total: number;
  notes: string;
  hub_id?: string;
  hub_name?: string;
  vendor_id?: string;
}

// ── DB row → StoredPO ─────────────────────────────────────────
function rowToPO(row: any): StoredPO {
  return {
    id:           row.id,
    poNumber:     row.po_number,
    vendorName:   row.vendor_name ?? '',
    // The PO's own business date (eod_date, mirrored to delivery_date on
    // write — see poToPayload) — NOT created_at, which is just when the row
    // was inserted. A bulk/catch-up import can insert several days' worth
    // of POs in one sitting, so created_at clusters around the import
    // moment while eod_date correctly holds each PO's real date. Reading
    // created_at here was making the Purchase Report's date filter and
    // displayed "PO date" silently wrong for anything imported late.
    date:         row.eod_date ?? row.delivery_date ?? row.created_at?.split('T')[0] ?? '',
    deliveryDate: row.delivery_date ?? row.eod_date ?? '',
    paymentTerms: row.payment_terms ?? 'Due on Receipt',
    status:       row.status === 'approved' ? 'open' : (row.status ?? 'draft'),
    rejectionReason: row.rejection_reason ?? undefined,
    approvedBy:   row.approved_by ?? undefined,
    approvedAt:   row.approved_at ?? undefined,
    items:        Array.isArray(row.items) ? row.items : [],
    subTotal:     Number(row.sub_total ?? 0),
    total:        Number(row.total_amount ?? 0),
    notes:        row.notes ?? '',
    hub_id:       row.hub_id ?? undefined,
    hub_name:     row.hub_name ?? undefined,
    vendor_id:    row.vendor_id ?? undefined,
  };
}

// ── StoredPO → DB payload ─────────────────────────────────────
function poToPayload(po: StoredPO): Record<string, any> {
  const payload: Record<string, any> = {
    po_number:       po.poNumber,
    status:          (po.status === 'open' || po.status === 'pending_approval') ? 'pending' : po.status,
    sub_total:       po.subTotal,
    total_amount:    po.total,
    total_estimated: po.total,
    items_count:     po.items?.length ?? 0,
    notes:           po.notes || null,
    items:           po.items,
    vendor_name:     po.vendorName || null,
    delivery_date:   po.deliveryDate || null,
    payment_terms:   po.paymentTerms || null,
  };
  if (po.deliveryDate) {
    payload.eod_date = po.deliveryDate;
    // VendorPerformance.tsx's on-time-delivery rate needs this — it was
    // otherwise only ever set by the legacy PurchaseOrderForm.tsx, so POs
    // created through the normal EOD flow had no expected date to compare
    // actual_delivery_date against, and every vendor showed a 0% OTD rate.
    payload.expected_delivery_date = po.deliveryDate;
  }
  if (po.hub_id && po.hub_id !== 'unassigned')    payload.hub_id    = po.hub_id;
  if (po.hub_name)  payload.hub_name  = po.hub_name;
  if (po.vendor_id) payload.vendor_id = po.vendor_id;
  return payload;
}

// ── Async read helpers (used by pages via useQuery) ───────────

// Supabase's PostgREST API silently caps any unbounded query at 1000 rows
// — an unpaginated .select('*') doesn't error, it just quietly returns the
// newest 1000 (since these are ordered created_at DESC) and drops
// everything older. With purchase_orders well past that count from this
// session's bulk imports, that was making POs from a few days back vanish
// from the Purchase Report before its own date filter ever ran. This pages
// through in batches of 1000 until a page comes back short, so nothing
// gets silently dropped regardless of how large the table grows.
async function fetchAllRows(table: string, extra?: (q: any) => any): Promise<any[]> {
  const PAGE_SIZE = 1000;
  const rows: any[] = [];
  let page = 0;
  while (true) {
    let q = supabase.from(table).select('*').order('created_at', { ascending: false });
    if (extra) q = extra(q);
    const { data, error } = await q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) { console.error(`[purchaseStore] fetchAllRows(${table}):`, error.message); break; }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    page++;
  }
  return rows;
}

export async function fetchAllPOs(): Promise<StoredPO[]> {
  const rows = await fetchAllRows('purchase_orders');
  return rows.map(rowToPO);
}

export async function fetchOpenPOs(): Promise<StoredPO[]> {
  const rows = await fetchAllRows('purchase_orders', q => q.eq('status', 'approved'));
  return rows.map(rowToPO);
}

export async function fetchPendingApprovalPOs(): Promise<StoredPO[]> {
  const rows = await fetchAllRows('purchase_orders', q => q.eq('status', 'pending_approval'));
  return rows.map(rowToPO);
}

export async function fetchMaxPOSerial(): Promise<number> {
  const { data } = await supabase
    .from('purchase_orders')
    .select('po_number')
    .order('created_at', { ascending: false })
    .limit(100);
  if (!data) return 0;
  return data.reduce((max: number, row: any) => {
    const n = parseInt((row.po_number ?? '').replace('PO-', ''), 10) || 0;
    return Math.max(max, n);
  }, 0);
}

// ── Sync write helpers ────────────────────────────────────────

export interface SavePOResult {
  id: string | null;
  error: string | null;
}

export async function savePOToStore(po: StoredPO): Promise<SavePOResult> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .upsert(poToPayload(po), { onConflict: 'po_number' })
    .select('id')
    .single();
  if (error) { console.error('[purchaseStore] savePOToStore:', error.message); return { id: null, error: error.message }; }
  const poId = data?.id ?? null;

  // Also insert items into purchase_order_items so BuyPage can render them
  if (poId && po.items && po.items.length > 0) {
    // Remove any old items first (in case of upsert/update)
    await supabase.from('purchase_order_items').delete().eq('po_id', poId);
    const itemRows = po.items.map(item => ({
      po_id:          poId,
      hub_id:         (po.hub_id && po.hub_id !== 'unassigned') ? po.hub_id : null,
      product_name:   item.itemName,
      item_name:      item.itemName,
      required_qty:   item.quantity,
      quantity:       item.quantity,
      unit:           'KG',
      estimated_price: item.rate,
      unit_price:     item.rate,
      total_price:    Math.round(item.quantity * item.rate),
      status:         'pending',
      ordered_qty:    0,
      received_qty:   0,
    }));
    const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemRows);
    if (itemErr) {
      // The PO row itself was already saved, but its line items weren't —
      // most likely an RLS gap (this role can write purchase_orders but
      // not purchase_order_items). Surface this as a full failure rather
      // than silently returning a "successful" id for a PO with 0 items.
      console.error('[purchaseStore] insert purchase_order_items:', itemErr.message);
      return { id: null, error: itemErr.message };
    }
  }

  if (poId) await ensurePurchaseBillForPO(poId, po);

  return { id: poId, error: null };
}

export async function markPOBilled(poNumber: string): Promise<void> {
  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'billed' })
    .eq('po_number', poNumber);
  if (error) console.error('[purchaseStore] markPOBilled:', error.message);
}

export async function deletePOFromStore(poNumber: string): Promise<void> {
  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled' })
    .eq('po_number', poNumber);
  if (error) console.error('[purchaseStore] deletePOFromStore:', error.message);
}

// ── Auto-generate POs from sales order aggregates ────────────

export async function createPOsFromSalesOrders(
  items: Array<{ productName: string; totalQty: number; unit: string; avgPrice: number; totalValue: number }>,
  hubId?: string,
  hubName?: string,
): Promise<StoredPO[]> {
  const serial = await fetchMaxPOSerial();
  const today  = new Date().toISOString().split('T')[0];
  const created: StoredPO[] = [];

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const poNumber = `PO-${String(serial + i + 1).padStart(5, '0')}`;
    const subTotal = Math.round(item.totalQty * item.avgPrice);
    const total    = Math.round(subTotal * 1.05);

    const po: StoredPO = {
      id:           '',   // filled after DB insert
      poNumber,
      vendorName:   '',
      date:         today,
      deliveryDate: '',
      paymentTerms: 'Due on Receipt',
      status:       'pending_approval',
      items: [{
        id: 1,
        itemName:        item.productName,
        account:         'Cost of Goods Sold',
        quantity:        item.totalQty,
        rate:            item.avgPrice,
        tax:             'GST 5%',
        discount:        0,
        customerDetails: '',
      }],
      subTotal,
      total,
      notes:    `Auto-generated from sales orders | Avg rate ₹${item.avgPrice}/${item.unit}`,
      hub_id:   hubId,
      hub_name: hubName,
    };

    const { id: dbId } = await savePOToStore(po);
    if (dbId) po.id = dbId;
    created.push(po);
  }

  return created;
}

// ── Legacy sync shims (for pages that haven't been updated yet) ─
// These keep the old synchronous call shape working by logging a warning.
/** @deprecated use fetchAllPOs() inside useQuery instead */
export function getStoredPOs(): StoredPO[] {
  console.warn('[purchaseStore] getStoredPOs() is deprecated — use fetchAllPOs() in useQuery');
  return [];
}
/** @deprecated use fetchOpenPOs() inside useQuery instead */
export function getOpenPOs(): StoredPO[] {
  console.warn('[purchaseStore] getOpenPOs() is deprecated — use fetchOpenPOs() in useQuery');
  return [];
}
/** @deprecated use fetchPendingApprovalPOs() inside useQuery instead */
export function getPendingApprovalPOs(): StoredPO[] {
  console.warn('[purchaseStore] getPendingApprovalPOs() is deprecated — use fetchPendingApprovalPOs() in useQuery');
  return [];
}
/** @deprecated use fetchMaxPOSerial() instead */
export function getMaxPOSerial(): number {
  console.warn('[purchaseStore] getMaxPOSerial() is deprecated — use fetchMaxPOSerial()');
  return 0;
}
/** @deprecated use savePOToStore() (now async) */
export function syncPOToSupabase(po: StoredPO): Promise<SavePOResult> {
  return savePOToStore(po);
}
