import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedPosts, GenerationOptions } from "./types.js";

// My posts are generated properly, but I have insights and critiques I want to pass in to like an array so 
// The generated code continues learning from what I think

// The flow is not realistic for me, when a post is generated, I want to be able to give feedback on it, and have the next post be better based on that feedback.
// So maybe I can have a function that takes in the generated post, and then I can give feedback on it, and then it can use that feedback to generate the next post.


export class ContentGenerator {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async generatePosts(
    previousPosts: string[],
    topic: string,
    options: GenerationOptions = {},
  ): Promise<GeneratedPosts> {
    const {
      xMaxLength = 280,
      linkedInMaxLength = 3000,
      tone = "professional but conversational",
    } = options;

    // Validate inputs
    if (!previousPosts.length) {
      throw new Error(
        "At least one previous post is required for style training",
      );
    }

    if (!topic.trim()) {
      throw new Error("Topic cannot be empty");
    }

    const styleExamples = previousPosts
      .map((post, i) => `Example ${i + 1}:\n${post}`)
      .join("\n\n");

    const prompt = `You are a content generator that writes in a specific person's voice.

STYLE TRAINING - Study these examples:
${styleExamples}

YOUR TASK: Create TWO posts about "${topic}"
1. X Post (max ${xMaxLength} chars) - short and punchy
2. LinkedIn Post (max ${linkedInMaxLength} chars) - longer storytelling

Match the exact tone from examples.

CRITICAL: Return ONLY valid JSON, no markdown, no explanation, just:
{"xPost": "...", "linkedInPost": "..."}`;

    try {
      const message = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const responseText = message.content
        .filter((block) => block.type === "text")
        .map((block) => ("text" in block ? block.text : ""))
        .join("");

      console.log("🔍 Raw response:", responseText.substring(0, 200)); // Debug log

      // Remove markdown code blocks if present
      let cleanedText = responseText
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();

      // Try to extract JSON object
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("❌ Full response:", responseText); // Show full response
        throw new Error("Could not find JSON in response");
      }

      const result = JSON.parse(jsonMatch[0]) as GeneratedPosts;

      // Validate response structure
      if (!result.xPost || !result.linkedInPost) {
        throw new Error("Invalid response structure from Claude");
      }

      // Warn about character limits
      if (result.xPost.length > xMaxLength) {
        console.warn(
          `⚠️  X post is ${result.xPost.length} chars (limit: ${xMaxLength})`,
        );
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Content generation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async generateXPost(
    previousPosts: string[],
    topic: string,
    options?: GenerationOptions,
  ): Promise<string> {
    const result = await this.generatePosts(previousPosts, topic, options);
    return result.xPost;
  }

  async generateLinkedInPost(
    previousPosts: string[],
    topic: string,
    options?: GenerationOptions,
  ): Promise<string> {
    const result = await this.generatePosts(previousPosts, topic, options);
    return result.linkedInPost;
  }
}
