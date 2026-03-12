#!/usr/bin/env node
import Late from '@getlatedev/node';
import 'dotenv/config';

async function getAccounts() {
  if (!process.env.LATE_API_KEY) {
    console.error('❌ LATE_API_KEY not set');
    process.exit(1);
  }

  const late = new Late({ apiKey: process.env.LATE_API_KEY });

  console.log('🔍 Fetching your connected accounts...\n');

  try {
    // Fetch accounts directly (no profiles needed)
    const response = await late.accounts.listAccounts({});
    const accounts = response?.accounts || response?.data?.accounts || [];

    if (accounts.length === 0) {
      console.log('❌ No accounts found.');
      console.log('\n📝 To connect accounts:');
      console.log('1. Go to https://getlate.dev');
      console.log('2. Connect your X and LinkedIn accounts');
      console.log('3. Run this script again');
      process.exit(1);
    }

    console.log('✅ Your Connected Accounts:\n');

    for (const account of accounts) {
      console.log(`Platform: ${account.platform.toUpperCase()}`);
      console.log(`   Account ID: ${account._id}`);
      console.log(`   Username: ${account.username || account.displayName || 'N/A'}`);
      console.log(`   Status: ${account.isActive ? 'Active ✅' : 'Inactive ⚠️'}`);
      console.log('');
    }

    console.log('💡 Copy these Account IDs to your .env file:\n');

    const twitterAccount = accounts.find((a: any) => a.platform === 'twitter');
    const linkedinAccount = accounts.find((a: any) => a.platform === 'linkedin');

    if (twitterAccount) {
      console.log(`LATE_TWITTER_ACCOUNT_ID=${twitterAccount._id}`);
    } else {
      console.log('# LATE_TWITTER_ACCOUNT_ID=<not_connected>');
    }

    if (linkedinAccount) {
      console.log(`LATE_LINKEDIN_ACCOUNT_ID=${linkedinAccount._id}`);
    } else {
      console.log('# LATE_LINKEDIN_ACCOUNT_ID=<not_connected>');
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

getAccounts();