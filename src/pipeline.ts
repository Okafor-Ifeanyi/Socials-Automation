import { ContentGenerator } from './content-generator.js';
import { LatePublisher } from './late-publisher.js';
import { loadCorpus } from './corpus.js';
import { isStale, profileStore } from './voice-profile.js';
import * as ledger from './ledger.js';
import { MODEL, PLATFORM_LABELS, REQUIRE_APPROVAL } from './config.js';
import type { Platform, PostRecord, Publication, VoiceProfile } from './types.js';

/**
 * Shared steps between the interactive CLI and the automated poster.
 *
 * These two used to be independent copies that had already drifted: one
 * published, the other had its publish calls commented out, and only one of
 * them loaded the corpus correctly.
 */

export async function requireProfile(): Promise<VoiceProfile> {
  const profile = await profileStore.read();

  if (!profile) {
    throw new Error(
      'No voice profile found. Build one first:\n' +
        '  npm run distill-voice\n' +
        `It is stored at ${profileStore.location} and only needs rebuilding when your corpus changes.`,
    );
  }

  const corpus = loadCorpus();
  if (corpus.length && isStale(profile, corpus)) {
    console.warn(
      `⚠️  Voice profile was built from ${profile.sourcePostCount} posts but your corpus ` +
        `now has ${corpus.length}. Run 'npm run distill-voice' to refresh it.`,
    );
  }

  return profile;
}

/** Generate a post for a topic and enter it in the ledger as a draft. */
export async function generateForTopic(topic: string): Promise<PostRecord> {
  const profile = await requireProfile();
  const priorPosts = await ledger.priorPostTexts();

  const generator = new ContentGenerator();
  const { posts, duplicateWarning } = await generator.generateDistinctPosts(
    profile,
    topic,
    priorPosts,
  );

  if (duplicateWarning) console.warn(`⚠️  ${duplicateWarning}`);

  return ledger.record({
    id: ledger.newPostId(topic),
    topic,
    status: 'draft',
    generatedAt: new Date().toISOString(),
    voiceProfileVersion: profile.version,
    model: MODEL,
    drafts: { twitter: posts.xPost, linkedin: posts.linkedInPost },
    publications: [],
    outcomes: [],
  });
}

/**
 * Publish whatever was approved for a record.
 *
 * Refuses to publish an unreviewed draft while approval is required — an
 * autonomous pipeline posting to someone's real professional identity should
 * not be the default, and the review step is also where training signal comes
 * from.
 */
export async function publishRecord(
  post: PostRecord,
  options: { scheduledFor?: Date; publisher?: LatePublisher } = {},
): Promise<Publication[]> {
  if (REQUIRE_APPROVAL && post.status === 'draft') {
    throw new Error(
      `Post ${post.id} has not been reviewed. Run 'npm run review', ` +
        'or set REQUIRE_APPROVAL=false to publish unreviewed drafts.',
    );
  }

  if (post.status === 'rejected') {
    throw new Error(`Post ${post.id} was rejected at review and will not be published`);
  }

  const publisher = options.publisher ?? new LatePublisher();

  const items = (Object.keys(PLATFORM_LABELS) as Platform[])
    .filter((platform) => publisher.accountFor(platform))
    .map((platform) => ({ platform, text: ledger.publishedText(post, platform) }))
    .filter((item): item is { platform: Platform; text: string } => Boolean(item.text));

  if (!items.length) {
    throw new Error('No platforms configured — set LATE_TWITTER_ACCOUNT_ID / LATE_LINKEDIN_ACCOUNT_ID');
  }

  const publications = await publisher.publishMany(items, options.scheduledFor);
  await ledger.recordPublications(post.id, publications);

  return publications;
}

export function describePublications(publications: Publication[]): void {
  for (const publication of publications) {
    const label = PLATFORM_LABELS[publication.platform];

    if (publication.status === 'failed') {
      console.error(`   ❌ ${label}: ${publication.error}`);
    } else {
      const when = publication.scheduledFor
        ? `scheduled for ${new Date(publication.scheduledFor).toLocaleString()}`
        : 'published';
      console.log(`   ✅ ${label}: ${when} (id ${publication.latePostId})`);
    }
  }
}
