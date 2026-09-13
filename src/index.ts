#!/usr/bin/env node
import 'dotenv/config';
import { runCli } from './cli.js';
import * as ledger from './ledger.js';
import { generateForTopic, publishRecord, describePublications } from './pipeline.js';
import { nextSlot } from './schedule.js';
import { PLATFORM_LABELS, REQUIRE_APPROVAL, TIMEZONE } from './config.js';
import type { Platform } from './types.js';

const USAGE = `Usage: npm run generate -- "your topic" [options]

Options:
  --publish              Publish immediately
  --schedule             Schedule for the next posting slot (${TIMEZONE})
  --time=<ISO_DATE>      Schedule for a specific time, e.g. 2026-09-10T09:00:00Z

Without --publish or --schedule the post is saved as a draft for 'npm run review'.`;

function parseScheduleTime(args: string[]): Date | undefined {
  const raw = args.find((arg) => arg.startsWith('--time='))?.split('=')[1];
  if (!raw) return undefined;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --time value: "${raw}". Use ISO 8601, e.g. 2026-09-10T09:00:00Z`);
  }
  if (date.getTime() <= Date.now()) {
    throw new Error(`--time is in the past: ${date.toISOString()}`);
  }

  return date;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topic = args.find((arg) => !arg.startsWith('--'));

  if (!topic) {
    console.log(USAGE);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const explicitTime = parseScheduleTime(args);
  const shouldSchedule = args.includes('--schedule') || Boolean(explicitTime);
  const shouldPublish = args.includes('--publish');

  if (shouldPublish && shouldSchedule) {
    throw new Error('Use either --publish or --schedule, not both');
  }
  if ((shouldPublish || shouldSchedule) && !process.env.LATE_API_KEY) {
    throw new Error('LATE_API_KEY not set — required for publishing');
  }

  console.log('🤖 AI Content Manager');
  console.log('━'.repeat(60));
  console.log(`📋 Topic: "${topic}"\n`);
  console.log('⏳ Generating...\n');

  const post = await generateForTopic(topic);

  for (const platform of Object.keys(PLATFORM_LABELS) as Platform[]) {
    const text = post.drafts[platform];
    if (!text) continue;

    console.log(`${PLATFORM_LABELS[platform]} (${text.length} chars)`);
    console.log('─'.repeat(60));
    console.log(text);
    console.log('');
  }

  console.log(`💾 Saved to the ledger as ${post.id}\n`);

  if (!shouldPublish && !shouldSchedule) {
    console.log("💡 Run 'npm run review' to approve and publish, or add --publish / --schedule.");
    return;
  }

  // The publishing that used to sit here was commented out, so --publish and
  // --schedule silently did nothing and exited 0.
  //
  // Asking for publication is itself the approval, but record it explicitly so
  // the ledger never contains a published post with no decision attached.
  if (REQUIRE_APPROVAL) {
    console.log('⚠️  Approving automatically — you asked to publish directly.');
  }

  await ledger.recordReview(
    post.id,
    { decision: 'accepted', reviewedAt: new Date().toISOString() },
    { ...post.drafts },
  );

  const approved = (await ledger.posts.get(post.id))!;
  const scheduledFor = shouldSchedule ? explicitTime ?? nextSlot() : undefined;

  if (scheduledFor) {
    console.log(`📅 Scheduling for ${scheduledFor.toLocaleString()} (${scheduledFor.toISOString()})`);
  } else {
    console.log('🚀 Publishing now...');
  }

  const publications = await publishRecord(approved, { scheduledFor });
  describePublications(publications);

  if (publications.every((publication) => publication.status === 'failed')) {
    throw new Error('Every platform failed to publish');
  }
}

runCli(main, '\n❌ ');
