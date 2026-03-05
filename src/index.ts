#!/usr/bin/env node
import { ContentGenerator } from './content-generator.js';
import { LatePublisher } from './late-publisher.js';
import * as fs from 'fs';
import * as path from 'path';
import type { ILinkedIn, PostsData, SavedOutput } from './types.js';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

dotenv.config();

const POSTS_FILE = './src/linkedInPosts.csv'; // exported from linkedIn directly
const X_POSTS_FILE = './src/xPosts.csv';


function loadPreviousPosts(): string[] {
  if (!fs.existsSync(POSTS_FILE)) {
    console.error(`❌ Error: ${POSTS_FILE} not found!`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(POSTS_FILE, 'utf8');
  const records: ILinkedIn[] = parse(fileContent, {
   columns: true,          // First row = header
    skip_empty_lines: true,
    relax_quotes: true,     // Important for LinkedIn format
    relax_column_count: true,
    trim: true,
  });

   return records
    .map((record) => {
      if (!record.ShareCommentary) return null;

      // Clean LinkedIn's excessive double quotes
      return record.ShareCommentary
        .replace(/""/g, '"')   // fix escaped quotes
        .trim();
    })
    .filter(Boolean) as string[];
}

function saveGeneratedPosts(
  posts: SavedOutput['posts'],
  topic: string
): string {
  const dir = path.resolve("src/generated");
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(dir, `generated-posts-${timestamp}.json`);

  const output: SavedOutput = {
    topic,
    generatedAt: new Date().toISOString(),
    posts,
  };

  fs.writeFileSync(filename, JSON.stringify(output, null, 2));
  return filename;
}

async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv;

  const topic = args[2];
  const shouldPublish = args.includes('--publish');
  const shouldSchedule = args.includes('--schedule');
  const scheduleTime = args.find(arg => arg.startsWith('--time='))?.split('=')[1];

  if (!topic) {
    console.log('Usage: npm run generate "your topic" [--publish] [--schedule --time=2026-03-10T09:00:00Z]');
    console.log('\nOptions:');
    console.log('  --publish              Publish immediately to X and LinkedIn');
    console.log('  --schedule --time=...  Schedule for a specific time (ISO 8601 format)');
    console.log('\nExamples:');
    console.log('  npm run generate "code reviews"');
    console.log('  npm run generate "code reviews" --publish');
    console.log('  npm run generate "code reviews" --schedule --time=2026-03-10T09:00:00Z');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not set!');
    process.exit(1);
  }

  console.log('🤖 AI Content Manager');
  console.log('━'.repeat(50));
  console.log(`📋 Topic: "${topic}"`);
  console.log('');

  try {
    // Generate posts
    const previousPosts = loadPreviousPosts();
    console.log(`✅ Loaded ${previousPosts.length} example posts`);
    console.log('⏳ Generating content with Claude...\n');

    const generator = new ContentGenerator();
    const posts = await generator.generatePosts(previousPosts, topic);

    console.log('📱 X POST:');
    console.log('─'.repeat(50));
    console.log(posts.xPost);
    console.log(`(${posts.xPost.length} characters)\n`);

    console.log('💼 LINKEDIN POST:');
    console.log('─'.repeat(50));
    console.log(posts.linkedInPost);
    console.log(`(${posts.linkedInPost.length} characters)\n`);

    const filename = saveGeneratedPosts(posts, topic);
    console.log(`💾 Saved to: ${filename}\n`);

    // Publish if requested
    if (shouldPublish || shouldSchedule) {
      if (!process.env.LATE_API_KEY) {
        console.error('❌ Error: LATE_API_KEY not set for publishing!');
        process.exit(1);
      }

      const publisher = new LatePublisher();

      if (shouldSchedule && scheduleTime) {
        const scheduledDate = new Date(scheduleTime);
        console.log(`📅 Scheduling posts for ${scheduledDate.toLocaleString()}...`);
        
        // const result = await publisher.postToBoth(
        //   posts.xPost,
        //   posts.linkedInPost,
        //   scheduledDate
        // );

        // console.log('✅ Posts scheduled successfully!');
        // console.log(`   X Post ID: ${result.x.id}`);
        // console.log(`   LinkedIn Post ID: ${result.linkedin.id}`);
      } else if (shouldPublish) {
        console.log('🚀 Publishing posts immediately...');
        
        // const result = await publisher.postToBoth(
        //   posts.xPost,
        //   posts.linkedInPost
        // );

        // console.log('✅ Posts published successfully!');
        // console.log(`   X Post ID: ${result.x.id}`);
        // console.log(`   LinkedIn Post ID: ${result.linkedin.id}`);
      }
    } else {
      console.log('💡 Tip: Add --publish to post immediately, or --schedule --time=... to schedule');
    }

  } catch (error) {
    console.error('❌ Failed:', (error as Error).message);
    process.exit(1);
  }
}

main();