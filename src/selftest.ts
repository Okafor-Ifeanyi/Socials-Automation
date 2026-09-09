#!/usr/bin/env node
import { EventEmitter } from 'events';
import type * as readline from 'readline/promises';
import * as ledger from './ledger.js';
import { selectTopic, summarise } from './topics.js';
import { numberFromEnv } from './config.js';
import { similarity, findNearestDuplicate } from './dedupe.js';
import { nextSlot } from './schedule.js';
import { ask } from './prompt.js';
import type { PostRecord } from './types.js';

/**
 * Fast checks over the pure logic — no API calls, no writes to the ledger.
 *
 * Weighted toward the paths where a mistake publishes something: prompt
 * defaults, measurement bookkeeping, and schedule arithmetic.
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

function section(title: string): void {
  console.log(`\n${title}`);
}

// ─── Prompt defaults ─────────────────────────────────────────────────────────
// A bare Enter must never resolve to an action that publishes.

/** Replays scripted answers, then closes the way a drained stdin does. */
function fakeRl(answers: string[]): readline.Interface {
  const emitter = new EventEmitter() as unknown as readline.Interface;
  let i = 0;

  (emitter as unknown as { question: (p: string) => Promise<string> }).question = () =>
    i < answers.length
      ? Promise.resolve(answers[i++])
      : new Promise<string>(() => {
          queueMicrotask(() => emitter.emit('close'));
        });

  return emitter;
}

const REVIEW = ['a', 'e', 'r', 's', 'q'];
const PUBLISH = ['n', 's', 'l'];

section('Prompt defaults');
check('Enter at publish prompt => later, not schedule', await ask(fakeRl(['']), '', PUBLISH, 'l'), 'l');
check('whitespace at publish prompt => later', await ask(fakeRl(['   ']), '', PUBLISH, 'l'), 'l');
check('closed stdin at publish prompt => later', await ask(fakeRl([]), '', PUBLISH, 'l'), 'l');
check('explicit "s" still schedules', await ask(fakeRl(['s']), '', PUBLISH, 's'), 's');
check('explicit "n" still publishes now', await ask(fakeRl(['n']), '', PUBLISH, 'l'), 'n');
check('Enter at review prompt => skip', await ask(fakeRl(['']), '', REVIEW, 's'), 's');
check('review prompt is case-insensitive', await ask(fakeRl(['A']), '', REVIEW, 's'), 'a');
check('unrecognised input re-prompts', await ask(fakeRl(['y', 'zzz', 'r']), '', REVIEW, 's'), 'r');
check('unrecognised then EOF => safe default', await ask(fakeRl(['y']), '', REVIEW, 's'), 's');

let badDefault = false;
try {
  await ask(fakeRl(['x']), '', PUBLISH, 'q');
} catch {
  badDefault = true;
}
check('a default outside the allowed set is rejected', badDefault, true);

// ─── Measurement bookkeeping ─────────────────────────────────────────────────

const settled = new Date(Date.now() - 72 * 3_600_000).toISOString();
const post = (over: Partial<PostRecord>): PostRecord => ({
  id: 'x',
  topic: 't',
  status: 'published',
  generatedAt: settled,
  voiceProfileVersion: 'v',
  model: 'm',
  drafts: {},
  publications: [],
  outcomes: [],
  ...over,
});

section('Measurement');
const partiallyMeasured = post({
  publications: [
    { platform: 'linkedin', latePostId: 'a', status: 'published', publishedAt: settled },
    { platform: 'twitter', latePostId: 'b', status: 'published', publishedAt: settled },
  ],
  outcomes: [{ platform: 'linkedin', collectedAt: settled, likes: 5 }],
});

check(
  'an unmeasured platform stays pending',
  ledger.pendingMeasurement(partiallyMeasured).map((p) => p.platform),
  ['twitter'],
);
check(
  'nothing pending once every platform reported',
  ledger.pendingMeasurement({
    ...partiallyMeasured,
    outcomes: [...partiallyMeasured.outcomes, { platform: 'twitter', collectedAt: settled, likes: 1 }],
  }).length,
  0,
);
check(
  'a failed publication is never pending',
  ledger.pendingMeasurement(post({
    publications: [{ platform: 'twitter', latePostId: null, status: 'failed' }],
  })).length,
  0,
);
check(
  'a post inside the settling window is not pending',
  ledger.pendingMeasurement(post({
    publications: [
      { platform: 'twitter', latePostId: 'c', status: 'published', publishedAt: new Date().toISOString() },
    ],
  })).length,
  0,
);

// ─── Topic selection ─────────────────────────────────────────────────────────

section('Topic selection');
const pool = ['alpha', 'beta', 'gamma'];
const history: PostRecord[] = [
  post({ id: '1', topic: 'alpha', generatedAt: '2026-01-01T00:00:00Z',
         outcomes: [{ platform: 'linkedin', collectedAt: settled, engagementRate: 9 }] }),
  // Used and published, but its analytics never came back.
  post({ id: '2', topic: 'beta', generatedAt: '2026-01-01T00:00:00Z', outcomes: [] }),
  post({ id: '3', topic: 'gamma', generatedAt: '2026-01-01T00:00:00Z',
         outcomes: [{ platform: 'linkedin', collectedAt: settled, engagementRate: 1 }] }),
];

const picks = new Set(Array.from({ length: 400 }, () => selectTopic(pool, history)));
check('a used-but-unmeasured topic stays selectable', picks.has('beta'), true);
check('every topic remains reachable', picks.size, 3);
check('usage counts are derived from the ledger', summarise(pool, history).map((s) => s.timesUsed), [1, 1, 1]);

// ─── Duplicate detection ─────────────────────────────────────────────────────

section('Duplicate detection');
const original = 'Code reviews are not about finding bugs they are about sharing knowledge across the team';
const restated = 'Code reviews arent about catching bugs. Theyre about sharing knowledge with your team';
const unrelated = 'Remote work requires a different kind of discipline than an office ever did';

check('a restatement scores as similar', similarity(original, restated) >= 0.5, true);
check('unrelated posts score apart', similarity(original, unrelated) < 0.2, true);
check('the nearest duplicate is found', findNearestDuplicate(restated, [unrelated, original]) !== undefined, true);
check('no false positive on unrelated text', findNearestDuplicate(unrelated, [original]), undefined);

// ─── Scheduling ──────────────────────────────────────────────────────────────

section('Scheduling');
const localHour = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d)) % 24;

check("today's slot is used when it is still ahead",
  nextSlot(new Date('2026-09-08T06:00:00Z'), 'UTC', 9).toISOString(), '2026-09-08T09:00:00.000Z');
check('a passed slot rolls to tomorrow',
  nextSlot(new Date('2026-09-08T12:00:00Z'), 'UTC', 9).toISOString(), '2026-09-09T09:00:00.000Z');
check('resolves the requested local hour, not the server hour',
  localHour(nextSlot(new Date('2026-09-08T06:00:00Z'), 'Asia/Tokyo', 9), 'Asia/Tokyo'), 9);
check('correct across a DST fall-back',
  localHour(nextSlot(new Date('2026-11-01T02:00:00Z'), 'America/New_York', 9), 'America/New_York'), 9);
check('correct across a DST spring-forward',
  localHour(nextSlot(new Date('2026-03-29T00:00:00Z'), 'Europe/London', 9), 'Europe/London'), 9);

// ─── Configuration ───────────────────────────────────────────────────────────

section('Configuration');
process.env.__SELFTEST_NUM = 'not-a-number';
let threw = false;
try {
  numberFromEnv('__SELFTEST_NUM', 1);
} catch {
  threw = true;
}
check('a malformed number fails loudly instead of becoming NaN', threw, true);

process.env.__SELFTEST_NUM = '';
check('an empty value falls back to the default', numberFromEnv('__SELFTEST_NUM', 42), 42);
process.env.__SELFTEST_NUM = '0';
check('zero is honoured, not treated as missing', numberFromEnv('__SELFTEST_NUM', 42), 0);
delete process.env.__SELFTEST_NUM;

console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ All checks passed');
process.exit(failures ? 1 : 0);
