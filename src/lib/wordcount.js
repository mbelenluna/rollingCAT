/**
 * wordcount.js — Repetition analysis matching professional CAT tool behaviour.
 *
 * Core rules (matching Trados Studio logic):
 *  - The FIRST occurrence of a source segment is "new" (AT — analysis total).
 *  - Every subsequent occurrence of the same source segment is a "repetition".
 *  - Repetition word count = full word count of the repeated segment × number of
 *    repeated occurrences (not a count of shared words across different segments).
 *  - Comparison is done on a NORMALIZED key (see normalizeSegmentKey), so minor
 *    whitespace, casing, or punctuation differences don't prevent matching.
 *  - The original source text is never modified — normalization is for comparison only.
 */

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Smart-quote / apostrophe substitution table.
 * Maps Unicode typographic characters to their ASCII equivalents.
 */
const QUOTE_MAP = {
  '\u2018': "'", // LEFT SINGLE QUOTATION MARK
  '\u2019': "'", // RIGHT SINGLE QUOTATION MARK  (also apostrophe)
  '\u201A': "'", // SINGLE LOW-9 QUOTATION MARK
  '\u201B': "'", // SINGLE HIGH-REVERSED-9 QUOTATION MARK
  '\u201C': '"', // LEFT DOUBLE QUOTATION MARK
  '\u201D': '"', // RIGHT DOUBLE QUOTATION MARK
  '\u201E': '"', // DOUBLE LOW-9 QUOTATION MARK
  '\u201F': '"', // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
  '\u2032': "'", // PRIME (foot/minute mark used as apostrophe)
  '\u2033': '"', // DOUBLE PRIME
  '\u00AB': '"', // LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
  '\u00BB': '"', // RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
};

const QUOTE_REGEX = new RegExp(`[${Object.keys(QUOTE_MAP).join('')}]`, 'g');

/**
 * Build a normalized comparison key from a raw source segment string.
 *
 * Steps (order matters):
 *  1. Strip XML/HTML tags and XLIFF-style placeables — they are not visible
 *     words and must not prevent two otherwise identical strings from matching.
 *  2. Normalize all line-break variants to a single space.
 *  3. Normalize smart quotes / apostrophes to ASCII equivalents.
 *  4. Strip zero-width and non-breaking space characters.
 *  5. Collapse any run of whitespace into a single space.
 *  6. Trim leading/trailing whitespace.
 *  7. Lowercase (case-insensitive comparison).
 *  8. Strip trailing sentence-final punctuation (. ! ?) so that "Click OK."
 *     and "Click OK" match. Only a single trailing character is removed to
 *     avoid corrupting abbreviations or ellipses.
 *
 * @param {string} text - raw source segment string
 * @returns {string} normalized key
 */
export function normalizeSegmentKey(text) {
  if (!text) return '';

  return text
    // 1. Strip XML/HTML tags and XLIFF g/x/ph/bx/ex placeables
    .replace(/<[^>]*>/g, ' ')
    // 2. Normalize line breaks (CR+LF, CR, LF, vertical tab, form feed) → space
    .replace(/[\r\n\v\f]+/g, ' ')
    // 3. Normalize typographic quotes/apostrophes → ASCII
    .replace(QUOTE_REGEX, (ch) => QUOTE_MAP[ch])
    // 4. Remove zero-width / invisible characters
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    // 5. Collapse runs of whitespace (including non-breaking spaces) to a single space
    .replace(/[\s\u00A0]+/g, ' ')
    // 6 & 7. Trim and lowercase
    .trim()
    .toLowerCase()
    // 8. Strip a single trailing sentence-final punctuation mark
    //    (handles "OK." vs "OK" but does NOT strip "..." or "e.g.")
    .replace(/[.!?]$/, '');
}

// ---------------------------------------------------------------------------
// Word counting
// ---------------------------------------------------------------------------

/**
 * Count the words in a raw source string.
 *
 * Algorithm:
 *  - Strip inline tags (they are not translatable words).
 *  - Remove zero-width characters.
 *  - Split on any whitespace run.
 *  - Filter out tokens that are entirely punctuation (no letter or digit).
 *
 * This matches broadly what Trados does for space-separated (Western) source
 * languages. CJK sources require a character-based counter (out of scope here).
 *
 * @param {string} text - raw source segment string
 * @returns {number}
 */
export function countWords(text) {
  if (!text) return 0;
  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!stripped) return 0;
  // Keep tokens that contain at least one letter or digit
  return stripped.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

/**
 * Analyse repetitions within one file's segments.
 *
 * Processing order matters: segments are visited in their display order.
 * The very first occurrence of a normalized key is "new"; every later
 * occurrence — even if non-consecutive — is a "repetition".
 *
 * When `seenSources` is supplied (batch mode), the Set is shared across
 * files so that a segment appearing in file B that already appeared in
 * file A is counted as a batch repetition.
 *
 * @param {Array<{source: string}>} segments
 * @param {Set<string>} [seenSources] - shared Set for batch-level dedup (mutated)
 * @returns {{
 *   totalWordCount: number,
 *   newWordCount: number,
 *   repetitionWordCount: number,
 *   repeatedSegmentOccurrences: number,  // total count of repeated occurrences
 * }}
 */
export function computeFileWordCounts(segments, seenSources) {
  // Use the caller's Set (batch mode) or create a fresh one (per-file mode).
  const seen = seenSources ?? new Set();

  let newWordCount = 0;
  let repetitionWordCount = 0;
  let repeatedSegmentOccurrences = 0;

  for (const segment of segments) {
    const key = normalizeSegmentKey(segment.source);
    // Skip blank/tag-only segments — they carry no translatable content.
    if (!key) continue;

    const words = countWords(segment.source);

    if (seen.has(key)) {
      // This is the 2nd, 3rd, … occurrence → repetition.
      // Add the FULL word count of this occurrence (not just "1 repetition flag").
      repetitionWordCount += words;
      repeatedSegmentOccurrences += 1;
    } else {
      seen.add(key);
      newWordCount += words;
    }
  }

  return {
    totalWordCount: newWordCount + repetitionWordCount,
    newWordCount,
    repetitionWordCount,
    repeatedSegmentOccurrences,
  };
}

// ---------------------------------------------------------------------------
// Batch-level analysis
// ---------------------------------------------------------------------------

/**
 * Compute batch-level (cross-file) repetition counts for all files in a workspace.
 *
 * A single shared Set accumulates normalized keys across all files in order.
 * A segment encountered in file N that was already seen in file 1…N-1 (or
 * earlier in file N itself) is counted as a batch repetition for file N.
 *
 * @param {Array<{segments: Array}>} files
 * @returns {Array<{
 *   batchNewWordCount: number,
 *   batchRepetitionWordCount: number,
 *   batchRepeatedSegmentOccurrences: number,
 * }>}
 */
export function computeBatchWordCounts(files) {
  const seenAcrossBatch = new Set();

  return files.map((file) => {
    const { newWordCount, repetitionWordCount, repeatedSegmentOccurrences } =
      computeFileWordCounts(file.segments, seenAcrossBatch);
    return {
      batchNewWordCount: newWordCount,
      batchRepetitionWordCount: repetitionWordCount,
      batchRepeatedSegmentOccurrences: repeatedSegmentOccurrences,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests (run with: node --experimental-vm-modules src/lib/wordcount.js)
// ---------------------------------------------------------------------------
// Uncomment and run manually when verifying the logic:
//
// function runTests() {
//   const cases = [
//     {
//       label: 'Exact repeat — 3 occurrences',
//       segments: [
//         { source: 'Click OK to continue' },
//         { source: 'Click OK to continue' },
//         { source: 'Click OK to continue' },
//       ],
//       expect: { totalWordCount: 12, newWordCount: 4, repetitionWordCount: 8, repeatedSegmentOccurrences: 2 },
//     },
//     {
//       label: 'Case difference should match',
//       segments: [
//         { source: 'Click OK to continue' },
//         { source: 'click ok to continue' },
//       ],
//       expect: { totalWordCount: 8, newWordCount: 4, repetitionWordCount: 4, repeatedSegmentOccurrences: 1 },
//     },
//     {
//       label: 'Extra internal spaces should match',
//       segments: [
//         { source: 'Click  OK  to  continue' },
//         { source: 'Click OK to continue' },
//       ],
//       expect: { totalWordCount: 8, newWordCount: 4, repetitionWordCount: 4, repeatedSegmentOccurrences: 1 },
//     },
//     {
//       label: 'Trailing punctuation variation should match',
//       segments: [
//         { source: 'Click OK to continue.' },
//         { source: 'Click OK to continue' },
//       ],
//       expect: { totalWordCount: 8, newWordCount: 4, repetitionWordCount: 4, repeatedSegmentOccurrences: 1 },
//     },
//     {
//       label: 'Smart quotes should match ASCII quotes',
//       segments: [
//         { source: '\u2018Hello\u2019' },
//         { source: "'Hello'" },
//       ],
//       expect: { totalWordCount: 2, newWordCount: 1, repetitionWordCount: 1, repeatedSegmentOccurrences: 1 },
//     },
//     {
//       label: 'Shared words across DIFFERENT segments do NOT count as repetitions',
//       segments: [
//         { source: 'Click OK to continue' },
//         { source: 'Click Cancel to abort' },
//       ],
//       expect: { totalWordCount: 8, newWordCount: 8, repetitionWordCount: 0, repeatedSegmentOccurrences: 0 },
//     },
//     {
//       label: 'Blank segment is skipped',
//       segments: [
//         { source: '' },
//         { source: '   ' },
//         { source: 'Hello' },
//       ],
//       expect: { totalWordCount: 1, newWordCount: 1, repetitionWordCount: 0, repeatedSegmentOccurrences: 0 },
//     },
//   ];
//
//   let passed = 0;
//   for (const { label, segments, expect } of cases) {
//     const result = computeFileWordCounts(segments);
//     const ok = Object.entries(expect).every(([k, v]) => result[k] === v);
//     console.log(`${ok ? '✓' : '✗'} ${label}`);
//     if (!ok) console.log('  expected', expect, '\n  got     ', result);
//     if (ok) passed++;
//   }
//   console.log(`\n${passed}/${cases.length} tests passed`);
// }
// runTests();
