import { db } from './db';
import { users, properties, projects, PROPERTY_TYPES, PROPERTY_STATUS, LISTING_TYPES } from '../shared/schema';

async function seed() {
  try {
    console.log("Starting seed process...");

    // Clear existing data
    console.log("Clearing existing data...");
    await db.delete(projects);
    await db.delete(properties);
    await db.delete(users);
    
    // Add test user
    console.log("Adding test users...");
    const [admin] = await db.insert(users).values({
      username: "admin",
      password: "$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm", // password = "password"
      email: "admin@kinglikeluxury.com",
      isAdmin: true,
      isVerified: true,
      authMethod: "email"
    }).returning();
    
    const [regularUser] = await db.insert(users).values({
      username: "user",
      password: "$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm", // password = "password"
      email: "user@example.com",
      isAdmin: false,
      isVerified: true,
      authMethod: "email"
    }).returning();
    
    // Add sample properties
    console.log("Adding sample properties...");
    
    // Add an apartment
    const [apartment] = await db.insert(properties).values({
      title: "Luxury Beachfront Apartment",
      description: "This beautiful beachfront apartment offers stunning ocean views and modern amenities. Located in the heart of the city with easy access to shopping and dining.",
      price: 450000,
      location: "Batumi, Georgia",
      area: 1200,
      bedrooms: 3,
      bathrooms: 2,
      propertyType: PROPERTY_TYPES.APARTMENT,
      features: ["Ocean View", "24/7 Security", "Swimming Pool", "Fitness Center", "Parking"],
      amenities: ["Air Conditioning", "Central Heating", "High-Speed Internet", "Modern Kitchen", "Built-in Wardrobes"],
      images: [
        "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1584622781867-1c5e76b48ba9?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"
      ],
      status: PROPERTY_STATUS.APPROVED,
      ownerId: admin.id,
      // Property scores
      locationScore: 85,
      valueScore: 75,
      amenitiesScore: 90,
      conditionScore: 88,
      investmentScore: 82,
      overallScore: 84
    }).returning();
    
    // Add a villa
    const [villa] = await db.insert(properties).values({
      title: "Mediterranean-Style Luxury Villa",
      description: "Elegant villa with private garden and pool, featuring panoramic mountain views. Perfect for families seeking luxury and privacy.",
      price: 1200000,
      location: "Tbilisi Outskirts, Georgia",
      area: 3500,
      bedrooms: 5,
      bathrooms: 4,
      propertyType: PROPERTY_TYPES.VILLA,
      features: ["Private Pool", "Garden", "Panoramic Views", "Security System", "Private Parking"],
      amenities: ["Smart Home System", "Underfloor Heating", "Wine Cellar", "Home Theater", "Outdoor Kitchen"],
      images: [
        "https://images.unsplash.com/photo-1564501049412-61c2a3083791?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1576941089067-2de3c901e126?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"
      ],
      status: PROPERTY_STATUS.APPROVED,
      ownerId: admin.id,
      // Property scores
      locationScore: 78,
      valueScore: 82,
      amenitiesScore: 95,
      conditionScore: 92,
      investmentScore: 80,
      overallScore: 85
    }).returning();
    
    // Add a development project
    const [project] = await db.insert(properties).values({
      title: "Kinglike Towers - Modern Residential Complex",
      description: "A luxury residential complex with modern architecture, premium finishes, and exceptional amenities. Invest in the future of urban living.",
      price: 350000,
      location: "Batumi Center, Georgia",
      area: 2200,
      bedrooms: 2,
      bathrooms: 2,
      propertyType: PROPERTY_TYPES.PROJECT,
      features: ["24/7 Concierge", "Infinity Pool", "Sky Lounge", "Children's Play Area", "EV Charging Stations"],
      amenities: ["Floor-to-Ceiling Windows", "Smart Home Features", "Premium Fixtures", "Coworking Space", "Fitness Center"],
      images: [
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80",
        "https://images.unsplash.com/photo-1519999482648-25049ddd37b1?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"
      ],
      status: PROPERTY_STATUS.APPROVED,
      ownerId: admin.id,
      // Property scores
      locationScore: 92,
      valueScore: 88,
      amenitiesScore: 94,
      conditionScore: 85,
      investmentScore: 90,
      overallScore: 90,
      listingType: LISTING_TYPES.VIP
    }).returning();
    
    // Add project details
    await db.insert(projects).values({
      propertyId: project.id,
      developer: "Kinglike Development Group",
      completionDate: "Q2 2025",
      projectStatus: "Pre-Launch Sales"
    });
    
    console.log("Seed data added successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

// Run the seed function if this file is executed directly
if (require.main === module) {
  seed().then(() => {
    console.log("Seed completed, exiting.");
    process.exit(0);
  }).catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}

export default seed;