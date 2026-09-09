#!/usr/bin/env node
import 'dotenv/config';
import * as ledger from './ledger.js';
import { loadTopicPool, selectTopic, summarise } from './topics.js';
import { generateForTopic, publishRecord, describePublications } from './pipeline.js';
import { nextSlot } from './schedule.js';
import { PLATFORM_LABELS, REQUIRE_APPROVAL, TIMEZONE } from './config.js';
import type { Platform } from './types.js';

/**
 * The scheduled path: pick a topic, write it, and either queue it for review
 * or send it out.
 *
 * POST_MODE is explicit rather than inferred. The workflow used to derive it
 * from an empty `workflow_dispatch` input, which meant every cron run took the
 * "schedule for tomorrow 9am" branch — so a Mon/Wed/Fri schedule published on
 * Tue/Thu/Sat.
 */
type PostMode = 'now' | 'schedule' | 'draft';

function resolveMode(): PostMode {
  const mode = (process.env.POST_MODE ?? '').toLowerCase();

  if (mode === 'now' || mode === 'schedule' || mode === 'draft') return mode;
  if (mode) throw new Error(`Invalid POST_MODE "${mode}" — expected now, schedule or draft`);

  // Approval required and nothing said otherwise: queue it, don't post it.
  return REQUIRE_APPROVAL ? 'draft' : 'now';
}

async function main(): Promise<void> {
  console.log('🤖 Automated Content Poster');
  console.log(`📅 ${new Date().toISOString()}\n`);

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const mode = resolveMode();
  if (mode !== 'draft' && !process.env.LATE_API_KEY) {
    throw new Error('LATE_API_KEY not set — required for publishing');
  }

  const history = await ledger.posts.all();
  const pool = loadTopicPool();
  const topic = process.env.TOPIC?.trim() || selectTopic(pool, history);

  const stats = summarise(pool, history).find((entry) => entry.topic === topic);
  console.log(`📋 Topic: "${topic}"`);
  console.log(
    `   used ${stats?.timesUsed ?? 0}x` +
      (stats?.meanEngagement !== undefined
        ? `, mean engagement ${stats.meanEngagement.toFixed(2)}`
        : ', no engagement data yet'),
  );
  console.log(`   mode: ${mode}\n`);

  console.log('⏳ Generating...\n');
  const post = await generateForTopic(topic);

  for (const platform of Object.keys(PLATFORM_LABELS) as Platform[]) {
    const text = post.drafts[platform];
    if (text) console.log(`${PLATFORM_LABELS[platform]}: ${text.slice(0, 120)}... (${text.length} chars)`);
  }
  console.log('');

  if (mode === 'draft') {
    console.log(`📥 Saved as ${post.id}, awaiting review.`);
    console.log("   Run 'npm run review' to approve and publish.");
    return;
  }

  await ledger.recordReview(
    post.id,
    { decision: 'accepted', reviewedAt: new Date().toISOString() },
    { ...post.drafts },
  );

  const approved = (await ledger.posts.get(post.id))!;
  const scheduledFor = mode === 'schedule' ? nextSlot() : undefined;

  if (scheduledFor) {
    console.log(`📅 Scheduling for ${scheduledFor.toISOString()} (${TIMEZONE} local slot)`);
  } else {
    console.log('🚀 Publishing now...');
  }

  const publications = await publishRecord(approved, { scheduledFor });
  describePublications(publications);

  if (publications.every((publication) => publication.status === 'failed')) {
    throw new Error('Every platform failed to publish');
  }

  console.log('\n🎉 Done.');
}

main().catch((error: Error) => {
  console.error(`\n❌ Automation failed: ${error.message}`);
  process.exit(1);
});
