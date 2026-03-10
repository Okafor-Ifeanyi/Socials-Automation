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
    // Get profiles
    const { profiles } = await late.profiles.listProfiles();
    
    if (!profiles || !profiles.length) {
      console.log('❌ No profiles found. Create one at getlate.dev first.');
      process.exit(1);
    }

    console.log('📋 Your Profiles & Accounts:\n');

    for (const profile of profiles) {
      console.log(`Profile: ${profile.name} (ID: ${profile._id})`);
      
      // Get accounts for this profile
      const { accounts } = await late.accounts.listAccounts({ 
        profileId: profile._id 
      });

      if (accounts.length === 0) {
        console.log('  ⚠️  No accounts connected to this profile\n');
        continue;
      }

      for (const account of accounts) {
        console.log(`  ✅ ${account.platform.toUpperCase()}`);
        console.log(`     Account ID: ${account._id}`);
        console.log(`     Username: ${account.username || 'N/A'}`);
        console.log('');
      }
    }

    console.log('💡 Copy these Account IDs to your .env file:');
    console.log('');

    const twitterAccount = profiles
      .flatMap((p: any) => p.accounts || [])
      .find((a: any) => a.platform === 'twitter');
    
    const linkedinAccount = profiles
      .flatMap((p: any) => p.accounts || [])
      .find((a: any) => a.platform === 'linkedin');

    if (twitterAccount) {
      console.log(`LATE_TWITTER_ACCOUNT_ID=${twitterAccount._id}`);
    }
    if (linkedinAccount) {
      console.log(`LATE_LINKEDIN_ACCOUNT_ID=${linkedinAccount._id}`);
    }

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    process.exit(1);
  }
}

getAccounts();