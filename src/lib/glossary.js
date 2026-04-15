import { normalizeForLookup } from './text';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForMatch(value) {
  return normalizeForLookup(value);
}

export function findGlossaryMatches(sourceText, glossaryEntries) {
  const lowerSource = normalizeForMatch(sourceText);

  return glossaryEntries
    .filter((entry) => lowerSource.includes(normalizeForMatch(entry.source)))
    .sort((a, b) => b.source.length - a.source.length);
}

export function buildHighlightedSource(sourceText, glossaryEntries) {
  if (!sourceText) {
    return [];
  }

  const matches = findGlossaryMatches(sourceText, glossaryEntries);
  if (!matches.length) {
    return [{ text: sourceText, matched: false }];
  }

  const ranges = [];
  matches.forEach((entry) => {
    const regex = new RegExp(escapeRegExp(entry.source), 'gi');
    let result = regex.exec(sourceText);

    while (result) {
      ranges.push({
        start: result.index,
        end: result.index + result[0].length,
      });
      result = regex.exec(sourceText);
    }
  });

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged = [];
  ranges.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  });

  const parts = [];
  let cursor = 0;

  merged.forEach((range) => {
    if (cursor < range.start) {
      parts.push({ text: sourceText.slice(cursor, range.start), matched: false });
    }

    parts.push({ text: sourceText.slice(range.start, range.end), matched: true });
    cursor = range.end;
  });

  if (cursor < sourceText.length) {
    parts.push({ text: sourceText.slice(cursor), matched: false });
  }

  return parts;
}
