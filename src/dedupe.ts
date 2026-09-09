import { SIMILARITY_THRESHOLD } from './config.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'will', 'with', 'you', 'your', 'my', 'me', 'we', 'our',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/** Jaccard overlap of content words. Cheap, local, and good enough to catch repeats. */
export function similarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (!setA.size || !setB.size) return 0;

  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;

  return shared / (setA.size + setB.size - shared);
}

export interface SimilarityHit {
  text: string;
  score: number;
}

/**
 * Find the closest prior post, if it is close enough to matter.
 *
 * Nothing checked this before, so the system could — and eventually would —
 * republish the same thought with different words.
 */
export function findNearestDuplicate(
  candidate: string,
  priorPosts: string[],
  threshold: number = SIMILARITY_THRESHOLD,
): SimilarityHit | undefined {
  let best: SimilarityHit | undefined;

  for (const prior of priorPosts) {
    const score = similarity(candidate, prior);
    if (score >= threshold && (!best || score > best.score)) {
      best = { text: prior, score };
    }
  }

  return best;
}
