#!/usr/bin/env node
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as ledger from './ledger.js';
import { MODEL } from './config.js';
import type { PostRecord } from './types.js';

/**
 * One-time migration off the old file layout.
 *
 * State used to live in three unjoined places: src/generated/*.json,
 * automation-logs.jsonl, and a mutable `used` array in src/topics.json. This
 * moves the one genuinely published post into the ledger — where it can
 * finally be measured — and archives the rest.
 *
 * The generated/*.json files are debug output (the same draft regenerated
 * eleven times, one topic that is an accidental shell path, one hardcoded
 * sample) so they are archived rather than imported; importing them would
 * poison the dedupe corpus and topic statistics with noise.
 */

const ARCHIVE = path.join(process.env.DATA_DIR ?? './data', 'archive');

interface LegacyLogEntry {
  timestamp: string;
  topic: string;
  status: 'success' | 'failed';
  details: {
    scheduled?: boolean;
    scheduledFor?: string;
    xPostId?: string | null;
    linkedInPostId?: string | null;
  };
}

async function importPublishedPosts(logFile: string): Promise<number> {
  if (!fs.existsSync(logFile)) return 0;

  const entries = fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LegacyLogEntry)
    .filter((entry) => entry.status === 'success');

  let imported = 0;

  for (const entry of entries) {
    const id = ledger.newPostId(entry.topic, new Date(entry.timestamp));
    if (await ledger.posts.get(id)) continue;

    const publications: PostRecord['publications'] = [];

    // The X id was always null here — postToX returned the wrong response
    // shape, so those publications were never recorded and cannot be recovered.
    if (entry.details.linkedInPostId) {
      publications.push({
        platform: 'linkedin',
        latePostId: entry.details.linkedInPostId,
        status: entry.details.scheduled ? 'scheduled' : 'published',
        scheduledFor: entry.details.scheduledFor,
        publishedAt: entry.details.scheduled ? undefined : entry.timestamp,
      });
    }
    if (entry.details.xPostId) {
      publications.push({
        platform: 'twitter',
        latePostId: entry.details.xPostId,
        status: entry.details.scheduled ? 'scheduled' : 'published',
        scheduledFor: entry.details.scheduledFor,
        publishedAt: entry.details.scheduled ? undefined : entry.timestamp,
      });
    }

    if (!publications.length) continue;

    await ledger.record({
      id,
      topic: entry.topic,
      status: 'published',
      generatedAt: entry.timestamp,
      voiceProfileVersion: 'pre-migration',
      model: MODEL,
      // Text was not retained by the old pipeline for this run.
      drafts: {},
      publications,
      outcomes: [],
    });

    imported += 1;
    console.log(`   ✅ ${entry.topic} (${publications.length} publication(s))`);
  }

  return imported;
}

function archive(source: string): boolean {
  if (!fs.existsSync(source)) return false;

  fs.mkdirSync(ARCHIVE, { recursive: true });
  fs.renameSync(source, path.join(ARCHIVE, path.basename(source)));
  return true;
}

/** Strip the mutable `used` array — usage is derived from the ledger now. */
function normaliseTopics(file: string): void {
  if (!fs.existsSync(file)) return;

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    topics?: string[];
    used?: string[];
  };

  if (!parsed.topics || !('used' in parsed)) return;

  fs.writeFileSync(file, `${JSON.stringify({ topics: parsed.topics }, null, 2)}\n`);
  console.log(`   ✅ Removed the mutable "used" list from ${file}`);
}

async function main(): Promise<void> {
  console.log('📦 Migrating to the ledger\n');

  console.log('Importing published posts from automation-logs.jsonl:');
  const imported = await importPublishedPosts('./automation-logs.jsonl');
  if (!imported) console.log('   (none found)');

  console.log('\nNormalising topics:');
  normaliseTopics(process.env.TOPICS_FILE ?? './src/topics.json');

  console.log('\nArchiving legacy files:');
  if (archive('./automation-logs.jsonl')) console.log('   ✅ automation-logs.jsonl');
  if (archive('./src/generated')) console.log('   ✅ src/generated/');

  const all = await ledger.posts.all();
  console.log(`\n💾 Ledger now holds ${all.length} post(s). Legacy files kept in ${ARCHIVE}.`);
}

main().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
