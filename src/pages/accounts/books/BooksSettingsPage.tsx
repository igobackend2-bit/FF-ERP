// @ts-nocheck
// Audit & Controls — books start date, period lock, fiscal years, the
// Maker-Checker toggle, everything awaiting a second approval, and the
// accounting-relevant slice of the ERP-wide audit_logs table.
// Only Admin / CEO may change the lock date or Maker-Checker (enforced by RLS).
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Lock, CalendarRange, ShieldCheck, CheckCircle2, XCircle, ListChecks, History, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  useAcctSettings, useUpdateSettings, useAccountsRole, useAddFiscalYear,
  usePendingVouchers, usePendingDocuments, useAuditLogs, useApproveVoucher, useRejectVoucher,
  logAudit, VOUCHER_TYPE_LABEL, inr,
} from '@/hooks/useAccounts';
import { BooksPage, Field, inputCls, LoadState, RefreshButton } from '@/components/accounts/BooksUI';
import { supabase } from '@/integrations/supabase/client';

function AddFiscalYearForm({ onDone }: { onDone: () => void }) {
  const add = useAddFiscalYear();
  const [f, setF] = useState({ name: '', short_code: '', start_date: '', end_date: '' });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name || !f.short_code || !f.start_date || !f.end_date) return;
    await add.mutateAsync(f);
    setF({ name: '', short_code: '', start_date: '', end_date: '' });
    onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-200 p-3">
      <Field label="Name"><input className={inputCls + ' w-32'} placeholder="FY 2026-27" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
      <Field label="Short code"><input className={inputCls + ' w-20'} placeholder="26-27" value={f.short_code} onChange={(e) => setF((p) => ({ ...p, short_code: e.target.value }))} /></Field>
      <Field label="Start"><input type="date" className={inputCls} value={f.start_date} onChange={(e) => setF((p) => ({ ...p, start_date: e.target.value }))} /></Field>
      <Field label="End"><input type="date" className={inputCls} value={f.end_date} onChange={(e) => setF((p) => ({ ...p, end_date: e.target.value }))} /></Field>
      <button type="submit" disabled={add.isPending} className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </form>
  );
}

const DOC_TABLE: Record<string, { table: string; recordType: string; approveStatus: string; rejectStatus: string }> = {
  'Credit Note': { table: 'credit_notes', recordType: 'CreditNote', approveStatus: 'issued', rejectStatus: 'cancelled' },
  'Debit Note': { table: 'debit_notes', recordType: 'DebitNote', approveStatus: 'issued', rejectStatus: 'cancelled' },
  'Vendor Credit': { table: 'vendor_credits', recordType: 'VendorCredit', approveStatus: 'open', rejectStatus: 'expired' },
  'Sales Invoice': { table: 'invoices', recordType: 'SalesInvoice', approveStatus: 'issued', rejectStatus: 'cancelled' },
};

function PendingApprovals() {
  const { user } = useAuth();
  const { canApprove } = useAccountsRole();
  const vouchersQ = usePendingVouchers();
  const docsQ = usePendingDocuments();
  const approveVoucher = useApproveVoucher();
  const rejectVoucher = useRejectVoucher();
  const [busy, setBusy] = useState<string | null>(null);

  const decideDoc = async (doc: any, approve: boolean) => {
    const cfg = DOC_TABLE[doc.type];
    if (!cfg) return;
    setBusy(doc.id);
    const { error } = await supabase.from(cfg.table).update({ status: approve ? cfg.approveStatus : cfg.rejectStatus }).eq('id', doc.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    await logAudit({ record_type: cfg.recordType, record_id: doc.id, action: approve ? 'approved' : 'rejected', performed_by_name: (user as any)?.name, remarks: doc.number });
    toast.success(approve ? `${doc.type} approved` : `${doc.type} rejected`);
    docsQ.refetch();
  };

  const rows = [
    ...(vouchersQ.data ?? []).map((v: any) => ({ kind: 'voucher', id: v.id, type: VOUCHER_TYPE_LABEL[v.voucher_type] || v.voucher_type, number: v.voucher_no, party: v.party_name, amount: v.total_debit })),
    ...(docsQ.data ?? []).map((d: any) => ({ kind: 'document', id: d.id, type: d.type, number: d.number, party: d.party, amount: d.amount, raw: d })),
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800"><ListChecks className="w-4 h-4 text-amber-600" /> Pending Approvals</h2>
      <LoadState isLoading={vouchersQ.isLoading || docsQ.isLoading} error={vouchersQ.error || docsQ.error} empty={!rows.length} emptyText="Nothing pending approval.">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="text-left py-1.5">Type</th><th className="text-left py-1.5">Number</th><th className="text-right py-1.5">Amount</th>{canApprove && <th className="text-right py-1.5">Actions</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="border-t border-gray-100">
                <td className="py-2 text-slate-700">{r.type}</td>
                <td className="py-2 text-slate-600">{r.number || '—'} <span className="text-xs text-gray-400">{r.party}</span></td>
                <td className="py-2 text-right tabular-nums">{inr(r.amount)}</td>
                {canApprove && (
                  <td className="py-2 text-right whitespace-nowrap">
                    {r.kind === 'voucher' ? (
                      <>
                        <button disabled={approveVoucher.isPending} onClick={() => approveVoucher.mutate(r.id)} className="mr-1 text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
                        <button disabled={rejectVoucher.isPending} onClick={() => rejectVoucher.mutate({ id: r.id, reason: 'Rejected in Audit & Controls' })} className="text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">Reject</button>
                      </>
                    ) : (
                      <>
                        <button disabled={busy === r.id} onClick={() => decideDoc(r.raw, true)} className="mr-1 text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
                        <button disabled={busy === r.id} onClick={() => decideDoc(r.raw, false)} className="text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </LoadState>
    </section>
  );
}

function AuditLog() {
  const q = useAuditLogs(150);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800"><History className="w-4 h-4 text-slate-500" /> Audit Log</h2>
        <RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />
      </div>
      <LoadState isLoading={q.isLoading} error={q.error} empty={!q.data?.length} emptyText="No accounting activity logged yet.">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-gray-500 sticky top-0 bg-white"><tr><th className="text-left py-1.5">When</th><th className="text-left py-1.5">Entity</th><th className="text-left py-1.5">Action</th><th className="text-left py-1.5">Actor</th></tr></thead>
            <tbody>
              {(q.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-2 text-slate-600 whitespace-nowrap">{format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}</td>
                  <td className="py-2 text-slate-700">{r.record_type}</td>
                  <td className="py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">{r.action}</span></td>
                  <td className="py-2 text-xs text-gray-500">{r.performed_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LoadState>
    </section>
  );
}

export default function BooksSettingsPage() {
  const { canApprove } = useAccountsRole();
  const q = useAcctSettings();
  const save = useUpdateSettings();
  const s = q.data?.settings;
  const [lock, setLock] = useState('');
  useEffect(() => setLock(s?.lock_date || ''), [s?.lock_date]);

  return (
    <BooksPage title="Audit & Controls" subtitle="Maker-checker, period lock, fiscal years, pending approvals and the audit trail.">
      <LoadState isLoading={q.isLoading} error={q.error}>
        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Maker-Checker</h2>
          <p className="text-sm text-slate-500">When enabled, Credit Notes, Debit Notes, Vendor Credits, Sales Invoices and Journal Entries need a company admin's approval — never the preparer's own — before they post to the ledger.</p>
          {canApprove ? (
            <button
              disabled={save.isPending}
              onClick={() => save.mutate({ maker_checker_enabled: !s?.maker_checker_enabled })}
              className={`flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border ${s?.maker_checker_enabled ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-gray-200 hover:bg-gray-50'}`}
            >
              {s?.maker_checker_enabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {s?.maker_checker_enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
            </button>
          ) : <p className="text-xs text-gray-400">Only Admin or CEO can change this.</p>}
        </section>

        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Lock className="w-4 h-4 text-amber-600" /> Period lock</h2>
            <p className="text-sm text-slate-500">
              Nothing can be posted, approved or reversed on or before the lock date. Lock a month once it has been reconciled and reviewed.
              Auto-postings that fall inside a locked period go to <b>Posting problems</b> instead of the ledger.
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-gray-400">Books start</dt><dd className="font-medium text-slate-700">{s?.books_start_date ? format(new Date(s.books_start_date), 'dd MMM yyyy') : '—'}</dd></div>
              <div><dt className="text-xs text-gray-400">Locked up to</dt><dd className="font-medium text-slate-700">{s?.lock_date ? format(new Date(s.lock_date), 'dd MMM yyyy') : 'Not locked'}</dd></div>
            </dl>
            {canApprove ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Lock books up to and including"><input id="books-lock" type="date" className={inputCls} value={lock} onChange={(e) => setLock(e.target.value)} /></Field>
                <button disabled={save.isPending || lock === (s?.lock_date || '')} onClick={() => save.mutate({ lock_date: lock || null })}
                  className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">Save lock date</button>
                {s?.lock_date && <button disabled={save.isPending} onClick={() => save.mutate({ lock_date: null })} className="h-9 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Unlock all</button>}
              </div>
            ) : <p className="text-xs text-gray-400">Only Admin or CEO can change the lock date.</p>}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800"><CalendarRange className="w-4 h-4 text-emerald-600" /> Fiscal Years &amp; Period Lock</h2>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="text-left py-1.5">Year</th><th className="text-left py-1.5">From</th><th className="text-left py-1.5">To</th><th className="text-left py-1.5">Status</th></tr></thead>
              <tbody>
                {(q.data?.fiscalYears ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-center text-xs text-gray-400">No fiscal years defined yet.</td></tr>}
                {(q.data?.fiscalYears ?? []).map((fy) => (
                  <tr key={fy.id} className="border-t border-gray-100">
                    <td className="py-2 font-medium text-slate-700">{fy.name}</td>
                    <td className="py-2 text-slate-600">{format(new Date(fy.start_date), 'dd MMM yyyy')}</td>
                    <td className="py-2 text-slate-600">{format(new Date(fy.end_date), 'dd MMM yyyy')}</td>
                    <td className="py-2">{fy.is_closed ? <span className="text-xs text-gray-500">Closed</span> : <span className="text-xs text-emerald-700">Open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canApprove && <AddFiscalYearForm onDone={() => q.refetch()} />}
            <p className="text-xs text-gray-400">Year-end closing (moving profit to Retained Earnings) arrives with the Phase 2 closing tools.</p>
          </section>
        </div>

        <div className="mt-4"><PendingApprovals /></div>
        <div className="mt-4"><AuditLog /></div>
      </LoadState>
    </BooksPage>
  );
}
