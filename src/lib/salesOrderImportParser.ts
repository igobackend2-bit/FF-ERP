// ─────────────────────────────────────────────────────────────
//  Sales Order PDF import — same Zoho-style export template as
//  the Purchase Order import (poImportParsers.ts), just with
//  customer/order fields instead of vendor/PO fields. Reuses the
//  same line-extraction and item-row parsing (computed rate from
//  qty+amount) since that part of the template is identical.
// ─────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist';
import {
  extractPageLines, parseItemRows, toISODate, parseAmount,
  type ParsedPOItem,
} from './poImportParsers';

export interface ParsedSalesOrder {
  sourceRef: string;
  hubRaw: string;
  customerRaw: string;
  date: string;
  items: ParsedPOItem[];
  parsedTotal: number;
  declaredTotal: number | null;
}

export async function parseSalesOrdersFromPDF(file: File): Promise<ParsedSalesOrder[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const results: ParsedSalesOrder[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const lines = await extractPageLines(page);
    const fullText = lines.map(l => l.text).join('\n');

    const refMatch     = fullText.match(/#\s*([A-Z]{2,4}-?\S+)/i);
    const dateMatch     = fullText.match(/Date\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    const hubMatch      = fullText.match(/(FF\s*-\s*[A-Z][A-Za-z]+)/);
    // Same template family as the PO — customer block may be labeled any of
    // these depending on which Zoho doc type it is (Sales Order / Invoice).
    const custLabelLine = lines.find(l => /(bill to|customer address|ship to|vendor address)/i.test(l.text));
    const custIdx       = custLabelLine ? lines.indexOf(custLabelLine) : -1;
    // This template's header is two columns (Bill To block on the left,
    // Order Date/meta on the right) that the Y-sorted text extraction
    // interleaves onto separate lines — so the real customer name is NOT
    // reliably "the very next line" after the label, it's consistently one
    // line further down in this export (Bill To -> Order Date : ... ->
    // customer name). Walk forward skipping any date/label line from that
    // other column, stopping at the item-table header so a genuinely blank
    // Bill To block surfaces as blank (caught by the "No customer name"
    // check below) instead of grabbing junk from further down the page.
    let customerMatch: string | undefined;
    for (let i = custIdx + 1; custIdx >= 0 && i < lines.length; i++) {
      const text = lines[i].text;
      if (/^#\s*item/i.test(text)) break;
      if (/^\s*(order\s*)?date\s*:/i.test(text)) continue;
      customerMatch = text;
      break;
    }
    const subTotalMatch = fullText.match(/Sub\s*Total\s*([\d,]+\.\d{2})/i);
    const totalMatch    = fullText.match(/(?<!Sub )Total\s*₹?\s*([\d,]+\.\d{2})/i);

    const items = parseItemRows(lines);
    if (!items.length) continue;

    // A multi-page order repeats the item-table header on its continuation
    // pages but not the Bill To block — that page has real items and no
    // customer label at all (custIdx === -1), as opposed to a label that's
    // present but genuinely blank. Merge those rows into the previous
    // order instead of creating a second, customer-less phantom order for
    // what is really one order split across pages.
    if (custIdx === -1 && results.length > 0) {
      const prev = results[results.length - 1];
      prev.items.push(...items);
      prev.parsedTotal += items.reduce((s, i) => s + i.amount, 0);
      // Sub Total / Total only print on the LAST page of a multi-page order --
      // earlier pages have neither, so prev.declaredTotal is still null at
      // this point. This continuation page's total (when present) is the
      // authoritative one for the whole merged order and must overwrite that,
      // not be discarded -- otherwise the caller falls back to parsedTotal
      // and silently drops anything only the final page's Total line carries
      // (e.g. shipping charges added after the item list).
      if (totalMatch) prev.declaredTotal = parseAmount(totalMatch[1]);
      else if (subTotalMatch) prev.declaredTotal = parseAmount(subTotalMatch[1]);
      continue;
    }

    results.push({
      sourceRef:     refMatch?.[1] ?? `page-${p}`,
      hubRaw:        hubMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
      customerRaw:   customerMatch ?? '',
      date:          dateMatch ? toISODate(dateMatch[1]) : new Date().toISOString().slice(0, 10),
      items,
      parsedTotal:   items.reduce((s, i) => s + i.amount, 0),
      declaredTotal: totalMatch ? parseAmount(totalMatch[1]) : (subTotalMatch ? parseAmount(subTotalMatch[1]) : null),
    });
  }
  return results;
}
