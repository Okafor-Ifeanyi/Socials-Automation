#!/usr/bin/env node
import 'dotenv/config';
import * as ledger from './ledger.js';
import { publishRecord, describePublications } from './pipeline.js';
import { nextSlot } from './schedule.js';

/**
 * Send out everything approved at review but not yet published.
 *
 * Lets review happen whenever it suits and publishing happen on schedule,
 * which is what makes the approval gate practical to keep switched on.
 */
async function main(): Promise<void> {
  const scheduleFlag = process.argv.includes('--schedule');
  const queued = await ledger.approvedUnpublished();

  if (!queued.length) {
    console.log('✅ Nothing approved and waiting.');
    return;
  }

  console.log(`📤 Publishing ${queued.length} approved post(s)...\n`);
  let failures = 0;

  // Each scheduled post takes the slot after the previous one, so clearing a
  // backlog spreads it across days instead of dumping it all at once.
  let cursor = new Date();

  for (const post of queued) {
    console.log(`• ${post.topic}`);

    try {
      let scheduledFor: Date | undefined;
      if (scheduleFlag) {
        scheduledFor = nextSlot(cursor);
        cursor = scheduledFor;
      }
      const publications = await publishRecord(post, { scheduledFor });
      describePublications(publications);

      if (publications.every((publication) => publication.status === 'failed')) failures += 1;
    } catch (error) {
      console.error(`   ❌ ${(error as Error).message}`);
      failures += 1;
    }
  }

  if (failures) {
    throw new Error(`${failures} of ${queued.length} post(s) failed to publish`);
  }
}

main().catch((error: Error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
