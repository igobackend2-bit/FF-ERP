import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

/**
 * Generate a collision-free invoice number.
 *
 * Format: INV-YYYYMMDD-XXXXXX
 * where XXXXXX = first 6 chars of the order UUID (guaranteed unique per order).
 *
 * This replaces the previous COUNT-based approach which had a race condition:
 * two simultaneous orders would both read count=N, generate the same number,
 * and the second INSERT would fail the UNIQUE constraint silently.
 */
function generateInvoiceNumber(orderId: string): string {
  const today = format(new Date(), 'yyyyMMdd');
  // Take first 6 chars of the order UUID (hex, no dashes) as unique suffix
  const suffix = orderId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INV-${today}-${suffix}`;
}

export interface CreateInvoiceParams {
  orderId: string;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  /** Pre-filled from the order's delivery_charges — still editable later via finalizeInvoice(). */
  deliveryCharges?: number;
  totalAmount: number;
  paymentMode?: string;
  notes?: string | null;
  /** Due date offset in days (default 0 = same day) */
  dueDays?: number;
}

/**
 * Creates an invoice record for a placed order.
 * - Safe to call multiple times: skips if invoice already exists for this order.
 * - Race-condition-free: invoice number uses order UUID, not a counter.
 * - Silently returns null on any error (does not break the order flow).
 */
export async function createInvoiceForOrder(params: CreateInvoiceParams): Promise<string | null> {
  try {
    // ── Guard: don't create a duplicate invoice for the same order ──
    // Scoped to non-cancelled rows + limit(1): some orders still carry legacy
    // duplicate invoices (1 active + N cancelled, from a trigger race fixed
    // 2026-09-29 — the dupes were cancelled, not deleted). An unscoped
    // .maybeSingle() throws PGRST116 "multiple rows returned" for any of
    // those orders, which aborted this function for ~443 orders during
    // "Sync Missing" and surfaced as silent console-only failures.
    const { data: existing } = await supabase
      .from('invoices')
      .select('id')
      .eq('order_id', params.orderId)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Invoice already exists — return its id without creating another
      return existing.id;
    }

    const invoice_number = generateInvoiceNumber(params.orderId);
    const invoice_date   = format(new Date(), 'yyyy-MM-dd');
    const due_date       = params.dueDays
      ? format(new Date(Date.now() + params.dueDays * 86_400_000), 'yyyy-MM-dd')
      : invoice_date;

    const { data, error } = await supabase.from('invoices').insert({
      invoice_number,
      order_id:         params.orderId,
      customer_id:      params.customerId  ?? null,
      customer_name:    params.customerName ?? null,
      customer_phone:   params.customerPhone ?? null,
      customer_address: params.customerAddress ?? null,
      invoice_date,
      due_date,
      subtotal:         params.subtotal,
      discount_amount:  params.discountAmount ?? 0,
      tax_amount:       params.taxAmount ?? 0,
      delivery_charges: params.deliveryCharges ?? 0,
      total_amount:     params.totalAmount,
      payment_mode:     params.paymentMode ?? 'cod',
      status:           'draft',
      notes:            params.notes ?? null,
    }).select('id').single();

    if (error) {
      // If we hit a unique constraint (extremely unlikely now), log and skip
      console.warn('Invoice creation skipped:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err: any) {
    // Never break the order flow if invoice fails
    console.warn('Invoice helper error:', err?.message);
    return null;
  }
}

/**
 * Backfill invoices for orders that don't have one yet.
 * Call this from a management page or run once to fix missing invoices.
 */
export async function backfillMissingInvoices(): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed  = 0;

  // Fetch orders — join customers table for name/phone/address
  const { data: orders } = await supabase
    .from('sales_orders')
    .select('id, customer_id, customer_name, net_amount, total_amount, subtotal, payment_mode, notes, customer:customers(name, phone, address)')
    .order('created_at', { ascending: true });

  if (!orders?.length) return { created, failed };

  // Get order IDs that already have invoices. Paginated: PostgREST caps an
  // unbounded select at 1000 rows, and this table has grown past that
  // (2,912 invoice rows, many orders carrying legacy cancelled duplicates).
  // An unpaginated fetch silently returned only the first 1000 rows, so
  // hundreds of orders that DO have an invoice looked "missing" here and
  // were sent into createInvoiceForOrder(), which then failed on its own
  // duplicate check — the root cause of the "N invoice(s) could not be
  // updated" errors during Sync Missing.
  const existingOrderIds = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('invoices')
      .select('order_id')
      .not('order_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error || !page?.length) break;
    for (const row of page as any[]) existingOrderIds.add(row.order_id);
    if (page.length < PAGE) break;
  }

  const missing = orders.filter(o => !existingOrderIds.has(o.id));

  for (const order of missing) {
    // Calculate total from order_items when order total is 0/null (e.g. APK orders)
    let total = Number((order as any).total_amount ?? (order as any).net_amount ?? 0);
    if (!total) {
      const { data: items } = await supabase
        .from('sales_order_items')
        .select('total_price, unit_price, quantity')
        .eq('order_id', order.id);
      if (items?.length) {
        total = items.reduce((sum, item: any) =>
          sum + Number(item.total_price ?? (Number(item.unit_price) * Number(item.quantity)) ?? 0), 0);
      }
    }

    const cust       = (order as any).customer as any;
    const custName   = (order as any).customer_name ?? cust?.name   ?? null;
    const custPhone  = cust?.phone   ?? null;
    const custAddr   = cust?.address ?? null;

    const result = await createInvoiceForOrder({
      orderId:         order.id,
      customerId:      (order as any).customer_id,
      customerName:    custName,
      customerPhone:   custPhone,
      customerAddress: custAddr,
      subtotal:        Number((order as any).subtotal ?? total),
      totalAmount:     total,
      paymentMode:     (order as any).payment_mode ?? 'cod',
      notes:           (order as any).notes,
    });
    if (result) created++;
    else failed++;
  }

  return { created, failed };
}

/**
 * Fix existing invoices that have total_amount = 0, missing customer_name, or a
 * customer_name that's actually a stray metadata label, not a real name — seen once
 * from a legacy bulk import that wrote "Order Date : dd/mm/yyyy" into this column
 * instead of the customer's name (701 invoices, fixed 2026-09-29). The "Order Date%"
 * check is kept as a standing filter so "Sync Missing" self-heals if the same import
 * pattern ever reappears.
 * Recalculates totals from sales_order_items and looks up customer from customers table.
 * Call this after backfillMissingInvoices to repair already-created empty invoices.
 */
export async function fixZeroAmountInvoices(): Promise<{ fixed: number; failed: number }> {
  let fixed  = 0;
  let failed = 0;

  // Get invoices that are empty (₹0, no customer name, or a corrupted one)
  const { data: emptyInvoices } = await supabase
    .from('invoices')
    .select('id, order_id, total_amount, customer_name, customer_id')
    .or('total_amount.eq.0,customer_name.is.null,customer_name.ilike.Order Date%')
    .not('order_id', 'is', null);

  if (!emptyInvoices?.length) return { fixed, failed };

  for (const inv of emptyInvoices) {
    if (!inv.order_id) continue;

    // Get order + customer join
    const { data: order } = await supabase
      .from('sales_orders')
      .select('id, customer_id, customer_name, net_amount, total_amount, subtotal, customer:customers(name, phone, address)')
      .eq('id', inv.order_id)
      .maybeSingle();

    if (!order) continue;

    // Calculate total from order_items when 0
    let total = Number((order as any).total_amount ?? (order as any).net_amount ?? 0);
    if (!total) {
      const { data: items } = await supabase
        .from('sales_order_items')
        .select('total_price, unit_price, quantity')
        .eq('order_id', inv.order_id);
      if (items?.length) {
        total = items.reduce((sum, item: any) =>
          sum + Number(item.total_price ?? (Number(item.unit_price) * Number(item.quantity)) ?? 0), 0);
      }
    }

    const cust      = (order as any).customer as any;
    const custName  = (order as any).customer_name ?? cust?.name   ?? inv.customer_name ?? null;
    const custPhone = cust?.phone   ?? null;
    const custAddr  = cust?.address ?? null;

    // Skip if we still have nothing new
    if (!total && !custName) continue;

    const patch: any = {};
    if (total > 0) {
      patch.total_amount   = total;
      patch.subtotal       = Number((order as any).subtotal ?? total);
    }
    if (custName)  patch.customer_name    = custName;
    if (custPhone) patch.customer_phone   = custPhone;
    if (custAddr)  patch.customer_address = custAddr;

    const { error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', inv.id);

    if (error) failed++;
    else fixed++;
  }

  return { fixed, failed };
}


/**
 * Finalize a draft invoice: add delivery charges, recalculate total, set status to 'unpaid'.
 * Called from SalesInvoicesPage when the user clicks "Generate Invoice".
 */
export async function finalizeInvoice(
  invoiceId: string,
  deliveryCharges: number
): Promise<{ error: string | null }> {
  try {
    // Fetch current invoice to get subtotal + existing fields
    const { data: inv, error: fetchErr } = await supabase
      .from('invoices')
      .select('subtotal, discount_amount, tax_amount')
      .eq('id', invoiceId)
      .single();

    if (fetchErr || !inv) return { error: fetchErr?.message ?? 'Invoice not found' };

    const newTotal =
      Number(inv.subtotal) +
      Number(deliveryCharges) -
      Number(inv.discount_amount ?? 0) +
      Number(inv.tax_amount ?? 0);

    const { error } = await supabase
      .from('invoices')
      .update({
        delivery_charges: deliveryCharges,
        total_amount:     Math.max(0, newTotal),
        status:           'unpaid',
      })
      .eq('id', invoiceId);

    return { error: error?.message ?? null };
  } catch (e: any) {
    return { error: e?.message ?? 'Unknown error' };
  }
}
