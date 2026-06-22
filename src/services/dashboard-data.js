// Aggregations powering the Gerrards performance dashboard. Reads the three
// data layers: broker_earnings (CBN money ledger), conversions (won form + GHL
// lost), and submissions (phone/referral enquiries). Counts are cast ::int and
// sums ::float in raw SQL to avoid BigInt/Decimal JSON issues.

const n = (v) => (v == null ? 0 : Number(v));

async function getDashboardData(prisma) {
  const [
    earnAgg, gbiByBrokerRows, gbiByTypeRows,
    byBrokerMonth, gbiPerDay, newBizPerWeek,
    lostByReason, lostByBroker, lostPerWeek,
    topClients, nbByBroker, enquiriesPerDay,
    lostCount, wonFormCount, enquiryCount,
  ] = await Promise.all([
    prisma.brokerEarning.aggregate({ _sum: { grossBrokerIncome: true, invoiceAmount: true, brokerFee: true } }),

    prisma.brokerEarning.groupBy({
      by: ['brokerName'], _sum: { grossBrokerIncome: true }, _count: true,
      orderBy: { _sum: { grossBrokerIncome: 'desc' } },
    }),

    prisma.brokerEarning.groupBy({
      by: ['tranType'], _sum: { grossBrokerIncome: true }, _count: true,
      orderBy: { _sum: { grossBrokerIncome: 'desc' } },
    }),

    prisma.$queryRaw`
      SELECT broker_name AS broker, to_char(date_trunc('month', tran_date), 'YYYY-MM') AS month,
             round(sum(gross_broker_income)::numeric, 0)::float AS gbi
      FROM broker_earnings GROUP BY 1, 2 ORDER BY 2, 1`,

    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', tran_date), 'YYYY-MM-DD') AS day,
             round(sum(gross_broker_income)::numeric, 0)::float AS gbi
      FROM broker_earnings GROUP BY 1 ORDER BY 1`,

    prisma.$queryRaw`
      SELECT to_char(date_trunc('week', tran_date), 'YYYY-MM-DD') AS week, count(*)::int AS n
      FROM broker_earnings WHERE tran_type = 'New Business' GROUP BY 1 ORDER BY 1`,

    prisma.$queryRaw`
      SELECT COALESCE(NULLIF(r.label, c.ghl_lost_reason_id), r.label, 'Unlabelled') AS reason, count(*)::int AS n
      FROM conversions c LEFT JOIN ghl_lost_reasons r ON r.ghl_id = c.ghl_lost_reason_id
      WHERE c.outcome = 'LOST' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,

    prisma.$queryRaw`
      SELECT COALESCE(u.name, 'Unassigned') AS broker, count(*)::int AS n
      FROM conversions c LEFT JOIN users u ON u.id = c.broker_user_id
      WHERE c.outcome = 'LOST' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,

    prisma.$queryRaw`
      SELECT to_char(date_trunc('week', lost_at), 'YYYY-MM-DD') AS week, count(*)::int AS n
      FROM conversions WHERE outcome = 'LOST' AND lost_at IS NOT NULL GROUP BY 1 ORDER BY 1`,

    prisma.$queryRaw`
      SELECT client_name AS client, round(sum(gross_broker_income)::numeric, 0)::float AS gbi
      FROM broker_earnings WHERE client_name IS NOT NULL
      GROUP BY 1 HAVING sum(gross_broker_income) > 0 ORDER BY 2 DESC LIMIT 12`,

    prisma.$queryRaw`
      SELECT broker_name AS broker, count(*)::int AS n
      FROM broker_earnings WHERE tran_type = 'New Business' GROUP BY 1 ORDER BY 2 DESC`,

    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM submissions GROUP BY 1 ORDER BY 1`,

    prisma.conversion.count({ where: { outcome: 'LOST' } }),
    prisma.conversion.count({ where: { outcome: 'WON' } }),
    prisma.submission.count(),
  ]);

  const gbiByType = gbiByTypeRows.map((r) => ({ type: r.tranType, gbi: n(r._sum.grossBrokerIncome), count: r._count }));
  const newBizGBI = (gbiByType.find((t) => t.type === 'New Business') || {}).gbi || 0;
  const renewalGBI = (gbiByType.find((t) => t.type === 'Renewal') || {}).gbi || 0;
  const cancelGBI = (gbiByType.find((t) => t.type === 'Cancellation') || {}).gbi || 0;
  const totalGBI = n(earnAgg._sum.grossBrokerIncome);

  // pivot byBrokerMonth → { months, brokers, series{broker:[per-month]} }
  const months = [...new Set(byBrokerMonth.map((r) => r.month))].sort();
  const brokers = [...new Set(byBrokerMonth.map((r) => r.broker))];
  const monthIdx = Object.fromEntries(months.map((m, i) => [m, i]));
  const brokerMonthSeries = brokers.map((b) => ({
    broker: b,
    data: months.map(() => 0),
  }));
  const seriesByBroker = Object.fromEntries(brokerMonthSeries.map((s) => [s.broker, s]));
  for (const r of byBrokerMonth) seriesByBroker[r.broker].data[monthIdx[r.month]] = n(r.gbi);

  return {
    kpis: {
      totalGBI,
      newBizGBI,
      renewalGBI,
      cancelGBI,
      grossInvoice: n(earnAgg._sum.invoiceAmount),
      brokerFee: n(earnAgg._sum.brokerFee),
      lostCount,
      wonFormCount,
      enquiryCount,
      brokerCount: gbiByBrokerRows.length,
      newBizPct: totalGBI > 0 ? Math.round((newBizGBI / (newBizGBI + renewalGBI || 1)) * 100) : 0,
    },
    gbiByBroker: gbiByBrokerRows.map((r) => ({ broker: r.brokerName, gbi: n(r._sum.grossBrokerIncome), tx: r._count })),
    gbiByType,
    brokerMonth: { months, series: brokerMonthSeries },
    gbiPerDay: gbiPerDay.map((r) => ({ day: r.day, gbi: n(r.gbi) })),
    newBizPerWeek: newBizPerWeek.map((r) => ({ week: r.week, n: r.n })),
    lostByReason: lostByReason.map((r) => ({ reason: r.reason, n: r.n })),
    lostByBroker: lostByBroker.map((r) => ({ broker: r.broker, n: r.n })),
    lostPerWeek: lostPerWeek.map((r) => ({ week: r.week, n: r.n })),
    topClients: topClients.map((r) => ({ client: r.client, gbi: n(r.gbi) })),
    nbByBroker: nbByBroker.map((r) => ({ broker: r.broker, n: r.n })),
    enquiriesPerDay: enquiriesPerDay.map((r) => ({ day: r.day, n: r.n })),
  };
}

module.exports = { getDashboardData };
