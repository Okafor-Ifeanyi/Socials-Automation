export interface GeneratedPosts {
  xPost: string;
  linkedInPost: string;
}

export interface GenerationOptions {
  xMaxLength?: number;
  linkedInMaxLength?: number;
  tone?: string;
}

export interface PostsData {
  posts: string[];
}

export interface SavedOutput {
  topic: string;
  generatedAt: string;
  posts: GeneratedPosts;
}

// NEW: Late.dev types
export interface LatePostRequest {
  text: string;
  platforms: ('twitter' | 'linkedin')[];
  scheduledFor?: string; // ISO 8601 timestamp
  mediaUrls?: string[];
}

export interface LatePostResponse {
  id: string;
  status: 'scheduled' | 'published' | 'failed';
  platforms: string[];
  scheduledFor?: string;
  publishedAt?: string;
}

export interface AccountConfig {
  twitter?: string;  // Twitter account ID
  linkedin?: string; // LinkedIn account ID
}

export interface ILinkedIn {
  Date: string;
  ShareLink: string;
  ShareCommentary: string;
  SharedUrl: string
  MediaUrl: string
  Visibility: string
}