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
