import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Readable preparer records, deliberately distinct from a fileable IRS form. */
export async function createPlanningPDF(title: string, taxYear: number) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} - ${taxYear} - preparer review`); doc.setAuthor('WriteOff');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 42, right = 570, bottom = 58, width = right - left;
  let page: PDFPage, y = 0;
  const safe = (value: unknown) => Array.from(String(value ?? '')).map(char => {
    if (char === '\n') return char;
    if (/\s/.test(char)) return ' ';
    try { font.encodeText(char); return char; } catch { return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`; }
  }).join('');
  const wrap = (value: unknown, available: number, size = 9, face: PDFFont = font) => {
    const result: string[] = [];
    for (const paragraph of safe(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/ +/)) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (face.widthOfTextAtSize(candidate, size) <= available) { line = candidate; continue; }
        if (line) { result.push(line); line = ''; }
        for (const char of word) {
          if (line && face.widthOfTextAtSize(line + char, size) > available) { result.push(line); line = ''; }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  };
  const draw = (value: string, x: number, at: number, size = 9, face = font) => page.drawText(value, { x, y: at, size, font: face });
  const newPage = () => {
    page = doc.addPage([612, 792]);
    page.drawRectangle({ x: left, y: 747, width, height: 19, color: rgb(0.10, 0.28, 0.56) });
    page.drawText(`WRITEOFF PREPARER SUMMARY | ${taxYear} | NOT FOR FILING`, { x: left + 6, y: 753, size: 9, font: bold, color: rgb(1, 1, 1) });
    y = 727;
    for (const line of wrap(title, width, 16, bold)) { draw(line, left, y, 16, bold); y -= 19; }
    y -= 8;
  };
  const ensure = (height: number) => { if (y - height < bottom) newPage(); };
  newPage();
  return {
    doc,
    paragraph(value: unknown, strong = false) {
      for (const line of wrap(value, width, 9, strong ? bold : font)) { ensure(13); draw(line, left, y, 9, strong ? bold : font); y -= 13; }
      y -= 6;
    },
    section(value: string) {
      const lines = wrap(value, width, 11, bold); ensure(lines.length * 15 + 65); y -= 6;
      for (const line of lines) { draw(line, left, y, 11, bold); y -= 15; }
      y -= 3;
    },
    table(headers: string[], rows: unknown[][], widths: number[]) {
      if (Math.abs(widths.reduce((a, b) => a + b, 0) - width) > 0.01 || headers.length !== widths.length) throw new Error('Invalid PDF columns');
      const header = () => {
        const wrapped = headers.map((value, i) => wrap(value, widths[i] - 10, 8, bold));
        const height = Math.max(...wrapped.map(lines => lines.length)) * 11 + 9;
        ensure(height + 24); page.drawRectangle({ x: left, y: y - height + 5, width, height, color: rgb(0.93, 0.95, 0.98) });
        let x = left;
        wrapped.forEach((lines, i) => { lines.forEach((line, j) => draw(line, x + 4, y - j * 11 - 4, 8, bold)); x += widths[i]; });
        y -= height;
      };
      header();
      for (const values of rows) {
        const wrapped = values.map((value, i) => wrap(value, widths[i] - 10, 8));
        const count = Math.max(...wrapped.map(lines => lines.length));
        let offset = 0;
        while (offset < count) {
          if (y - 22 < bottom) { newPage(); header(); }
          const capacity = Math.max(1, Math.floor((y - bottom - 9) / 11));
          const take = Math.min(count - offset, capacity); let x = left;
          wrapped.forEach((lines, i) => { lines.slice(offset, offset + take).forEach((line, j) => draw(line, x + 4, y - j * 11 - 5, 8)); x += widths[i]; });
          y -= take * 11 + 9;
          page.drawLine({ start: { x: left, y: y + 3 }, end: { x: right, y: y + 3 }, color: rgb(0.8, 0.8, 0.8), thickness: 0.4 });
          offset += take;
        }
      }
      y -= 9;
    },
    async save(pageOffset = 0) {
      const pages = doc.getPages();
      pages.forEach((item, index) => {
        item.drawText('Planning records only. Not an official form or complete return. Review with your tax preparer.', { x: left, y: 34, size: 7, font });
        item.drawText(`Page ${index + 1 + pageOffset} of ${pages.length + pageOffset}`, { x: right - 58, y: 22, size: 7, font });
      });
      return doc.save();
    },
  };
}

export const formatExportMoney = (value: number) => {
  if (!Number.isFinite(value)) throw new RangeError('Export amounts must be finite.');
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
