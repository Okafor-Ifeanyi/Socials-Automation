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
    // Try to fetch accounts directly (no profile needed)
    console.log('📡 Fetching accounts...');
    const accountsResponse = await late.accounts.listAccounts({});
    
    console.log('✅ Successfully connected to Late.dev');
    console.log('📦 Raw response:', JSON.stringify(accountsResponse, null, 2));
    
    const accounts = accountsResponse?.accounts || accountsResponse?.data?.accounts || [];
    
    if (accounts.length === 0) {
      console.warn('\n⚠️  No accounts found. Have you connected your X and LinkedIn accounts at getlate.dev?');
    } else {
      console.log(`\n✅ Found ${accounts.length} account(s):`);
      accounts.forEach((account: any) => {
        console.log(`   - ${account.platform.toUpperCase()}: ${account.username || account.displayName || 'N/A'}`);
        console.log(`     Account ID: ${account._id}`);
      });
    }

    // Check if configured account IDs exist
    console.log('\n🔍 Checking configured account IDs...');
    
    if (process.env.LATE_TWITTER_ACCOUNT_ID) {
      const twitterExists = accounts.find((a: any) => a._id === process.env.LATE_TWITTER_ACCOUNT_ID);
      if (twitterExists) {
        console.log(`✅ Twitter Account ID valid: ${process.env.LATE_TWITTER_ACCOUNT_ID}`);
      } else {
        console.error(`❌ Twitter Account ID not found: ${process.env.LATE_TWITTER_ACCOUNT_ID}`);
        console.log('   Available Twitter accounts:', accounts.filter((a: any) => a.platform === 'twitter').map((a: any) => a._id));
      }
    } else {
      console.warn('⚠️  LATE_TWITTER_ACCOUNT_ID not set');
    }
    
    if (process.env.LATE_LINKEDIN_ACCOUNT_ID) {
      const linkedinExists = accounts.find((a: any) => a._id === process.env.LATE_LINKEDIN_ACCOUNT_ID);
      if (linkedinExists) {
        console.log(`✅ LinkedIn Account ID valid: ${process.env.LATE_LINKEDIN_ACCOUNT_ID}`);
      } else {
        console.error(`❌ LinkedIn Account ID not found: ${process.env.LATE_LINKEDIN_ACCOUNT_ID}`);
        console.log('   Available LinkedIn accounts:', accounts.filter((a: any) => a.platform === 'linkedin').map((a: any) => a._id));
      }
    } else {
      console.warn('⚠️  LATE_LINKEDIN_ACCOUNT_ID not set');
    }

    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('❌ Connection test failed:', error);
    console.error('   Error message:', (error as Error).message);
    console.error('   Error stack:', (error as Error).stack);
    process.exit(1);
  }
}

testConnection();