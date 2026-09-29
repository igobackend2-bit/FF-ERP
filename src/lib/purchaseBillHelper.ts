// ─────────────────────────────────────────────────────────────
//  Purchase Bills — the purchase-side mirror of invoiceHelper.ts.
//  A Purchase Bill is a document only: it snapshots what a PO said at the
//  moment it was saved, for GST/record purposes. It never touches the
//  ledger — Purchases/Creditors are still recognised exclusively when a
//  vendor payment is raised (acct_sync_ff_vendor_payment). This just gives
//  every PO the paper trail Sales Orders already get via `invoices`.
// ─────────────────────────────────────────────────────────────
import { supabase } from '@/integrations/supabase/client';
import type { StoredPO } from '@/lib/purchaseStore';

function generateBillNumber(poNumber: string) {
  return `PB-${poNumber.replace(/^PO-/, '')}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Creates one purchase_bills row for a PO the first time it's saved.
 * Safe to call on every savePOToStore() (insert or update) — it's a no-op
 * if a bill for this po_number already exists, so editing a PO later never
 * spawns a second bill.
 */
export async function ensurePurchaseBillForPO(poId: string, po: StoredPO): Promise<void> {
  try {
    const { data: existing, error: checkErr } = await supabase
      .from('purchase_bills').select('id').eq('po_number', po.poNumber).maybeSingle();
    if (checkErr) { console.error('[purchaseBillHelper] check existing:', checkErr.message); return; }
    if (existing) return;

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('purchase_bills').insert({
      bill_number: generateBillNumber(po.poNumber),
      po_id: poId,
      po_number: po.poNumber,
      vendor_id: po.vendor_id || null,
      vendor_name: po.vendorName || null,
      hub_id: (po.hub_id && po.hub_id !== 'unassigned') ? po.hub_id : null,
      bill_date: po.date || new Date().toISOString().slice(0, 10),
      items: po.items ?? [],
      amount: po.total ?? 0,
      status: 'draft',
      created_by: user?.id ?? null,
    });
    if (error) console.error('[purchaseBillHelper] insert purchase_bills:', error.message);
  } catch (e: any) {
    console.error('[purchaseBillHelper] ensurePurchaseBillForPO:', e?.message || e);
  }
}
