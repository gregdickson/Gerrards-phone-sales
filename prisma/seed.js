const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: 'car_insurance', label: 'Car Insurance', utmCampaign: 'car_insurance', sortOrder: 1 },
  { slug: 'property_insurance', label: 'Property Insurance', utmCampaign: 'property_insurance', sortOrder: 2 },
  { slug: 'business_liability', label: 'Business Liability', utmCampaign: 'business_liability', sortOrder: 3 },
  { slug: 'truck_insurance', label: 'Truck Insurance', utmCampaign: 'truck_insurance', sortOrder: 4 },
  { slug: 'plant_contents', label: 'Plant & Contents', utmCampaign: 'plant_contents', sortOrder: 5 },
  { slug: 'stock_inventory', label: 'Stock & Inventory', utmCampaign: 'stock_inventory', sortOrder: 6 },
  { slug: 'cyber_insurance', label: 'Cyber Insurance', utmCampaign: 'cyber_insurance', sortOrder: 7 },
  { slug: 'management', label: 'Management', utmCampaign: 'management', sortOrder: 8 },
  { slug: 'life_health', label: 'Life & Health', utmCampaign: 'life_health', sortOrder: 9 },
];

const LEAD_SOURCES = [
  { label: 'Phone Call', sortOrder: 1 },
  { label: 'Client Referral', sortOrder: 2 },
  { label: 'Professional Referral', sortOrder: 3 },
  { label: 'Networking Referral', sortOrder: 4 },
  { label: 'Facebook', sortOrder: 5 },
];

// Starter list of NZ commercial underwriters shown on the conversion form.
const INSURERS = [
  { label: 'NZI', sortOrder: 1 },
  { label: 'Vero', sortOrder: 2 },
  { label: 'QBE', sortOrder: 3 },
  { label: 'Ando', sortOrder: 4 },
  { label: 'AIG', sortOrder: 5 },
  { label: 'Berkshire Hathaway Specialty', sortOrder: 6 },
  { label: 'Chubb', sortOrder: 7 },
  { label: 'Delta Insurance', sortOrder: 8 },
  { label: 'Star Underwriting', sortOrder: 9 },
  { label: 'Vero Liability', sortOrder: 10 },
  { label: 'Zurich', sortOrder: 11 },
  { label: 'Other', sortOrder: 99 },
];

async function main() {
  console.log('Seeding database...');

  // Upsert insurance categories
  for (const cat of CATEGORIES) {
    await prisma.insuranceCategory.upsert({
      where: { slug: cat.slug },
      update: { label: cat.label, utmCampaign: cat.utmCampaign, sortOrder: cat.sortOrder },
      create: cat,
    });
  }
  console.log(`Seeded ${CATEGORIES.length} insurance categories`);

  // Upsert lead sources
  for (const src of LEAD_SOURCES) {
    await prisma.leadSource.upsert({
      where: { label: src.label },
      update: { sortOrder: src.sortOrder },
      create: src,
    });
  }
  console.log(`Seeded ${LEAD_SOURCES.length} lead sources`);

  // Upsert insurers (preserves admin edits to commission % on re-seed)
  for (const ins of INSURERS) {
    await prisma.insurer.upsert({
      where: { label: ins.label },
      update: { sortOrder: ins.sortOrder },
      create: ins,
    });
  }
  console.log(`Seeded ${INSURERS.length} insurers`);

  // Seed admin user if env vars provided
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminName = process.env.ADMIN_NAME;
  const adminGhlUserId = process.env.ADMIN_GHL_USER_ID;

  if (adminEmail && adminName && adminGhlUserId) {
    await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      update: { name: adminName, ghlUserId: adminGhlUserId, role: 'ADMIN' },
      create: {
        email: adminEmail.toLowerCase(),
        name: adminName,
        ghlUserId: adminGhlUserId,
        role: 'ADMIN',
      },
    });
    console.log(`Seeded admin user: ${adminEmail}`);
  } else {
    console.log('Skipping admin user seed (ADMIN_EMAIL, ADMIN_NAME, ADMIN_GHL_USER_ID not all set)');
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
