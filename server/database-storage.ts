import { eq, and, like, ilike, gte, lte, desc, or, isNull, sql } from "drizzle-orm";
import { db, withRetry } from "./db";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import {
  users,
  properties,
  projects,
  blogPosts,
  verificationCodes,
  type User,
  type InsertUser,
  type Property,
  type InsertProperty,
  type Project,
  type InsertProject,
  type BlogPost,
  type InsertBlogPost,
  PROPERTY_STATUS,
  PROPERTY_TYPES,
  AUTH_METHODS
} from "@shared/schema";
import { IStorage } from "./storage";

// Session store for PostgreSQL
const PostgresSessionStore = connectPg(session);

export class DatabaseStorage implements IStorage {
  sessionStore: any; // Use 'any' type for sessionStore to fix type issues

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return await withRetry(async () => {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    });
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return await withRetry(async () => {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user;
    });
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    if (!email) return undefined;
    return await withRetry(async () => {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user;
    });
  }

  async getUserByField(field: string, value: string): Promise<User | undefined> {
    if (!value) return undefined;
    
    // Using dynamic field selection based on the field name
    let query;
    switch (field) {
      case 'phoneNumber':
        query = eq(users.phoneNumber, value);
        break;
      case 'whatsappNumber':
        query = eq(users.whatsappNumber, value);
        break;
      case 'facebookId':
        query = eq(users.facebookId, value);
        break;
      default:
        throw new Error(`Invalid field: ${field}`);
    }
    
    const [user] = await db.select().from(users).where(query);
    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    // Make sure isVerified is set to false by default if not provided
    const userDataWithDefaults = {
      ...userData,
      isVerified: userData.isVerified ?? false,
    };
    
    return await withRetry(async () => {
      const [user] = await db.insert(users).values(userDataWithDefaults).returning();
      return user;
    });
  }

  // Property operations
  async getProperties(filters?: {
    type?: string;
    status?: string;
    ownerId?: number;
    location?: string;
    locationContains?: string;
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
    phoneNumber?: string;
    whatsappNumber?: string;
  }): Promise<Property[]> {
    return await withRetry(async () => {
      let query = db.select().from(properties);
      
      if (filters) {
        const conditions = [];
        
        if (filters.type) {
          conditions.push(eq(properties.propertyType, filters.type));
        }
        
        if (filters.status) {
          conditions.push(eq(properties.status, filters.status));
        }
        
        if (filters.ownerId) {
          conditions.push(eq(properties.ownerId, filters.ownerId));
        }
        
        if (filters.location) {
          conditions.push(ilike(properties.location, `%${filters.location}%`));
        }
        
        if (filters.locationContains) {
          conditions.push(ilike(properties.location, `%${filters.locationContains}%`));
        }
        
        if (filters.minPrice) {
          conditions.push(gte(properties.price, filters.minPrice));
        }
        
        if (filters.maxPrice) {
          conditions.push(lte(properties.price, filters.maxPrice));
        }
        
        if (filters.bedrooms !== undefined) {
          // Handle bedroom filtering - for studio apartments, bedrooms might be null or 0
          if (filters.bedrooms === 0) {
            conditions.push(or(eq(properties.bedrooms, 0), isNull(properties.bedrooms)));
          } else {
            conditions.push(eq(properties.bedrooms, filters.bedrooms));
          }
        }
        
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }
      }
      
      return await query.orderBy(desc(properties.createdAt));
    });
  }

  async getProperty(id: number): Promise<Property | undefined> {
    return await withRetry(async () => {
      const [property] = await db.select().from(properties).where(eq(properties.id, id));
      return property;
    });
  }

  async getPropertyWithAgent(id: number): Promise<(Property & { agent: any }) | undefined> {
    const [result] = await db
      .select({
        // Property fields
        id: properties.id,
        title: properties.title,
        description: properties.description,
        price: properties.price,
        location: properties.location,
        latitude: properties.latitude,
        longitude: properties.longitude,
        area: properties.area,
        bedrooms: properties.bedrooms,
        bathrooms: properties.bathrooms,
        floorNumber: properties.floorNumber,
        propertyType: properties.propertyType,
        images: properties.images,
        videos: properties.videos,
        features: properties.features,
        amenities: properties.amenities,
        locationScore: properties.locationScore,
        valueScore: properties.valueScore,
        amenitiesScore: properties.amenitiesScore,
        conditionScore: properties.conditionScore,
        investmentScore: properties.investmentScore,
        overallScore: properties.overallScore,
        status: properties.status,
        ownerId: properties.ownerId,
        createdAt: properties.createdAt,
        updatedAt: properties.updatedAt,
        listingType: properties.listingType,
        listingExpiresAt: properties.listingExpiresAt,
        
        // Agent fields
        agent: {
          id: users.id,
          username: users.username,
          email: users.email,
          phoneNumber: users.phoneNumber,
          whatsappNumber: users.whatsappNumber,
          authMethod: users.authMethod,
        }
      })
      .from(properties)
      .innerJoin(users, eq(properties.ownerId, users.id))
      .where(eq(properties.id, id));
    
    return result;
  }

  async getPropertyById(id: number): Promise<Property | undefined> {
    return await withRetry(async () => {
      const [property] = await db.select().from(properties).where(eq(properties.id, id));
      return property;
    });
  }

  async getPropertiesByType(propertyType: string): Promise<Property[]> {
    try {
      const result = await db.select()
        .from(properties)
        .where(eq(properties.propertyType, propertyType))
        .orderBy(desc(properties.createdAt));
      return result;
    } catch (error) {
      console.error('Error fetching properties by type:', error);
      throw error;
    }
  }

  async createProperty(propertyData: InsertProperty): Promise<Property> {
    const now = new Date();
    
    // Calculate expiration date if listing duration is provided
    let listingExpiresAt = null;
    if (propertyData.listingDuration) {
      listingExpiresAt = new Date();
      listingExpiresAt.setDate(now.getDate() + propertyData.listingDuration);
    }
    
    const propertyToInsert = {
      ...propertyData,
      status: propertyData.propertyType === PROPERTY_TYPES.PROJECT 
        ? PROPERTY_STATUS.APPROVED 
        : PROPERTY_STATUS.PENDING,
      listingExpiresAt,
    };
    
    return await withRetry(async () => {
      const [property] = await db.insert(properties).values(propertyToInsert).returning();
      return property;
    });
  }

  async updateProperty(id: number, propertyData: Partial<InsertProperty>): Promise<Property | undefined> {
    const [property] = await db
      .update(properties)
      .set({ 
        ...propertyData,
        updatedAt: new Date() 
      })
      .where(eq(properties.id, id))
      .returning();
      
    return property;
  }

  async updatePropertyStatus(id: number, status: string): Promise<Property | undefined> {
    const [property] = await db
      .update(properties)
      .set({ 
        status, 
        updatedAt: new Date() 
      })
      .where(eq(properties.id, id))
      .returning();
      
    return property;
  }

  async deleteProperty(id: number): Promise<boolean> {
    await db.delete(properties).where(eq(properties.id, id));
    return true; // Assuming success if no error is thrown
  }

  // Project operations
  async getProjects(): Promise<(Project & { property: Property })[]> {
    const results = await db
      .select()
      .from(projects)
      .innerJoin(properties, eq(projects.propertyId, properties.id));
      
    return results.map(({ projects, properties }) => ({
      ...projects,
      property: properties
    }));
  }

  async getProject(id: number): Promise<(Project & { property: Property }) | undefined> {
    const [result] = await db
      .select()
      .from(projects)
      .innerJoin(properties, eq(projects.propertyId, properties.id))
      .where(eq(projects.id, id));
      
    if (!result) return undefined;
    
    return {
      ...result.projects,
      property: result.properties
    };
  }

  async createProject(projectData: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(projectData).returning();
    return project;
  }
  
  // Blog post operations
  async getBlogPosts(filters?: { 
    published?: boolean;
    authorId?: number;
    category?: string;
  }): Promise<(BlogPost & { author: User })[]> {
    let query = db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id));
      
    if (filters) {
      const conditions = [];
      
      if (filters.published !== undefined) {
        conditions.push(eq(blogPosts.published, filters.published));
      }
      
      if (filters.authorId) {
        conditions.push(eq(blogPosts.authorId, filters.authorId));
      }
      
      if (filters.category) {
        // Using SQL function to check if the category exists in the array
        conditions.push(sql`${blogPosts.categories}::text LIKE ${'%' + filters.category + '%'}`);
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }
    
    const results = await query.orderBy(desc(blogPosts.createdAt));
    
    return results.map(({ blog_posts, users }) => ({
      ...blog_posts,
      author: users
    }));
  }
  
  async getBlogPostById(id: number): Promise<(BlogPost & { author: User }) | undefined> {
    const [result] = await db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id))
      .where(eq(blogPosts.id, id));
      
    if (!result) return undefined;
    
    return {
      ...result.blog_posts,
      author: result.users
    };
  }
  
  async getBlogPostBySlug(slug: string): Promise<(BlogPost & { author: User }) | undefined> {
    const [result] = await db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id))
      .where(eq(blogPosts.slug, slug));
      
    if (!result) return undefined;
    
    return {
      ...result.blog_posts,
      author: result.users
    };
  }
  
  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const [blogPost] = await db.insert(blogPosts).values(post).returning();
    return blogPost;
  }
  
  async updateBlogPost(id: number, post: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    const [blogPost] = await db
      .update(blogPosts)
      .set({
        ...post,
        updatedAt: new Date()
      })
      .where(eq(blogPosts.id, id))
      .returning();
      
    return blogPost;
  }
  
  async deleteBlogPost(id: number): Promise<boolean> {
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
    return true;
  }

  async createVerificationCode(phoneNumber: string, code: string, expiresAt: Date): Promise<void> {
    await db.delete(verificationCodes).where(eq(verificationCodes.phoneNumber, phoneNumber));
    await db.insert(verificationCodes).values({ phoneNumber, code, expiresAt, verified: false });
  }

  async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    const [record] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phoneNumber, phoneNumber),
          eq(verificationCodes.code, code),
          gte(verificationCodes.expiresAt, new Date())
        )
      );
    if (!record) return false;
    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, record.id));
    return true;
  }

  async isPhoneVerified(phoneNumber: string): Promise<boolean> {
    const [record] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phoneNumber, phoneNumber),
          eq(verificationCodes.verified, true)
        )
      );
    return !!record;
  }

  // In-memory store for BOG pending payments (these are transient)
  private bogPayments: Map<string, any> = new Map();

  async createPendingBOGPayment(data: {
    bogOrderId: string;
    shopOrderId: string;
    propertyId: number;
    userId: number;
    amount: number;
    currency: string;
    days: number;
    status: string;
  }): Promise<void> {
    this.bogPayments.set(data.bogOrderId, { ...data, createdAt: new Date() });
  }

  async completeBOGPayment(bogOrderId: string): Promise<void> {
    const record = this.bogPayments.get(bogOrderId);
    if (!record) return;
    record.status = "completed";
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + record.days);
    await db
      .update(properties)
      .set({ listingType: "vip", listingExpiresAt: expiresAt })
      .where(eq(properties.id, record.propertyId));
  }
}