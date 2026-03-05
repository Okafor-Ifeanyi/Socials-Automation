# AI Content Manager 🤖

An automated content generation and publishing system that uses Claude AI to create authentic social media posts in your unique voice, then publishes them to X (Twitter) and LinkedIn.

## ✨ Features

- **Voice Cloning**: Analyzes your past posts to replicate your writing style
- **Multi-Platform**: Generates optimized content for both X and LinkedIn
- **Smart Publishing**: Post immediately or schedule for later
- **CSV Import**: Load your LinkedIn and X post history directly
- **TypeScript**: Fully typed for reliability and maintainability
- **Cost Effective**: ~$0.02 per generation using Claude API

## 📋 Prerequisites

- Node.js 18+ installed
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- Late.dev API key ([getlate.dev](https://getlate.dev))
- Your X and LinkedIn accounts connected to Late.dev

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:
```bash
# Anthropic API (for content generation)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Late.dev API (for publishing)
LATE_API_KEY=sk_your_late_key_here
LATE_TWITTER_ACCOUNT_ID=your_twitter_account_id
LATE_LINKEDIN_ACCOUNT_ID=your_linkedin_account_id
```

**Getting your Late.dev Account IDs:**
```bash
npm run get-accounts
```

This will display your connected accounts and their IDs.

### 3. Add Your Post History

Export your posts from LinkedIn and X, then place them in:
- `src/linkedInPosts.csv` - Your LinkedIn post history
- `src/xPosts.csv` - Your X/Twitter post history

**How to export from LinkedIn:**
1. Go to Settings → Data Privacy → Get a copy of your data
2. Select "Posts" and download
3. Rename to `linkedInPosts.csv`

**How to export from X:**
1. Go to Settings → Your Account → Download archive
2. Extract `tweets.csv` or manually copy your best tweets
3. Rename to `xPosts.csv`

### 4. Generate Your First Post
```bash
npm run generate "why developers should take breaks"
```

---

## 📖 Usage

### Basic Command Structure
```bash
npm run generate "your topic" [flags]
```

### Available Flags

| Flag | Description | Example |
|------|-------------|---------|
| None | Generate only (no publishing) | `npm run generate "code reviews"` |
| `--publish` | Generate and publish immediately | `npm run generate "AI tools" --publish` |
| `--schedule --time=<ISO_DATE>` | Schedule for a specific time | `npm run generate "productivity" --schedule --time=2026-03-10T09:00:00Z` |

### Detailed Examples

#### 1. Generate Content Only (No Publishing)
```bash
npm run generate "the importance of code reviews"
```

**Output:**
- Displays generated X and LinkedIn posts
- Saves to `generated-posts/generated-posts-<timestamp>.json`
- Does NOT publish anywhere

**Use this when:**
- You want to review content before posting
- Testing your prompt/style training
- Building a content library

---

#### 2. Generate and Publish Immediately
```bash
npm run generate "building in public as a developer" --publish
```

**Output:**
- Generates content
- Posts to X immediately
- Posts to LinkedIn immediately
- Returns post IDs and URLs

**Use this when:**
- You trust your style training
- You want instant publishing
- You're actively managing your feed

---

#### 3. Generate and Schedule for Later
```bash
npm run generate "5 debugging tips" --schedule --time=2026-03-10T09:00:00Z
```

**Output:**
- Generates content
- Schedules X post for specified time
- Schedules LinkedIn post for specified time
- Returns scheduled post IDs

**Use this when:**
- Planning content calendar
- Posting at optimal engagement times
- Maintaining consistent posting schedule

**Time format:** ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)

---

## 📂 Project Structure
```
SocialsAI/
├── src/
│   ├── content-generator.ts    # Claude API integration
│   ├── late-publisher.ts       # Late.dev publishing
│   ├── index.ts               # Main CLI entry point
│   ├── types.ts               # TypeScript interfaces
│   ├── linkedInPosts.csv      # Your LinkedIn history
│   └── xPosts.csv             # Your X/Twitter history
├── generated-posts/           # All generated content saved here
├── .env                       # API keys (DO NOT COMMIT)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎯 How It Works

### Step 1: Style Training
The system loads your past posts and analyzes:
- Your sentence structure and rhythm
- Your vocabulary and tone
- How you use punctuation and formatting
- Your narrative style and storytelling patterns

### Step 2: Content Generation
Claude generates two versions:
- **X Post**: 280 characters max, punchy and attention-grabbing
- **LinkedIn Post**: Up to 3,000 characters, long-form storytelling

### Step 3: Publishing (Optional)
Late.dev handles:
- Multi-platform posting with one API call
- Scheduling with timezone handling
- Status tracking and delivery confirmation

---

## 📊 Output Examples

### Console Output
```bash
🤖 AI Content Manager
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Topic: "the importance of code reviews"

✅ Loaded 58 example posts
⏳ Generating content with Claude...

📱 X POST:
──────────────────────────────────────────────────
Code reviews aren't about finding bugs.
They're about spreading knowledge.
The real value? Junior devs learn from seniors.
Seniors stay humble. Everyone writes better code.
(176 characters)

💼 LINKEDIN POST:
──────────────────────────────────────────────────
I used to think code reviews were a waste of time...
[full post content]
(2,450 characters)

💾 Saved to: generated-posts/generated-posts-2026-03-05T10-42-35-713Z.json

🚀 Publishing posts immediately...
🐦 Posting to Twitter...
✅ Tweet posted! 69a95e1f590110394a79457d
🔗 URL: https://twitter.com/...

💼 Posting to LinkedIn...
✅ LinkedIn post published! 69a95e1f590110394a79457d
🔗 URL: https://www.linkedin.com/feed/update/...

✅ Posts published successfully!
```

### Saved JSON Format
```json
{
  "topic": "the importance of code reviews",
  "generatedAt": "2026-03-05T10:42:35.713Z",
  "posts": {
    "xPost": "Code reviews aren't about finding bugs...",
    "linkedInPost": "I used to think code reviews were..."
  }
}
```

---

## 💰 Costs

### Anthropic API (Claude)
- **Cost per generation**: ~$0.01-0.03
- **Monthly (1 post/day)**: ~$0.60-0.90
- **Yearly (1 post/day)**: ~$7-11

### Late.dev API
- Free tier: 50 posts/month
- Pro tier: Unlimited posts, $10/month

**Total monthly cost for daily posting**: ~$11

---

## 🛠️ Advanced Configuration

### Custom Generation Options

You can customize generation parameters in `src/content-generator.ts`:
```typescript
const options = {
  xMaxLength: 280,              // X character limit
  linkedInMaxLength: 3000,       // LinkedIn character limit
  tone: 'professional but conversational' // Desired tone
};

const posts = await generator.generatePosts(myPosts, topic, options);
```

### Tone Options

- `'professional but conversational'` (default)
- `'casual and authentic'`
- `'technical and detailed'`
- `'motivational and inspiring'`
- `'humorous and relatable'`

---

## 🔮 Roadmap & Future Features

### Coming Soon

#### 1. **Feedback Loop System** 🔄
```typescript
// Give feedback on generated posts to improve future content
await generator.provideFeedback(postId, {
  quality: 4/5,
  critique: "Too formal, be more casual",
  improvements: ["Add more personal anecdotes", "Shorter sentences"]
});
```

#### 2. **Learning from Critiques** 📚
- Store feedback in a database
- Use past feedback to refine prompts
- Continuously improve voice matching

#### 3. **Interactive Review Mode** ✅
```bash
npm run generate "topic" --review
```
- Review each post before publishing
- Edit content inline
- Approve or regenerate
- Learn from edits automatically

#### 4. **Performance Analytics** 📈
- Track engagement metrics per post
- Identify best-performing topics
- Suggest optimal posting times
- A/B test different styles

#### 5. **Multi-Account Support** 👥
- Manage multiple brands/personas
- Switch between voice profiles
- Cross-post to different account sets

---

## 🐛 Troubleshooting

### "ANTHROPIC_API_KEY not set"
**Solution:** Create `.env` file with your API key
```bash
echo "ANTHROPIC_API_KEY=your-key-here" > .env
```

### "LATE_API_KEY not set for publishing"
**Solution:** Add Late.dev credentials to `.env`
```bash
# Run this to see your account IDs
npm run get-accounts

# Add to .env
echo "LATE_API_KEY=your-late-key" >> .env
echo "LATE_TWITTER_ACCOUNT_ID=acc_xyz" >> .env
echo "LATE_LINKEDIN_ACCOUNT_ID=acc_abc" >> .env
```

### "Posts don't sound like me"
**Solutions:**
1. Add more example posts (aim for 50-100)
2. Include diverse examples (technical, personal, short, long)
3. Use your most representative posts, not just popular ones
4. Adjust the `tone` parameter in generation options

### "Invalid JSON in request body"
**Solution:** This is usually a Late.dev API issue. Check:
1. Your API key is valid
2. Account IDs are correct
3. You have publishing credits remaining

### "Post scheduled at wrong time"
**Solution:** Verify your ISO 8601 timestamp format:
```bash
# Correct format
--time=2026-03-10T09:00:00Z

# Wrong formats
--time=2026-03-10 09:00:00  ❌
--time=03-10-2026T09:00:00Z ❌
```

---

## 📚 API Documentation

### ContentGenerator Class
```typescript
import { ContentGenerator } from './content-generator';

const generator = new ContentGenerator(apiKey?);

// Generate both platforms
const posts = await generator.generatePosts(
  previousPosts: string[],
  topic: string,
  options?: GenerationOptions
);

// Generate X only
const xPost = await generator.generateXPost(previousPosts, topic, options);

// Generate LinkedIn only
const linkedInPost = await generator.generateLinkedInPost(previousPosts, topic, options);
```

### LatePublisher Class
```typescript
import { LatePublisher } from './late-publisher';

const publisher = new LatePublisher(apiKey?, accountIds?);

// Post to X
await publisher.postToX(text, scheduledFor?);

// Post to LinkedIn
await publisher.postToLinkedIn(text, scheduledFor?);

// Post to both (different content)
await publisher.postToBoth(xText, linkedInText, scheduledFor?);

// Get post status
const status = await publisher.getPostStatus(postId);
```

---

## 🤝 Contributing

This is a personal project, but feedback and suggestions are welcome! Open an issue or reach out on [LinkedIn](https://www.linkedin.com/in/ifeanyi-okafor-bio/) or [X](https://x.com/prog_BIO_).

---

## 📄 License

MIT License - Use however you want!

---

## 🙏 Acknowledgments

- **Claude AI** by Anthropic for content generation
- **Late.dev** for multi-platform publishing
- Built with TypeScript, Node.js, and determination

---

## 📞 Support

Having issues? Check:
1. This README's troubleshooting section
2. [Anthropic API Docs](https://docs.anthropic.com)
3. [Late.dev Documentation](https://docs.getlate.dev)
4. Open an issue in this repository

---

**Built by [Okafor Ifeanyi] | [https://linktr.ee/IfeanyiOkafor]**

*Automating content creation, one post at a time* ✨