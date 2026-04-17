/**
 * Count the words in a source string.
 * Strips XML/HTML tags, splits on whitespace, ignores pure-punctuation tokens.
 */
export function countWords(text) {
  if (!text) return 0;
  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

/**
 * Compute word count stats for one file's segments.
 * A segment is a "repetition" if its normalized source appeared in an earlier segment.
 *
 * @param {Array} segments - array of segment objects with a .source string
 * @param {Set} [seenSources] - optional shared Set for batch-level dedup (mutated in place)
 * @returns {{ totalWordCount, newWordCount, repetitionWordCount }}
 */
export function computeFileWordCounts(segments, seenSources) {
  const seen = seenSources ?? new Set();
  let newWordCount = 0;
  let repetitionWordCount = 0;

  for (const segment of segments) {
    const key = segment.source.trim().toLowerCase();
    const words = countWords(segment.source);
    if (seen.has(key)) {
      repetitionWordCount += words;
    } else {
      seen.add(key);
      newWordCount += words;
    }
  }

  return {
    totalWordCount: newWordCount + repetitionWordCount,
    newWordCount,
    repetitionWordCount,
  };
}

/**
 * Compute batch-level (cross-file) repetition counts for all files in a workspace.
 * Files are processed in order; a segment is a batch repetition if its source
 * appeared in any prior file or earlier in the current file.
 *
 * @param {Array} files - array of objects with a .segments array
 * @returns {Array<{ batchNewWordCount, batchRepetitionWordCount }>}
 */
export function computeBatchWordCounts(files) {
  const seenAcrossBatch = new Set();

  return files.map((file) => {
    const { newWordCount: batchNewWordCount, repetitionWordCount: batchRepetitionWordCount } =
      computeFileWordCounts(file.segments, seenAcrossBatch);
    return { batchNewWordCount, batchRepetitionWordCount };
  });
}
