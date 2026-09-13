# AI Content Manager 🤖

Writes social posts in your own voice, publishes them to X and LinkedIn, and
learns from what actually performed — every post carries its review decision and
its real engagement back into the voice that writes the next one.

```
corpus ──▶ voice profile ──▶ draft ──▶ review ──▶ publish ──▶ engagement
              ▲                                                    │
              └──────────────── learned rules ◀────────────────────┘
```

---

## Before you start

You'll need:

- **Node.js 18 or newer** — check with `node --version`
- **An Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **A Late.dev account** — [getlate.dev](https://getlate.dev), with your X and
  LinkedIn accounts connected there
- **An export of your own posts** — this is what teaches the system your voice

---

## Step 1 — Install

```bash
git clone <your-repo-url>
cd SocialsAI
npm install
```

## Step 2 — Add your API keys

```bash
cp .env.example .env
```

Open `.env` and fill in the first two values:

```bash
ANTHROPIC_API_KEY=sk-ant-...
LATE_API_KEY=sk_...
```

Leave everything else as-is for now.

## Step 3 — Connect your social accounts

Late needs to know *which* X and LinkedIn accounts to post to. Ask it:

```bash
npm run get-accounts
```

It prints something like:

```
LATE_TWITTER_ACCOUNT_ID=699329c...
LATE_LINKEDIN_ACCOUNT_ID=69a74dcd...
```

Copy both lines into your `.env`, then confirm everything is wired up:

```bash
npm run test-late
```

You should see `✅ X: account ID valid` and `✅ LinkedIn: account ID valid`.
Fix any errors here before continuing — this check exists so you don't discover
a bad key *after* generating a post.

## Step 4 — Add your writing samples

The system learns your voice from posts you've already written. More is better;
aim for 50 or more, varied in length and subject.

**LinkedIn:** Settings → Data Privacy → Get a copy of your data → select
**Posts** → download. Save the CSV as `src/linkedInPosts.csv`.

**X (optional):** Settings → Your Account → Download an archive. Save it as
`src/xPosts.csv`. Any column named `text`, `tweet`, `full_text` or `content`
is picked up automatically.

> Only LinkedIn is required. If you skip X, the system still writes X posts —
> it just learns your voice from your LinkedIn writing.

## Step 5 — Build your voice profile

```bash
npm run distill-voice
```

This reads your samples once and writes `data/voice-profile.json` — a set of
specific, checkable rules about how you write. It prints them so you can see
what it learned:

```
📝 Ifeanyi writes LinkedIn build-logs: an emoji-led title-case headline, a short
   personal framing paragraph, then a numbered breakdown, a lesson, an open
   question, and a fixed identity sign-off...

Rules:
  - Open with a headline line, usually title-cased and often prefixed with 🛠️...
  - Quantify everything available: percentages, dollar or naira amounts...
```

**Read these rules.** If they don't sound like you, your samples aren't
representative — add more and run `npm run distill-voice -- --force`.

You only do this once. Every other command reuses the profile and warns you if
your samples have changed since.

---

## Writing and publishing

### Write a draft

```bash
npm run generate -- "the hidden costs of technical debt"
```

Prints both posts and saves them to the ledger as a draft. Nothing is published.

### Review your drafts

```bash
npm run review
```

Walks you through each pending draft:

```
[a]ccept  [e]dit  [r]eject  [s]kip  [q]uit >
```

- **accept** — good as written
- **edit** — opens the post in your `$EDITOR` (set one, or you'll be limited to
  single-line replacements)
- **reject** — kill it; still recorded, because knowing what you turn down is
  useful signal
- **skip** — decide later

Then it asks for an optional **critique**. This is the highest-value thing you
can give the system — a sentence like *"too formal, and the opener buries the
story"* does more for your next post than ten more samples.

Finally it asks when to publish. Pressing Enter holds the post; nothing is ever
published by default.

### Publish what you approved

```bash
npm run publish-approved              # publish now
npm run publish-approved -- --schedule  # spread across upcoming daily slots
```

### Skip the review gate

If you trust a post and want it out immediately:

```bash
npm run generate -- "shipping fast" --publish
npm run generate -- "shipping fast" --schedule
npm run generate -- "shipping fast" --time=2026-09-12T09:00:00Z
```

---

## Closing the loop

This is what makes the system improve rather than just repeat itself. Run it
every few days, or let the automation do it.

**1. Collect real numbers** for posts that have been live long enough to settle
(48 hours by default):

```bash
npm run sync-engagement
```

**2. Turn results and reviews into voice rules:**

```bash
npm run distill-voice -- --learn
```

```
📚 2 new rule(s) learned:
  - Lead with the number, not the setup — posts opening on a concrete figure
    outperformed narrative openers.
    (engagement: 4 posts, mean engagement rate 3.1 vs 1.4)
```

New rules only appear when a pattern holds across several posts, so one unusually
good or bad post can't swing your voice. Rules are capped at 25; the oldest
retire as new ones arrive.

---

## Running it on autopilot

`.github/workflows/auto-post.yml` runs the whole loop for you.

**Add these repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `LATE_API_KEY` | your Late key |
| `LATE_TWITTER_ACCOUNT_ID` | from `npm run get-accounts` |
| `LATE_LINKEDIN_ACCOUNT_ID` | from `npm run get-accounts` |

**What runs when:**

| Schedule | Job | What it does |
|---|---|---|
| Mon/Wed/Fri 09:00 UTC | `post` | Picks a topic by past performance, writes it, publishes |
| Daily 07:00 UTC | `measure` | Collects engagement, folds it into your voice profile |

**Optional repository *variables*** to change behaviour without touching code:

| Variable | Default | Effect |
|---|---|---|
| `POST_MODE` | `now` | `now`, `schedule`, or `draft` |
| `REQUIRE_APPROVAL` | `false` | `true` puts the review gate in front of your accounts |
| `POST_TIMEZONE` | `UTC` | e.g. `Africa/Lagos` |
| `POST_HOUR` | `9` | Local hour to post at |

> **Recommended:** set `REQUIRE_APPROVAL` to `true` and `POST_MODE` to `draft`.
> The automation then queues posts instead of publishing them, and you approve
> them with `npm run review`. This is also the only way the loop collects review
> signal to learn from.

You can also trigger a run by hand: **Actions → Automated Content Posting → Run
workflow**, where you can supply a specific topic or collect engagement only.

---

## Where your data lives

By default, everything is JSON files under `data/` — the ledger and your voice
profile — and the GitHub workflow commits them back to the repo so state
survives between runs.

That works for one person on one machine. It stops working as soon as two
things write at once, which is what happens the moment a web UI and the cron
job both exist. Two processes appending to the same post lose each other's
writes:

```
2 processes x 25 appends each, at the same moment
JSON files -> 26/50 survived   <- 24 publications recorded nowhere
Postgres   -> 50/50 survived
```

To switch, create a free Postgres database ([neon.tech](https://neon.tech) or
[supabase.com](https://supabase.com) both have a free tier), put its connection
string in `.env`, and copy your existing data across:

```bash
DATABASE_URL=postgres://...    # in .env
npm run migrate-db
```

That's the whole migration. Every command now reads and writes Postgres; the
schema is created on first connect. Your JSON files are left alone, so unset
`DATABASE_URL` at any point to fall back to them.

```bash
npm run migrate-db -- --verify   # compare the two, write nothing
npm run test:store               # round-trip + concurrency check on either backend
```

> Once you're on Postgres the workflow's "commit ledger" steps are dead weight —
> state no longer lives in the repo. Leave them; they simply find nothing to
> commit.

---
## Editing your topic list

`src/topics.json` is a plain list. Add or remove lines freely:

```json
{
  "topics": [
    "why code reviews matter for team growth",
    "the hidden costs of technical debt"
  ]
}
```

The system tracks usage and performance in the ledger, not in this file, so you
never need to edit it except to change what you write about. Untouched topics
get tried first; after that, selection favours what performed well.

---

## All commands

| Command | What it does |
|---|---|
| `npm run distill-voice` | Build or refresh your voice profile |
| `npm run distill-voice -- --force` | Rebuild even if samples haven't changed |
| `npm run distill-voice -- --learn` | Fold reviews and engagement into the profile |
| `npm run generate -- "topic"` | Write a draft |
| `npm run review` | Approve, edit or reject drafts |
| `npm run publish-approved` | Publish everything approved |
| `npm run auto-post` | Pick a topic and write it (what the schedule runs) |
| `npm run sync-engagement` | Pull real engagement for settled posts |
| `npm run get-accounts` | List your Late account IDs |
| `npm run test-late` | Verify the publishing path |
| `npm test` | Run the self-checks |
| `npm run test:store` | Check the storage backend, including concurrent writes |
| `npm run typecheck` | Type-check without building |
| `npm run build` | Compile to `dist/` |
| `npm run migrate` | One-time migration off the old file layout |
| `npm run migrate-db` | Copy `data/` into Postgres, then verify it matches |

---

## Settings

Everything below is optional and lives in `.env`. See `.env.example` for the
complete list.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5` | Set to `claude-sonnet-5` for cheaper runs |
| `GENERATION_EFFORT` | `medium` | Thinking depth when writing |
| `REQUIRE_APPROVAL` | `true` | Block publishing until reviewed |
| `POST_TIMEZONE` | `UTC` | IANA zone your posting hour is in |
| `POST_HOUR` | `9` | Local hour to publish at |
| `OUTCOME_DELAY_HOURS` | `48` | Settling time before reading engagement |
| `SIMILARITY_THRESHOLD` | `0.5` | Overlap above which a draft counts as a repeat |
| `TOPIC_EXPLORE_RATE` | `0.7` | Chance of trying an untouched topic |
| `MAX_LEARNED_RULES` | `25` | Cap on accumulated voice rules |
| `DATA_DIR` | `./data` | Where the ledger and voice profile live |

---

## How it's put together

```
src/
  config.ts             every tunable, in one place
  store.ts              the persistence seam: JSON files or Postgres
  db.ts                 Postgres pool, schema and transactions
  types.ts              domain model
  corpus.ts             CSV loading, fingerprinting, exemplar selection
  voice-profile.ts      distillation + learning from outcomes
  content-generator.ts  generation (cached prefix, schema-enforced output)
  dedupe.ts             similarity against what you've already written
  schedule.ts           timezone-correct posting slots
  late-publisher.ts     Late.dev, with one response-normalisation point
  ledger.ts             the system of record
  topics.ts             performance-weighted topic selection
  pipeline.ts           steps shared by the CLI and the automation
  prompt.ts             console prompting with safe defaults
  cli.ts                entrypoint wrapper: error reporting, pool cleanup
  selftest.ts           npm test
  store-check.ts        npm run test:store
  migrate-db.ts         npm run migrate-db
data/                   used only while DATABASE_URL is unset
  posts.json            the ledger: draft → review → publication → outcome
  voice-profile.json    your distilled voice
  archive/              pre-migration files, not versioned
```

---

## Costs

Your voice profile is cached between calls, so a typical post costs a few cents
on `claude-opus-5` and less on `claude-sonnet-5`. Distillation is a one-off per
change to your samples.

Check that caching is working:

```bash
DEBUG_USAGE=true npm run generate -- "a topic"
# 🔢 tokens — uncached in 70, cache write 0, cache read 5367, out 904
```

A cache read of `0` on repeated runs means something varying leaked into the
cached part of the prompt.

---

## Troubleshooting

**"No voice profile found"**
Run `npm run distill-voice`.

**"Post has not been reviewed"**
`REQUIRE_APPROVAL` is on. Run `npm run review`, or publish directly with
`--publish` / `--schedule`.

**"LATE_API_KEY not set"**
Add it to `.env`. If it's already there, check you copied the whole key.

**"account ID not found"**
Your `.env` account IDs don't match Late. Re-run `npm run get-accounts`.

**Posts don't sound like you**
Add more samples (50+, varied), run `npm run distill-voice -- --force`, and read
the printed rules. If a rule is wrong, your samples aren't representative.

**Posts repeat themselves**
Lower `SIMILARITY_THRESHOLD` in `.env`. The generator already retries once
against everything you've written.

**Engagement numbers are missing**
Some Late metrics need their analytics add-on, and platforms backfill on a
delay. `sync-engagement` records what it can and retries the rest next run.

---

## Known limits

- **Single user.** Account IDs are two environment variables, so one person =
  one fork. The storage seam is no longer the obstacle — `DATABASE_URL` moves
  state into Postgres — but nothing is scoped by owner yet.
- **Git is the database, unless you set `DATABASE_URL`.** On the file backend the
  workflow commits `data/` so state survives between runs, and a concurrency
  group serialises writes; that's a guard, not a fix. See *Where your data
  lives*.
- **Engagement depends on Late.** Metric availability varies by plan and platform.
