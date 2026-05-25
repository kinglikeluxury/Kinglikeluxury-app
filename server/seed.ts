/**
 * SEED SCRIPT — DEV ONLY
 * NEVER run this in production. It will be blocked automatically.
 */
import { db } from './db';
import { users, properties, projects, notificationLogs, PROPERTY_TYPES, PROPERTY_STATUS, LISTING_TYPES } from '../shared/schema';
import { assertNotProduction } from './productionGuard';

// ── HARD PRODUCTION GUARD ────────────────────────────────────────────────────
assertNotProduction('seed.ts — mass delete and insert');
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  try {
    console.log('Starting DEV seed process...');

    console.log('Clearing existing data...');
    await db.delete(notificationLogs);
    await db.delete(projects);
    await db.delete(properties);
    await db.delete(users);

    console.log('Adding test users...');
    const [admin] = await db.insert(users).values({
      username: 'admin',
      password: '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm',
      email: 'admin@kinglikeluxury.com',
      isAdmin: true,
      isVerified: true,
      authMethod: 'email'
    }).returning();

    await db.insert(users).values({
      username: 'user',
      password: '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm',
      email: 'user@example.com',
      isAdmin: false,
      isVerified: true,
      authMethod: 'email'
    });

    console.log('Adding sample properties...');

    const [apartment] = await db.insert(properties).values({
      title: 'Luxury Beachfront Apartment',
      description: 'Beautiful beachfront apartment with ocean views.',
      price: 450000,
      location: 'Batumi, Georgia',
      area: 1200,
      bedrooms: 3,
      bathrooms: 2,
      propertyType: PROPERTY_TYPES.APARTMENT,
      features: ['Ocean View', '24/7 Security', 'Swimming Pool'],
      amenities: ['Air Conditioning', 'High-Speed Internet'],
      images: [
        'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=800'
      ],
      status: PROPERTY_STATUS.APPROVED,
      ownerId: admin.id,
      locationScore: 85,
      valueScore: 75,
      amenitiesScore: 90,
      conditionScore: 88,
      investmentScore: 82,
      overallScore: 84
    }).returning();

    const [projectProp] = await db.insert(properties).values({
      title: 'Kinglike Towers - Modern Residential Complex',
      description: 'A luxury residential complex with modern architecture.',
      price: 350000,
      location: 'Batumi Center, Georgia',
      area: 2200,
      bedrooms: 2,
      bathrooms: 2,
      propertyType: PROPERTY_TYPES.PROJECT,
      features: ['24/7 Concierge', 'Infinity Pool'],
      amenities: ['Smart Home Features', 'Fitness Center'],
      images: [
        'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800'
      ],
      status: PROPERTY_STATUS.APPROVED,
      ownerId: admin.id,
      locationScore: 92,
      valueScore: 88,
      amenitiesScore: 94,
      conditionScore: 85,
      investmentScore: 90,
      overallScore: 90,
      listingType: LISTING_TYPES.VIP
    }).returning();

    await db.insert(projects).values({
      propertyId: projectProp.id,
      developer: 'Kinglike Development Group',
      completionDate: 'Q2 2025',
      projectStatus: 'Pre-Launch Sales'
    });

    console.log('DEV seed data added successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

seed().then(() => {
  console.log('Seed completed.');
  process.exit(0);
}).catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

export default seed;
