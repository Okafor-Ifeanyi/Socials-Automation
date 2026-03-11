#!/usr/bin/env node
import { ContentGenerator } from "./content-generator";
import { LatePublisher } from "./late-publisher";
import * as fs from "fs";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";

dotenv.config();

interface TopicsData {
  topics: string[];
  used: string[];
}

const TOPICS_FILE = "./src/topics.json";
const POSTS_HISTORY_FILE = "./src/linkedInPosts.csv";

/**
 * Load and pick a random unused topic
 */
function pickTopic(): { topic: string; topicsData: TopicsData } {
  if (!fs.existsSync(TOPICS_FILE)) {
    throw new Error(`Topics file not found: ${TOPICS_FILE}`);
  }

  const topicsData: TopicsData = JSON.parse(
    fs.readFileSync(TOPICS_FILE, "utf8"),
  );

  // Get unused topics
  const unusedTopics = topicsData.topics.filter(
    (topic) => !topicsData.used.includes(topic),
  );

  // If all topics used, reset the used list
  if (unusedTopics.length === 0) {
    console.log("♻️  All topics used. Resetting topic pool...");
    topicsData.used = [];
    return pickTopic(); // Recursive call with reset data
  }

  // Pick random topic
  const randomIndex = Math.floor(Math.random() * unusedTopics.length);
  const selectedTopic = unusedTopics[randomIndex];

  return { topic: selectedTopic, topicsData };
}

/**
 * Mark topic as used
 */
function markTopicAsUsed(topic: string, topicsData: TopicsData): void {
  topicsData.used.push(topic);
  fs.writeFileSync(TOPICS_FILE, JSON.stringify(topicsData, null, 2));
}

/**
 * Load previous posts for style training
 */
function loadPreviousPosts(): string[] {
  // Use your existing CSV loading logic from index.ts
  // For now, simplified version
  if (!fs.existsSync(POSTS_HISTORY_FILE)) {
    throw new Error("Posts history file not found");
  }

  //   const { parse } = require('csv-parse/sync');
  const fileContent = fs.readFileSync(POSTS_HISTORY_FILE, "utf8");
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  return records
    .map((record: any) => {
      if (!record.ShareCommentary) return null;
      return record.ShareCommentary.replace(/""/g, '"').trim();
    })
    .filter(Boolean);
}

/**
 * Calculate next posting time (e.g., tomorrow at 9 AM)
 */
function getNextPostingTime(): Date {
  const now = new Date();
  const scheduledTime = new Date(now);

  // Schedule for next day at 9 AM UTC
  scheduledTime.setDate(scheduledTime.getDate() + 1);
  scheduledTime.setHours(9, 0, 0, 0);

  return scheduledTime;
}

/**
 * Save execution log
 */
function logExecution(
  topic: string,
  status: "success" | "failed",
  details: any,
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    topic,
    status,
    details,
  };

  const logFile = "./automation-logs.jsonl";
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
}

/**
 * Main automation function
 */
async function autoPost(): Promise<void> {
  console.log("🤖 Automated Content Poster Started");
  console.log(`📅 ${new Date().toLocaleString()}\n`);

  try {
    // Validate environment
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    if (!process.env.LATE_API_KEY) {
      throw new Error("LATE_API_KEY not set");
    }

    // Pick a topic
    const { topic, topicsData } = pickTopic();
    console.log(`📋 Selected topic: "${topic}"\n`);

    // Load style training data
    const previousPosts = loadPreviousPosts();
    console.log(
      `✅ Loaded ${previousPosts.length} example posts for training\n`,
    );

    // Generate content
    console.log("⏳ Generating content with Claude...\n");
    const generator = new ContentGenerator();
    const posts = await generator.generatePosts(previousPosts, topic);

    console.log("📱 X POST:");
    console.log("─".repeat(50));
    console.log(posts.xPost.substring(0, 100) + "...");
    console.log(`(${posts.xPost.length} characters)\n`);

    console.log("💼 LINKEDIN POST:");
    console.log("─".repeat(50));
    console.log(posts.linkedInPost.substring(0, 150) + "...");
    console.log(`(${posts.linkedInPost.length} characters)\n`);

    // Determine posting strategy
    const shouldSchedule = process.env.SCHEDULE_POSTS === "true";

    const publisher = new LatePublisher();

    if (shouldSchedule) {
      // Schedule for optimal time
      const scheduledTime = getNextPostingTime();
      console.log(
        `📅 Scheduling posts for ${scheduledTime.toLocaleString()}...\n`,
      );

      const result = await publisher.postToBoth(
        posts.xPost,
        posts.linkedInPost,
        scheduledTime,
      );

      console.log("✅ Posts scheduled successfully!");
      console.log(`   X Post ID: ${null}`);
      console.log(`   LinkedIn Post ID: ${result.linkedin._id}`);

      logExecution(topic, "success", {
        scheduled: true,
        scheduledFor: scheduledTime.toISOString(),
        xPostId: null,
        linkedInPostId: result.linkedin._id,
      });
    } else {
      // Post immediately
      console.log("🚀 Publishing posts immediately...\n");

      try {
        console.log("📝 About to call postToBoth...");
        console.log("   X post length:", posts.xPost.length);
        console.log("   LinkedIn post length:", posts.linkedInPost.length);

        // Add timeout wrapper
        const publishPromise = publisher.postToBoth(
          posts.xPost,
          posts.linkedInPost,
        );

        // Race against a 60-second timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Publishing timed out after 60 seconds")),
            60000,
          );
        });

        const result = (await Promise.race([
          publishPromise,
          timeoutPromise,
        ])) as any;

        console.log("✅ Posts published successfully!");
        console.log("   Full result:", JSON.stringify(result, null, 2));
        console.log(`   X Post ID: ${result.x?._id || "N/A"}`);
        console.log(`   LinkedIn Post ID: ${result.linkedin?._id || "N/A"}`);

        logExecution(topic, "success", {
          scheduled: false,
          xPostId: result.x?._id || null,
          linkedInPostId: result.linkedin?._id || null,
        });
      } catch (publishError) {
        console.error("\n❌ Publishing failed with error:");
        console.error("   Error type:", publishError?.constructor?.name);
        console.error("   Error message:", (publishError as Error).message);
        console.error("   Error stack:", (publishError as Error).stack);

        // Log the failure but don't exit yet
        logExecution(topic, "failed", {
          phase: "publishing",
          error: (publishError as Error).message,
          stack: (publishError as Error).stack,
        });

        throw publishError; // Re-throw to be caught by outer try-catch
      }
    }

    // Mark topic as used
    markTopicAsUsed(topic, topicsData);
    console.log("\n✅ Topic marked as used");

    console.log("\n🎉 Automation completed successfully!");
  } catch (error) {
    console.error("\n❌ Automation failed:", (error as Error).message);

    logExecution("unknown", "failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    process.exit(1);
  }
}

// Run the automation
autoPost();
