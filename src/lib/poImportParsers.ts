// ─────────────────────────────────────────────────────────────
//  PO Import parsers — PDF / CSV / XLSX
//  Parses the Zoho-style "Purchase Order" export (one PO per PDF
//  page, or one row-group per PO in CSV/XLSX) into a normalized
//  shape the Import dialog can review and edit before committing.
//  Never writes to the DB itself — always returns data for the
//  caller to show in a review screen first.
// ─────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsedPOItem {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  discountPct?: number; // only ever set for the Zoho Sales Order template's Disc% column
}

export interface ParsedPO {
  sourceRef: string;       // original PO number / row ref from the file, for traceability only
  hubRaw: string;
  vendorRaw: string;
  date: string;             // yyyy-MM-dd if parseable, else raw string
  items: ParsedPOItem[];
  parsedTotal: number;      // sum of item amounts
  declaredTotal: number | null; // "Total" line read from the file, if present — for a sanity check
}

const UNIT_WORDS = ['kg', 'pcs', 'box', 'ltr', 'litre', 'dozen', 'batch'];

export function toISODate(raw: string): string {
  const m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return raw;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function parseAmount(token: string): number {
  return parseFloat(token.replace(/,/g, '')) || 0;
}

// ── PDF ─────────────────────────────────────────────────────

export interface Line { y: number; text: string; x: number; }

export async function extractPageLines(page: any): Promise<Line[]> {
  const textContent = await page.getTextContent();
  const items: any[] = textContent.items;
  const groups: Record<string, { x: number; str: string }[]> = {};
  const tolerance = 4;

  for (const item of items) {
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const key = Object.keys(groups).find(k => Math.abs(parseInt(k, 10) - y) < tolerance) ?? String(y);
    (groups[key] ??= []).push({ x, str: item.str });
  }

  return Object.entries(groups)
    .map(([y, parts]) => {
      parts.sort((a, b) => a.x - b.x);
      return { y: parseInt(y, 10), x: parts[0]?.x ?? 0, text: parts.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim() };
    })
    .filter(l => l.text)
    .sort((a, b) => b.y - a.y); // top of page first
}

export function parseItemRows(lines: Line[]): ParsedPOItem[] {
  const items: ParsedPOItem[] = [];
  // On a multi-page order/bill, a continuation page's items keep numbering
  // from where the previous page left off (17, 18, 19...), not restart at 1
  // -- this function is called once per page, so it can't assume the first
  // row is always "1". expectedIdx starts unset and locks onto whatever
  // number the first matching row actually has, then requires every row
  // after that to be sequential -- same protection against stray numbers in
  // item text, just not hardcoded to a page-1 start.
  let expectedIdx: number | null = null;
  let current: { idx: number; text: string } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.text.replace(/^\d+\s*/, '');
    // Zoho prints every numeric column (Qty, Rate, Amount) with exactly two
    // decimals, so those are the only "1,234.56"-shaped tokens in a row. The
    // item name itself starts with a bare-integer catalog prefix
    // ("2023-TOMATO(BANGALORE)" — 2023 is a Zoho item-group code, not a year
    // and not a quantity), which is why the row is split on decimal numbers
    // rather than on "the first number": that rule read 2023 as the qty and
    // pushed the real qty/rate/amount into the item name.
    const nums = [...body.matchAll(/(?<![\w.-])(\d[\d,]*\.\d{2})(?![\w.])/g)];
    if (nums.length >= 2) {
      const qtyTok = nums[0];
      const qty    = parseAmount(qtyTok[1]);
      const amount = parseAmount(nums[nums.length - 1][1]);
      let rate = 0;
      let discountPct: number | undefined;
      // The Zoho Sales Order template has a 4th numeric column between rate
      // and amount — Disc% (printed as "5.00%" or "0.00" with no sign) — so
      // a row like "ASH GOURD 100.00 25.00 5.00% 2,375.00" has 4 two-decimal
      // tokens, not 3. Try that shape first: qty × rate × (1 − disc/100) =
      // amount. Checking this before the plain 3-number case matters because
      // otherwise nums[length-2] (the discount, "5.00") gets mistaken for
      // the rate, silently baking the discount into a wrong derived rate
      // with no discount ever recorded.
      if (nums.length === 4) {
        const candRate = parseAmount(nums[1][1]);
        const candDisc = parseAmount(nums[2][1]);
        if (qty > 0 && Math.abs(qty * candRate * (1 - candDisc / 100) - amount) < 0.5) {
          rate = candRate;
          discountPct = candDisc;
        }
      }
      if (discountPct === undefined) {
        // Plain qty/rate/amount (3 numbers) — or a Rate column Zoho printed
        // with more than 2 decimals ("211.1111"), which this regex can't
        // capture at all (it only matches exactly-2-decimal tokens), leaving
        // just qty and amount here; deriving the rate from those two is
        // exact either way since amount = qty × rate by construction.
        const printedRate = nums.length >= 3 ? parseAmount(nums[nums.length - 2][1]) : null;
        rate = printedRate !== null && Math.abs(qty * printedRate - amount) < 0.05
          ? printedRate
          : (qty > 0 ? amount / qty : 0);
      }
      // The unit sits right after the qty in this template; searching only
      // the tail keeps a product called "APPLE BOX" from reading as unit=box.
      const tail = body.slice((qtyTok.index ?? 0) + qtyTok[0].length);
      const unitFound = UNIT_WORDS.find(u => new RegExp(`\\b${u}\\b`, 'i').test(tail));
      let name = body.slice(0, qtyTok.index).trim();
      name = name.replace(/^\d{4}\s*-\s*/, ''); // strip the "2023-" catalog prefix
      if (name && qty > 0) {
        items.push({ name, qty, unit: unitFound ?? 'unit', rate, amount, ...(discountPct !== undefined ? { discountPct } : {}) });
      }
    }
    current = null;
  };

  for (const line of lines) {
    const m = line.text.match(/^(\d{1,2})\s+(.*)/);
    const rowNum = m ? parseInt(m[1], 10) : null;
    if (rowNum !== null && (expectedIdx === null ? true : rowNum === expectedIdx)) {
      flush();
      current = { idx: rowNum, text: line.text };
      expectedIdx = rowNum + 1;
    } else if (current && !/^(sub\s*total|total|authorized signature)/i.test(line.text)) {
      current.text += ' ' + line.text;
    } else if (/^(sub\s*total|total|authorized signature)/i.test(line.text)) {
      flush();
      break;
    }
  }
  flush();
  return items;
}

// Zoho prints the vendor name under a left-column label ("Vendor Address" on
// PO templates, "Bill From" on Bill templates) but a right-column field
// ("Terms : Due on Receipt") often lands between the label and the name in
// y-sorted order, since it sits at roughly the same height. Scan forward
// from the label for the first line back in the label's own column (x
// within ~20pt) instead of blindly taking the very next line.
function findVendorName(lines: Line[]): string | undefined {
  const labelLine = lines.find(l => /vendor address|bill from/i.test(l.text));
  const labelIdx  = labelLine ? lines.indexOf(labelLine) : -1;
  if (labelIdx < 0) return undefined;
  for (let i = labelIdx + 1; i < Math.min(lines.length, labelIdx + 5); i++) {
    if (Math.abs(lines[i].x - labelLine!.x) < 20) return lines[i].text;
  }
  return undefined;
}

export async function parsePOsFromPDF(file: File): Promise<ParsedPO[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const results: ParsedPO[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const lines = await extractPageLines(page);
    const fullText = lines.map(l => l.text).join('\n');

    // A "#" precedes the PO code on PO templates ("PO# PO-04791"), but Bill
    // templates print it as "Order Number : PO-04791" with no "#" at all --
    // fall back to a bare PO-<digits> search anywhere on the page.
    const poMatch      = fullText.match(/#\s*(PO-?\S+)/i) ?? fullText.match(/(PO-?\d+)/i);
    const dateMatch    = fullText.match(/Date\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    const hubMatch     = fullText.match(/(FF\s*-\s*[A-Z][A-Za-z]+)/);
    const vendorMatch  = findVendorName(lines);
    const subTotalMatch = fullText.match(/Sub\s*Total\s*([\d,]+\.\d{2})/i);
    const totalMatch    = fullText.match(/(?<!Sub )Total\s*₹?\s*([\d,]+\.\d{2})/i);

    const items = parseItemRows(lines);
    if (!items.length) continue; // skip pages that aren't a PO (e.g. blank/cover pages)

    // A multi-page bill/PO repeats the item table on its continuation pages
    // but never the Bill From/Vendor Address block -- that page has real
    // items and no vendor label at all (findVendorName returns undefined), as
    // opposed to a label that's present but genuinely blank. Merge those rows
    // into the previous PO instead of creating a second, vendor-less phantom
    // entry for what is really one PO split across pages (see
    // salesOrderImportParser.ts, which has the same continuation-page shape
    // and had this exact bug -- a multi-page sales order silently lost every
    // item after the first page).
    if (!vendorMatch && results.length > 0) {
      const prev = results[results.length - 1];
      prev.items.push(...items);
      prev.parsedTotal += items.reduce((s, i) => s + i.amount, 0);
      // Sub Total / Total only print on the LAST page -- this continuation
      // page's total (when present) is the authoritative one for the whole
      // merged PO and must overwrite the earlier page's null, not be dropped.
      if (totalMatch) prev.declaredTotal = parseAmount(totalMatch[1]);
      else if (subTotalMatch) prev.declaredTotal = parseAmount(subTotalMatch[1]);
      continue;
    }

    results.push({
      sourceRef:     poMatch?.[1] ?? `page-${p}`,
      hubRaw:        hubMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
      vendorRaw:     vendorMatch ?? '',
      date:          dateMatch ? toISODate(dateMatch[1]) : new Date().toISOString().slice(0, 10),
      items,
      parsedTotal:   items.reduce((s, i) => s + i.amount, 0),
      declaredTotal: totalMatch ? parseAmount(totalMatch[1]) : (subTotalMatch ? parseAmount(subTotalMatch[1]) : null),
    });
  }
  return results;
}

// ── CSV / XLSX ──────────────────────────────────────────────
// Expected columns (case-insensitive, flexible naming):
//   PO Number / PO# | Vendor | Hub | Date | Item / Item & Description | Qty | Unit | Rate | Amount
// Rows sharing the same PO Number/ref are grouped into one PO.

function pick(row: Record<string, any>, ...keys: string[]): string {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function rowsToPOs(rows: Record<string, any>[]): ParsedPO[] {
  const groups = new Map<string, Record<string, any>[]>();
  rows.forEach((r, i) => {
    const ref = pick(r, 'po number', 'po#', 'po', 'ref') || `row-${i}`;
    (groups.get(ref) ?? groups.set(ref, []).get(ref)!).push(r);
  });

  const results: ParsedPO[] = [];
  for (const [ref, group] of groups) {
    const first = group[0];
    const items: ParsedPOItem[] = group.map(r => {
      const qty = parseFloat(pick(r, 'qty', 'quantity')) || 0;
      const amountRaw = pick(r, 'amount', 'total');
      const rateRaw = pick(r, 'rate', 'price');
      const amount = amountRaw ? parseAmount(amountRaw) : (parseAmount(rateRaw) * qty);
      const rate = qty > 0 ? amount / qty : parseAmount(rateRaw);
      // Strip the same Zoho item-group catalog prefix ("2023-TOMATO") the
      // PDF path strips in parseItemRows — a CSV/XLSX export has real
      // separate Qty/Rate/Amount columns so this never corrupts the
      // numbers here, but the raw prefix otherwise leaks into product_name.
      const rawName = pick(r, 'item', 'item & description', 'item name', 'product');
      return {
        name: rawName.replace(/^\d+\s*-\s*/, ''),
        qty, unit: pick(r, 'unit') || 'unit', rate, amount,
      };
    }).filter(i => i.name && i.qty > 0);

    if (!items.length) continue;
    results.push({
      sourceRef: ref,
      hubRaw: pick(first, 'hub'),
      vendorRaw: pick(first, 'vendor'),
      date: pick(first, 'date') ? toISODate(pick(first, 'date')) : new Date().toISOString().slice(0, 10),
      items,
      parsedTotal: items.reduce((s, i) => s + i.amount, 0),
      declaredTotal: null,
    });
  }
  return results;
}

export function parsePOsFromCSV(file: File): Promise<ParsedPO[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => resolve(rowsToPOs(res.data as Record<string, any>[])),
      error: reject,
    });
  });
}

export async function parsePOsFromXLSX(file: File): Promise<ParsedPO[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];
  return rowsToPOs(rows);
}

export async function parsePOFile(file: File): Promise<ParsedPO[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return parsePOsFromPDF(file);
  if (ext === 'csv') return parsePOsFromCSV(file);
  if (ext === 'xlsx' || ext === 'xls') return parsePOsFromXLSX(file);
  throw new Error(`Unsupported file type: .${ext}. Use PDF, CSV, or XLSX.`);
}

// ── Vendor / Hub fuzzy matching ───────────────────────────────

export function normName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/^ms\.?\s*/i, '')
    .replace(/[^a-z0-9]/g, '');
}

export function matchVendor(rawName: string, vendors: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const norm = normName(rawName);
  if (!norm) return null;
  const exact = vendors.find(v => normName(v.name) === norm);
  if (exact) return exact;
  const partial = vendors.find(v => {
    const vn = normName(v.name);
    return vn.length >= 4 && (norm.includes(vn) || vn.includes(norm));
  });
  return partial ?? null;
}

const normHub = (s: string) =>
  (s ?? '').toLowerCase().replace(/\s*hub\s*/gi, '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');

export function matchHub(rawHub: string, hubs: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const target = normHub(rawHub.replace(/^ff\s*-?\s*/i, ''));
  if (!target || target.length < 3) return null;
  for (const hub of hubs) {
    const hn = normHub(hub.name);
    if (!hn) continue;
    let i = 0;
    while (i < target.length && i < hn.length && target[i] === hn[i]) i++;
    if (i >= Math.min(6, target.length)) return hub;
  }
  return null;
}
