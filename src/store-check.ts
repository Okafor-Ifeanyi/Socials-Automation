#!/usr/bin/env node
import 'dotenv/config';
import * as ledger from './ledger.js';
import { closePool } from './db.js';
import { backendName } from './store.js';
import type { PostRecord, Publication } from './types.js';

/**
 * Exercises the storage backend against whatever DATABASE_URL points at —
 * Postgres if set, the JSON files otherwise.
 *
 * Separate from `npm test` because this one writes: it creates a scratch
 * record, hammers it, and removes it again. The concurrency case is the reason
 * it exists. Every ledger mutation appends to an array, and with a plain
 * read-then-write two appends landing together lose one — a publication that
 * happened but was never recorded, which is unmeasurable and unfixable after
 * the fact.
 */

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? '✅' : '❌'} ${name}` +
      (ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`),
  );
}

async function main(): Promise<void> {
  console.log(`backend: ${backendName()}\n`);

  const id = `zz-store-check-${Date.now()}`;
  const seed: PostRecord = {
    id,
    topic: 'store check',
    status: 'approved',
    generatedAt: new Date().toISOString(),
    voiceProfileVersion: 'test',
    model: 'test',
    drafts: { twitter: 'x', linkedin: 'li' },
    publications: [],
    outcomes: [],
  };

  try {
    await ledger.record(seed);
    check('round-trips a record', (await ledger.posts.get(id))?.topic, 'store check');

    const publication = (platform: 'twitter' | 'linkedin'): Publication[] => [
      {
        platform,
        latePostId: `late-${platform}`,
        status: 'published',
        publishedAt: new Date().toISOString(),
      },
    ];

    await Promise.all([
      ledger.recordPublications(id, publication('twitter')),
      ledger.recordPublications(id, publication('linkedin')),
    ]);

    const after = (await ledger.posts.get(id))!;
    check('concurrent appends both survive', after.publications.length, 2);
    check(
      'both platforms recorded',
      after.publications.map((entry) => entry.platform).sort(),
      ['linkedin', 'twitter'],
    );
    check('status advanced to published', after.status, 'published');

    let message = '';
    try {
      await ledger.recordReview('does-not-exist', { decision: 'accepted', reviewedAt: '' });
    } catch (error) {
      message = (error as Error).message;
    }
    check('a missing id keeps the ledger wording', message, 'No post in ledger with id does-not-exist');
  } finally {
    await ledger.posts.remove(id);
  }

  check('scratch record cleaned up', await ledger.posts.get(id), undefined);

  console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ All store checks passed');
  if (failures) process.exitCode = 1;
}

main()
  .catch((error: Error) => {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
