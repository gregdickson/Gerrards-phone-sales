const crypto = require('crypto');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function generateMagicLink(prisma, userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await prisma.magicLinkToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  return { token: rawToken, expiresAt };
}

async function verifyMagicLink(prisma, rawToken) {
  const tokenHash = hashToken(rawToken);

  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;
  if (!record.user.isActive) return null;

  // Mark as used
  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.user;
}

async function createSession(prisma, userId, userAgent) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      userAgent: userAgent || null,
    },
  });

  // Update last login
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });

  return session.id;
}

async function destroySession(prisma, sessionId) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

async function getSessionUser(prisma, sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive) return null;

  // Update last seen (fire and forget)
  prisma.session.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});

  return session.user;
}

module.exports = {
  generateMagicLink,
  verifyMagicLink,
  createSession,
  destroySession,
  getSessionUser,
};
