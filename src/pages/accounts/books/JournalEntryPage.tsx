// @ts-nocheck
// New Journal Entry — manual double-entry voucher. Debits must equal credits before it
// can be saved; lines on debtor / creditor accounts must name the customer or vendor
// so ageing and party ledgers stay correct. Accounts submits for approval; Admin posts.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Plus, Trash2, Scale, ArrowLeft, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useChartOfAccounts, useCreateVoucher, useAccountsRole, useAcctSettings, searchParties, today, inr,
} from '@/hooks/useAccounts';
import { BooksPage, Field, inputCls, HubSelect } from '@/components/accounts/BooksUI';

const TYPES = [
  ['journal', 'Journal (adjustment)'], ['receipt', 'Receipt (money in)'], ['payment', 'Payment (money out)'],
  ['contra', 'Contra (cash ↔ bank)'], ['credit_note', 'Credit note (to customer)'], ['debit_note', 'Debit note (to vendor)'],
  ['opening', 'Opening balances'],
];

type Line = { key: number; account_id: string; debit: string; credit: string; party_type: string; party_id: string; party_name: string; remarks: string };
let seq = 0;
const blank = (): Line => ({ key: ++seq, account_id: '', debit: '', credit: '', party_type: '', party_id: '', party_name: '', remarks: '' });
const num = (s: string) => Math.round((parseFloat(s) || 0) * 100) / 100;

function PartyCell({ line, onChange }: { line: Line; onChange: (p: Partial<Line>) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(line.party_name);
  const [res, setRes] = useState<any[]>([]);
  const find = async (t: string) => {
    setTerm(t);
    if (!line.party_type) return;
    try { setRes(await searchParties(line.party_type, t)); } catch (e) { console.error(e); }
  };
  return (
    <div className="flex gap-1">
      <select aria-label="Party type" className={inputCls + ' w-24 px-1 text-xs'} value={line.party_type}
        onChange={(e) => { onChange({ party_type: e.target.value, party_id: '', party_name: '' }); setTerm(''); setRes([]); }}>
        <option value="">—</option><option value="customer">Customer</option><option value="vendor">Vendor</option>
        <option value="driver">Transporter</option><option value="employee">Employee</option>
      </select>
      {line.party_type && (
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-gray-400" />
          <input aria-label="Party" className={cn(inputCls, 'w-full pl-7 text-xs', !line.party_id && 'border-amber-300')} value={term} placeholder="Search…"
            onFocus={() => { setOpen(true); find(term); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => find(e.target.value)} />
          {open && res.length > 0 && (
            <ul className="absolute z-30 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {res.map((r) => (
                <li key={r.id}><button type="button" onMouseDown={() => { onChange({ party_id: r.id, party_name: r.name }); setTerm(r.name); setOpen(false); }}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-emerald-50">{r.name} <span className="text-gray-400">{r.sub}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function JournalEntryPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { canWrite, canApprove } = useAccountsRole();
  const settingsQ = useAcctSettings();
  const accountsQ = useChartOfAccounts();
  const create = useCreateVoucher();
  const leaves = (accountsQ.data ?? []).filter((a) => !a.is_group && a.is_active);
  const byId = useMemo(() => new Map(leaves.map((a) => [a.id, a])), [leaves]);

  const [type, setType] = useState(sp.get('type') || 'journal');
  const [date, setDate] = useState(today());
  const [hub, setHub] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [tried, setTried] = useState(false);

  const booksStart = settingsQ.data?.settings?.books_start_date;
  const lockDate = settingsQ.data?.settings?.lock_date;
  const upd = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const dr = lines.reduce((s, l) => s + num(l.debit), 0);
  const cr = lines.reduce((s, l) => s + num(l.credit), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const used = lines.filter((l) => l.account_id && (num(l.debit) || num(l.credit)));

  const problems: string[] = [];
  if (used.length < 2) problems.push('Add at least two lines with an account and an amount.');
  if (Math.abs(diff) >= 0.005) problems.push(`Debits and credits differ by ${inr(Math.abs(diff))}.`);
  if (dr === 0) problems.push('The entry total is zero.');
  lines.forEach((l, i) => {
    if (num(l.debit) && num(l.credit)) problems.push(`Line ${i + 1}: enter either a debit or a credit, not both.`);
    if ((num(l.debit) || num(l.credit)) && !l.account_id) problems.push(`Line ${i + 1}: choose an account.`);
    const a = byId.get(l.account_id);
    if (a && ['receivable', 'payable'].includes(a.account_type) && !l.party_id) problems.push(`Line ${i + 1}: ${a.name} needs a customer or vendor.`);
    if (l.party_type && !l.party_id) problems.push(`Line ${i + 1}: pick the ${l.party_type} or clear the party type.`);
  });
  if (type !== 'opening' && booksStart && date < booksStart) problems.push(`The books start on ${booksStart}; use an Opening balances entry for earlier figures.`);
  if (lockDate && date <= lockDate) problems.push(`Books are locked up to ${lockDate}.`);

  // Closing stock: Dr Stock in Hand / Cr Purchases (reverse it on the first day of next month)
  const closingStock = () => {
    const stock = (accountsQ.data ?? []).find((a) => a.system_key === 'stock');
    const purchases = (accountsQ.data ?? []).find((a) => a.system_key === 'purchases');
    if (!stock || !purchases) return;
    setType('journal');
    setNarration('Closing stock adjustment — unsold stock carried to Stock in Hand');
    setLines([{ ...blank(), account_id: stock.id }, { ...blank(), account_id: purchases.id }]);
  };

  const balanceLast = () => {
    const last = [...lines].reverse().find((l) => !num(l.debit) && !num(l.credit)) || lines[lines.length - 1];
    const others = lines.filter((l) => l.key !== last.key);
    const d = others.reduce((s, l) => s + num(l.debit) - num(l.credit), 0);
    upd(last.key, d > 0 ? { credit: d.toFixed(2), debit: '' } : { debit: (-d).toFixed(2), credit: '' });
  };

  const save = async (action: 'draft' | 'submit') => {
    setTried(true);
    if (problems.length) return;
    const party = used.find((l) => l.party_id);
    const id = await create.mutateAsync({
      action,
      payload: {
        voucher_type: type, posting_date: date, hub_id: hub || null, reference_no: reference || null, narration: narration || null,
        is_opening: type === 'opening',
        party_type: party?.party_type || null, party_id: party?.party_id || null, party_name: party?.party_name || null,
        lines: used.map((l) => ({
          account_id: l.account_id, debit: num(l.debit), credit: num(l.credit), hub_id: hub || null,
          party_type: l.party_type || null, party_id: l.party_id || null, party_name: l.party_name || null, remarks: l.remarks || null,
        })),
      },
    });
    navigate(`/accounts/books/vouchers${action === 'submit' && !canApprove ? '#approvals' : ''}`, { state: { opened: id } });
  };

  if (!canWrite) {
    return <BooksPage title="New journal entry"><p className="text-sm text-gray-500">Only Accounts and Admin can create journal entries.</p></BooksPage>;
  }

  return (
    <BooksPage title="New journal entry"
      subtitle={canApprove ? 'You are an approver: submitting posts the entry immediately.' : 'Submitted entries wait for Admin / CEO approval before they reach the ledger.'}
      actions={<Link to="/accounts/books/vouchers" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"><ArrowLeft className="w-3.5 h-3.5" /> Vouchers</Link>}>
      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Entry type">
          <select id="je-type" className={inputCls} value={type} onChange={(e) => { setType(e.target.value); if (e.target.value === 'opening' && booksStart) setDate(booksStart); }}>
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Posting date"><input id="je-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <HubSelect value={hub} onChange={setHub} label="Hub (optional)" />
        <Field label="Reference (bill no / UTR)"><input id="je-ref" className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Narration" className="sm:col-span-2 lg:col-span-4">
          <input id="je-narration" className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Why this entry is being made" />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
            <tr><th className="w-8 px-3 py-2.5">#</th><th className="text-left px-2 py-2.5">Account</th><th className="text-left px-2 py-2.5">Party</th><th className="text-right px-2 py-2.5 w-32">Debit</th><th className="text-right px-2 py-2.5 w-32">Credit</th><th className="text-left px-2 py-2.5">Line remark</th><th className="w-10" /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <select aria-label={`Line ${i + 1} account`} className={cn(inputCls, 'w-64', tried && !l.account_id && (num(l.debit) || num(l.credit)) && 'border-red-300')}
                    value={l.account_id} onChange={(e) => upd(l.key, { account_id: e.target.value })}>
                    <option value="">Choose account…</option>
                    {leaves.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 w-72"><PartyCell line={l} onChange={(p) => upd(l.key, p)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" className={inputCls + ' w-full text-right tabular-nums'} value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value.replace(/[^\d.]/g, ''), credit: e.target.value ? '' : l.credit })} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" className={inputCls + ' w-full text-right tabular-nums'} value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value.replace(/[^\d.]/g, ''), debit: e.target.value ? '' : l.debit })} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} remark`} className={inputCls + ' w-full'} value={l.remarks} onChange={(e) => upd(l.key, { remarks: e.target.value })} /></td>
                <td className="px-2 py-1.5">
                  <button disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="p-2 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={`Remove line ${i + 1}`}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={3} className="px-3 py-2.5">
                <div className="flex gap-2">
                  <button onClick={() => setLines((ls) => [...ls, blank()])} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50"><Plus className="w-3.5 h-3.5" /> Add line</button>
                  <button onClick={balanceLast} disabled={Math.abs(diff) < 0.005} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"><Scale className="w-3.5 h-3.5" /> Balance last line</button>
                  <button onClick={closingStock} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50">Closing stock</button>
                </div>
              </td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{inr(dr)}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{inr(cr)}</td>
              <td colSpan={2} className={cn('px-2 py-2.5 text-sm font-medium', Math.abs(diff) < 0.005 && dr > 0 ? 'text-emerald-700' : 'text-red-600')}>
                {Math.abs(diff) < 0.005 ? (dr > 0 ? 'Balanced' : '') : `Difference ${inr(Math.abs(diff))} ${diff > 0 ? 'Dr' : 'Cr'}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {tried && problems.length > 0 && (
        <ul className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 list-disc pl-8 space-y-0.5">
          {[...new Set(problems)].map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button disabled={create.isPending} onClick={() => save('draft')} className="h-10 px-4 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50 disabled:opacity-50">Save as draft</button>
        <button disabled={create.isPending} onClick={() => save('submit')} className="h-10 px-5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
          {create.isPending ? 'Saving…' : canApprove ? 'Post entry' : 'Submit for approval'}
        </button>
      </div>
    </BooksPage>
  );
}
