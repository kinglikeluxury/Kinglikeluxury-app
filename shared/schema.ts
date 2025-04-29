import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User model
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  isAdmin: true,
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
  propertyType: text("property_type").notNull(),
  images: jsonb("images").notNull().$type<string[]>(),
  features: jsonb("features").notNull().$type<string[]>(),
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
    features: z.array(z.string()),
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
export type PropertyWithOwner = Property & { owner: User };
export type ProjectWithProperty = Project & { property: Property };
