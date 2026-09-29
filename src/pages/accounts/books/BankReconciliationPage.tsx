// @ts-nocheck
// Bank Reconciliation — match an imported bank statement against the actual
// General Ledger postings on a bank/cash account (acct_gl), not against
// payment records (that UTR-matching tool already exists at
// /accounts/reconciliation for vendor payouts). This is the GL-level check:
// does the book balance for Kotak Mahindra Bank actually match the statement?
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Upload, Link2, Ban, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBankAccounts, useBankStatementLines, useUnreconciledGlLines,
  useImportBankStatementLines, useMatchBankLine, useIgnoreBankLine, drCr, fyOf,
} from '@/hooks/useAccounts';
import { BooksPage, FilterBar, DateRange, Field, inputCls, LoadState, RefreshButton } from '@/components/accounts/BooksUI';

function parseBankStatementFile(file: File): Promise<{ statement_date: string; description: string; reference_no: string; debit: number; credit: number }[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet);
        const rows = json.map((row) => {
          const keys = Object.keys(row);
          const find = (...needles: string[]) => keys.find((k) => needles.some((n) => k.toLowerCase().includes(n)));
          const dateKey = find('date');
          const descKey = find('narration', 'description', 'particular', 'remark');
          const refKey = find('reference', 'utr', 'chq', 'cheque', 'ref no');
          const debitKey = find('debit', 'withdrawal');
          const creditKey = find('credit', 'deposit');
          const rawDate = dateKey ? row[dateKey] : null;
          let statement_date: string | null = null;
          if (rawDate instanceof Date) statement_date = rawDate.toISOString().slice(0, 10);
          else if (typeof rawDate === 'number') statement_date = new Date(Math.round((rawDate - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
          else if (typeof rawDate === 'string') { const d = new Date(rawDate); if (!isNaN(d.getTime())) statement_date = d.toISOString().slice(0, 10); }
          const debit = parseFloat(String(row[debitKey || ''] ?? '0').replace(/,/g, '')) || 0;
          const credit = parseFloat(String(row[creditKey || ''] ?? '0').replace(/,/g, '')) || 0;
          return { statement_date, description: descKey ? String(row[descKey]) : '', reference_no: refKey ? String(row[refKey]) : '', debit, credit };
        }).filter((r) => r.statement_date && (r.debit > 0 || r.credit > 0));
        resolve(rows as any);
      } catch (err) { reject(new Error('Could not read this file — expecting a Date, Debit and Credit column.')); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export default function BankReconciliationPage() {
  const fy = fyOf();
  const fileRef = useRef<HTMLInputElement>(null);
  const banksQ = useBankAccounts();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [importing, setImporting] = useState(false);

  const linesQ = useBankStatementLines(accountId || null, from, to);
  const glQ = useUnreconciledGlLines(accountId || null, from, to);
  const importMut = useImportBankStatementLines();
  const matchMut = useMatchBankLine();
  const ignoreMut = useIgnoreBankLine();

  const unmatched = (linesQ.data ?? []).filter((l: any) => l.status === 'unmatched');
  const matched = (linesQ.data ?? []).filter((l: any) => l.status === 'matched');
  const glRows = glQ.data ?? [];

  const suggestions = useMemo(() => {
    const out = new Map<string, any>(); // statement line id -> suggested gl row
    const used = new Set<string>();
    for (const l of unmatched) {
      const amt = Number(l.debit) || Number(l.credit);
      const wantDebitSide = Number(l.credit) > 0; // statement credit = money IN = our books' debit side, and vice versa
      const hit = glRows.find((g: any) => {
        if (used.has(g.id)) return false;
        const glAmt = wantDebitSide ? Number(g.debit) : Number(g.credit);
        if (Math.abs(glAmt - amt) > 0.01) return false;
        const days = Math.abs((new Date(g.posting_date).getTime() - new Date(l.statement_date).getTime()) / 86400000);
        return days <= 3;
      });
      if (hit) { out.set(l.id, hit); used.add(hit.id); }
    }
    return out;
  }, [unmatched, glRows]);

  const statementTotal = (linesQ.data ?? []).reduce((s: number, l: any) => s + Number(l.credit) - Number(l.debit), 0);
  const bookTotal = matched.reduce((s: number, l: any) => s + Number(l.credit) - Number(l.debit), 0);

  const handleFile = async (file: File) => {
    if (!accountId) { toast.error('Choose a bank account first'); return; }
    setImporting(true);
    try {
      const rows = await parseBankStatementFile(file);
      if (!rows.length) { toast.error('No usable rows found — expecting Date, Debit and Credit columns'); return; }
      await importMut.mutateAsync({ bankAccountId: accountId, rows });
      linesQ.refetch();
    } catch (e: any) { toast.error(e.message); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <BooksPage title="Bank Reconciliation" subtitle="Match an imported bank statement against what's actually posted to the ledger."
      actions={<RefreshButton onClick={() => { linesQ.refetch(); glQ.refetch(); }} busy={linesQ.isFetching || glQ.isFetching} />}>
      <FilterBar>
        <Field label="Account">
          <select className={inputCls + ' w-64'} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose a bank/cash account…</option>
            {(banksQ.data ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <button disabled={!accountId || importing} onClick={() => fileRef.current?.click()}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
          <Upload className="w-3.5 h-3.5" /> {importing ? 'Importing…' : 'Import Statement'}
        </button>
      </FilterBar>

      {!accountId ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400">Choose a bank account to reconcile.</div>
      ) : (
        <LoadState isLoading={linesQ.isLoading || glQ.isLoading} error={linesQ.error || glQ.error}>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-gray-400">Statement net movement</p>
              <p className="mt-0.5 text-base font-semibold text-slate-800 tabular-nums">{drCr(-statementTotal)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-gray-400">Matched to ledger</p>
              <p className="mt-0.5 text-base font-semibold text-slate-800 tabular-nums">{drCr(-bookTotal)}</p>
            </div>
            <div className={cn('rounded-xl border px-4 py-3', unmatched.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
              <p className="text-[11px] uppercase tracking-wider text-gray-400">Unmatched lines</p>
              <p className={cn('mt-0.5 text-base font-semibold tabular-nums', unmatched.length ? 'text-amber-700' : 'text-emerald-700')}>{unmatched.length}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-600">Unmatched statement lines</div>
              <table className="w-full text-sm">
                <tbody>
                  {unmatched.length === 0 && <tr><td className="px-4 py-6 text-center text-xs text-gray-400">Nothing unmatched — fully reconciled.</td></tr>}
                  {unmatched.map((l: any) => {
                    const suggestion = suggestions.get(l.id);
                    return (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <p className="text-xs text-slate-600">{format(new Date(l.statement_date), 'dd MMM yy')} · {l.description}</p>
                          <p className="text-xs font-medium tabular-nums">{l.debit > 0 ? `− ${Number(l.debit).toFixed(2)}` : `+ ${Number(l.credit).toFixed(2)}`}</p>
                          {suggestion && (
                            <p className="mt-1 text-[11px] text-emerald-700">
                              Suggested match: {suggestion.voucher_no} · {format(new Date(suggestion.posting_date), 'dd MMM')}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {suggestion && (
                            <button onClick={() => matchMut.mutate({ statementLineId: l.id, glId: suggestion.id }, { onSuccess: () => { linesQ.refetch(); glQ.refetch(); } })}
                              className="mr-1 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
                              <Link2 className="w-3 h-3" /> Confirm
                            </button>
                          )}
                          <button onClick={() => ignoreMut.mutate(l.id, { onSuccess: () => linesQ.refetch() })}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">
                            <Ban className="w-3 h-3" /> Ignore
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-600">Unreconciled ledger postings</div>
              <table className="w-full text-sm">
                <tbody>
                  {glRows.length === 0 && <tr><td className="px-4 py-6 text-center text-xs text-gray-400">Every ledger posting in this range is reconciled.</td></tr>}
                  {glRows.map((g: any) => (
                    <tr key={g.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">
                        <p className="text-xs text-slate-600">{format(new Date(g.posting_date), 'dd MMM yy')} · {g.voucher_no} · {g.narration}</p>
                        <p className="text-xs font-medium tabular-nums">{Number(g.debit) ? `+ ${Number(g.debit).toFixed(2)}` : `− ${Number(g.credit).toFixed(2)}`}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-600 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Matched ({matched.length})
            </div>
            <table className="w-full text-sm">
              <tbody>
                {matched.map((l: any) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-xs text-slate-600">{format(new Date(l.statement_date), 'dd MMM yy')} · {l.description}</td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">{l.debit > 0 ? `− ${Number(l.debit).toFixed(2)}` : `+ ${Number(l.credit).toFixed(2)}`}</td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => matchMut.mutate({ statementLineId: l.id, glId: null }, { onSuccess: () => { linesQ.refetch(); glQ.refetch(); } })}
                        className="text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">Unmatch</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadState>
      )}
    </BooksPage>
  );
}
