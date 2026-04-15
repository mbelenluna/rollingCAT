import * as XLSX from 'xlsx';
import { cleanSpreadsheetCell, normalizeForLookup } from './text';

function cleanCellValue(value) {
  return cleanSpreadsheetCell(value);
}

function looksLikeHeaderLabel(value) {
  const normalized = normalizeForLookup(value);
  return [
    'source',
    'target',
    'english',
    'translation',
    'translated text',
    'source text',
    'target text',
    'term',
    'glossary',
    'locale',
    'language',
  ].includes(normalized);
}

function getDataRows(rows, assumeHeader = true) {
  if (!assumeHeader || !rows.length) {
    return rows;
  }

  const firstRow = rows[0] ?? [];
  const firstCellLooksLikeHeader = looksLikeHeaderLabel(firstRow[0]);
  const secondCellLooksLikeHeader = looksLikeHeaderLabel(firstRow[1]);

  return firstCellLooksLikeHeader || secondCellLooksLikeHeader ? rows.slice(1) : rows;
}

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        resolve(XLSX.read(event.target?.result, { type: 'array' }));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function getWorksheetRows(workbook) {
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
}

function rowsToPairs(rows) {
  return getDataRows(rows, true)
    .map((row) => {
      const source = cleanCellValue(row[0]);
      const target = cleanCellValue(row[1]);
      return source && target ? { source, target } : null;
    })
    .filter(Boolean);
}

function parseGoogleSheetUrl(sheetUrl) {
  let url;
  try {
    url = new URL(sheetUrl);
  } catch {
    throw new Error('Please paste a valid Google Sheets link.');
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error('That link does not look like a Google Sheets document.');
  }

  const documentId = match[1];
  const gidFromSearch = url.searchParams.get('gid');
  const gidFromHash = url.hash.match(/gid=(\d+)/)?.[1];
  const gid = gidFromSearch || gidFromHash || '0';

  return `https://docs.google.com/spreadsheets/d/${documentId}/export?format=csv&gid=${gid}`;
}

export async function parseSegmentFile(file) {
  const workbook = await readWorkbook(file);
  const rows = getWorksheetRows(workbook);
  const dataRows = getDataRows(rows, true);
  const header = dataRows.length === rows.length ? ['Source', 'Target'] : rows[0]?.slice(0, 2) ?? ['Source', 'Target'];
  const segments = dataRows
    .map((row, index) => {
      const source = cleanCellValue(row[0]);
      const target = cleanCellValue(row[1]);

      if (!source.trim() && !target.trim()) {
        return null;
      }

      return {
        id: crypto.randomUUID(),
        number: index + 1,
        source,
        target,
        status: target.trim() ? 'translated' : 'empty',
        tmMatchPercent: target.trim() ? 100 : null,
      };
    })
    .filter(Boolean);

  return {
    projectName: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    header,
    segments,
  };
}

export async function parseSimplePairsFile(file) {
  const workbook = await readWorkbook(file);
  const rows = getWorksheetRows(workbook);

  return rowsToPairs(rows);
}

export async function parseSimplePairsFiles(files) {
  const parsedFiles = await Promise.all(files.map((file) => parseSimplePairsFile(file)));
  return parsedFiles.flat();
}

export async function parseSimplePairsFromGoogleSheetUrl(sheetUrl) {
  const exportUrl = parseGoogleSheetUrl(sheetUrl);
  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error('Could not fetch that Google Sheet. Make sure the tab is public or published to the web.');
  }

  const csvText = await response.text();
  const workbook = XLSX.read(csvText, { type: 'string' });
  const rows = getWorksheetRows(workbook);
  return rowsToPairs(rows);
}

export function exportSegmentsToWorkbook({ header, segments, fileName }) {
  const rows = [
    header?.length ? header.slice(0, 2) : ['Source', 'Target'],
    ...segments.map((segment) => [segment.source, segment.target ?? '']),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Translations');
  XLSX.writeFile(workbook, fileName || 'translations.xlsx');
}
