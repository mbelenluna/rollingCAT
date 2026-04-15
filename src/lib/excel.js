import * as XLSX from 'xlsx';
import { cleanSpreadsheetCell, normalizeForLookup } from './text';

function cleanCellValue(value) {
  return cleanSpreadsheetCell(value);
}

const SOURCE_HEADER_KEYWORDS = ['source', 'source text', 'english', 'en', 'original', 'string', 'text'];
const TARGET_HEADER_KEYWORDS = ['target', 'target text', 'translation', 'translated text', 'translated', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko'];

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

function isLikelyKeyColumn(value) {
  const normalized = normalizeForLookup(value);
  return ['key', 'keys', 'id', 'identifier', 'name', 'resource key'].includes(normalized);
}

function findHeaderIndex(row, keywords) {
  return row.findIndex((cell) => {
    const normalized = normalizeForLookup(cell);
    return keywords.includes(normalized);
  });
}

function firstNonEmptyCellIndex(row) {
  return row.findIndex((cell) => cleanCellValue(cell));
}

function inferSegmentColumns(rows) {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cleanCellValue(cell)));
  const headerRow = nonEmptyRows[0] ?? [];
  const dataRows = getDataRows(rows, true);
  const firstDataRow = dataRows.find((row) => row.some((cell) => cleanCellValue(cell))) ?? [];

  let sourceIndex = findHeaderIndex(headerRow, SOURCE_HEADER_KEYWORDS);
  let targetIndex = findHeaderIndex(headerRow, TARGET_HEADER_KEYWORDS);

  if (sourceIndex !== -1 && targetIndex !== -1 && sourceIndex !== targetIndex) {
    return {
      sourceIndex,
      targetIndex,
      header: [headerRow[sourceIndex] || 'Source', headerRow[targetIndex] || 'Target'],
    };
  }

  const nonEmptyIndexes = headerRow
    .map((cell, index) => (cleanCellValue(cell) ? index : -1))
    .filter((index) => index >= 0);

  const candidateIndexes = nonEmptyIndexes.filter((index) => !isLikelyKeyColumn(headerRow[index]));

  if (candidateIndexes.length >= 2) {
    return {
      sourceIndex: candidateIndexes[0],
      targetIndex: candidateIndexes[1],
      header: [headerRow[candidateIndexes[0]] || 'Source', headerRow[candidateIndexes[1]] || 'Target'],
    };
  }

  const firstDataIndexes = firstDataRow
    .map((cell, index) => (cleanCellValue(cell) ? index : -1))
    .filter((index) => index >= 0);

  if (firstDataIndexes.length >= 2) {
    return {
      sourceIndex: firstDataIndexes[0],
      targetIndex: firstDataIndexes[1],
      header: [headerRow[firstDataIndexes[0]] || 'Source', headerRow[firstDataIndexes[1]] || 'Target'],
    };
  }

  const fallbackSourceIndex = firstNonEmptyCellIndex(headerRow) >= 0 ? firstNonEmptyCellIndex(headerRow) : 0;

  return {
    sourceIndex: fallbackSourceIndex,
    targetIndex: fallbackSourceIndex + 1,
    header: [headerRow[fallbackSourceIndex] || 'Source', headerRow[fallbackSourceIndex + 1] || 'Target'],
  };
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

function getSegmentDataRows(rows) {
  return rows.length ? rows.slice(1) : rows;
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

function workbookToSegmentFile(workbook, fileName = 'Imported file.xlsx') {
  const rows = getWorksheetRows(workbook);
  const { sourceIndex, targetIndex, header } = inferSegmentColumns(rows);
  const dataRows = getSegmentDataRows(rows);
  const segments = dataRows
    .map((row, index) => {
      const source = cleanCellValue(row[sourceIndex]);
      const target = cleanCellValue(row[targetIndex]);

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
    projectName: fileName.replace(/\.[^.]+$/, ''),
    fileName,
    header,
    segments,
  };
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
  return workbookToSegmentFile(workbook, file.name);
}

export function parseSegmentBlob(blob, fileName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: 'array' });
        resolve(workbookToSegmentFile(workbook, fileName));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
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
