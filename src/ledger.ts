import { collection } from './store.js';
import { OUTCOME_DELAY_HOURS } from './config.js';
import type { Outcome, Platform, PlatformText, PostRecord, Publication, Review } from './types.js';

/**
 * The system of record for every post: draft -> review -> publication -> outcome.
 *
 * Previously these four facts lived in three places that shared no key
 * (src/generated/*.json, automation-logs.jsonl, topics.json), which is why
 * nothing could answer "did the posts we wrote actually do anything".
 */
export const posts = collection<PostRecord>('posts');

function slug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function newPostId(topic: string, at: Date = new Date()): string {
  return `${at.toISOString().replace(/[:.]/g, '-')}-${slug(topic)}`;
}

export async function record(post: PostRecord): Promise<PostRecord> {
  await posts.put(post.id, post);
  return post;
}

/**
 * Apply a change to one ledger entry.
 *
 * Delegates to the store's atomic update rather than reading and writing as
 * two steps: every mutation here appends to an array (`publications`,
 * `outcomes`), and two callers appending at once — a review in the UI while
 * the cron records a publication — would otherwise drop one of the appends.
 */
async function mutate(
  id: string,
  change: (post: PostRecord) => PostRecord,
): Promise<PostRecord> {
  try {
    return await posts.update(id, change);
  } catch (error) {
    if ((error as Error).message === `No record with id ${id}`) {
      throw new Error(`No post in ledger with id ${id}`);
    }
    throw error;
  }
}

/** Record the author's verdict. `approved` carries any edits they made. */
export async function recordReview(
  id: string,
  review: Review,
  approved?: PlatformText,
): Promise<PostRecord> {
  return mutate(id, (post) => ({
    ...post,
    review,
    approved,
    status: review.decision === 'rejected' ? 'rejected' : 'approved',
  }));
}

export async function recordPublications(
  id: string,
  publications: Publication[],
): Promise<PostRecord> {
  return mutate(id, (post) => ({
    ...post,
    publications: [...post.publications, ...publications],
    status: publications.some((p) => p.status !== 'failed') ? 'published' : post.status,
  }));
}

export async function recordOutcomes(id: string, outcomes: Outcome[]): Promise<PostRecord> {
  return mutate(id, (post) => {
    const merged = { ...post, outcomes: [...post.outcomes, ...outcomes] };

    // Only 'measured' once nothing is still pending. Marking the whole post
    // measured after a single platform reported would strand the other one
    // permanently the first time its analytics call failed.
    return pendingMeasurement(merged).length ? merged : { ...merged, status: 'measured' };
  });
}

/** The text that actually went out, falling back to the draft when unedited. */
export function publishedText(post: PostRecord, platform: Platform): string | undefined {
  return post.approved?.[platform] ?? post.drafts[platform];
}

export async function pendingReview(): Promise<PostRecord[]> {
  const all = await posts.all();
  return all
    .filter((post) => post.status === 'draft')
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

export async function approvedUnpublished(): Promise<PostRecord[]> {
  const all = await posts.all();
  return all.filter((post) => post.status === 'approved' && !post.publications.length);
}

/**
 * Publications that have settled but have no outcome recorded yet.
 *
 * Tracked per platform so a failed analytics call for one platform is retried
 * on the next sweep instead of being written off with the post.
 */
export function pendingMeasurement(post: PostRecord, now: Date = new Date()): Publication[] {
  const cutoff = now.getTime() - OUTCOME_DELAY_HOURS * 3_600_000;
  const measured = new Set(post.outcomes.map((outcome) => outcome.platform));

  return post.publications.filter((publication) => {
    if (publication.status === 'failed' || !publication.latePostId) return false;
    if (measured.has(publication.platform)) return false;

    const at = publication.publishedAt ?? publication.scheduledFor;
    return at !== undefined && new Date(at).getTime() <= cutoff;
  });
}

/** Posts with at least one publication still waiting to be measured. */
export async function awaitingOutcomes(now: Date = new Date()): Promise<PostRecord[]> {
  const all = await posts.all();
  return all.filter((post) => pendingMeasurement(post, now).length > 0);
}

/**
 * Every post we have already written — the dedupe corpus.
 *
 * Includes drafts and rejected posts, not just published ones: with the review
 * gate on, drafts accumulate unpublished, and restricting this to published
 * work meant several generations in a row were compared against nothing.
 * Sorted oldest-first so callers taking the last N get the most recent.
 */
export async function priorPostTexts(): Promise<string[]> {
  const all = await posts.all();

  return all
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
    .flatMap((post) => [publishedText(post, 'twitter'), publishedText(post, 'linkedin')])
    .filter((text): text is string => Boolean(text));
}
