import { MIN_FUZZY_MATCH } from './constants';
import { normalizeForLookup } from './text';

function normalizeText(value) {
  return normalizeForLookup(value);
}

function tokenize(value) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/[\s.,!?;:()[\]{}<>/"'`~@#$%^&*_+=\\|-]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
}

function tokenOverlap(sourceA, sourceB) {
  const a = tokenize(sourceA);
  const b = tokenize(sourceB);
  if (!a.length && !b.length) {
    return 0;
  }

  const bSet = new Set(b);
  let intersection = 0;
  for (const token of a) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }

  return Math.max(a.length, b.length) ? intersection / Math.max(a.length, b.length) : 0;
}

function levenshteinDistance(sourceA, sourceB) {
  const a = normalizeText(sourceA);
  const b = normalizeText(sourceB);
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= b.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function normalizedEditSimilarity(sourceA, sourceB) {
  const a = normalizeText(sourceA);
  const b = normalizeText(sourceB);
  if (!a && !b) {
    return 1;
  }

  const longestLength = Math.max(a.length, b.length);
  if (!longestLength) {
    return 0;
  }

  return 1 - levenshteinDistance(a, b) / longestLength;
}

function substringBoost(sourceA, sourceB) {
  const a = normalizeText(sourceA);
  const b = normalizeText(sourceB);
  if (!a || !b) {
    return 0;
  }

  return a.includes(b) || b.includes(a) ? 1 : 0;
}

export function getTmKey(source) {
  return normalizeText(source);
}

export function dedupeTmEntries(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    if (entry.source?.trim() && entry.target?.trim()) {
      map.set(getTmKey(entry.source), {
        source: entry.source,
        target: entry.target,
      });
    }
  });

  return [...map.values()];
}

export function findTmMatches(sourceText, tmEntries) {
  return tmEntries
    .map((entry) => {
      const exact = normalizeText(entry.source) === normalizeText(sourceText);
      const overlap = tokenOverlap(sourceText, entry.source);
      const editSimilarity = normalizedEditSimilarity(sourceText, entry.source);
      const hasSubstringBoost = substringBoost(sourceText, entry.source);
      const score = exact
        ? 100
        : Math.round(
            Math.max(
              overlap * 100,
              overlap > 0 ? (overlap * 0.7 + editSimilarity * 0.3) * 100 : hasSubstringBoost ? editSimilarity * 100 : 0,
            ),
          );

      return { ...entry, score, overlap };
    })
    .filter((entry) => entry.score >= 40)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source, undefined, { sensitivity: 'base' }))
    .slice(0, 3);
}

export function getAutofillMatch(matches) {
  const topMatch = matches[0];
  if (!topMatch) {
    return null;
  }
  if (topMatch.score === 100) {
    return { ...topMatch, status: 'autofilled' };
  }
  if (topMatch.score >= MIN_FUZZY_MATCH) {
    return { ...topMatch, status: 'fuzzy' };
  }
  return null;
}
