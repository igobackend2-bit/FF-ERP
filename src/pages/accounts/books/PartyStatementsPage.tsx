// @ts-nocheck
// Party Statements — a focused, printable statement of account for one
// customer or vendor, built on the same acct_account_ledger RPC (party mode)
// that powers General Ledger, just without the account-picker/CSV chrome.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { Download, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccountLedger, searchParties, fyOf, drCr, VOUCHER_TYPE_LABEL } from '@/hooks/useAccounts';
import { BooksPage, FilterBar, DateRange, Field, inputCls, LoadState } from '@/components/accounts/BooksUI';

function PartyPicker({ type, value, label, onPick }: { type: string; value: string; label: string; onPick: (id: string, name: string) => void }) {
  const [term, setTerm] = useState(label);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  useEffect(() => setTerm(label), [label]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchParties(type, term).then(setResults).catch((e) => console.error(e)), 250);
    return () => clearTimeout(t);
  }, [term, type, open]);
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
        <input className={inputCls + ' pl-8 w-64'} placeholder={`Select a ${type}…`} value={term}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onMouseDown={() => { onPick(r.id, r.name); setTerm(r.name); setOpen(false); }}
                className={cn('w-full px-3 py-2 text-left text-sm hover:bg-emerald-50', r.id === value && 'bg-emerald-50')}>
                <span className="text-slate-700">{r.name}</span>{r.sub && <span className="ml-2 text-xs text-gray-400">{r.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Plain, print-styled statement used only for the PDF capture — kept off-screen. */
function StatementTemplate({ partyName, partyType, from, to, rows, opening, closing, tot }: any) {
  return (
    <div style={{ width: 794, padding: 40, background: '#fff', fontFamily: 'Arial, sans-serif', color: '#1a2420' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Statement of Account</h1>
      <p style={{ fontSize: 12, color: '#5b6b60', marginBottom: 2 }}>{partyName} · {partyType}</p>
      <p style={{ fontSize: 12, color: '#5b6b60', marginBottom: 16 }}>{format(new Date(from), 'dd MMM yyyy')} to {format(new Date(to), 'dd MMM yyyy')}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#f2f5f1', textAlign: 'left' }}>
            <th style={{ padding: 6, border: '1px solid #d8e0da' }}>Date</th>
            <th style={{ padding: 6, border: '1px solid #d8e0da' }}>Particulars</th>
            <th style={{ padding: 6, border: '1px solid #d8e0da' }}>Voucher</th>
            <th style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>Debit</th>
            <th style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>Credit</th>
            <th style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: 6, border: '1px solid #d8e0da' }}>{format(new Date(from), 'yyyy-MM-dd')}</td>
            <td style={{ padding: 6, border: '1px solid #d8e0da' }} colSpan={4}>Opening Balance</td>
            <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{drCr(opening)}</td>
          </tr>
          {rows.map((r: any) => (
            <tr key={r.line_id}>
              <td style={{ padding: 6, border: '1px solid #d8e0da' }}>{format(new Date(r.posting_date), 'yyyy-MM-dd')}</td>
              <td style={{ padding: 6, border: '1px solid #d8e0da' }}>{r.narration || r.party_name || ''}{r.reference_no ? ` · ${r.reference_no}` : ''}</td>
              <td style={{ padding: 6, border: '1px solid #d8e0da' }}>{VOUCHER_TYPE_LABEL[r.voucher_type] || r.voucher_type}</td>
              <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{Number(r.debit) ? Number(r.debit).toFixed(2) : ''}</td>
              <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{Number(r.credit) ? Number(r.credit).toFixed(2) : ''}</td>
              <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{drCr(r.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td style={{ padding: 6, border: '1px solid #d8e0da' }} colSpan={3}>Closing Balance</td>
            <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{tot.dr.toFixed(2)}</td>
            <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{tot.cr.toFixed(2)}</td>
            <td style={{ padding: 6, border: '1px solid #d8e0da', textAlign: 'right' }}>{drCr(closing)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

async function downloadStatementPDF(props: any) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const container = document.createElement('div');
  container.style.position = 'fixed'; container.style.left = '-9999px'; container.style.top = '0';
  document.body.appendChild(container);
  const root = createRoot(container);
  await new Promise<void>((resolve) => { root.render(<StatementTemplate {...props} />); setTimeout(resolve, 300); });
  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: 794, windowWidth: 794 });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgWidth = 210, imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png');
    if (imgHeight <= 297) pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    else {
      let position = 0, remaining = imgHeight, page = 0;
      while (remaining > 0) {
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -position, imgWidth, imgHeight);
        position += 297; remaining -= 297; page++;
      }
    }
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `statement-${props.partyName.replace(/\s+/g, '-')}-${props.to}.pdf`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

export default function PartyStatementsPage() {
  const fy = fyOf();
  const [partyType, setPartyType] = useState<'customer' | 'vendor' | 'driver'>('customer');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [downloading, setDownloading] = useState(false);

  const ledgerQ = useAccountLedger({ partyType, partyId: partyId || null, from, to });
  const all = ledgerQ.data ?? [];
  const opening = all.length ? Number(all[0].opening) : 0;
  const rows = all.filter((r: any) => r.line_id);
  const tot = useMemo(() => rows.reduce((t: any, r: any) => ({ dr: t.dr + Number(r.debit), cr: t.cr + Number(r.credit) }), { dr: 0, cr: 0 }), [rows]);
  const closing = opening + tot.dr - tot.cr;

  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadStatementPDF({ partyName, partyType, from, to, rows, opening, closing, tot }); }
    finally { setDownloading(false); }
  };

  return (
    <BooksPage title="Party Statements" subtitle="A printable statement of account for one customer or vendor.">
      <FilterBar>
        <Field label="Party Type">
          <select className={inputCls} value={partyType} onChange={(e) => { setPartyType(e.target.value as any); setPartyId(''); setPartyName(''); }}>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="driver">Transporter / driver</option>
          </select>
        </Field>
        <Field label={partyType === 'customer' ? 'Customer' : partyType === 'vendor' ? 'Vendor' : 'Transporter'}>
          <PartyPicker type={partyType} value={partyId} label={partyName} onPick={(id, name) => { setPartyId(id); setPartyName(name); }} />
        </Field>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <button disabled={!partyId || downloading} onClick={handleDownload}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </FilterBar>

      {!partyId ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          Choose a {partyType} to view their statement.
        </div>
      ) : (
        <LoadState isLoading={ledgerQ.isLoading} error={ledgerQ.error}>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5">Date</th><th className="text-left px-3 py-2.5">Particulars</th>
                  <th className="text-left px-3 py-2.5">Voucher Type</th><th className="text-right px-3 py-2.5">Debit</th>
                  <th className="text-right px-3 py-2.5">Credit</th><th className="text-right px-4 py-2.5">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-100 bg-slate-50/60 text-slate-600">
                  <td className="px-4 py-2 text-xs" colSpan={5}>Opening Balance</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{drCr(opening)}</td>
                </tr>
                {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No postings in this period.</td></tr>}
                {rows.map((r: any) => (
                  <tr key={r.line_id} className="border-t border-gray-100">
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{format(new Date(r.posting_date), 'dd MMM yy')}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[340px] truncate">{r.narration}{r.reference_no ? ` · ${r.reference_no}` : ''}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{VOUCHER_TYPE_LABEL[r.voucher_type]}</td>
                    <td className="px-3 py-2 text-right">{Number(r.debit) ? Number(r.debit).toFixed(2) : ''}</td>
                    <td className="px-3 py-2 text-right">{Number(r.credit) ? Number(r.credit).toFixed(2) : ''}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{drCr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-800">
                <tr>
                  <td className="px-4 py-2.5" colSpan={5}>Closing Balance</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{drCr(closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </LoadState>
      )}
    </BooksPage>
  );
}
