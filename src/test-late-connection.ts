#!/usr/bin/env node
import Late from '@getlatedev/node';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  console.log('🔍 Testing Late.dev connection...\n');

  if (!process.env.LATE_API_KEY) {
    console.error('❌ LATE_API_KEY not set');
    process.exit(1);
  }

  console.log('✅ API Key present:', process.env.LATE_API_KEY.substring(0, 10) + '...');

  const late = new Late({ apiKey: process.env.LATE_API_KEY });

  try {
    console.log('📡 Fetching profiles...');
    const { profiles } = await late.profiles.listProfiles();
    console.log('✅ Successfully connected to Late.dev');
    console.log(`   Found ${profiles.length} profile(s)`);

    if (profiles.length > 0) {
      console.log('\n📋 Your profiles:');
      profiles.forEach(p => {
        console.log(`   - ${p.name} (${p._id})`);
      });
    }

    console.log('\n📡 Fetching accounts...');
    const { accounts } = await late.accounts.listAccounts({
      profileId: profiles[0]?._id
    });
    console.log(`✅ Found ${accounts.length} account(s)`);

    if (process.env.LATE_TWITTER_ACCOUNT_ID) {
      console.log(`\n🐦 Twitter Account ID: ${process.env.LATE_TWITTER_ACCOUNT_ID}`);
    }
    if (process.env.LATE_LINKEDIN_ACCOUNT_ID) {
      console.log(`💼 LinkedIn Account ID: ${process.env.LATE_LINKEDIN_ACCOUNT_ID}`);
    }

    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('❌ Connection test failed:', error);
    console.error('   Error message:', (error as Error).message);
    process.exit(1);
  }
}

testConnection();