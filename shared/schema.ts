import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User model
// Authentication methods
export const AUTH_METHODS = {
  EMAIL: "email",
  PHONE: "phone",
  WHATSAPP: "whatsapp",
  FACEBOOK: "facebook",
} as const;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password"), // Can be null for social logins
  email: text("email").unique(), // Can be null if using phone
  phoneNumber: text("phone_number").unique(), // For SMS verification
  whatsappNumber: text("whatsapp_number").unique(), // For WhatsApp verification
  facebookId: text("facebook_id").unique(), // For Facebook login
  authMethod: text("auth_method").notNull().default(AUTH_METHODS.EMAIL),
  isVerified: boolean("is_verified").default(false).notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users)
  .pick({
    username: true,
    password: true,
    email: true,
    phoneNumber: true,
    whatsappNumber: true,
    facebookId: true,
    authMethod: true,
    isAdmin: true,
    isVerified: true,
  })
  .extend({
    password: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phoneNumber: z.string().optional(),
    whatsappNumber: z.string().optional(),
    facebookId: z.string().optional(),
  });

// Property types
export const PROPERTY_TYPES = {
  APARTMENT: "apartment",
  VILLA: "villa",
  LAND: "land",
  COMMERCIAL: "commercial",
  PROJECT: "project",
} as const;

// Property status
export const PROPERTY_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

// VIP listing types
export const LISTING_TYPES = {
  REGULAR: "regular",
  VIP: "vip",
  SUPER_VIP: "super_vip",
} as const;

// Property model
export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  location: text("location").notNull(),
  latitude: text("latitude"), // Store latitude as text for precision
  longitude: text("longitude"), // Store longitude as text for precision
  area: text("area").notNull(), // stored as comma-separated values for range support
  bedrooms: integer("bedrooms"), // nullable for land
  bathrooms: integer("bathrooms"), // nullable for land
  floorNumber: integer("floor_number"), // for apartments
  propertyType: text("property_type").notNull(),
  images: jsonb("images").notNull().$type<string[]>(),
  videos: jsonb("videos").notNull().$type<string[]>().default([]),
  features: jsonb("features").notNull().$type<string[]>(),
  amenities: jsonb("amenities").notNull().$type<string[]>().default([]),
  // Property score metrics (0-100 scale)
  locationScore: integer("location_score").default(70),
  valueScore: integer("value_score").default(65),
  amenitiesScore: integer("amenities_score").default(60),
  conditionScore: integer("condition_score").default(75),
  investmentScore: integer("investment_score").default(68),
  overallScore: integer("overall_score").default(70),
  status: text("status").notNull().default(PROPERTY_STATUS.APPROVED),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  listingType: text("listing_type").notNull().default(LISTING_TYPES.REGULAR),
  listingExpiresAt: timestamp("listing_expires_at"),
  readyStatus: text("ready_status"),
  topRated: boolean("top_rated").default(false),
  bestPrice: boolean("best_price").default(false),
  acceptablePrice: boolean("acceptable_price").default(false),
  highPrice: boolean("high_price").default(false),
  isSold: boolean("is_sold").default(false).notNull(),
  priceMax: integer("price_max"),
  landType: text("land_type"), // "agricultural" | "non-agricultural" — only for land type
  landFeatures: jsonb("land_features").$type<string[]>().default([]), // electricity, water, etc.
  paymentMethod: text("payment_method"), // "cash" | "installments"
  downPaymentPercent: integer("down_payment_percent"), // e.g. 10, 15, 20 ... 90
  installmentDuration: text("installment_duration"), // e.g. "1-month", "6-months", "2-years"
  titleEn: text("title_en"), // Optional English title for multilingual display
  descriptionEn: text("description_en"), // Optional English description

});

export const insertPropertySchema = createInsertSchema(properties)
  .omit({
    id: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    listingExpiresAt: true,
  })
  .extend({
    propertyType: z.enum([
      PROPERTY_TYPES.APARTMENT,
      PROPERTY_TYPES.VILLA,
      PROPERTY_TYPES.LAND,
      PROPERTY_TYPES.PROJECT,
      PROPERTY_TYPES.COMMERCIAL,
    ]),
    listingType: z
      .enum([LISTING_TYPES.REGULAR, LISTING_TYPES.VIP, LISTING_TYPES.SUPER_VIP])
      .default(LISTING_TYPES.REGULAR),
    listingDuration: z.number().optional().describe("Duration in days"),
    images: z.array(z.string()),
    videos: z.array(z.string()).optional().default([]),
    features: z.array(z.string()),
    amenities: z.array(z.string()).optional().default([]),
    floorNumber: z.number().optional().nullable(),
    bedrooms: z.number().optional().nullable(),
    bathrooms: z.number().optional().nullable(),
    landType: z.string().optional().nullable(),
    landFeatures: z.array(z.string()).optional().default([]),
    paymentMethod: z.string().optional().nullable(),
    downPaymentPercent: z.number().optional().nullable(),
    installmentDuration: z.string().optional().nullable(),
  });

// Project details (for construction projects)
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  developer: text("developer").notNull(),
  completionDate: text("completion_date").notNull(), // e.g., "Q4 2024"
  projectStatus: text("project_status").notNull(), // e.g., "Now Selling", "Pre-Launch"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// Payment tracking table
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  amount: integer("amount").notNull(), // Amount in cents
  currency: text("currency").notNull().default("USD"),
  paymentMethod: text("payment_method").notNull(), // 'stripe', 'paypal'
  paymentIntentId: text("payment_intent_id"), // Stripe payment intent ID
  paypalOrderId: text("paypal_order_id"), // PayPal order ID
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'failed'
  durationDays: integer("duration_days").notNull(), // 7, 14, or 30 days
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Extended types (combining related data)
// Blog post schema
export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(),
  excerpt: text("excerpt").notNull(),
  coverImage: text("cover_image").notNull(),
  coverVideo: text("cover_video"),
  authorId: integer("author_id")
    .notNull()
    .references(() => users.id),
  categories: jsonb("categories").notNull().$type<string[]>(),
  country: text("country").notNull().default("georgia"),
  translations: jsonb("translations").$type<Record<string, { title: string; content: string; excerpt: string }>>(),
  published: boolean("published").notNull().default(true),
  oldSlugs: text("old_slugs").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;

// Contact Logs — records every WhatsApp contact click
export const contactLogs = pgTable("contact_logs", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  contactorId: integer("contactor_id").references(() => users.id),
  contactorName: text("contactor_name").notNull().default("زائر"),
  contactorPhone: text("contactor_phone"),
  ownerName: text("owner_name"),
  ownerPhone: text("owner_phone"),
  propertyTitle: text("property_title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ContactLog = typeof contactLogs.$inferSelect;

// SMS Verification Codes
export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VerificationCode = typeof verificationCodes.$inferSelect;

// ── Notification Templates ──────────────────────────────────────────────────
export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),        // 'email' | 'whatsapp'
  trigger: text("trigger").notNull(),  // 'welcome' | 'weekly_update' | 'inactive_reminder'
  subject: text("subject"),            // email subject (null for whatsapp)
  bodyHtml: text("body_html"),         // email HTML body
  bodyText: text("body_text"),         // plain-text / whatsapp body
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, updatedAt: true });
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;

// ── Notification Logs ───────────────────────────────────────────────────────
export const notificationLogs = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(),        // 'email' | 'whatsapp'
  trigger: text("trigger").notNull(),  // 'welcome' | 'weekly_update' | 'inactive_reminder'
  recipient: text("recipient"),        // email or phone
  status: text("status").notNull(),    // 'sent' | 'failed'
  error: text("error"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export type NotificationLog = typeof notificationLogs.$inferSelect;

export type PropertyWithOwner = Property & { owner: User };
export type PropertyWithAgent = Property & { 
  agent: {
    id: number;
    username: string;
    email: string | null;
    phoneNumber: string | null;
    whatsappNumber: string | null;
    authMethod: string;
  };
};
export type ProjectWithProperty = Project & { property: Property };
export type BlogPostWithAuthor = BlogPost & { author: User };

// App settings — persistent key-value store for admin config
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Consultation Feature ─────────────────────────────────────────────────────

export const CONSULTATION_COUNTRIES = {
  GEORGIA: "georgia",
  TURKEY: "turkey",
  DUBAI: "dubai",
  NORTH_CYPRUS: "north_cyprus",
} as const;

export const CONSULTATION_TYPES = {
  INVESTMENT: "investment",
  VIEWING: "viewing",
  RESIDENCY: "residency",
  INSTALLMENT: "installment",
} as const;

export const CONSULTATION_METHODS = {
  GOOGLE_MEET: "google_meet",
  ZOOM: "zoom",
  WHATSAPP_VIDEO: "whatsapp_video",
  WHATSAPP_VOICE: "whatsapp_voice",
} as const;

export const CONSULTATION_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
} as const;

export const consultationTimeSlots = pgTable("consultation_time_slots", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isAvailable: boolean("is_available").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConsultationTimeSlotSchema = createInsertSchema(consultationTimeSlots).omit({ id: true, createdAt: true });
export type ConsultationTimeSlot = typeof consultationTimeSlots.$inferSelect;
export type InsertConsultationTimeSlot = z.infer<typeof insertConsultationTimeSlotSchema>;

export const consultationBookings = pgTable("consultation_bookings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  propertyId: integer("property_id").references(() => properties.id),
  propertyTitle: text("property_title"),
  slotId: integer("slot_id").references(() => consultationTimeSlots.id),
  country: text("country").notNull(),
  consultationType: text("consultation_type").notNull(),
  consultationMethod: text("consultation_method").notNull(),
  status: text("status").notNull().default("pending"),
  budget: text("budget"),
  notes: text("notes"),
  email: text("email"),
  whatsappContactNumber: text("whatsapp_contact_number"),
  meetingLink: text("meeting_link"),
  userPhone: text("user_phone").notNull(),
  userLanguage: text("user_language").default("en"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertConsultationBookingSchema = createInsertSchema(consultationBookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  meetingLink: true,
  adminNotes: true,
});
export type ConsultationBooking = typeof consultationBookings.$inferSelect;
export type InsertConsultationBooking = z.infer<typeof insertConsultationBookingSchema>;

// ── User Notifications ──────────────────────────────────────────────────────
export const userNotifications = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // consultation_confirmed | consultation_rejected | consultation_cancelled | test
  title: text("title").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, any>>(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserNotificationSchema = createInsertSchema(userNotifications).omit({ id: true, createdAt: true });
export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;

// ── AI Advisor ───────────────────────────────────────────────────────────────

export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  language: text("language").default("en"),
  status: text("status").default("active"), // active | completed | abandoned
  messageCount: integer("message_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiMessages = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => aiConversations.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const investorProfiles = pgTable("investor_profiles", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => aiConversations.id),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  accountPhone: text("account_phone"),
  whatsappContactNumber: text("whatsapp_contact_number"),
  email: text("email"),
  language: text("language"),
  goal: text("goal"),
  budget: text("budget"),
  paymentPreference: text("payment_preference"),
  country: text("country"),
  city: text("city"),
  interestedProject: text("interested_project"),
  timeline: text("timeline"),
  communicationMethod: text("communication_method"),
  summary: text("summary"),
  leadScore: text("lead_score").default("cold"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiLeadScores = pgTable("ai_lead_scores", {
  id: serial("id").primaryKey(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id, { onDelete: "cascade" }).notNull(),
  score: text("score").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type InvestorProfile = typeof investorProfiles.$inferSelect;
export type AiLeadScore = typeof aiLeadScores.$inferSelect;

// ── Push Subscriptions ───────────────────────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
