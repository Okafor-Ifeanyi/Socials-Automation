#!/usr/bin/env node
import 'dotenv/config';
import { Late } from '@getlatedev/node';
import { PLATFORM_LABELS } from './config.js';
import type { Platform } from './types.js';

interface Account {
  _id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
}

/**
 * Preflight check for the publishing path — run before the workflow spends a
 * generation on a run that was going to fail at the last step anyway.
 *
 * Prints identifiers and status only. It used to dump the whole raw accounts
 * response into the CI log, which is public on a public repo.
 */
async function main(): Promise<void> {
  if (!process.env.LATE_API_KEY) throw new Error('LATE_API_KEY not set');

  const late = new Late({ apiKey: process.env.LATE_API_KEY });
  const response = (await late.accounts.listAccounts({})) as {
    data?: { accounts?: Account[] };
    accounts?: Account[];
  };

  const accounts = response.data?.accounts ?? response.accounts ?? [];

  if (!accounts.length) {
    throw new Error('No accounts connected. Connect X and LinkedIn at getlate.dev first.');
  }

  console.log(`✅ Connected to Late — ${accounts.length} account(s):`);
  for (const account of accounts) {
    const name = account.username ?? account.displayName ?? 'unnamed';
    console.log(
      `   ${account.platform ?? 'unknown'}: ${name} ${account.isActive ? '(active)' : '(inactive)'}`,
    );
  }

  const configured: [Platform, string | undefined][] = [
    ['twitter', process.env.LATE_TWITTER_ACCOUNT_ID],
    ['linkedin', process.env.LATE_LINKEDIN_ACCOUNT_ID],
  ];

  let problems = 0;

  for (const [platform, accountId] of configured) {
    const label = PLATFORM_LABELS[platform];

    if (!accountId) {
      console.warn(`⚠️  ${label}: no account ID configured — this platform will be skipped`);
      continue;
    }

    if (accounts.some((account) => account._id === accountId)) {
      console.log(`✅ ${label}: account ID valid`);
    } else {
      const available = accounts
        .filter((account) => account.platform === platform)
        .map((account) => account._id)
        .join(', ');
      console.error(
        `❌ ${label}: configured ID not found. Available for ${platform}: ${available || 'none'}`,
      );
      problems += 1;
    }
  }

  if (problems) {
    throw new Error(`${problems} account ID(s) misconfigured — run 'npm run get-accounts'`);
  }
}

main().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
