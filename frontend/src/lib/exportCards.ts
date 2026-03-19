import { formatColumnValueForDisplay } from './sprintCardsColumns';

type ExportArgs = {
  filename: string;
  headers: string[];
  rows: string[][];
};

const escapeCSVCell = (cell: string): string => {
  const needsQuotes = /[",\n\r]/.test(cell);
  const escaped = cell.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportCardsToCSV = ({ filename, headers, rows }: ExportArgs) => {
  const headerLine = headers.map((h) => escapeCSVCell(h)).join(',');
  const rowLines = rows.map((row) =>
    row.map((cell) => escapeCSVCell(cell ?? '')).join(','),
  );

  const csv = [headerLine, ...rowLines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
};

export const exportCardsToXLSX = async ({ filename, headers, rows }: ExportArgs) => {
  // import dinâmico para reduzir impacto no build caso o usuário não use XLSX
  const XLSX: any = await import('xlsx');

  const aoa = [headers, ...rows.map((r) => r.map((cell) => cell ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cards');

  const wbout: ArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, filename);
};

// Helper caso você queira converter valores brutos antes de montar `rows`
export const normalizeValueForExport = (value: unknown): string =>
  formatColumnValueForDisplay(value);

