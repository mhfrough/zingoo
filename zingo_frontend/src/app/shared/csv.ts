/** One block of a CSV export: a title line, then a header row and the data rows. */
export interface CsvSection {
  title: string;
  rows: Record<string, string | number | null | undefined>[];
}

/** Quotes a cell when it contains a comma, a quote or a line break. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Turns sections into CSV text: each section is a title, its column names, then its rows, separated by a blank line. */
export function toCsv(sections: CsvSection[]): string {
  return sections
    .map(({ title, rows }) => {
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return [title, columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
    })
    .join('\r\n\r\n');
}

/** Saves sections as a CSV file through the browser's download. */
export function downloadCsv(filename: string, sections: CsvSection[]): void {
  const blob = new Blob(['﻿' + toCsv(sections)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
