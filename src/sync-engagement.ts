#!/usr/bin/env node
import 'dotenv/config';
import { LatePublisher } from './late-publisher.js';
import * as ledger from './ledger.js';
import { OUTCOME_DELAY_HOURS, PLATFORM_LABELS } from './config.js';
import type { Outcome } from './types.js';

/**
 * Pull engagement back from Late for posts old enough to have settled.
 *
 * This is the return leg of the loop. Until it existed the system could
 * publish indefinitely without ever learning whether anything landed.
 */
async function main(): Promise<void> {
  const due = await ledger.awaitingOutcomes();

  if (!due.length) {
    console.log(`✅ No posts older than ${OUTCOME_DELAY_HOURS}h awaiting measurement.`);
    return;
  }

  console.log(`📊 Collecting outcomes for ${due.length} post(s)...\n`);
  const publisher = new LatePublisher();
  let collected = 0;

  for (const post of due) {
    const outcomes: Outcome[] = [];

    // Only the publications actually still pending — already-measured platforms
    // are not re-fetched.
    for (const publication of ledger.pendingMeasurement(post)) {
      try {
        const outcome = await publisher.getOutcome(publication.platform, publication.latePostId!);

        if (outcome) {
          outcomes.push(outcome);
          console.log(
            `   ${PLATFORM_LABELS[publication.platform]} · ${post.topic}: ` +
              `${outcome.impressions ?? '?'} impressions, ${outcome.likes ?? '?'} likes, ` +
              `${outcome.comments ?? '?'} comments`,
          );
        }
      } catch (error) {
        // One unavailable metric must not stop the sweep — analytics lag
        // behind publication and some platforms backfill late.
        console.warn(
          `   ⚠️  ${PLATFORM_LABELS[publication.platform]} · ${post.topic}: ` +
            (error as Error).message,
        );
      }
    }

    if (outcomes.length) {
      await ledger.recordOutcomes(post.id, outcomes);
      collected += 1;
    }
  }

  console.log(`\n💾 Recorded outcomes for ${collected} of ${due.length} post(s).`);
  if (collected) {
    console.log("   Run 'npm run distill-voice -- --learn' to fold these into the voice profile.");
  }
}

main().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
