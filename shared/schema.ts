import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  password: text("password"),  // Can be null for social logins
  email: text("email").unique(),  // Can be null if using phone
  phoneNumber: text("phone_number").unique(), // For SMS verification
  whatsappNumber: text("whatsapp_number").unique(), // For WhatsApp verification
  facebookId: text("facebook_id").unique(), // For Facebook login
  authMethod: text("auth_method").notNull().default(AUTH_METHODS.EMAIL),
  isVerified: boolean("is_verified").default(false).notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
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
  // Make certain fields conditional based on auth method
  password: z.string().optional().refine(
    (val, ctx) => {
      if (ctx.data.authMethod === AUTH_METHODS.EMAIL && !val) {
        return false;
      }
      return true;
    },
    { message: "Password is required for email authentication" }
  ),
  email: z.string().email().optional().refine(
    (val, ctx) => {
      if (ctx.data.authMethod === AUTH_METHODS.EMAIL && !val) {
        return false;
      }
      return true;
    },
    { message: "Email is required for email authentication" }
  ),
  phoneNumber: z.string().optional().refine(
    (val, ctx) => {
      if (ctx.data.authMethod === AUTH_METHODS.PHONE && !val) {
        return false;
      }
      return true;
    },
    { message: "Phone number is required for SMS authentication" }
  ),
  whatsappNumber: z.string().optional().refine(
    (val, ctx) => {
      if (ctx.data.authMethod === AUTH_METHODS.WHATSAPP && !val) {
        return false;
      }
      return true;
    },
    { message: "WhatsApp number is required for WhatsApp authentication" }
  ),
  facebookId: z.string().optional().refine(
    (val, ctx) => {
      if (ctx.data.authMethod === AUTH_METHODS.FACEBOOK && !val) {
        return false;
      }
      return true;
    },
    { message: "Facebook ID is required for Facebook authentication" }
  ),
});

// Property types
export const PROPERTY_TYPES = {
  APARTMENT: "apartment",
  VILLA: "villa",
  LAND: "land",
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
  area: integer("area").notNull(), // in sq ft
  bedrooms: integer("bedrooms"), // nullable for land
  bathrooms: integer("bathrooms"), // nullable for land
  floorNumber: integer("floor_number"), // for apartments
  propertyType: text("property_type").notNull(),
  images: jsonb("images").notNull().$type<string[]>(),
  videos: jsonb("videos").notNull().$type<string[]>().default([]),
  features: jsonb("features").notNull().$type<string[]>(),
  amenities: jsonb("amenities").notNull().$type<string[]>().default([]),
  status: text("status").notNull().default(PROPERTY_STATUS.PENDING),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  listingType: text("listing_type").notNull().default(LISTING_TYPES.REGULAR),
  listingExpiresAt: timestamp("listing_expires_at"),
});

export const insertPropertySchema = createInsertSchema(properties)
  .omit({ id: true, status: true, createdAt: true, updatedAt: true, listingExpiresAt: true })
  .extend({
    propertyType: z.enum([
      PROPERTY_TYPES.APARTMENT,
      PROPERTY_TYPES.VILLA,
      PROPERTY_TYPES.LAND,
      PROPERTY_TYPES.PROJECT,
    ]),
    listingType: z.enum([
      LISTING_TYPES.REGULAR,
      LISTING_TYPES.VIP,
      LISTING_TYPES.SUPER_VIP,
    ]).default(LISTING_TYPES.REGULAR),
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

// Extended types (combining related data)
// Blog post schema
export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(),
  excerpt: text("excerpt").notNull(),
  coverImage: text("cover_image").notNull(),
  authorId: integer("author_id").notNull().references(() => users.id),
  categories: jsonb("categories").notNull().$type<string[]>(),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;

export type PropertyWithOwner = Property & { owner: User };
export type ProjectWithProperty = Project & { property: Property };
export type BlogPostWithAuthor = BlogPost & { author: User };
