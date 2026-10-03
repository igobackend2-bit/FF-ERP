import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  FileText, Search, Eye, Printer, X, CheckCircle2,
  Clock, XCircle, IndianRupee, Phone, MapPin,
  ArrowLeft, Download, MessageCircle, Loader2,
  Package, ChevronRight, Building2, RefreshCw, Zap, Truck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { backfillMissingInvoices, fixZeroAmountInvoices, finalizeInvoice } from '@/lib/invoiceHelper';

/* ─── Types ─────────────────────────────────────────────────────────────────── */
interface Invoice {
  id: string;
  invoice_number: string;
  order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_mode: string | null;
  status: string;
  delivery_charges: number;
  notes: string | null;
  created_at: string;
  // joined
  sales_orders?: {
    order_number: string | null;
    hub_id: string | null;
    hub_name: string | null;
    created_at: string | null;
    sales_order_items: Array<{
      id: string;
      product_name: string | null;
      quantity: number | null;
      qty_kg: number | null;
      unit_price: number | null;
      total_price: number | null;
      subtotal: number | null;
      unit: string | null;
      qc_grade: string | null;
      grade: string | null;
      products?: { name: string; category: string } | null;
    }>;
  } | null;
}

/* ─── Entry time ─────────────────────────────────────────────────────────────── */
// The invoice date follows the order's selected (delivery) date, which is often the
// day after the order was typed in. This line shows when the order was actually
// entered, with its own date whenever that differs from the invoice date.
function EnteredAt({ inv }: { inv: Invoice }) {
  const ts = inv.sales_orders?.created_at ?? inv.created_at;
  if (!ts) return null;
  const at = new Date(ts);
  if (isNaN(at.getTime())) return null;
  const time = format(at, 'hh:mm a');
  const label = format(at, 'yyyy-MM-dd') === inv.invoice_date ? time : `${format(at, 'dd MMM')}, ${time}`;
  return <div className="text-[10px] text-slate-400 mt-0.5">Entered {label}</div>;
}

/* ─── Status config ──────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  draft:      { label: 'Draft',     cls: 'bg-gray-100 text-gray-500',    icon: <FileText className="h-3 w-3" /> },
  issued:     { label: 'Issued',    cls: 'bg-blue-100 text-blue-700',    icon: <FileText className="h-3 w-3" /> },
  unpaid:     { label: 'Unpaid',     cls: 'bg-amber-100 text-amber-700',   icon: <Clock className="h-3 w-3" /> },
  paid:       { label: 'Paid',       cls: 'bg-green-100 text-green-700',   icon: <CheckCircle2 className="h-3 w-3" /> },
  processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700',     icon: <RefreshCw className="h-3 w-3" /> },
  partial:    { label: 'Partial',    cls: 'bg-purple-100 text-purple-700', icon: <Clock className="h-3 w-3" /> },
  cancelled:  { label: 'Cancelled',  cls: 'bg-red-100 text-red-600',       icon: <XCircle className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.unpaid;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

/* ─── Company Info ───────────────────────────────────────────────────────────── */
const COMPANY = {
  name:    'Farmers Factory',
  tagline: 'Fresh · Quality · Reliable',
  address: 'No 17, Kovalan Street, 2nd Main Road, Uthandi Kanathur, Chennai - 600119',
  phone:   '044-00000000',
  email:   'hr@igogroup.in',
  gstin:   '33AAHCI8683B1ZJ',
  bank:    'Indian Bank',
  account: '1234567890',
  ifsc:    'IDIB000A001',
};

/* ═══════════════════════════════════════════════════════════════════════════════
   PRINT VIEW
   ═══════════════════════════════════════════════════════════════════════════════ */
function InvoicePrintView({ invoice, onClose, readOnly = false }: { invoice: Invoice; onClose: () => void; readOnly?: boolean }) {
  const printRef = useRef<HTMLDivElement>(null);
  const qc       = useQueryClient();

  const items = invoice.sales_orders?.sales_order_items ?? [];

  const markPaid = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice marked as paid');
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  const handlePrint = () => {
    const content = printRef.current?.innerHTML ?? '';
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html><html>
      <head>
        <title>${invoice.invoice_number}</title>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #1e293b; background: #fff; }
          @media print { body { padding: 0; } @page { margin: 1cm; } }
        </style>
      </head>
      <body>${content}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };

  const GRADE_LABEL: Record<string, string> = { A: 'A', B: 'B', C: 'C' };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
      {/* Action bar */}
      <div className="flex items-center justify-between bg-slate-900 text-white px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold">{invoice.invoice_number}</span>
          <StatusBadge status={invoice.status} />
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && invoice.status === 'unpaid' && (
            <button
              onClick={() => markPaid.mutate()}
              disabled={markPaid.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold"
            >
              {markPaid.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Mark as Paid
            </button>
          )}
          {invoice.customer_phone && (
            <a
              href={`https://wa.me/91${invoice.customer_phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Hi, please find your invoice ${invoice.invoice_number} for ₹${invoice.total_amount.toLocaleString('en-IN')} from Farmers Factory.`)}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-xs font-bold"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          )}
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-bold">
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable invoice body */}
      <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
        <div ref={printRef} style={{ maxWidth: 800, margin: '0 auto', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 24px rgba(0,0,0,0.10)', fontFamily: 'Arial, sans-serif' }}>

          {/* ── Header: Logo left, INVOICE right ── */}
          <div style={{ padding: '36px 48px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '2px solid #e5e7eb' }}>
            {/* Logo + company */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <img src="/ff-logo.jpg" alt="Farmers Factory" style={{ width: 110, height: 110, objectFit: 'contain', borderRadius: 8 }} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px' }}>{COMPANY.name}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{COMPANY.address}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{COMPANY.phone} &nbsp;|&nbsp; {COMPANY.email}</div>
                <div style={{ fontSize: 11, color: '#374151', fontWeight: 700, marginTop: 3 }}>GSTIN: {COMPANY.gstin}</div>
              </div>
            </div>
            {/* Invoice title + number */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 38, fontWeight: 900, color: '#111827', letterSpacing: '-1px', lineHeight: 1 }}>INVOICE</div>
              <div style={{ marginTop: 10, fontSize: 13, color: '#6b7280' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#9ca3af' }}>Invoice No.</span>
                  <span style={{ fontWeight: 700, color: '#111827' }}>{invoice.invoice_number}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#9ca3af' }}>Date</span>
                  <span style={{ fontWeight: 700, color: '#111827' }}>{format(new Date(invoice.invoice_date), 'dd MMM yyyy')}</span>
                </div>
                {invoice.due_date && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <span style={{ color: '#9ca3af' }}>Due Date</span>
                    <span style={{ fontWeight: 700, color: '#111827' }}>{format(new Date(invoice.due_date), 'dd MMM yyyy')}</span>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
                    background: invoice.status === 'paid' ? '#dcfce7' : '#fef3c7',
                    color: invoice.status === 'paid' ? '#166534' : '#92400e',
                    border: `1px solid ${invoice.status === 'paid' ? '#bbf7d0' : '#fde68a'}`,
                  }}>{invoice.status}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Billed From / Billed To ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '24px 48px', gap: 32, borderBottom: '1px solid #e5e7eb' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>From</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}>{COMPANY.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.8 }}>
                <div>{COMPANY.address}</div>
                <div>{COMPANY.phone}</div>
                <div>{COMPANY.email}</div>
                <div style={{ color: '#374151', fontWeight: 600, marginTop: 2 }}>GSTIN: {COMPANY.gstin}</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Bill To</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}>{invoice.customer_name || '—'}</div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.8 }}>
                {invoice.customer_phone && <div>{invoice.customer_phone}</div>}
                {invoice.customer_address && <div>{invoice.customer_address}</div>}
              </div>
            </div>
          </div>

          {/* ── Items Table ── */}
          <div style={{ padding: '24px 48px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Item Description</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Grade</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Qty</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Rate (₹)</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>No items</td></tr>
                ) : items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '14px 12px', color: '#9ca3af', fontSize: 12 }}>{idx + 1}</td>
                    <td style={{ padding: '14px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{item.products?.name || item.product_name || '—'}</div>
                      {item.products?.category && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, textTransform: 'uppercase' }}>{item.products.category}</div>}
                    </td>
                    <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                      {(item.qc_grade ?? item.grade) ? (
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: (item.qc_grade ?? item.grade) === 'A' ? '#f0fdf4' : (item.qc_grade ?? item.grade) === 'B' ? '#fefce8' : '#fff7ed',
                          color: (item.qc_grade ?? item.grade) === 'A' ? '#166534' : (item.qc_grade ?? item.grade) === 'B' ? '#854d0e' : '#9a3412',
                          border: `1px solid ${(item.qc_grade ?? item.grade) === 'A' ? '#bbf7d0' : (item.qc_grade ?? item.grade) === 'B' ? '#fef08a' : '#fed7aa'}`,
                        }}>
                          Grade {item.qc_grade ?? item.grade}
                        </span>
                      ) : <span style={{ color: '#d1d5db' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 12px', textAlign: 'right', color: '#374151', fontWeight: 600 }}>
                      {item.qty_kg ?? item.quantity ?? 0} <span style={{ fontSize: 10, color: '#9ca3af' }}>{item.unit || 'KG'}</span>
                    </td>
                    <td style={{ padding: '14px 12px', textAlign: 'right', color: '#6b7280' }}>{(item.unit_price ?? 0).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 700, color: '#111827' }}>{(item.total_price ?? item.subtotal ?? 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Summary + Payment ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '0 48px 36px', gap: 32, alignItems: 'end' }}>
            {/* Payment details */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#9ca3af', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Payment Details</div>
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                  {[
                    ['Payment Mode', invoice.payment_mode?.toUpperCase() || 'COD'],
                    ['Bank', COMPANY.bank],
                    ['Account No.', COMPANY.account],
                    ['IFSC Code', COMPANY.ifsc],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
              {invoice.notes && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280', background: '#fffbeb', borderRadius: 6, padding: '10px 14px', borderLeft: '3px solid #f59e0b' }}>
                  <strong style={{ color: '#374151' }}>Note: </strong>{invoice.notes}
                </div>
              )}
            </div>

            {/* Totals */}
            <div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                  <span style={{ color: '#6b7280' }}>Subtotal</span>
                  <span style={{ fontWeight: 600, color: '#374151' }}>₹{invoice.subtotal.toLocaleString('en-IN')}</span>
                </div>
                {invoice.discount_amount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span style={{ color: '#6b7280' }}>Discount</span>
                    <span style={{ fontWeight: 600, color: '#16a34a' }}>-₹{invoice.discount_amount.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {invoice.tax_amount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span style={{ color: '#6b7280' }}>Tax / GST</span>
                    <span style={{ fontWeight: 600, color: '#374151' }}>₹{invoice.tax_amount.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {invoice.delivery_charges > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12 }}>🚚</span> Delivery Charges
                    </span>
                    <span style={{ fontWeight: 600, color: '#374151' }}>₹{invoice.delivery_charges.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#111827' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>TOTAL</span>
                  <span style={{ color: '#fff', fontWeight: 900, fontSize: 20 }}>₹{invoice.total_amount.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{ borderTop: '1px solid #e5e7eb', padding: '18px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb' }}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Thank you for your business · {COMPANY.email}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Authorised Signatory</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>{COMPANY.name}</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INVOICE LIST (main page)
   ═══════════════════════════════════════════════════════════════════════════════ */
const SETUP_SQL = `-- STEP 1: Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   text NOT NULL UNIQUE,
  order_id         uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name    text,
  customer_phone   text,
  customer_address text,
  invoice_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date,
  subtotal         numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount  numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount       numeric(12,2) NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode     text DEFAULT 'cod',
  status           text NOT NULL DEFAULT 'unpaid',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.invoices TO anon, authenticated;

-- STEP 2: Backfill invoices for all existing orders
INSERT INTO public.invoices (
  invoice_number, order_id, customer_id, customer_name,
  customer_phone, customer_address, invoice_date,
  subtotal, total_amount, payment_mode, status
)
SELECT
  CONCAT('INV-', TO_CHAR(so.created_at, 'YYYYMMDD'), '-',
         LPAD(ROW_NUMBER() OVER (ORDER BY so.created_at)::text, 4, '0')),
  so.id,
  so.customer_id,
  COALESCE(so.customer_name, c.name, c.shop_name, 'Customer'),
  COALESCE(c.phone, c.mobile),
  c.address,
  so.created_at::date,
  COALESCE(so.subtotal, so.total_amount, 0),
  COALESCE(so.net_amount, so.total_amount, 0),
  COALESCE(so.payment_mode, 'cod'),
  'unpaid'
FROM public.sales_orders so
LEFT JOIN public.customers c ON c.id = so.customer_id
WHERE so.id NOT IN (
  SELECT order_id FROM public.invoices WHERE order_id IS NOT NULL
);

NOTIFY pgrst, 'reload schema';`;

function SetupRequired() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <div className="h-20 w-20 bg-amber-50 rounded-full flex items-center justify-center">
        <FileText className="h-10 w-10 text-amber-400" />
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold text-slate-800 mb-2">One-time database setup needed</h2>
        <p className="text-slate-500 text-sm">
          Copy the SQL below and run it in your <strong>Supabase SQL Editor</strong>. It will:
        </p>
        <ul className="mt-2 text-sm text-slate-500 space-y-1 text-left list-none">
          <li>✅ Create the <code className="bg-slate-100 px-1 rounded text-xs">invoices</code> table</li>
          <li>✅ Auto-generate invoices for all <strong>existing orders</strong></li>
          <li>✅ Future orders will get invoices automatically</li>
        </ul>
      </div>
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">SQL to run</span>
          <button onClick={copy}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
              copied ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {copied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied!</> : <>📋 Copy SQL</>}
          </button>
        </div>
        <pre className="bg-slate-900 text-green-400 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-700">
          {SETUP_SQL}
        </pre>
      </div>
      <a
        href="https://supabase.com/dashboard/project/bvbfnguqpuctdvfztuda/sql/new"
        target="_blank" rel="noreferrer"
        className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition-colors"
      >
        Open Supabase SQL Editor →
      </a>
      <p className="text-xs text-slate-400 text-center">After running the SQL, refresh this page. Future invoices will be auto-created with every order.</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   GENERATE INVOICE MODAL
   ═══════════════════════════════════════════════════════════════════════════════ */
function GenerateInvoiceModal({ invoice, onClose, onDone }: {
  invoice: Invoice;
  onClose: () => void;
  onDone:  (updated: Invoice) => void;
}) {
  const [deliveryAmt, setDeliveryAmt] = useState('');
  const [submitting, setSubmitting]  = useState(false);
  const items = invoice.sales_orders?.sales_order_items ?? [];
  const dc    = parseFloat(deliveryAmt) || 0;
  const projected = invoice.subtotal - invoice.discount_amount + invoice.tax_amount + dc;

  const handleGenerate = async () => {
    setSubmitting(true);
    const { error } = await finalizeInvoice(invoice.id, dc);
    if (error) { setSubmitting(false); toast.error('Failed: ' + error); return; }
    // Fetch the updated invoice so print view shows delivery charges
    const { data: updated } = await supabase
      .from('invoices')
      .select(`*, sales_orders(order_number, sales_order_items(
        id, product_name, quantity, qty_kg, unit_price, total_price, subtotal, unit, qc_grade, grade,
        products(name, category)
      ))`)
      .eq('id', invoice.id)
      .single();
    setSubmitting(false);
    toast.success('Invoice generated!');
    onClose();
    if (updated) onDone(updated as Invoice);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-slate-800">Generate Invoice</h3>
            <p className="text-xs text-slate-400 mt-0.5">{invoice.invoice_number}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>
        <div className="px-5 py-4 max-h-60 overflow-y-auto border-b border-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Order Items</p>
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 py-3 text-center">No items</p>
          ) : items.map((item) => (
            <div key={item.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm font-semibold text-slate-700">{item.products?.name || item.product_name || '—'}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{item.qty_kg ?? item.quantity ?? 0} {item.unit || 'kg'} × ₹{item.unit_price ?? 0}</p>
              </div>
              <p className="text-sm font-bold text-slate-800">₹{(item.total_price ?? item.subtotal ?? 0).toLocaleString('en-IN')}</p>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-semibold text-slate-700">₹{invoice.subtotal.toLocaleString('en-IN')}</span>
          </div>
          {invoice.discount_amount > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Discount</span>
              <span className="font-semibold text-green-600">-₹{invoice.discount_amount.toLocaleString('en-IN')}</span>
            </div>
          )}
          {invoice.tax_amount > 0 && (
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Tax</span>
              <span className="font-semibold text-slate-700">₹{invoice.tax_amount.toLocaleString('en-IN')}</span>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-b border-gray-100">
          <label className="block text-xs font-bold text-slate-600 mb-2">
            <Truck className="h-3.5 w-3.5 inline mr-1.5 text-slate-400" />
            Delivery Charges (optional)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={deliveryAmt}
              onChange={e => setDeliveryAmt(e.target.value)}
              className="w-full pl-7 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
        <div className="px-5 py-3 bg-slate-800 flex justify-between items-center">
          <span className="text-white font-bold text-sm">Total Amount</span>
          <span className="text-white font-black text-lg">₹{Math.max(0, projected).toLocaleString('en-IN')}</span>
        </div>
        <div className="px-5 py-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-gray-100 rounded-xl">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Generate Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalesInvoicesPage() {
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [hubFilter, setHubFilter]       = useState<string>('');
  const [dateFrom, setDateFrom]         = useState<string>('');
  const [dateTo, setDateTo]             = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [needsSetup, setNeedsSetup]     = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [payModeFor, setPayModeFor]     = useState<string | null>(null);
  const [generateFor, setGenerateFor]   = useState<Invoice | null>(null);
  const queryClient = useQueryClient();
  // Accounts only view invoices and their status; creating, editing and payment changes belong to operations.
  const { user } = useAuth();
  const readOnly = user?.role === 'accounts';

  const { data: hubs = [] } = useQuery({
    queryKey: ['hubs-for-invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hubs').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const PAYMENT_MODES = [
    { label: 'Cash',   value: 'cash',   color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
    { label: 'GPay',   value: 'gpay',   color: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' },
    { label: 'UPI',    value: 'upi',    color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
    { label: 'Online', value: 'online', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
    { label: 'COD',    value: 'cod',    color: 'bg-orange-100 text-orange-700 hover:bg-orange-200' },
    { label: 'Cheque', value: 'cheque', color: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
  ];

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, paymentMode }: { id: string; status: string; paymentMode?: string }) => {
      const update: Record<string, string> = { status };
      if (paymentMode) update.payment_mode = paymentMode;
      const { error } = await supabase.from('invoices').update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      const modeLabel = vars.paymentMode ? ` via ${vars.paymentMode.toUpperCase()}` : '';
      toast.success(`Invoice marked as ${vars.status}${modeLabel}`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err: any) => toast.error(`Failed: ${err?.message || err?.code || JSON.stringify(err)}`),
  });

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['invoices', search, statusFilter, hubFilter, dateFrom, dateTo],
    queryFn: async () => {
      // sales_orders needs `!inner` only when we filter on its hub_id — otherwise it would
      // silently drop any invoice whose linked order was since deleted (order_id SET NULL).
      let q = supabase
        .from('invoices')
        .select(`
          *,
          sales_orders${hubFilter ? '!inner' : ''}(
            order_number, hub_id, hub_name, created_at,
            sales_order_items(
              id, product_name, quantity, qty_kg, unit_price, total_price, subtotal, unit, qc_grade, grade,
              products(name, category)
            )
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (search.trim())  q = q.or(`invoice_number.ilike.%${search}%,customer_name.ilike.%${search}%`);
      if (hubFilter) q = q.eq('sales_orders.hub_id', hubFilter);
      if (dateFrom) q = q.gte('invoice_date', dateFrom);
      if (dateTo) q = q.lte('invoice_date', dateTo);

      const { data, error } = await q;
      if (error) {
        // Table doesn't exist yet
        if (error.code === 'PGRST205' || error.message?.includes('invoices')) {
          setNeedsSetup(true);
          return [];
        }
        throw error;
      }
      setNeedsSetup(false);
      return (data ?? []) as Invoice[];
    },
  });

  const totalUnpaid = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + i.total_amount, 0);
  const totalPaid   = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0);

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Step 1: create invoices for orders that have none
      const { created, failed } = await backfillMissingInvoices();
      // Step 2: fix existing invoices that have ₹0 or missing customer (e.g. from APK orders)
      const { fixed, failed: fixFailed } = await fixZeroAmountInvoices();

      const totalIssues = failed + fixFailed;
      if (created > 0 || fixed > 0) {
        const parts = [];
        if (created > 0) parts.push(`${created} new invoice${created > 1 ? 's' : ''} created`);
        if (fixed > 0)   parts.push(`${fixed} empty invoice${fixed > 1 ? 's' : ''} fixed`);
        toast.success(`✅ ${parts.join(' · ')}`);
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
      } else {
        toast.success('All invoices are up to date');
      }
      if (totalIssues > 0) toast.error(`${totalIssues} invoice(s) could not be updated — check console`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  if (needsSetup) return <SetupRequired />;

  if (selectedInvoice) {
    return <InvoicePrintView invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} readOnly={readOnly} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">{readOnly ? 'View only — invoice details and payment status' : 'Auto-generated for every order'}</p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 disabled:opacity-50 transition-colors"
            title="Generate invoices for any orders that are missing one"
          >
            {syncing
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
              : <><Zap className="h-3.5 w-3.5" /> Sync Missing</>}
          </button>}
          <span className="bg-amber-50 text-amber-700 font-bold px-3 py-1.5 rounded-lg border border-amber-200 text-xs">
            Unpaid ₹{totalUnpaid.toLocaleString('en-IN')}
          </span>
          <span className="bg-green-50 text-green-700 font-bold px-3 py-1.5 rounded-lg border border-green-200 text-xs">
            Paid ₹{totalPaid.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Search by invoice # or customer…"
          />
        </div>
        <select
          value={hubFilter} onChange={e => setHubFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">All Hubs</option>
          {hubs.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <input
          type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          title="From date"
        />
        <input
          type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          title="To date"
        />
        {(hubFilter || dateFrom || dateTo) && (
          <button onClick={() => { setHubFilter(''); setDateFrom(''); setDateTo(''); }}
            className="px-2.5 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            Clear
          </button>
        )}
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'draft', 'issued', 'unpaid', 'paid', 'processing', 'partial', 'cancelled'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors',
                statusFilter === s
                  ? 'bg-green-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
              )}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-dashed border-gray-200 gap-4">
          <div className="h-16 w-16 bg-green-50 rounded-full flex items-center justify-center">
            <FileText className="h-8 w-8 text-green-400" />
          </div>
          <div className="text-center">
            <p className="text-slate-700 font-bold text-base">No invoices yet</p>
            <p className="text-slate-400 text-sm mt-1">Invoices are created automatically when you place orders</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
            <span>Invoice</span>
            <span>Customer</span>
            <span>Date</span>
            <span className="text-right">Amount</span>
            <span className="text-center">Status</span>
            <span className="text-center">Actions</span>
          </div>
          {/* Rows */}
          <div className="divide-y divide-gray-50">
            {invoices.map(inv => (
              <div
                key={inv.id}
                onClick={() => setSelectedInvoice(inv)}
                className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-4 hover:bg-green-50/40 cursor-pointer items-center transition-colors group"
              >
                <div>
                  <div className="font-bold text-sm text-slate-800 group-hover:text-green-700 transition-colors">
                    {inv.invoice_number}
                  </div>
                  {inv.sales_orders?.order_number && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Order: {inv.sales_orders.order_number}
                      {inv.sales_orders.hub_name && <> · {inv.sales_orders.hub_name}</>}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-700">{inv.customer_name || '—'}</div>
                  {inv.customer_phone && (
                    <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5" />{inv.customer_phone}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {format(new Date(inv.invoice_date), 'dd MMM yyyy')}
                  <EnteredAt inv={inv} />
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm text-slate-800">₹{inv.total_amount.toLocaleString('en-IN')}</div>
                  <div className="text-[10px] text-slate-400 uppercase">{inv.payment_mode}</div>
                </div>
                <div className="flex justify-center">
                  <StatusBadge status={inv.status} />
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {/* Draft → generate invoice */}
                  {!readOnly && inv.status === 'draft' && (
                    <button
                      onClick={() => setGenerateFor(inv)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                      title="Add delivery charges and generate invoice"
                    >
                      <Truck className="h-3 w-3" /> Generate
                    </button>
                  )}
                  {/* Quick status actions (non-draft only) */}
                  {!readOnly && inv.status !== 'paid' && inv.status !== 'draft' && (
                    <div className="relative">
                      <button
                        onClick={() => setPayModeFor(payModeFor === inv.id ? null : inv.id)}
                        disabled={updateStatus.isPending}
                        className="px-2 py-1 text-[10px] font-bold rounded-md bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                        title="Mark as Paid — select payment mode"
                      >
                        Paid ▾
                      </button>
                      {payModeFor === inv.id && (
                        <div className="absolute right-0 top-7 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-2 flex flex-col gap-1 min-w-[100px]">
                          {PAYMENT_MODES.map(m => (
                            <button
                              key={m.value}
                              onClick={() => {
                                updateStatus.mutate({ id: inv.id, status: 'paid', paymentMode: m.value });
                                setPayModeFor(null);
                              }}
                              disabled={updateStatus.isPending}
                              className={cn('px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors text-left', m.color)}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {!readOnly && inv.status === 'paid' && (
                    <button
                      onClick={() => updateStatus.mutate({ id: inv.id, status: 'unpaid' })}
                      disabled={updateStatus.isPending}
                      className="px-2 py-1 text-[10px] font-bold rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                      title="Mark as Unpaid"
                    >
                      Unpaid
                    </button>
                  )}
                  {/* Render modal */}
                  {!readOnly && generateFor?.id === inv.id && (
                    <GenerateInvoiceModal
                      invoice={generateFor}
                      onClose={() => setGenerateFor(null)}
                      onDone={(updated) => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); setSelectedInvoice(updated); }}
                    />
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedInvoice(inv); }}
                    className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="View Invoice"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}