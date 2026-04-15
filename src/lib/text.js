export function normalizeForLookup(value) {
  return `${value ?? ''}`
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function cleanSpreadsheetCell(value) {
  return `${value ?? ''}`
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}
