import { eq, and, like, ilike, gte, lte, asc, desc, or, isNull, sql, gte as gteOp } from "drizzle-orm";
import { db, withRetry } from "./db";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import {
  pushSubscriptions,
  InsertPushSubscription,
  PushSubscription,
  users,
  properties,
  projects,
  payments,
  blogPosts,
  verificationCodes,
  contactLogs,
  consultationTimeSlots,
  consultationBookings,
  userNotifications,
  aiConversations,
  aiMessages,
  investorProfiles,
  projectLiveCameras,
  type ProjectLiveCamera,
  type InsertProjectLiveCamera,
  crmLeads,
  crmNotes,
  crmProjects,
  crmTasks,
  type CrmLead,
  type InsertCrmLead,
  type CrmNote,
  type InsertCrmNote,
  type CrmProject,
  type InsertCrmProject,
  type CrmTask,
  type InsertCrmTask,
  type ContactLog,
  type User,
  type InsertUser,
  type Property,
  type InsertProperty,
  type Project,
  type InsertProject,
  type BlogPost,
  type InsertBlogPost,
  type ConsultationTimeSlot,
  type InsertConsultationTimeSlot,
  type ConsultationBooking,
  type InsertConsultationBooking,
  type UserNotification,
  type InsertUserNotification,
  type AiConversation,
  type AiMessage,
  type InvestorProfile,
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

  async getUserByPhone(phoneNumber: string): Promise<User | undefined> {
    if (!phoneNumber) return undefined;
    return await withRetry(async () => {
      const [user] = await db.select().from(users).where(eq(users.phoneNumber, phoneNumber));
      return user;
    });
  }

  async getAllUsers(): Promise<User[]> {
    return await withRetry(async () => {
      return await db.select().from(users).orderBy(desc(users.createdAt));
    });
  }

  async updateUserPassword(id: number, newPassword: string): Promise<User | undefined> {
    return await withRetry(async () => {
      const [updated] = await db
        .update(users)
        .set({ password: newPassword })
        .where(eq(users.id, id))
        .returning();
      return updated;
    });
  }
  async updateUser(id: number, data: Partial<User>): Promise<User | undefined> {
    return await withRetry(async () => {
      const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
      return updated;
    });
  }
  async deleteUser(id: number): Promise<void> {
    await withRetry(async () => {
      await db.delete(users).where(eq(users.id, id));
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
    includeAllTypes?: boolean;
  }): Promise<Property[]> {
    return await withRetry(async () => {
      let query = db.select().from(properties);
      
      if (filters) {
        const conditions = [];
        
        if (filters.type) {
          conditions.push(eq(properties.propertyType, filters.type));
        } else if (!filters.ownerId && !filters.includeAllTypes) {
          // Exclude off-plan projects from general listing — they have their own dedicated page
          conditions.push(sql`${properties.propertyType} != ${PROPERTY_TYPES.PROJECT}`);
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
      
      return await query.orderBy(desc(properties.topRated), desc(properties.createdAt));
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
        topRated: properties.topRated,
        isSold: properties.isSold,
        priceMax: properties.priceMax,
        readyStatus: properties.readyStatus,
        bestPrice: properties.bestPrice,
        acceptablePrice: properties.acceptablePrice,
        highPrice: properties.highPrice,
        landType: properties.landType,
        landFeatures: properties.landFeatures,
        titleEn: properties.titleEn,
        descriptionEn: properties.descriptionEn,
        paymentMethod: properties.paymentMethod,
        downPaymentPercent: properties.downPaymentPercent,
        installmentDuration: properties.installmentDuration,
        monthlyInstallment: properties.monthlyInstallment,
        remainingBalance: properties.remainingBalance,
        paymentNotes: properties.paymentNotes,
        
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
        .orderBy(desc(properties.topRated), desc(properties.createdAt));
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
    // Delete related records first to avoid foreign key constraint violations
    await db.delete(contactLogs).where(eq(contactLogs.propertyId, id));
    await db.delete(payments).where(eq(payments.propertyId, id));
    await db.delete(projects).where(eq(projects.propertyId, id));
    await db.delete(properties).where(eq(properties.id, id));
    return true;
  }

  // Project operations
  async getProjects(): Promise<(Project & { property: Property })[]> {
    const results = await db
      .select()
      .from(projects)
      .innerJoin(properties, eq(projects.propertyId, properties.id))
      .orderBy(desc(properties.topRated), desc(projects.id));
      
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

  async updateProjectByPropertyId(propertyId: number, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set(data)
      .where(eq(projects.propertyId, propertyId))
      .returning();
    return updated;
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
    const decodedSlug = decodeURIComponent(slug);
    const [result] = await db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id))
      .where(eq(blogPosts.slug, decodedSlug));
      
    if (!result) return undefined;
    
    return {
      ...result.blog_posts,
      author: result.users
    };
  }

  async getBlogPostByOldSlug(oldSlug: string): Promise<(BlogPost & { author: User }) | undefined> {
    const decodedSlug = decodeURIComponent(oldSlug);
    const [result] = await db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id))
      .where(sql`${blogPosts.oldSlugs} @> ARRAY[${decodedSlug}]::text[]`);

    if (!result) return undefined;

    return {
      ...result.blog_posts,
      author: result.users
    };
  }

  async getBlogPostByLocalizedSlug(lang: string, slug: string): Promise<(BlogPost & { author: User }) | undefined> {
    const decodedSlug = decodeURIComponent(slug);
    // Query: (translations->'lang')->>'slug' = $decodedSlug
    // lang is validated against SEO_LANGS before calling this method
    const [result] = await db
      .select()
      .from(blogPosts)
      .innerJoin(users, eq(blogPosts.authorId, users.id))
      .where(sql`(${blogPosts.translations}->${sql.raw("'" + lang.replace(/'/g, "''") + "'")})->>'slug' = ${decodedSlug}`);

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

  async createContactLog(data: {
    propertyId: number;
    contactorId?: number;
    contactorName: string;
    contactorPhone?: string;
    ownerName?: string;
    ownerPhone?: string;
    propertyTitle?: string;
  }): Promise<void> {
    await db.insert(contactLogs).values({
      propertyId: data.propertyId,
      contactorId: data.contactorId ?? null,
      contactorName: data.contactorName,
      contactorPhone: data.contactorPhone ?? null,
      ownerName: data.ownerName ?? null,
      ownerPhone: data.ownerPhone ?? null,
      propertyTitle: data.propertyTitle ?? null,
    });
  }

  async getContactLogs(): Promise<ContactLog[]> {
    return await db
      .select()
      .from(contactLogs)
      .orderBy(desc(contactLogs.createdAt));
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

  async getBOGPaymentByPropertyId(propertyId: number): Promise<{ bogOrderId: string; amount: number; status: string } | null> {
    for (const [bogOrderId, record] of this.bogPayments.entries()) {
      if (record.propertyId === propertyId && record.status === "completed") {
        return { bogOrderId, amount: record.amount, status: record.status };
      }
    }
    return null;
  }

  // ── Consultation operations ──────────────────────────────────────────────────

  async getConsultationTimeSlots(date?: string): Promise<ConsultationTimeSlot[]> {
    if (date) {
      return await db
        .select()
        .from(consultationTimeSlots)
        .where(eq(consultationTimeSlots.date, date))
        .orderBy(consultationTimeSlots.startTime);
    }
    return await db
      .select()
      .from(consultationTimeSlots)
      .orderBy(desc(consultationTimeSlots.createdAt));
  }

  async createConsultationTimeSlot(data: InsertConsultationTimeSlot): Promise<ConsultationTimeSlot> {
    const [slot] = await db.insert(consultationTimeSlots).values(data).returning();
    return slot;
  }

  async deleteConsultationTimeSlot(id: number): Promise<boolean> {
    const result = await db.delete(consultationTimeSlots).where(eq(consultationTimeSlots.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getAvailableSlotsForDate(date: string): Promise<ConsultationTimeSlot[]> {
    return await db
      .select()
      .from(consultationTimeSlots)
      .where(and(eq(consultationTimeSlots.date, date), eq(consultationTimeSlots.isAvailable, true)))
      .orderBy(consultationTimeSlots.startTime);
  }

  async toggleConsultationTimeSlot(id: number, isAvailable: boolean): Promise<ConsultationTimeSlot | undefined> {
    const [slot] = await db
      .update(consultationTimeSlots)
      .set({ isAvailable })
      .where(eq(consultationTimeSlots.id, id))
      .returning();
    return slot;
  }

  async createConsultationBooking(data: InsertConsultationBooking): Promise<ConsultationBooking> {
    const [booking] = await db
      .insert(consultationBookings)
      .values({ ...data, status: "pending" })
      .returning();
    if (data.slotId) {
      await db
        .update(consultationTimeSlots)
        .set({ isAvailable: false })
        .where(eq(consultationTimeSlots.id, data.slotId));
    }
    return booking;
  }

  async getConsultationBookings(filters?: {
    status?: string;
    country?: string;
    method?: string;
  }): Promise<ConsultationBooking[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(consultationBookings.status, filters.status));
    if (filters?.country) conditions.push(eq(consultationBookings.country, filters.country));
    if (filters?.method) conditions.push(eq(consultationBookings.consultationMethod, filters.method));

    if (conditions.length > 0) {
      return await db
        .select()
        .from(consultationBookings)
        .where(and(...conditions))
        .orderBy(desc(consultationBookings.createdAt));
    }
    return await db
      .select()
      .from(consultationBookings)
      .orderBy(desc(consultationBookings.createdAt));
  }

  async getConsultationBookingById(id: number): Promise<ConsultationBooking | undefined> {
    const [booking] = await db
      .select()
      .from(consultationBookings)
      .where(eq(consultationBookings.id, id));
    return booking;
  }

  async getUserConsultationBookings(userId: number): Promise<ConsultationBooking[]> {
    return await db
      .select()
      .from(consultationBookings)
      .where(eq(consultationBookings.userId, userId))
      .orderBy(desc(consultationBookings.createdAt));
  }

  async updateConsultationBooking(
    id: number,
    data: Partial<ConsultationBooking>
  ): Promise<ConsultationBooking | undefined> {
    const [updated] = await db
      .update(consultationBookings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(consultationBookings.id, id))
      .returning();
    return updated;
  }

  async getConsultationSlotById(id: number): Promise<ConsultationTimeSlot | undefined> {
    const [slot] = await db
      .select()
      .from(consultationTimeSlots)
      .where(eq(consultationTimeSlots.id, id));
    return slot;
  }

  // ── User Notifications ──────────────────────────────────────────────────────

  async createUserNotification(data: InsertUserNotification): Promise<UserNotification> {
    const [notif] = await db.insert(userNotifications).values(data).returning();
    console.log(`[Notification] ✓ In-app created for userId=${data.userId} type=${data.type}`);
    return notif;
  }

  async getUserNotifications(userId: number): Promise<UserNotification[]> {
    return await db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId))
      .orderBy(desc(userNotifications.createdAt));
  }

  async markNotificationRead(id: number): Promise<void> {
    await db
      .update(userNotifications)
      .set({ isRead: true })
      .where(eq(userNotifications.id, id));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db
      .update(userNotifications)
      .set({ isRead: true })
      .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db
      .select()
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));
    return result.length;
  }

  // ── Push Subscriptions ──────────────────────────────────────────────────────

  async savePushSubscription(data: InsertPushSubscription): Promise<PushSubscription> {
    // Upsert: update keys if endpoint already exists
    const [sub] = await db
      .insert(pushSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: data.p256dh, auth: data.auth, userAgent: data.userAgent },
      })
      .returning();
    console.log(`[Push] ✓ Subscription saved for userId=${data.userId}`);
    return sub;
  }

  async getPushSubscriptionsByUserId(userId: number): Promise<PushSubscription[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  async deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  // ── AI Advisor ──────────────────────────────────────────────────────────────

  async createAiConversation(userId: number, language: string): Promise<AiConversation> {
    const [conv] = await db.insert(aiConversations).values({ userId, language, status: "active", messageCount: 0 }).returning();
    return conv;
  }

  async addAiMessage(conversationId: number, role: string, content: string): Promise<AiMessage> {
    const [msg] = await db.insert(aiMessages).values({ conversationId, role, content }).returning();
    return msg;
  }

  async getAiMessages(conversationId: number): Promise<AiMessage[]> {
    return await db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(aiMessages.createdAt);
  }

  async upsertInvestorProfile(data: { conversationId: number; userId: number; [key: string]: any }): Promise<InvestorProfile> {
    const existing = await db.select().from(investorProfiles).where(eq(investorProfiles.conversationId, data.conversationId));
    if (existing.length > 0) {
      const [updated] = await db.update(investorProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(investorProfiles.conversationId, data.conversationId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(investorProfiles).values({ ...data }).returning();
      return created;
    }
  }

  async getAllInvestorProfiles(): Promise<(InvestorProfile & { username?: string; conversation?: AiMessage[] })[]> {
    const profiles = await db.select().from(investorProfiles).orderBy(desc(investorProfiles.createdAt));
    const result = await Promise.all(profiles.map(async (p) => {
      const [userRow] = await db.select({ username: users.username }).from(users).where(eq(users.id, p.userId));
      const msgs = p.conversationId ? await this.getAiMessages(p.conversationId) : [];
      return { ...p, username: userRow?.username, conversation: msgs };
    }));
    return result;
  }

  async getInvestorProfileByConversation(conversationId: number): Promise<InvestorProfile | undefined> {
    const [profile] = await db.select().from(investorProfiles).where(eq(investorProfiles.conversationId, conversationId));
    return profile;
  }

  async getLatestInvestorProfileByUser(userId: number): Promise<InvestorProfile | undefined> {
    const [profile] = await db.select().from(investorProfiles)
      .where(eq(investorProfiles.userId, userId))
      .orderBy(desc(investorProfiles.updatedAt))
      .limit(1);
    return profile;
  }

  async incrementConversationMessages(conversationId: number): Promise<void> {
    await db.update(aiConversations)
      .set({ messageCount: sql`${aiConversations.messageCount} + 1`, updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  }

  async completeConversation(conversationId: number): Promise<void> {
    await db.update(aiConversations)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  }

  async countTodayConversations(userId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await db.select().from(aiConversations)
      .where(and(eq(aiConversations.userId, userId), gte(aiConversations.createdAt, today)));
    return rows.length;
  }

  // ── Live Projects (from properties table) ────────────────────────────────
  async getLiveProjects(): Promise<Property[]> {
    return await withRetry(async () => {
      return db.select().from(properties)
        .where(and(
          eq(properties.liveEnabled as any, true),
          sql`${properties.liveEmbedUrl} IS NOT NULL`,
          sql`${properties.liveEmbedUrl} != ''`
        ))
        .orderBy(desc(properties.createdAt));
    });
  }

  // ── Live Cameras (legacy separate table) ──────────────────────────────────

  async getLiveCameras(filters?: { country?: string; city?: string; isActive?: boolean }): Promise<ProjectLiveCamera[]> {
    const conditions = [];
    if (filters?.country) conditions.push(eq(projectLiveCameras.country, filters.country));
    if (filters?.city) conditions.push(eq(projectLiveCameras.city, filters.city));
    if (filters?.isActive !== undefined) conditions.push(eq(projectLiveCameras.isActive, filters.isActive));
    const rows = conditions.length > 0
      ? await db.select().from(projectLiveCameras).where(and(...conditions)).orderBy(desc(projectLiveCameras.createdAt))
      : await db.select().from(projectLiveCameras).orderBy(desc(projectLiveCameras.createdAt));
    // Enrich with property titles
    const enriched = await Promise.all(rows.map(async cam => {
      const [prop] = await db.select({ id: properties.id, title: properties.title, location: properties.location })
        .from(properties).where(eq(properties.id, cam.propertyId));
      return { ...cam, propertyTitle: prop?.title, propertyLocation: prop?.location };
    }));
    return enriched;
  }

  async getLiveCamerasForProperty(propertyId: number): Promise<ProjectLiveCamera[]> {
    return db.select().from(projectLiveCameras)
      .where(eq(projectLiveCameras.propertyId, propertyId))
      .orderBy(projectLiveCameras.createdAt);
  }

  async createLiveCamera(data: InsertProjectLiveCamera): Promise<ProjectLiveCamera> {
    const [row] = await db.insert(projectLiveCameras).values({ ...data, updatedAt: new Date() }).returning();
    return row;
  }

  async updateLiveCamera(id: number, data: Partial<ProjectLiveCamera>): Promise<ProjectLiveCamera | undefined> {
    const [row] = await db.update(projectLiveCameras)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectLiveCameras.id, id))
      .returning();
    return row;
  }

  async deleteLiveCamera(id: number): Promise<boolean> {
    const result = await db.delete(projectLiveCameras).where(eq(projectLiveCameras.id, id)).returning();
    return result.length > 0;
  }

  // ── CRM ────────────────────────────────────────────────────────────────────
  async getCrmLeads(filters?: { search?: string; status?: string; source?: string; assignedTo?: number | null; expectedMonth?: string; contactDate?: string; sortOrder?: "newest" | "oldest"; limit?: number; offset?: number }): Promise<{ leads: (CrmLead & { assigneeName?: string | null })[]; total: number }> {
    const MAX_LIMIT = 50;
    const limit  = Math.min(filters?.limit  ?? MAX_LIMIT, MAX_LIMIT);
    const offset = filters?.offset ?? 0;

    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(crmLeads.status, filters.status));
    if (filters?.source) conditions.push(eq(crmLeads.leadSource, filters.source));
    if (filters?.assignedTo !== undefined && filters.assignedTo !== null)
      conditions.push(eq(crmLeads.assignedTo, filters.assignedTo));
    if (filters?.search) {
      const s = `%${filters.search}%`;
      conditions.push(or(
        ilike(crmLeads.fullName, s),
        ilike(crmLeads.firstName, s),
        ilike(crmLeads.lastName, s),
        ilike(crmLeads.phone, s),
        ilike(crmLeads.email, s),
      ));
    }

    // Expected Arrival Month filter
    if (filters?.expectedMonth === "not_specified") {
      conditions.push(or(
        isNull(crmLeads.expectedPurchaseMonth),
        eq(crmLeads.expectedPurchaseMonth, ""),
      ));
    } else if (filters?.expectedMonth) {
      conditions.push(eq(crmLeads.expectedPurchaseMonth, filters.expectedMonth));
    }

    // Contact Date filter — priority: lastContactAt → createdAt
    if (filters?.contactDate && filters.contactDate !== "all") {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      let start: Date | null = null;
      let end:   Date | null = null;
      switch (filters.contactDate) {
        case "today":
          start = todayStart; end = todayEnd; break;
        case "yesterday":
          start = new Date(todayStart.getTime() - 86_400_000);
          end   = new Date(todayEnd.getTime()   - 86_400_000); break;
        case "last7":
          start = new Date(todayStart.getTime() - 6 * 86_400_000);
          end   = todayEnd; break;
        case "last30":
          start = new Date(todayStart.getTime() - 29 * 86_400_000);
          end   = todayEnd; break;
        case "thisMonth":
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); break;
        case "prevMonth":
          start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); break;
      }
      if (start && end) {
        conditions.push(sql`COALESCE(${crmLeads.lastContactAt}, ${crmLeads.createdAt}) >= ${start}`);
        conditions.push(sql`COALESCE(${crmLeads.lastContactAt}, ${crmLeads.createdAt}) <= ${end}`);
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Sort: priority lastContactAt → createdAt; default newest first
    const sortExpr = filters?.sortOrder === "oldest"
      ? asc(sql`COALESCE(${crmLeads.lastContactAt}, ${crmLeads.createdAt})`)
      : desc(sql`COALESCE(${crmLeads.lastContactAt}, ${crmLeads.createdAt})`);

    // Single JOIN — no N+1 loop
    const rows = await db
      .select({ lead: crmLeads, assigneeName: users.username })
      .from(crmLeads)
      .leftJoin(users, eq(crmLeads.assignedTo, users.id))
      .where(where)
      .orderBy(sortExpr)
      .limit(limit)
      .offset(offset);

    // Total count (same WHERE, no LIMIT)
    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(crmLeads)
      .where(where);

    const leads = rows.map(r => ({ ...r.lead, assigneeName: r.assigneeName ?? null }));
    return { leads, total };
  }

  async getCrmLead(id: number): Promise<(CrmLead & { crmNotes: (CrmNote & { authorName?: string | null })[]; crmTasks: CrmTask[]; assigneeName?: string | null }) | undefined> {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id));
    if (!lead) return undefined;
    const [notes, tasks] = await Promise.all([
      db.select().from(crmNotes).where(eq(crmNotes.leadId, id)).orderBy(crmNotes.createdAt),
      db.select().from(crmTasks).where(eq(crmTasks.leadId, id)).orderBy(crmTasks.createdAt),
    ]);
    const enrichedNotes = await Promise.all(notes.map(async n => {
      if (!n.userId) return { ...n, authorName: null };
      const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, n.userId));
      return { ...n, authorName: u?.username ?? null };
    }));
    let assigneeName: string | null = null;
    if (lead.assignedTo) {
      const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, lead.assignedTo));
      assigneeName = u?.username ?? null;
    }
    return { ...lead, crmNotes: enrichedNotes, crmTasks: tasks, assigneeName };
  }

  async createCrmLead(data: InsertCrmLead): Promise<CrmLead> {
    const [row] = await db.insert(crmLeads).values({ ...data, updatedAt: new Date() }).returning();
    return row;
  }

  async updateCrmLead(id: number, data: Partial<CrmLead>): Promise<CrmLead | undefined> {
    const { id: _id, createdAt: _c, ...safe } = data as any;
    const [row] = await db.update(crmLeads)
      .set({ ...safe, updatedAt: new Date() })
      .where(eq(crmLeads.id, id))
      .returning();
    return row;
  }

  async deleteCrmLead(id: number): Promise<boolean> {
    const result = await db.delete(crmLeads).where(eq(crmLeads.id, id)).returning();
    return result.length > 0;
  }

  async addCrmNote(data: InsertCrmNote): Promise<CrmNote> {
    const [row] = await db.insert(crmNotes).values(data).returning();
    return row;
  }

  // ── CRM Projects ──────────────────────────────────────────────────────────
  async getCrmProjects(): Promise<CrmProject[]> {
    return db.select().from(crmProjects).orderBy(crmProjects.sortOrder, crmProjects.createdAt);
  }

  async createCrmProject(data: InsertCrmProject): Promise<CrmProject> {
    const [row] = await db.insert(crmProjects).values(data).returning();
    return row;
  }

  async updateCrmProject(id: number, data: Partial<CrmProject>): Promise<CrmProject | undefined> {
    const { id: _id, createdAt: _c, ...safe } = data as any;
    const [row] = await db.update(crmProjects).set(safe).where(eq(crmProjects.id, id)).returning();
    return row;
  }

  async deleteCrmProject(id: number): Promise<boolean> {
    const result = await db.delete(crmProjects).where(eq(crmProjects.id, id)).returning();
    return result.length > 0;
  }

  // ── CRM Tasks ─────────────────────────────────────────────────────────────
  async getCrmTasks(leadId: number): Promise<CrmTask[]> {
    return db.select().from(crmTasks).where(eq(crmTasks.leadId, leadId)).orderBy(crmTasks.createdAt);
  }

  async createCrmTask(data: InsertCrmTask): Promise<CrmTask> {
    const [row] = await db.insert(crmTasks).values(data).returning();
    return row;
  }

  async updateCrmTask(id: number, data: Partial<CrmTask>): Promise<CrmTask | undefined> {
    const { id: _id, createdAt: _c, leadId: _l, ...safe } = data as any;
    const [row] = await db.update(crmTasks).set(safe).where(eq(crmTasks.id, id)).returning();
    return row;
  }

  async deleteCrmTask(id: number): Promise<boolean> {
    const result = await db.delete(crmTasks).where(eq(crmTasks.id, id)).returning();
    return result.length > 0;
  }
}