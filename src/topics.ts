import * as fs from 'fs';
import type { Outcome, PostRecord } from './types.js';
import { numberFromEnv } from './config.js';

const TOPICS_FILE = process.env.TOPICS_FILE ?? './src/topics.json';

/** Chance of trying an untouched topic rather than revisiting a strong one. */
const EXPLORE_RATE = numberFromEnv('TOPIC_EXPLORE_RATE', 0.7);

/**
 * The topic pool is author-curated input, not runtime state.
 *
 * The old design mutated a `used` array inside this file and had the GitHub
 * Action commit it back on every run — which made two concurrent runs race on
 * a git push, and reset the whole pool the moment it was exhausted. Usage is
 * now derived from the ledger, so this file is read-only config and nothing
 * needs to be written back.
 */
export function loadTopicPool(file: string = TOPICS_FILE): string[] {
  if (!fs.existsSync(file)) {
    throw new Error(`Topics file not found: ${file}`);
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as
    | string[]
    | { topics: (string | { topic: string })[] };

  const topics = Array.isArray(parsed) ? parsed : parsed.topics;

  return topics
    .map((entry) => (typeof entry === 'string' ? entry : entry.topic))
    .filter((topic): topic is string => Boolean(topic?.trim()));
}

/** A single comparable number per post, so topics can be ranked. */
function engagementScore(outcomes: Outcome[]): number | undefined {
  const scores = outcomes
    .map((outcome) => {
      if (outcome.engagementRate !== undefined) return outcome.engagementRate;

      const interactions =
        (outcome.likes ?? 0) + (outcome.comments ?? 0) + (outcome.shares ?? 0);
      if (outcome.impressions) return (interactions / outcome.impressions) * 100;

      return interactions || undefined;
    })
    .filter((score): score is number => score !== undefined);

  if (!scores.length) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export interface TopicStats {
  topic: string;
  timesUsed: number;
  lastUsedAt?: string;
  meanEngagement?: number;
}

export function summarise(pool: string[], history: PostRecord[]): TopicStats[] {
  return pool.map((topic) => {
    const posts = history.filter((post) => post.topic === topic);
    const scored = posts
      .map((post) => engagementScore(post.outcomes))
      .filter((score): score is number => score !== undefined);

    return {
      topic,
      timesUsed: posts.length,
      lastUsedAt: posts.map((post) => post.generatedAt).sort().pop(),
      meanEngagement: scored.length
        ? scored.reduce((sum, score) => sum + score, 0) / scored.length
        : undefined,
    };
  });
}

/**
 * Choose what to write about next, weighted by what has actually worked.
 *
 * Epsilon-greedy: mostly cover untouched topics, otherwise revisit the
 * best-performing ones, with a penalty for anything used recently so a single
 * winner can't monopolise the calendar. Falls back to uniform random while
 * there is no outcome data — which is the only behaviour the old
 * `Math.random()` picker ever had.
 */
export function selectTopic(pool: string[], history: PostRecord[]): string {
  if (!pool.length) throw new Error('Topic pool is empty');

  const stats = summarise(pool, history);
  const unused = stats.filter((stat) => stat.timesUsed === 0);

  if (unused.length && Math.random() < EXPLORE_RATE) {
    return unused[Math.floor(Math.random() * unused.length)].topic;
  }

  const measured = stats.filter((stat) => stat.meanEngagement !== undefined);
  if (!measured.length) {
    const candidates = unused.length ? unused : stats;
    return candidates[Math.floor(Math.random() * candidates.length)].topic;
  }

  // Neutral prior for topics we have used but never measured — usually because
  // an analytics call failed. Ranking only measured topics excluded those from
  // selection permanently once every topic had been used at least once.
  const prior =
    measured.reduce((sum, stat) => sum + stat.meanEngagement!, 0) / measured.length;

  const now = Date.now();
  const ranked = stats
    .map((stat) => {
      const ageDays = stat.lastUsedAt
        ? (now - new Date(stat.lastUsedAt).getTime()) / 86_400_000
        : Infinity;
      // Full weight once a topic is a month old; heavily damped before then.
      const recency = Math.min(ageDays / 30, 1);
      return { topic: stat.topic, score: (stat.meanEngagement ?? prior) * recency };
    })
    .sort((a, b) => b.score - a.score);

  // Sample from the leaders rather than always taking the argmax, so selection
  // keeps some variety instead of locking onto one winner.
  const shortlist = ranked.slice(0, Math.min(3, ranked.length));
  return shortlist[Math.floor(Math.random() * shortlist.length)].topic;
}
