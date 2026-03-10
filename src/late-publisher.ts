import Late from "@getlatedev/node";
import type { LatePostResponse, AccountConfig } from "./types.js";

export class LatePublisher {
  private late: Late;
  private accountIds: AccountConfig;

  constructor(apiKey?: string, accountIds?: AccountConfig) {
    const key = apiKey || process.env.LATE_API_KEY;

    if (!key) {
      throw new Error(
        "Late.dev API key is required (set LATE_API_KEY env var)",
      );
    }

    this.late = new Late({ apiKey: key });

    // Load account IDs from env or constructor
    this.accountIds = accountIds || {
      twitter: process.env.LATE_TWITTER_ACCOUNT_ID,
      linkedin: process.env.LATE_LINKEDIN_ACCOUNT_ID,
    };

    if (!this.accountIds.twitter && !this.accountIds.linkedin) {
      console.warn(
        "⚠️  No account IDs configured. Set LATE_TWITTER_ACCOUNT_ID and LATE_LINKEDIN_ACCOUNT_ID",
      );
    }
  }

  /**
   * Post to X (Twitter)
   */
  async postToX(text: string, scheduledFor?: Date): Promise<LatePostResponse> {
    if (!this.accountIds.twitter) {
      throw new Error("Twitter account ID not configured");
    }

    // Build request body conditionally
    const requestBody: any = {
      content: text,
      platforms: [{ platform: "twitter", accountId: this.accountIds.twitter }],
    };

    // Only add scheduling parameters if a time is provided
    if (scheduledFor) {
      requestBody.scheduledFor = scheduledFor.toISOString();
    } else {
      requestBody.publishNow = true;
    }

    console.log("🐦 Posting to Twitter...");

    try {
      const { post } = await this.late.posts.createPost({
        body: requestBody, // <-- ADD "body:" HERE
      });
      return post as LatePostResponse;
    } catch (error) {
      console.error("❌ Twitter posting failed:", error);
      throw error;
    }
  }

  /**
   * Post to LinkedIn
   */
  async postToLinkedIn(
    text: string,
    scheduledFor?: Date,
  ): Promise<LatePostResponse> {
    if (!this.accountIds.linkedin) {
      throw new Error("LinkedIn account ID not configured");
    }

    // Build request body conditionally
    const requestBody: any = {
      content: text,
      platforms: [
        { platform: "linkedin", accountId: this.accountIds.linkedin },
      ],
    };

    // Only add scheduling parameters if a time is provided
    if (scheduledFor) {
      requestBody.scheduledFor = scheduledFor.toISOString();
    } else {
      requestBody.publishNow = true;
    }

    console.log("💼 Posting to LinkedIn...");

    try {
      const response = await this.late.posts.createPost({
        body: requestBody,
      });

      // DEBUG: Log the full response
      if (!response || !response.data.post) {
        console.error("❌ Unexpected response structure:", response);
        throw new Error("API returned unexpected response structure");
      }

      return response.data.post as LatePostResponse;
    } catch (error) {
      console.error("❌ LinkedIn posting failed:", error);
      throw error;
    }
  }

  /**
   * Post to both X and LinkedIn simultaneously
   * Uses different content for each platform
   */
  async postToBoth(
    xText: string,
    linkedInText: string,
    scheduledFor?: Date,
  ): Promise<{ x: LatePostResponse; linkedin: LatePostResponse }> {
    const [x, linkedin] = await Promise.all([
      this.postToX(xText, scheduledFor),
      this.postToLinkedIn(linkedInText, scheduledFor),
    ]);

    return { x, linkedin };
  }

  /**
   * Post the same content to multiple platforms
   * (Not recommended - different platforms have different best practices)
   */
  async postToMultiplePlatforms(
    text: string,
    platforms: ("twitter" | "linkedin")[],
    scheduledFor?: Date,
  ): Promise<LatePostResponse> {
    const platformConfigs = platforms.map((platform) => {
      const accountId =
        platform === "twitter"
          ? this.accountIds.twitter
          : this.accountIds.linkedin;

      if (!accountId) {
        throw new Error(`${platform} account ID not configured`);
      }

      return { platform, accountId };
    });

    const requestBody: any = {
      content: text,
      platforms: platformConfigs,
    };

    if (scheduledFor) {
      requestBody.scheduledFor = scheduledFor.toISOString();
    } else {
      requestBody.publishNow = true;
    }

    const { post } = await this.late.posts.createPost({
      body: requestBody, // <-- ADD "body:" HERE
    });

    console.log("✅ Posted to multiple platforms!", post.post.id);
    return post as LatePostResponse;
  }

  /**
   * Schedule a post for a specific time
   */
  async schedulePost(
    platform: "twitter" | "linkedin",
    text: string,
    scheduledFor: Date,
  ): Promise<LatePostResponse> {
    if (platform === "twitter") {
      return this.postToX(text, scheduledFor);
    } else {
      return this.postToLinkedIn(text, scheduledFor);
    }
  }

  /**
   * Post immediately (no scheduling)
   */
  async postNow(
    platform: "twitter" | "linkedin",
    text: string,
  ): Promise<LatePostResponse> {
    if (platform === "twitter") {
      return this.postToX(text);
    } else {
      return this.postToLinkedIn(text);
    }
  }

  /**
   * Get status of a post
   */
  async getPostStatus(postId: string): Promise<LatePostResponse> {
    const { post } = await this.late.posts.getPost({ postId });
    return post as LatePostResponse;
  }

  /**
   * Get all posts
   */
  async getAllPosts(limit = 50): Promise<LatePostResponse[]> {
    const { posts } = await this.late.posts.listPosts({ query: { limit } });
    return posts as LatePostResponse[];
  }

  /**
   * Delete a scheduled post
   */
  async deletePost(postId: string): Promise<void> {
    await this.late.posts.deletePost({ postId });
    console.log("✅ Post deleted:", postId);
  }
}
