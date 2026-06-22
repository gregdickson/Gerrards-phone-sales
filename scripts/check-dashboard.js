// Diagnostic: runs the dashboard aggregations against the live DB and prints a
// summary, so the SQL can be verified end-to-end (run via railway ssh).
const { PrismaClient } = require('@prisma/client');
const { getDashboardData } = require('../src/services/dashboard-data');

const prisma = new PrismaClient();

(async () => {
  const d = await getDashboardData(prisma);
  console.log('KPIs:', JSON.stringify(d.kpis));
  console.log('gbiByBroker:', d.gbiByBroker.length, 'rows;', d.gbiByBroker.map((b) => b.broker + '=' + b.gbi).join(', '));
  console.log('months:', d.brokerMonth.months.join(','), '| series:', d.brokerMonth.series.length);
  console.log('byType:', d.gbiByType.map((t) => t.type + ':' + t.gbi).join(' | '));
  console.log('lostByReason:', d.lostByReason.length, 'rows; top:', JSON.stringify(d.lostByReason[0]));
  console.log('lostByBroker:', d.lostByBroker.length, 'rows; top:', JSON.stringify(d.lostByBroker[0]));
  console.log('lostPerWeek pts:', d.lostPerWeek.length, '| nbPerWeek pts:', d.newBizPerWeek.length);
  console.log('gbiPerDay pts:', d.gbiPerDay.length, '| enquiriesPerDay pts:', d.enquiriesPerDay.length);
  console.log('topClients:', d.topClients.length, 'rows; top:', JSON.stringify(d.topClients[0]));
})()
  .catch((e) => { console.error('check failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
