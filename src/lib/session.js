import { dedupeTmEntries, findTmMatches, getAutofillMatch } from './tm';
import { normalizeForLookup } from './text';

function updateSegmentWithMatch(segment, tmEntries) {
  if (segment.status === 'translated' && segment.target.trim()) {
    return {
      ...segment,
      status: 'translated',
      tmMatchPercent: 100,
    };
  }

  if (segment.status === 'pending' && segment.target.trim()) {
    return {
      ...segment,
      status: 'pending',
      tmMatchPercent: null,
    };
  }

  const matches = findTmMatches(segment.source, tmEntries);
  const autofill = getAutofillMatch(matches);

  if (!autofill) {
    return {
      ...segment,
      status: 'empty',
      tmMatchPercent: matches[0]?.score ?? null,
    };
  }

  return {
    ...segment,
    target: autofill.target,
    status: autofill.status,
    tmMatchPercent: autofill.score,
  };
}

export function createSessionFromUpload(uploadResult) {
  const tmEntries = [];

  const seededSegments = uploadResult.segments.map((segment) =>
    segment.target.trim()
      ? {
          ...segment,
          status: 'pending',
          tmMatchPercent: null,
        }
      : segment,
  );

  const segments = seededSegments.map((segment) => updateSegmentWithMatch(segment, tmEntries));

  return {
    projectName: uploadResult.projectName,
    originalFileName: uploadResult.fileName,
    header: uploadResult.header,
    segments,
    glossaryEntries: [],
    tmEntries,
    currentSegmentId: segments[0]?.id ?? null,
    updatedAt: Date.now(),
  };
}

export function createProjectFromUpload(uploadResult, userId) {
  const baseSession = createSessionFromUpload(uploadResult);
  const timestamp = Date.now();

  return {
    id: crypto.randomUUID(),
    userId,
    createdAt: timestamp,
    ...baseSession,
    updatedAt: timestamp,
  };
}

export function mergeGlossaryEntries(session, glossaryEntries) {
  const map = new Map();

  [...session.glossaryEntries, ...glossaryEntries].forEach((entry) => {
    if (entry.source?.trim() && entry.target?.trim()) {
      map.set(normalizeForLookup(entry.source), { source: entry.source, target: entry.target });
    }
  });

  return {
    ...session,
    glossaryEntries: [...map.values()],
    updatedAt: Date.now(),
  };
}

export function mergeTmEntries(session, additionalEntries) {
  const tmEntries = dedupeTmEntries([...session.tmEntries, ...additionalEntries]);
  return {
    ...session,
    tmEntries,
    segments: session.segments.map((segment) => updateSegmentWithMatch(segment, tmEntries)),
    updatedAt: Date.now(),
  };
}

export function saveSegmentTranslation(session, segmentId, targetText) {
  const normalizedTarget = targetText.replace(/\r\n/g, '\n');
  const segments = session.segments.map((segment) =>
    segment.id === segmentId
      ? {
          ...segment,
          target: normalizedTarget,
          status: normalizedTarget.trim() ? 'translated' : 'empty',
          tmMatchPercent: normalizedTarget.trim() ? 100 : segment.tmMatchPercent,
        }
      : segment,
  );

  const updatedSegment = segments.find((segment) => segment.id === segmentId);
  const tmEntries = updatedSegment?.target.trim()
    ? dedupeTmEntries([...session.tmEntries, { source: updatedSegment.source, target: updatedSegment.target }])
    : session.tmEntries;

  return {
    ...session,
    segments,
    tmEntries,
    updatedAt: Date.now(),
  };
}

export function recomputeSegmentMatches(session) {
  return {
    ...session,
    segments: session.segments.map((segment) => updateSegmentWithMatch(segment, session.tmEntries)),
    updatedAt: Date.now(),
  };
}
