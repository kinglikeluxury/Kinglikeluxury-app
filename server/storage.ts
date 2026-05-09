import {
  users,
  properties,
  projects,
  blogPosts,
  type User,
  type InsertUser,
  type Property, 
  type InsertProperty,
  type Project,
  type InsertProject,
  type BlogPost,
  type InsertBlogPost,
  PROPERTY_STATUS,
  PROPERTY_TYPES
} from "@shared/schema";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phoneNumber: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: number, newPassword: string): Promise<User | undefined>;
  
  // Property operations
  getProperties(filters?: {
    type?: string;
    status?: string;
    ownerId?: number;
    location?: string;
    locationContains?: string;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  getPropertyById(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, property: Partial<InsertProperty>): Promise<Property | undefined>;
  updatePropertyStatus(id: number, status: string): Promise<Property | undefined>;
  deleteProperty(id: number): Promise<boolean>;
  
  // Project operations
  getProjects(): Promise<(Project & { property: Property })[]>;
  getProject(id: number): Promise<(Project & { property: Property }) | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  
  // Blog operations
  getBlogPosts(filters?: { 
    published?: boolean;
    authorId?: number;
    category?: string;
  }): Promise<(BlogPost & { author: User })[]>;
  getBlogPostById(id: number): Promise<(BlogPost & { author: User }) | undefined>;
  getBlogPostBySlug(slug: string): Promise<(BlogPost & { author: User }) | undefined>;
  createBlogPost(post: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: number, post: Partial<InsertBlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: number): Promise<boolean>;
  
  // Verification code operations
  createVerificationCode(phoneNumber: string, code: string, expiresAt: Date): Promise<void>;
  verifyCode(phoneNumber: string, code: string): Promise<boolean>;
  isPhoneVerified(phoneNumber: string): Promise<boolean>;

  // Contact log operations
  createContactLog(data: {
    propertyId: number;
    contactorId?: number;
    contactorName: string;
    contactorPhone?: string;
    ownerName?: string;
    ownerPhone?: string;
    propertyTitle?: string;
  }): Promise<void>;
  getContactLogs(): Promise<import("@shared/schema").ContactLog[]>;

  // BOG payment operations
  createPendingBOGPayment(data: {
    bogOrderId: string;
    shopOrderId: string;
    propertyId: number;
    userId: number;
    amount: number;
    currency: string;
    days: number;
    status: string;
  }): Promise<void>;
  completeBOGPayment(bogOrderId: string): Promise<void>;
  getBOGPaymentByPropertyId(propertyId: number): Promise<{ bogOrderId: string; amount: number; status: string } | null>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private properties: Map<number, Property>;
  private projects: Map<number, Project>;
  private blogPosts: Map<number, BlogPost>;
  private userIdCounter: number;
  private propertyIdCounter: number;
  private projectIdCounter: number;
  private blogPostIdCounter: number;

  constructor() {
    this.users = new Map();
    this.properties = new Map();
    this.projects = new Map();
    this.blogPosts = new Map();
    this.userIdCounter = 1;
    this.propertyIdCounter = 1;
    this.projectIdCounter = 1;
    this.blogPostIdCounter = 1;
    
    // Create admin user
    this.createUser({
      username: "admin",
      password: "admin123", // In a real app, this would be hashed
      email: "admin@realestatepro.com",
      isAdmin: true
    });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email
    );
  }

  async getUserByPhone(phoneNumber: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.phoneNumber === phoneNumber
    );
  }

  async updateUserPassword(id: number, newPassword: string): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, password: newPassword };
    this.users.set(id, updated);
    return updated;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = {
      ...userData,
      id,
      password: userData.password ?? null,
      email: userData.email ?? null,
      phoneNumber: userData.phoneNumber ?? null,
      whatsappNumber: userData.whatsappNumber ?? null,
      facebookId: userData.facebookId ?? null,
      authMethod: userData.authMethod ?? 'email',
      isVerified: userData.isVerified ?? false,
      isAdmin: userData.isAdmin ?? false,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
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
  }): Promise<Property[]> {
    let properties = Array.from(this.properties.values());

    if (filters) {
      if (filters.type) {
        properties = properties.filter(p => p.propertyType === filters.type);
      }
      
      if (filters.status) {
        properties = properties.filter(p => p.status === filters.status);
      }
      
      if (filters.ownerId) {
        properties = properties.filter(p => p.ownerId === filters.ownerId);
      }
      
      if (filters.location) {
        properties = properties.filter(p => 
          p.location.toLowerCase().includes(filters.location!.toLowerCase())
        );
      }
      
      if (filters.locationContains) {
        properties = properties.filter(p => 
          p.location.toLowerCase().includes(filters.locationContains!.toLowerCase())
        );
      }
      
      if (filters.minPrice) {
        properties = properties.filter(p => p.price >= filters.minPrice!);
      }
      
      if (filters.maxPrice) {
        properties = properties.filter(p => p.price <= filters.maxPrice!);
      }
    }

    return properties;
  }

  async getProperty(id: number): Promise<Property | undefined> {
    return this.properties.get(id);
  }

  async getPropertyById(id: number): Promise<Property | undefined> {
    return this.properties.get(id);
  }

  async createProperty(propertyData: InsertProperty): Promise<Property> {
    const id = this.propertyIdCounter++;
    const now = new Date();
    
    const property: Property = {
      ...propertyData,
      id,
      status: propertyData.status || PROPERTY_STATUS.PENDING,
      latitude: propertyData.latitude ?? null,
      longitude: propertyData.longitude ?? null,
      bedrooms: propertyData.bedrooms ?? null,
      bathrooms: propertyData.bathrooms ?? null,
      floorNumber: propertyData.floorNumber ?? null,
      listingExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    
    this.properties.set(id, property);
    return property;
  }

  async updateProperty(id: number, propertyData: Partial<InsertProperty>): Promise<Property | undefined> {
    const property = this.properties.get(id);
    if (!property) return undefined;
    
    const updatedProperty = { 
      ...property, 
      ...propertyData,
      updatedAt: new Date() 
    };
    
    this.properties.set(id, updatedProperty);
    return updatedProperty;
  }

  async updatePropertyStatus(id: number, status: string): Promise<Property | undefined> {
    const property = this.properties.get(id);
    if (!property) return undefined;
    
    const updatedProperty = { 
      ...property, 
      status, 
      updatedAt: new Date() 
    };
    
    this.properties.set(id, updatedProperty);
    return updatedProperty;
  }

  async deleteProperty(id: number): Promise<boolean> {
    return this.properties.delete(id);
  }

  // Project operations
  async getProjects(): Promise<(Project & { property: Property })[]> {
    const projectsArray = Array.from(this.projects.values());
    return projectsArray.map(project => {
      const property = this.properties.get(project.propertyId);
      if (!property) {
        throw new Error(`Property not found for project ${project.id}`);
      }
      return { ...project, property };
    });
  }

  async getProject(id: number): Promise<(Project & { property: Property }) | undefined> {
    const project = this.projects.get(id);
    if (!project) return undefined;
    
    const property = this.properties.get(project.propertyId);
    if (!property) return undefined;
    
    return { ...project, property };
  }

  async createProject(projectData: InsertProject): Promise<Project> {
    const id = this.projectIdCounter++;
    const project: Project = {
      ...projectData,
      id,
      createdAt: new Date(),
    };
    
    this.projects.set(id, project);
    return project;
  }

  // Blog operations (stub implementations for interface compliance)
  async getBlogPosts(filters?: { 
    published?: boolean;
    authorId?: number;
    category?: string;
  }): Promise<(BlogPost & { author: User })[]> {
    // Return empty array for now since this is a stub implementation
    return [];
  }
  
  async getBlogPostById(id: number): Promise<(BlogPost & { author: User }) | undefined> {
    return undefined;
  }
  
  async getBlogPostBySlug(slug: string): Promise<(BlogPost & { author: User }) | undefined> {
    return undefined;
  }
  
  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const id = this.blogPostIdCounter++;
    const blogPost: BlogPost = {
      ...post,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.blogPosts.set(id, blogPost);
    return blogPost;
  }
  
  async updateBlogPost(id: number, post: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    const blogPost = this.blogPosts.get(id);
    if (!blogPost) return undefined;
    
    const updatedPost = { 
      ...blogPost, 
      ...post,
      updatedAt: new Date() 
    };
    
    this.blogPosts.set(id, updatedPost);
    return updatedPost;
  }
  
  async deleteBlogPost(id: number): Promise<boolean> {
    return this.blogPosts.delete(id);
  }

  private verificationCodes: Map<string, { code: string; expiresAt: Date; verified: boolean }> = new Map();

  async createVerificationCode(phoneNumber: string, code: string, expiresAt: Date): Promise<void> {
    this.verificationCodes.set(phoneNumber, { code, expiresAt, verified: false });
  }

  async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
    const record = this.verificationCodes.get(phoneNumber);
    if (!record) return false;
    if (record.code !== code) return false;
    if (new Date() > record.expiresAt) return false;
    record.verified = true;
    return true;
  }

  async isPhoneVerified(phoneNumber: string): Promise<boolean> {
    const record = this.verificationCodes.get(phoneNumber);
    return record?.verified === true;
  }

  async createContactLog(_data: {
    propertyId: number;
    contactorId?: number;
    contactorName: string;
    contactorPhone?: string;
    ownerName?: string;
    ownerPhone?: string;
    propertyTitle?: string;
  }): Promise<void> {
    // MemStorage stub — not used in production
  }

  async getContactLogs(): Promise<import("@shared/schema").ContactLog[]> {
    return [];
  }

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
    // Upgrade property to VIP
    const property = this.properties.get(record.propertyId);
    if (property) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + record.days);
      this.properties.set(record.propertyId, {
        ...property,
        listingType: "vip",
        listingExpiresAt: expiresAt,
      });
    }
  }

  async getBOGPaymentByPropertyId(propertyId: number): Promise<{ bogOrderId: string; amount: number; status: string } | null> {
    for (const [bogOrderId, record] of this.bogPayments.entries()) {
      if (record.propertyId === propertyId && record.status === "completed") {
        return { bogOrderId, amount: record.amount, status: record.status };
      }
    }
    return null;
  }
}

// Import the DatabaseStorage class
import { DatabaseStorage } from "./database-storage";

// Use Database Storage for production, MemStorage for development if needed
export const storage = new DatabaseStorage();
