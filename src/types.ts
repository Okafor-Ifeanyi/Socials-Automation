/** Platforms we publish to. Adding one here is the only place a new channel starts. */
export type Platform = 'twitter' | 'linkedin';

/** Per-platform text. Keyed so adding a platform doesn't mean renaming fields. */
export type PlatformText = Partial<Record<Platform, string>>;

// ─── Voice profile ───────────────────────────────────────────────────────────
// The distilled, versioned representation of someone's writing voice. This is
// the asset: it replaces stuffing the raw corpus into every prompt, and it is
// what the feedback loop improves over time.

export interface VoiceProfile {
  /** Content-addressed version, so a ledger entry can name the voice that wrote it. */
  version: string;
  builtAt: string;
  /** Hash of the source corpus — lets us detect when a rebuild is warranted. */
  sourceFingerprint: string;
  sourcePostCount: number;
  model: string;

  /** Prose description of the voice, 2-4 sentences. */
  summary: string;
  /** Concrete, checkable style rules. */
  rules: string[];
  vocabulary: {
    favors: string[];
    avoids: string[];
  };
  /** Recurring post shapes, e.g. "short declarative opener, then a turn". */
  structures: string[];
  /** A small representative sample — grounding without the whole corpus. */
  exemplars: string[];

  /**
   * Rules derived from published outcomes and human review, appended over time.
   * This is the part that makes the profile improve rather than just exist.
   */
  learned: LearnedRule[];
}

export interface LearnedRule {
  rule: string;
  /** Where the rule came from, so a bad rule can be traced and removed. */
  source: 'review' | 'engagement';
  evidence: string;
  addedAt: string;
}

// ─── Post ledger ─────────────────────────────────────────────────────────────
// One record per generated post, carried from draft through review, publication
// and measured outcome. Previously this was split across generated/*.json,
// automation-logs.jsonl and topics.json, with nothing joining them.

export type ReviewDecision = 'accepted' | 'edited' | 'rejected';

export interface Review {
  decision: ReviewDecision;
  /** Free-text critique — the highest-signal training input we can capture. */
  critique?: string;
  reviewedAt: string;
}

export interface Publication {
  platform: Platform;
  /** Late's post id. Null only if the publish call failed outright. */
  latePostId: string | null;
  status: 'scheduled' | 'published' | 'failed';
  scheduledFor?: string;
  publishedAt?: string;
  error?: string;
}

export interface Outcome {
  platform: Platform;
  collectedAt: string;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  engagementRate?: number;
}

export type PostStatus =
  | 'draft'        // generated, awaiting review
  | 'approved'     // cleared for publishing
  | 'rejected'     // killed at review
  | 'published'    // sent to Late
  | 'measured';    // outcomes collected

export interface PostRecord {
  id: string;
  topic: string;
  status: PostStatus;
  generatedAt: string;
  /** Which voice profile produced this — lets us compare versions later. */
  voiceProfileVersion: string;
  model: string;

  /** What the model produced. Never mutated, so edits stay measurable. */
  drafts: PlatformText;
  /** What a human actually approved. Diffing against drafts is training signal. */
  approved?: PlatformText;

  review?: Review;
  publications: Publication[];
  outcomes: Outcome[];
}

// ─── Generation ──────────────────────────────────────────────────────────────

export interface GenerationOptions {
  xMaxLength?: number;
  linkedInMaxLength?: number;
  /** Recent post texts to steer away from, so we stop repeating ourselves. */
  avoidSimilarTo?: string[];
}

export interface GeneratedPosts {
  xPost: string;
  linkedInPost: string;
}

/** LinkedIn's data-export CSV columns. */
export interface LinkedInCsvRow {
  Date: string;
  ShareLink: string;
  ShareCommentary: string;
  SharedUrl: string;
  MediaUrl: string;
  Visibility: string;
}
