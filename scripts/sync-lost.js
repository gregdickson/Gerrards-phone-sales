// Pull lost opportunities from GHL into the conversions table.
// Usage:
//   node scripts/sync-lost.js          # incremental (since last cursor)
//   node scripts/sync-lost.js --full   # full backfill (walks all history)
const { PrismaClient } = require('@prisma/client');
const { syncLostOpportunities } = require('../src/services/lost-sync');

const prisma = new PrismaClient();

(async () => {
  const fullBackfill = process.argv.includes('--full');
  console.log(`Lost sync starting (${fullBackfill ? 'full backfill' : 'incremental'})...`);
  const result = await syncLostOpportunities(prisma, { fullBackfill, log: console.log });
  console.log('Done:', JSON.stringify(result));
})()
  .catch((e) => {
    console.error('Sync error:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
