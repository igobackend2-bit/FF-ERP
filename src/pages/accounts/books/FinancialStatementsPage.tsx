// @ts-nocheck
// Profit & Loss and Balance Sheet, both computed from the posted ledger
// (acct_trial_balance) — unlike the older /reports/pl and /reports/balance-sheet,
// which sum operational tables and do not balance.
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  useChartOfAccounts, useTrialBalance, useHubs, buildTree, rollUp, fyOf, today, inr, type TBRow, type Account,
} from '@/hooks/useAccounts';
import { BooksPage, FilterBar, DateRange, HubSelect, Field, inputCls, LoadState, RefreshButton, downloadCsv } from '@/components/accounts/BooksUI';

const DIRECT_INCOME = ['direct_income'];
const DIRECT_COST = ['cost_of_goods', 'direct_expense', 'stock'];

/** Sum natural-sign amounts (income/liability/equity positive as credit) for accounts matching a predicate. */
function total(tb: TBRow[], pred: (r: TBRow) => boolean, field: 'closing' | 'period' = 'period') {
  return tb.filter(pred).reduce((s, r) => {
    const v = field === 'closing' ? r.closing : r.period_debit - r.period_credit;
    return s + (['income', 'liability', 'equity'].includes(r.root_type) ? -v : v);
  }, 0);
}

function Amount({ v, strong, className }: { v: number; strong?: boolean; className?: string }) {
  const n = Math.round(v * 100) / 100;
  return (
    <span className={cn('tabular-nums', strong && 'font-semibold', n < 0 && 'text-red-600', className)}>
      {Math.abs(n) < 0.005 ? '—' : (n < 0 ? '(' : '') + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ')' : '')}
    </span>
  );
}

/** Render one root (e.g. Income) as an indented tree with a value per column. */
function Section({ title, root, accounts, columns, sign, linkParams }:
  { title: string; root: string; accounts: Account[]; columns: { key: string; sums: Map<string, any>; }[]; sign: 1 | -1; linkParams: string }) {
  const tree = buildTree(accounts).filter((n) => n.item.root_type === root);
  const rows: any[] = [];
  const walk = (nodes: any[]) => nodes.forEach((n) => {
    const any = columns.some((c) => Math.abs(c.sums.get(n.item.id)?.v ?? 0) > 0.004);
    if (!any) return;
    rows.push(n); walk(n.children);
  });
  walk(tree);
  return (
    <>
      <tr className="bg-slate-100/80"><td className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600" colSpan={columns.length + 1}>{title}</td></tr>
      {rows.length === 0 && <tr><td className="px-4 py-2 text-xs text-gray-400" colSpan={columns.length + 1}>No balances</td></tr>}
      {rows.map(({ item: a, depth }) => (
        <tr key={a.id} className={cn('border-t border-gray-100', a.is_group && 'font-semibold text-slate-700')}>
          <td className="px-4 py-1.5" style={{ paddingLeft: 16 + depth * 18 }}>
            {a.is_group ? a.name : <Link className="text-slate-600 hover:text-emerald-700 hover:underline" to={`/accounts/books/ledger?account=${a.id}${linkParams}`}>{a.name}</Link>}
          </td>
          {columns.map((c) => <td key={c.key} className="px-4 py-1.5 text-right"><Amount v={sign * (c.sums.get(a.id)?.v ?? 0)} /></td>)}
        </tr>
      ))}
    </>
  );
}

function sumsFor(accounts: Account[], tb: TBRow[], field: 'period' | 'closing') {
  const shaped = tb.map((r) => ({ ...r, closing: field === 'period' ? r.period_debit - r.period_credit : r.closing }));
  const s = rollUp(accounts, shaped);
  const out = new Map<string, { v: number }>();
  s.forEach((val, k) => out.set(k, { v: val.closing }));
  return out;
}

function ProfitAndLoss() {
  const fy = fyOf();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [hub, setHub] = useState('');
  const [compare, setCompare] = useState(false);
  const accountsQ = useChartOfAccounts();
  const hubsQ = useHubs();
  const accounts = accountsQ.data ?? [];

  const cols = compare
    ? [...(hubsQ.data ?? []).map((h: any) => ({ key: h.id, label: h.code, hub: h.id })), { key: 'all', label: 'Total', hub: null }]
    : [{ key: hub || 'all', label: 'Amount', hub: hub || null }];

  const results = useQueries({
    queries: cols.map((c) => ({
      queryKey: ['acct', 'tb', from, to, c.hub || 'all', true],
      queryFn: async () => {
        const { data, error } = await supabase.rpc('acct_trial_balance', { p_from: from, p_to: to, p_hub: c.hub, p_exclude_closing: true });
        if (error) throw error;
        return (data ?? []).map((r: any) => ({ ...r, opening: +r.opening, period_debit: +r.period_debit, period_credit: +r.period_credit, closing: +r.closing }));
      },
    })),
  });
  const loading = accountsQ.isLoading || results.some((r) => r.isLoading);
  const error = accountsQ.error || results.find((r) => r.error)?.error;

  const computed = useMemo(() => cols.map((c, i) => {
    const tb: TBRow[] = results[i]?.data ?? [];
    const income = total(tb, (r) => r.root_type === 'income');
    const expense = total(tb, (r) => r.root_type === 'expense');
    const directIncome = total(tb, (r) => r.root_type === 'income' && DIRECT_INCOME.includes(r.account_type));
    const directCost = total(tb, (r) => r.root_type === 'expense' && DIRECT_COST.includes(r.account_type));
    return { key: c.key, sums: sumsFor(accounts, tb, 'period'), income, expense, gross: directIncome - directCost, net: income - expense, directIncome };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [results.map((r) => r.dataUpdatedAt).join(), accounts, compare, hub]);

  const linkParams = `&from=${from}&to=${to}${hub && !compare ? `&hub=${hub}` : ''}`;

  const exportCsv = () => downloadCsv(`profit-and-loss-${from}-to-${to}.csv`, [
    ['Line', ...cols.map((c) => c.label)],
    ['Total income', ...computed.map((c) => c.income.toFixed(2))],
    ['Total expenses', ...computed.map((c) => c.expense.toFixed(2))],
    ['Gross profit', ...computed.map((c) => c.gross.toFixed(2))],
    ['Net profit', ...computed.map((c) => c.net.toFixed(2))],
  ]);

  return (
    <div className="space-y-4">
      <FilterBar>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {!compare && <HubSelect value={hub} onChange={setHub} />}
        <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600"><input id="pl-compare" type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare hubs side by side</label>
        <button onClick={exportCsv} className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"><Download className="w-3.5 h-3.5" /> CSV</button>
      </FilterBar>
      <LoadState isLoading={loading} error={error}>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm" style={{ minWidth: 420 + cols.length * 120 }}>
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr><th className="text-left px-4 py-2.5">Particulars</th>{cols.map((c) => <th key={c.key} className="text-right px-4 py-2.5">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              <Section title="Income" root="income" accounts={accounts} columns={computed} sign={-1} linkParams={linkParams} />
              <tr className="border-t border-gray-200 font-semibold"><td className="px-4 py-2">Total income</td>{computed.map((c) => <td key={c.key} className="px-4 py-2 text-right"><Amount v={c.income} strong /></td>)}</tr>
              <Section title="Expenses" root="expense" accounts={accounts} columns={computed} sign={1} linkParams={linkParams} />
              <tr className="border-t border-gray-200 font-semibold"><td className="px-4 py-2">Total expenses</td>{computed.map((c) => <td key={c.key} className="px-4 py-2 text-right"><Amount v={c.expense} strong /></td>)}</tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 text-slate-700">
                <td className="px-4 py-2">Gross profit <span className="text-xs font-normal text-gray-400">(sales − purchases, freight, wastage &amp; direct costs)</span></td>
                {computed.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-right">
                    <Amount v={c.gross} strong />
                    {Math.abs(c.directIncome) > 0.004 && <div className="text-[11px] text-gray-400">{((c.gross / c.directIncome) * 100).toFixed(1)}% margin</div>}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-slate-200 bg-emerald-50 text-base font-bold text-slate-800">
                <td className="px-4 py-3">Net profit / (loss)</td>
                {computed.map((c) => <td key={c.key} className="px-4 py-3 text-right"><Amount v={c.net} strong /></td>)}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-400">Purchases are expensed when bought. Post a closing-stock journal (Journal entry → “Closing stock”) to move unsold stock to the Balance Sheet.</p>
        {compare && <p className="text-xs text-gray-400">Head-office postings with no hub are included in Total only.</p>}
      </LoadState>
    </div>
  );
}

function BalanceSheet() {
  const [asOf, setAsOf] = useState(today());
  const accountsQ = useChartOfAccounts();
  const tbQ = useTrialBalance('1900-01-01', asOf);
  const accounts = accountsQ.data ?? [];
  const tb = tbQ.data ?? [];
  const sums = useMemo(() => sumsFor(accounts, tb, 'closing'), [accounts, tb]);
  const col = [{ key: 'v', sums }];

  const assets = total(tb, (r) => r.root_type === 'asset', 'closing');
  const liabilities = total(tb, (r) => r.root_type === 'liability', 'closing');
  const equity = total(tb, (r) => r.root_type === 'equity', 'closing');
  const profit = total(tb, (r) => r.root_type === 'income', 'closing') - total(tb, (r) => r.root_type === 'expense', 'closing');
  const diff = assets - (liabilities + equity + profit);
  const balanced = Math.abs(diff) < 0.01;

  const exportCsv = () => downloadCsv(`balance-sheet-${asOf}.csv`, [
    ['Code', 'Account', 'Root', `Balance ${asOf}`],
    ...tb.filter((r) => ['asset', 'liability', 'equity'].includes(r.root_type) && Math.abs(r.closing) > 0.004)
      .map((r) => [r.code, r.name, r.root_type, (r.root_type === 'asset' ? r.closing : -r.closing).toFixed(2)]),
    ['', 'Profit / (loss) not yet closed to retained earnings', 'equity', profit.toFixed(2)],
    ['', 'Total assets', '', assets.toFixed(2)],
    ['', 'Total liabilities + equity', '', (liabilities + equity + profit).toFixed(2)],
  ]);

  return (
    <div className="space-y-4">
      <FilterBar>
        <Field label="As of"><input id="bs-asof" type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <button onClick={exportCsv} className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"><Download className="w-3.5 h-3.5" /> CSV</button>
      </FilterBar>
      <LoadState isLoading={accountsQ.isLoading || tbQ.isLoading} error={accountsQ.error || tbQ.error}>
        <div className={cn('flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm',
          balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}>
          {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {balanced ? 'Assets equal liabilities plus equity.' : `Does not balance by ${inr(diff)} — report this immediately.`}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm min-w-[360px]">
              <tbody>
                <Section title="Assets" root="asset" accounts={accounts} columns={col} sign={1} linkParams={`&to=${asOf}`} />
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800"><td className="px-4 py-2.5">Total assets</td><td className="px-4 py-2.5 text-right"><Amount v={assets} strong /></td></tr></tfoot>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm min-w-[360px]">
              <tbody>
                <Section title="Liabilities" root="liability" accounts={accounts} columns={col} sign={-1} linkParams={`&to=${asOf}`} />
                <tr className="border-t border-gray-200 font-semibold"><td className="px-4 py-2">Total liabilities</td><td className="px-4 py-2 text-right"><Amount v={liabilities} strong /></td></tr>
                <Section title="Equity" root="equity" accounts={accounts} columns={col} sign={-1} linkParams={`&to=${asOf}`} />
                <tr className="border-t border-gray-100"><td className="px-4 py-1.5 pl-[34px] text-slate-600">Profit / (loss) not yet closed to Retained Earnings</td><td className="px-4 py-1.5 text-right"><Amount v={profit} /></td></tr>
                <tr className="border-t border-gray-200 font-semibold"><td className="px-4 py-2">Total equity</td><td className="px-4 py-2 text-right"><Amount v={equity + profit} strong /></td></tr>
              </tbody>
              <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800"><td className="px-4 py-2.5">Total liabilities + equity</td><td className="px-4 py-2.5 text-right"><Amount v={liabilities + equity + profit} strong /></td></tr></tfoot>
            </table>
          </div>
        </div>
      </LoadState>
    </div>
  );
}

export default function FinancialStatementsPage() {
  const [tab, setTab] = useState<'pl' | 'bs'>(() => (location.hash === '#balance-sheet' ? 'bs' : 'pl'));
  return (
    <BooksPage title={tab === 'pl' ? 'Profit & Loss' : 'Balance Sheet'}
      subtitle="Built from the posted ledger. Click any account to see the entries behind it.">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {[['pl', 'Profit & Loss'], ['bs', 'Balance Sheet']].map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k as any); history.replaceState(null, '', k === 'bs' ? '#balance-sheet' : '#'); }}
            className={cn('px-4 py-1.5 rounded-md text-sm', tab === k ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-gray-50')}>{l}</button>
        ))}
      </div>
      {tab === 'pl' ? <ProfitAndLoss /> : <BalanceSheet />}
    </BooksPage>
  );
}
