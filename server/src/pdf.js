// Draws report documents (see reportDocs.js) as a PDF with pdf-lib (pure JavaScript: no Excel, no native code).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PORTRAIT = [612, 792];
const LANDSCAPE = [792, 612];
const MARGIN_X = 40;
const TOP = 66; // space reserved for the page header
const BOTTOM = 52; // space reserved for the footer
const BURGUNDY = rgb(0.588, 0, 0.012); // #960003, the colour used on the web page
const GRAY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);

const SIZES = { bold12: 12, bold11: 11, bold10: 10, normal: 8.5, italic: 8, small: 7.5 };

export async function renderPdf(docs, { title = 'CIC Journal', generated = new Date() } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('CIC Journal');
  pdf.setCreator('CIC Journal');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // The standard fonts only hold Western characters; anything else (for example Arabic) is shown as "?".
  const supported = new Set(regular.getCharacterSet());
  const safe = (value) => {
    let out = '';
    for (const ch of String(value ?? '').replace(/[\r\n\t]+/g, ' ')) {
      out += supported.has(ch.codePointAt(0)) ? ch : '?';
    }
    return out;
  };

  const pages = []; // { page, w, h, docName }
  let cur = null; // { page, w, h, y, left, right }

  const newPage = (doc) => {
    const [w, h] = doc.orientation === 'landscape' ? LANDSCAPE : PORTRAIT;
    const page = pdf.addPage([w, h]);
    cur = { page, w, h, y: h - TOP, left: MARGIN_X, right: w - MARGIN_X };
    pages.push({ page, w, h, docName: doc.name });
  };

  const width = (txt, font, size) => font.widthOfTextAtSize(txt, size);

  // Word wrap into lines no wider than maxW.
  const wrap = (txt, font, size, maxW) => {
    const words = safe(txt).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (width(test, font, size) <= maxW) {
        line = test;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (width(rest, font, size) > maxW && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && width(rest.slice(0, cut), font, size) > maxW) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
    return lines;
  };

  // Cut a single line to fit, ending with ".." when it had to be shortened.
  const clip = (txt, font, size, maxW) => {
    const s = safe(txt);
    if (width(s, font, size) <= maxW) return s;
    let n = s.length;
    while (n > 1 && width(`${s.slice(0, n)}..`, font, size) > maxW) n -= 1;
    return `${s.slice(0, n)}..`;
  };

  const drawText = (txt, x, y, font, size, color = rgb(0, 0, 0)) => {
    if (txt) cur.page.drawText(txt, { x, y, size, font, color });
  };

  const ensure = (doc, needed, repeatHeader) => {
    if (cur && cur.y - needed >= BOTTOM) return;
    newPage(doc);
    if (repeatHeader) repeatHeader();
  };

  const fontFor = (style) => (/bold/.test(style) ? bold : style === 'italic' ? italic : regular);

  // ---------------------------------------------------------------- blocks
  const drawTextBlock = (doc, block) => {
    const size = SIZES[block.style] ?? SIZES.normal;
    const font = fontFor(block.style);
    const lines = block.text ? wrap(block.text, font, size, cur.right - cur.left) : [''];
    for (const [k, ln] of lines.entries()) {
      // a heading is never left alone at the bottom of a page: it needs room for the table that follows
      ensure(doc, size * 1.35 + (k === 0 && block.style === 'bold10' ? 60 : 0));
      cur.y -= size * 1.25;
      drawText(ln, cur.left, cur.y, font, size, block.style === 'italic' ? GRAY : rgb(0, 0, 0));
    }
    cur.y -= block.gap ?? 0;
  };

  const drawTable = (doc, block) => {
    const size = block.size ?? 8;
    const avail = cur.right - cur.left;
    const fixed = block.cols.reduce((s, c) => s + (c.w === 'flex' ? 0 : c.w), 0);
    const flexCount = block.cols.filter((c) => c.w === 'flex').length || 1;
    const colW = block.cols.map((c) => (c.w === 'flex' ? Math.max(40, (avail - fixed) / flexCount) : c.w));
    const colX = [];
    let x = cur.left;
    for (const w of colW) {
      colX.push(x);
      x += w;
    }
    const PAD = 3;
    const rowH = size * 1.45 + 2;

    const cellX = (i, txt, font, sz) => {
      const col = block.cols[i];
      if (col.align === 'right') return colX[i] + colW[i] - PAD - width(txt, font, sz);
      return colX[i] + (i === 0 ? 0 : PAD);
    };

    const drawHeader = () => {
      if (!block.header) return;
      const lines = block.header.map((h, i) => wrap(h, bold, size, colW[i] - PAD * 2));
      const n = Math.max(...lines.map((l) => l.length));
      const h = n * size * 1.2 + 6;
      cur.page.drawRectangle({ x: cur.left, y: cur.y - h, width: avail, height: h, color: BURGUNDY });
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const tx = block.cols[i].align === 'right' ? colX[i] + colW[i] - PAD - width(ln, bold, size) : colX[i] + (i === 0 ? 2 : PAD);
          drawText(ln, tx, cur.y - size * 1.2 * (k + 1) - 1, bold, size, rgb(1, 1, 1));
        });
      });
      cur.y -= h;
    };

    ensure(doc, rowH * 3 + 20);
    drawHeader();

    for (const r of block.rows) {
      if (r.style === 'blank') {
        ensure(doc, rowH * 0.6, drawHeader);
        cur.y -= rowH * 0.6;
        continue;
      }
      if (r.span !== undefined) {
        const lines = wrap(r.span, italic, size - 0.5, avail);
        for (const ln of lines) {
          ensure(doc, rowH, drawHeader);
          cur.y -= rowH;
          drawText(ln, cur.left, cur.y + 3, italic, size - 0.5, GRAY);
        }
        continue;
      }
      const isBold = r.style === 'bold' || r.style === 'total' || r.style === 'section';
      const font = isBold ? bold : regular;
      const cellLines = r.cells.map((c, i) =>
        block.cols[i]?.wrap ? wrap(c ?? '', font, size, colW[i] - PAD * 2) : [clip(c ?? '', font, size, colW[i] - PAD * 2)],
      );
      const n = Math.max(1, ...cellLines.map((l) => l.length));
      const h = rowH + (n - 1) * size * 1.2;
      ensure(doc, h, drawHeader);
      if (r.style === 'total') {
        cur.page.drawLine({ start: { x: cur.left, y: cur.y }, end: { x: cur.right, y: cur.y }, thickness: 0.5, color: LINE });
      }
      if (r.style === 'section') {
        cur.page.drawRectangle({ x: cur.left, y: cur.y - h, width: avail, height: h, color: rgb(0.96, 0.93, 0.93) });
      }
      cellLines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const yy = cur.y - size * 1.2 * (k + 1) - 1;
          if (r.style === 'section' && i === 1) drawText(ln, colX[1] + PAD, yy, font, size);
          else drawText(ln, cellX(i, ln, font, size), yy, font, size);
        });
      });
      cur.y -= h;
    }
  };

  // ---------------------------------------------------------------- documents
  for (const doc of docs) {
    newPage(doc);
    for (const block of doc.blocks) {
      if (block.type === 'text') drawTextBlock(doc, block);
      else drawTable(doc, block);
    }
  }

  // ---------------------------------------------------------------- header and footer on every page
  const total = pages.length;
  const d = generated;
  const stamp = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  pages.forEach(({ page, w, h, docName }, i) => {
    const hy = h - 30;
    const right = `Page ${i + 1} of ${total}`;
    page.drawText('CIC Journal', { x: MARGIN_X, y: hy, size: 8, font: regular, color: GRAY });
    const mid = safe(docName);
    page.drawText(mid, { x: (w - width(mid, bold, 9)) / 2, y: hy, size: 9, font: bold, color: rgb(0, 0, 0) });
    page.drawText(right, { x: w - MARGIN_X - width(right, regular, 8), y: hy, size: 8, font: regular, color: GRAY });
    page.drawLine({ start: { x: MARGIN_X, y: hy - 6 }, end: { x: w - MARGIN_X, y: hy - 6 }, thickness: 0.6, color: BURGUNDY });
    page.drawText(stamp, { x: w - MARGIN_X - width(stamp, regular, 7.5), y: 28, size: 7.5, font: regular, color: GRAY });
  });

  return pdf.save();
}
