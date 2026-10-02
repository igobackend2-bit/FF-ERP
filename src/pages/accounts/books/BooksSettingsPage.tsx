// @ts-nocheck
// Books settings — books start date, period lock date and fiscal years.
// Only Admin / CEO may change the lock date (enforced by RLS on acct_settings).
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Lock, CalendarRange } from 'lucide-react';
import { useAcctSettings, useUpdateSettings, useAccountsRole, useCloseFiscalYear } from '@/hooks/useAccounts';
import { BooksPage, Field, inputCls, LoadState } from '@/components/accounts/BooksUI';

export default function BooksSettingsPage() {
  const { canApprove } = useAccountsRole();
  const q = useAcctSettings();
  const save = useUpdateSettings();
  const closeFy = useCloseFiscalYear();
  const s = q.data?.settings;
  const [lock, setLock] = useState('');
  useEffect(() => setLock(s?.lock_date || ''), [s?.lock_date]);

  return (
    <BooksPage title="Books settings" subtitle="When the books start, which periods are closed, and the financial years.">
      <LoadState isLoading={q.isLoading} error={q.error}>
        <div className="grid gap-4 lg:grid-cols-2">
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
            <h2 className="flex items-center gap-2 font-semibold text-slate-800"><CalendarRange className="w-4 h-4 text-emerald-600" /> Financial years</h2>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="text-left py-1.5">Year</th><th className="text-left py-1.5">From</th><th className="text-left py-1.5">To</th><th className="text-left py-1.5">Status</th><th /></tr></thead>
              <tbody>
                {(q.data?.fiscalYears ?? []).map((fy) => (
                  <tr key={fy.id} className="border-t border-gray-100">
                    <td className="py-2 font-medium text-slate-700">{fy.name}</td>
                    <td className="py-2 text-slate-600">{format(new Date(fy.start_date), 'dd MMM yyyy')}</td>
                    <td className="py-2 text-slate-600">{format(new Date(fy.end_date), 'dd MMM yyyy')}</td>
                    <td className="py-2">{fy.is_closed ? <span className="text-xs text-gray-500">Closed</span> : <span className="text-xs text-emerald-700">Open</span>}</td>
                    <td className="py-2 text-right">
                      {canApprove && !fy.is_closed && new Date(fy.end_date) < new Date() && (
                        <button disabled={closeFy.isPending}
                          onClick={() => window.confirm(`Close ${fy.name}? Income and expenses move to Retained Earnings and no more entries can be posted in this year.`) && closeFy.mutate(fy.id)}
                          className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Close year</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400">Closing a year posts one entry moving its profit to Retained Earnings, locks the year and opens the next. Earlier years must be closed first; the lock date must be before the year end.</p>
          </section>
        </div>
      </LoadState>
    </BooksPage>
  );
}
