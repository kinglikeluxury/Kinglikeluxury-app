import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertUserSchema, 
  insertPropertySchema, 
  insertProjectSchema,
  insertBlogPostSchema,
  PROPERTY_TYPES,
  PROPERTY_STATUS
} from "@shared/schema";
import session from "express-session";
import { z } from "zod";
import { processImages } from "./utils/imageProcessing";
import { translateBlogPost } from "./translate";
import { createBOGOrder, getBOGOrderStatus, refundBOGOrder } from "./bogPayment";
// TODO: Fix Google Cloud Storage TypeScript compatibility issues
// import {
//   ObjectStorageService,
//   ObjectNotFoundError,
// } from "./objectStorage";
import multer from "multer";
import { ObjectStorageService } from "./objectStorage";
import { uploadToCloudinary } from "./cloudinaryService";
import path from "path";
import Twilio from "twilio";

// Configure multer for file uploads - memory storage for Cloudinary
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB max per file
    fieldSize: 10 * 1024 * 1024, // 10MB field size
    files: 20 // Max 20 files per request
  }
});

// Session type definition
declare module "express-session" {
  interface SessionData {
    userId: number;
    isAdmin: boolean;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Configure sessions with PostgreSQL store
  app.use(
    session({
      cookie: { maxAge: 86400000 }, // 24 hours
      store: storage.sessionStore,
      resave: false,
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET || "realestatepro-secret",
    })
  );

  // Middleware to check if user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (req.session.userId) {
      return next();
    }
    res.status(401).json({ message: "Not authenticated" });
  };

  // Middleware to check if user is admin
  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (req.session.userId && req.session.isAdmin) {
      return next();
    }
    res.status(403).json({ message: "Not authorized" });
  };

  // Digital Asset Links for TWA (Trusted Web Activity) - Required for Google Play
  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json([{
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.kinglikeluxury",
        "sha256_cert_fingerprints": [
          "A7:9B:9A:D6:7E:A3:E8:32:83:12:60:B6:F8:27:36:E8:3F:00:3D:89:6A:82:E4:6E:8B:20:73:F5:FB:84:AF:2F"
        ]
      }
    }]);
  });

  // IP-based country detection
  app.get("/api/geo/detect", async (req, res) => {
    try {
      const forwarded = req.headers['x-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '';
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
      const data = await response.json() as any;
      res.json({ countryCode: data.countryCode || 'US' });
    } catch {
      res.json({ countryCode: 'US' });
    }
  });

  // Twilio SMS client
  const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

  // Send SMS verification code
  app.post("/api/auth/send-verification", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      if (!twilioClient) {
        return res.status(500).json({ message: "SMS service not configured" });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await storage.createVerificationCode(phoneNumber, code, expiresAt);

      await twilioClient.messages.create({
        body: `Your Kinglike verification code is: ${code}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });

      res.json({ success: true, message: "Verification code sent" });
    } catch (error: any) {
      console.error("SMS send error:", error);
      res.status(500).json({ message: error.message || "Failed to send verification code" });
    }
  });

  // Verify SMS code
  app.post("/api/auth/verify-code", async (req, res) => {
    try {
      const { phoneNumber, code } = req.body;
      if (!phoneNumber || !code) {
        return res.status(400).json({ message: "Phone number and code are required" });
      }

      const isValid = await storage.verifyCode(phoneNumber, code);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      res.json({ success: true, verified: true });
    } catch (error) {
      console.error("Verify code error:", error);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      // Check for existing credentials based on auth method
      if (userData.email) {
        const existingEmail = await storage.getUserByEmail(userData.email);
        if (existingEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      
      // Check phone number verification for mobile signups
      if (userData.authMethod === 'phone' && userData.phoneNumber) {
        const isPhoneVerified = await storage.isPhoneVerified(userData.phoneNumber);
        if (!isPhoneVerified) {
          return res.status(400).json({ message: "Phone number must be verified before registration" });
        }
      }

      const userWithVerification = {
        ...userData,
        isAdmin: false,
        isVerified: true
      };
      
      const user = await storage.createUser(userWithVerification);
      
      // Set session
      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      
      // Return appropriate user data
      const userResponse: any = {
        id: user.id,
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin
      };
      
      // Add method-specific fields to response
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;
      if (user.whatsappNumber) userResponse.whatsappNumber = user.whatsappNumber;
      if (user.facebookId) userResponse.facebookId = user.facebookId;
      
      res.status(201).json(userResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password, phoneNumber, whatsappNumber, facebookId, authMethod } = req.body;
      
      // Get user based on auth method
      let user;
      
      // Validate required fields based on auth method
      if (authMethod === 'email') {
        if (!username || !password) {
          return res.status(400).json({ message: "Username and password are required for email login" });
        }
        
        user = await storage.getUserByUsername(username);
        
        if (!user || user.password !== password) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      } 
      else if (authMethod === 'phone') {
        if (!phoneNumber) {
          return res.status(400).json({ message: "Phone number is required for SMS login" });
        }
        
        // Here we would normally validate a verification code
        // For demo, we'll just check if a user with this phone number exists
        user = await storage.getUserByField('phoneNumber', phoneNumber);
        
        // In production, verify OTP code here
      }
      else if (authMethod === 'whatsapp') {
        if (!whatsappNumber) {
          return res.status(400).json({ message: "WhatsApp number is required for WhatsApp login" });
        }
        
        // Here we would normally validate a verification code
        // For demo, we'll just check if a user with this WhatsApp number exists
        user = await storage.getUserByField('whatsappNumber', whatsappNumber);
        
        // In production, verify WhatsApp code here
      }
      else if (authMethod === 'facebook') {
        if (!facebookId) {
          return res.status(400).json({ message: "Facebook ID is required for Facebook login" });
        }
        
        // For demo, we'll just check if a user with this Facebook ID exists
        user = await storage.getUserByField('facebookId', facebookId);
        
        // In production, Facebook OAuth would handle this
      }
      else {
        // Default to traditional username/password login if no auth method specified
        if (!username || !password) {
          return res.status(400).json({ message: "Username and password are required" });
        }
        
        user = await storage.getUserByUsername(username);
        
        if (!user || user.password !== password) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      }
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Set session
      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      
      // Return appropriate user data
      const userResponse: any = {
        id: user.id, 
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin
      };
      
      // Add method-specific fields to response
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;
      if (user.whatsappNumber) userResponse.whatsappNumber = user.whatsappNumber;
      if (user.facebookId) userResponse.facebookId = user.facebookId;
      
      res.json(userResponse);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });
  
  // Payment routes
  app.post("/api/payments", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const paymentData = req.body;
      if (!paymentData.propertyId || !paymentData.amount || !paymentData.paymentMethod) {
        return res.status(400).json({ message: "Missing required payment fields" });
      }
      const payment = {
        id: Math.floor(Math.random() * 1000000),
        ...paymentData,
        userId: req.session.userId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      console.log('💳 Payment processed:', payment);
      res.status(201).json(payment);
    } catch (error) {
      console.error('Payment error:', error);
      res.status(500).json({ message: "Payment processing failed" });
    }
  });

  // BOG (Bank of Georgia) payment — create order and redirect
  app.post("/api/bog/create-order", isAuthenticated, async (req, res) => {
    try {
      const { amount, currency = "USD", propertyId, days } = req.body;
      if (!amount || !propertyId) {
        return res.status(400).json({ message: "amount and propertyId are required" });
      }
      const shopOrderId = `prop-${propertyId}-${Date.now()}`;
      const baseUrl = process.env.BOG_BASE_URL ||
        `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
      const { orderId, redirectUrl } = await createBOGOrder(
        parseFloat(amount),
        currency,
        shopOrderId,
        baseUrl
      );
      // Store pending payment with bog order id
      await storage.createPendingBOGPayment({
        bogOrderId: orderId,
        shopOrderId,
        propertyId: parseInt(propertyId),
        userId: req.session.userId!,
        amount: parseFloat(amount),
        currency,
        days: parseInt(days) || 30,
        status: "pending",
      });
      res.json({ orderId, redirectUrl });
    } catch (error: any) {
      console.error("BOG create order error:", error);
      res.status(500).json({ message: error.message || "Failed to create BOG payment order" });
    }
  });

  // BOG callback — called by BOG after payment
  app.post("/api/bog/callback", async (req, res) => {
    try {
      const { order_id } = req.body;
      if (!order_id) {
        return res.status(400).json({ message: "order_id missing" });
      }
      const status = await getBOGOrderStatus(order_id);
      const completed = status === "completed" || status === "captured";
      if (completed) {
        await storage.completeBOGPayment(order_id);
      }
      console.log(`BOG callback: order ${order_id} status=${status}`);
      res.json({ received: true, status });
    } catch (error: any) {
      console.error("BOG callback error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // BOG order status check
  app.get("/api/bog/order-status/:orderId", isAuthenticated, async (req, res) => {
    try {
      const status = await getBOGOrderStatus(req.params.orderId);
      res.json({ status });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // BOG refund — called by admin when rejecting a paid property
  app.post("/api/bog/refund/:propertyId", isAdmin, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const payment = await storage.getBOGPaymentByPropertyId(propertyId);
      if (!payment) {
        return res.status(404).json({ message: "No confirmed BOG payment found for this property" });
      }
      await refundBOGOrder(payment.bogOrderId);
      console.log(`BOG refund issued for property ${propertyId}, order ${payment.bogOrderId}`);
      res.json({ success: true, refundedAmount: payment.amount });
    } catch (error: any) {
      console.error("BOG refund error:", error);
      res.status(500).json({ message: error.message || "Refund failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json({ 
      id: user.id, 
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin
    });
  });

  // Property routes
  app.get("/api/properties", async (req, res) => {
    try {
      const { 
        type, 
        status = PROPERTY_STATUS.APPROVED, // Default to showing only approved properties
        location,
        minPrice,
        maxPrice
      } = req.query;
      
      let filters: any = { status };
      
      // Handle apartment subtypes (studio, one-bedroom, etc.) by converting to proper filters
      if (type) {
        switch (type) {
          case 'studio':
            filters.type = 'apartment';
            filters.bedrooms = 0; // Studio = 0 bedrooms
            break;
          case 'one-bedroom':
            filters.type = 'apartment';
            filters.bedrooms = 1;
            break;
          case 'two-bedrooms':
            filters.type = 'apartment';
            filters.bedrooms = 2;
            break;
          case 'three-bedrooms':
            filters.type = 'apartment';
            filters.bedrooms = 3;
            break;
          case 'doublex':
            filters.type = 'apartment';
            // Doublex can have various bedroom counts, so no bedroom filter
            break;
          default:
            // Handle regular property types (apartment, villa, land, project)
            filters.type = type as string;
            break;
        }
      }
      
      if (location && location !== 'any') filters.location = location as string;
      if (minPrice) filters.minPrice = parseInt(minPrice as string);
      if (maxPrice) filters.maxPrice = parseInt(maxPrice as string);
      
      // Support country+city filtering for main feed (Hero search)
      if (req.query.city && req.query.city !== 'any') {
        const locationFilter = getLocationFilter(req.query.city as string);
        if (locationFilter) {
          filters.locationContains = locationFilter;
        }
      }
      
      // If admin is requesting, allow getting all statuses
      if (req.session.isAdmin && req.query.status) {
        // If admin requests status=all, don't filter by status at all
        if (req.query.status === 'all') {
          delete filters.status;
        } else {
          filters.status = req.query.status as string;
        }
      }
      
      // If regular user is requesting their own properties, include their pending ones
      if (req.session.userId && !req.session.isAdmin && req.query.myProperties) {
        filters = {
          ownerId: req.session.userId
        };
      }
      
      const properties = await storage.getProperties(filters);
      
      // Sort properties to prioritize featured listings (VIP and Super VIP)
      const sortedProperties = properties.sort((a, b) => {
        // First, check if listings are still active (not expired)
        const now = new Date();
        const aIsActive = !a.listingExpiresAt || new Date(a.listingExpiresAt) > now;
        const bIsActive = !b.listingExpiresAt || new Date(b.listingExpiresAt) > now;
        
        // If listing is expired, treat it as regular
        const aListingType = aIsActive ? a.listingType : 'regular';
        const bListingType = bIsActive ? b.listingType : 'regular';
        
        // Prioritization order: super_vip > vip > regular
        const priorities = { 'super_vip': 3, 'vip': 2, 'regular': 1 };
        const aPriority = priorities[aListingType as keyof typeof priorities] || 1;
        const bPriority = priorities[bListingType as keyof typeof priorities] || 1;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        
        // If same priority, sort by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      res.json(sortedProperties);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/properties/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getPropertyWithAgent(id);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // If property is not approved, only show to owner or admin
      if (
        property.status !== PROPERTY_STATUS.APPROVED && 
        (!req.session.userId || 
          (property.ownerId !== req.session.userId && !req.session.isAdmin))
      ) {
        return res.status(403).json({ message: "Not authorized to view this property" });
      }
      
      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  const recentSubmissions = new Map<string, number>();
  
  app.post("/api/properties", isAuthenticated, async (req, res) => {
    try {
      const propertyData = insertPropertySchema.parse(req.body);
      
      const dedupeKey = `${req.session.userId}-${propertyData.title}-${propertyData.propertyType}`;
      const lastSubmission = recentSubmissions.get(dedupeKey);
      const now = Date.now();
      if (lastSubmission && now - lastSubmission < 3000) {
        return res.status(429).json({ message: "Duplicate submission detected. Please wait a few seconds." });
      }
      recentSubmissions.set(dedupeKey, now);
      setTimeout(() => recentSubmissions.delete(dedupeKey), 5000);
      
      // Add watermark to all property images
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to images:', err);
      }
      
      const isAdminUser = req.session.isAdmin === true;
      
      const property = await storage.createProperty({
        ...propertyData,
        ownerId: req.session.userId!
      });
      
      if (isAdminUser) {
        await storage.updatePropertyStatus(property.id, PROPERTY_STATUS.APPROVED);
        property.status = PROPERTY_STATUS.APPROVED;
      }
      
      if (
        propertyData.propertyType === PROPERTY_TYPES.PROJECT && 
        req.body.projectDetails
      ) {
        const projectData = insertProjectSchema.parse({
          ...req.body.projectDetails,
          propertyId: property.id
        });
        
        await storage.createProject(projectData);
      }
      
      res.status(201).json({
        ...property,
        pendingReview: !isAdminUser
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  // Update property (PATCH)
  app.patch("/api/properties/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const propertyData = insertPropertySchema.parse(req.body);
      
      // Get existing property to check ownership
      const existingProperty = await storage.getPropertyById(id);
      if (!existingProperty) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // Check ownership - only allow property owner or admin to edit
      const isOwner = existingProperty.ownerId === req.session.userId;
      const isAdmin = req.session.isAdmin;
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ message: "You can only edit your own properties" });
      }
      
      // Add watermark to all property images if they've changed
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to images:', err);
        // Continue with original images if watermarking fails
      }
      
      // Update property (preserve original owner)
      const property = await storage.updateProperty(id, {
        ...propertyData,
        ownerId: existingProperty.ownerId // Keep original owner
      });
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(property);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error('Error updating property:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Mark property as sold / unmark
  app.patch("/api/properties/:id/sold", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      if (property.ownerId !== req.session.userId && !req.session.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { isSold } = req.body;
      const updated = await storage.updateProperty(id, { isSold: !!isSold } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error marking sold:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      if (property.ownerId !== req.session.userId && !req.session.isAdmin) {
        return res.status(403).json({ message: "Not authorized to delete this property" });
      }
      
      const deleted = await storage.deleteProperty(id);
      if (deleted) {
        res.json({ message: "Property deleted successfully" });
      } else {
        res.status(500).json({ message: "Failed to delete property" });
      }
    } catch (error) {
      console.error('Error deleting property:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Admin routes for property approval
  app.patch("/api/properties/:id/status", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      if (!status || !Object.values(PROPERTY_STATUS).includes(status as any)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const property = await storage.updatePropertyStatus(id, status);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Project routes
  app.get("/api/projects", async (req, res) => {
    try {
      // Get both dedicated projects and project-type properties
      const [dedicatedProjects, projectProperties] = await Promise.all([
        storage.getProjects(),
        storage.getPropertiesByType(PROPERTY_TYPES.PROJECT)
      ]);
      
      // Get property IDs that already have dedicated project records to avoid duplicates
      const dedicatedPropertyIds = new Set(dedicatedProjects.map(project => project.propertyId));
      
      // Filter out properties that already have dedicated project records
      const standaloneProjectProperties = projectProperties.filter(
        property => !dedicatedPropertyIds.has(property.id)
      );
      
      // Transform standalone project-type properties to project format for display
      const propertyProjects = standaloneProjectProperties.map(property => ({
        id: `property-${property.id}`, // Unique ID to avoid conflicts with dedicated projects
        propertyId: property.id,
        developer: property.title, // Use title as developer
        completionDate: 'Q4 2024', // Default completion
        projectStatus: 'Now Selling', // Default status
        createdAt: property.createdAt,
        property: property,
        // Include property fields for backward compatibility
        title: property.title,
        description: property.description,
        price: property.price,
        location: property.location,
        area: property.area,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        features: property.features || [],
        amenities: property.amenities || [],
        images: property.images || [],
        videos: property.videos || [],
        status: property.status,
        ownerId: property.ownerId
      }));
      
      // Combine and return all projects (dedicated projects + standalone project properties)
      const allProjects = [...dedicatedProjects, ...propertyProjects];
      res.json(allProjects);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/projects", isAdmin, async (req, res) => {
    try {
      const propertyData = insertPropertySchema.parse({
        ...req.body.property,
        propertyType: PROPERTY_TYPES.PROJECT,
        ownerId: req.session.userId!
      });
      
      const dedupeKey = `project-${req.session.userId}-${propertyData.title}`;
      const lastSubmission = recentSubmissions.get(dedupeKey);
      const now = Date.now();
      if (lastSubmission && now - lastSubmission < 3000) {
        return res.status(429).json({ message: "Duplicate submission detected. Please wait a few seconds." });
      }
      recentSubmissions.set(dedupeKey, now);
      setTimeout(() => recentSubmissions.delete(dedupeKey), 5000);
      
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to project images:', err);
      }
      
      const property = await storage.createProperty(propertyData);
      
      // Then create the project with the property ID
      const projectData = insertProjectSchema.parse({
        ...req.body.projectDetails,
        propertyId: property.id
      });
      
      const project = await storage.createProject(projectData);
      
      res.status(201).json({ property, project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  // Photo upload → Cloudinary
  app.post("/api/photos/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const result = await uploadToCloudinary(req.file.buffer, { folder: "kinglike/photos", resourceType: "image" });
      res.json({ url: result.secureUrl, objectPath: result.secureUrl });
    } catch (error) {
      console.error("Error uploading photo:", error);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  // Legacy process endpoint (kept for backward compatibility)
  app.post("/api/photos/process", isAuthenticated, async (req, res) => {
    const { photoURL } = req.body;
    res.status(200).json({ objectPath: photoURL || "" });
  });

  // Route to serve uploaded files (legacy object storage - with Range request support for video)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const [metadata] = await objectFile.getMetadata();
      const contentType = metadata.contentType || "application/octet-stream";
      const fileSize = Number(metadata.size);
      const isVideo = contentType.startsWith("video/");

      const rangeHeader = req.headers.range;

      if (isVideo && rangeHeader) {
        // Parse Range header e.g. "bytes=0-1023"
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        });

        const stream = objectFile.createReadStream({ start, end });
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      } else {
        // No range request - serve full file
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": fileSize,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        });
        const stream = objectFile.createReadStream();
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      }
    } catch (error: any) {
      if (error.name === "ObjectNotFoundError") {
        if (req.path.startsWith("/objects/.private/uploads/")) {
          return res.status(404).json({ error: "File not found" });
        }
        return res.redirect("https://via.placeholder.com/800x600?text=Image+Not+Found");
      }
      return res.status(404).json({ error: "Object not found" });
    }
  });

  // Video upload → Cloudinary
  app.post("/api/videos/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const result = await uploadToCloudinary(req.file.buffer, { folder: "kinglike/videos", resourceType: "video" });
      res.json({ url: result.secureUrl, objectPath: result.secureUrl });
    } catch (error) {
      console.error("Error uploading video:", error);
      res.status(500).json({ error: "Failed to upload video" });
    }
  });

  app.post("/api/videos/process", isAuthenticated, async (req, res) => {
    const { videoURL } = req.body;
    res.status(200).json({ objectPath: videoURL || "" });
  });

  // Audio upload → Cloudinary
  app.post("/api/audios/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const result = await uploadToCloudinary(req.file.buffer, { folder: "kinglike/audio", resourceType: "video" });
      res.json({ url: result.secureUrl, objectPath: result.secureUrl });
    } catch (error) {
      console.error("Error uploading audio:", error);
      res.status(500).json({ error: "Failed to upload audio" });
    }
  });

  app.post("/api/audios/process", isAuthenticated, async (req, res) => {
    const { audioURL } = req.body;
    res.status(200).json({ objectPath: audioURL || "" });
  });

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Blog routes
  app.get("/api/blog", async (req, res) => {
    try {
      const { published, authorId, category, lang, country: countryFilter } = req.query;
      
      const filters: any = {};
      const isAdmin = req.session?.userId ? (await storage.getUser(req.session.userId))?.isAdmin : false;
      if (published === 'all' && isAdmin) {
        // Admin can see all posts - don't filter by published
      } else {
        filters.published = true;
      }
      if (authorId) filters.authorId = parseInt(authorId as string);
      if (category) filters.category = category as string;
      
      let blogPosts = await storage.getBlogPosts(filters);
      
      if (countryFilter && countryFilter !== 'all') {
        blogPosts = blogPosts.filter((p: any) => p.country === countryFilter);
      }

      if (lang) {
        blogPosts = blogPosts.map((post: any) => {
          const t = post.translations?.[lang as string];
          if (t) {
            return { ...post, title: t.title, content: t.content, excerpt: t.excerpt };
          }
          return post;
        });
      }
      
      res.json(blogPosts);
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/blog/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const { lang } = req.query;
      const blogPost = await storage.getBlogPostBySlug(slug);
      
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }
      
      if (lang) {
        const t = (blogPost as any).translations?.[lang as string];
        if (t) {
          return res.json({ ...blogPost, title: t.title, content: t.content, excerpt: t.excerpt });
        }
      }

      res.json(blogPost);
    } catch (error) {
      console.error('Error fetching blog post by slug:', error);
      res.status(500).json({ message: "Failed to fetch blog post" });
    }
  });

  app.get("/api/blog/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { lang } = req.query;
      const blogPost = await storage.getBlogPostById(id);
      
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }
      
      if (lang) {
        const t = (blogPost as any).translations?.[lang as string];
        if (t) {
          return res.json({ ...blogPost, title: t.title, content: t.content, excerpt: t.excerpt });
        }
      }

      res.json(blogPost);
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });





  // Blog image upload route
  app.post("/api/blog/upload-image", upload.single('image'), async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const result = await uploadToCloudinary(req.file.buffer, {
        folder: "kinglike/blog",
        resourceType: "image",
      });
      res.json({ url: result.secureUrl });
    } catch (error) {
      console.error('Error uploading blog image:', error);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

  const blogVideoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid video format. Use MP4, WEBM, MOV, or AVI.'));
      }
    }
  });

  app.post("/api/blog/upload-video", blogVideoUpload.single('video'), async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No video file provided" });
      }

      const result = await uploadToCloudinary(req.file.buffer, {
        folder: "kinglike/blog",
        resourceType: "video",
      });
      res.json({ url: result.secureUrl });
    } catch (error: any) {
      if (error.message?.includes('Invalid video format') || error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: error.message || "File too large (max 100MB)" });
      }
      console.error('Error uploading blog video:', error);
      res.status(500).json({ message: "Failed to upload video" });
    }
  });

  // Blog CRUD routes (admin only)
  app.post("/api/blog", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { title, content, excerpt, coverImage, coverVideo, categories, published, country } = req.body;
      
      if (!title || !content) {
        return res.status(400).json({ message: "Title and content are required" });
      }
      
      let slug = title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\u0590-\u05FF\u10A0-\u10FF\u4E00-\u9FFF\u0400-\u04FF]+/g, '-').replace(/(^-|-$)/g, '');
      if (!slug || slug === '-') {
        slug = `post-${Date.now()}`;
      }
      const finalExcerpt = excerpt || content.substring(0, 200);

      const postData = {
        title,
        slug,
        content,
        excerpt: finalExcerpt,
        coverImage: coverImage || '',
        coverVideo: coverVideo || null,
        authorId: user.id,
        categories: categories || [],
        country: country || 'georgia',
        published: published !== false,
      };

      const validated = insertBlogPostSchema.safeParse(postData);
      if (!validated.success) {
        return res.status(400).json({ message: "Invalid blog post data", errors: validated.error.errors });
      }

      const blogPost = await storage.createBlogPost(validated.data);

      res.status(201).json(blogPost);

      translateBlogPost(title, content, finalExcerpt).then(async (translations) => {
        try {
          await storage.updateBlogPost(blogPost.id, { translations } as any);
          console.log(`Translations saved for blog post ${blogPost.id}`);
        } catch (err) {
          console.error(`Failed to save translations for blog post ${blogPost.id}:`, err);
        }
      }).catch(err => console.error('Translation failed:', err));
    } catch (error) {
      console.error('Error creating blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.put("/api/blog/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const { title, content, excerpt, coverImage, coverVideo, categories, published, country } = req.body;
      
      const updates: any = {};
      if (title !== undefined) {
        updates.title = title;
        let newSlug = title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\u0590-\u05FF\u10A0-\u10FF\u4E00-\u9FFF\u0400-\u04FF]+/g, '-').replace(/(^-|-$)/g, '');
        if (!newSlug || newSlug === '-') {
          newSlug = `post-${Date.now()}`;
        }
        updates.slug = newSlug;
      }
      if (content !== undefined) updates.content = content;
      if (excerpt !== undefined) updates.excerpt = excerpt;
      if (coverImage !== undefined) updates.coverImage = coverImage;
      if (coverVideo !== undefined) updates.coverVideo = coverVideo;
      if (categories !== undefined) updates.categories = categories;
      if (published !== undefined) updates.published = published;
      if (country !== undefined) updates.country = country;

      const blogPost = await storage.updateBlogPost(id, updates);
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }

      res.json(blogPost);

      if (title !== undefined || content !== undefined || excerpt !== undefined) {
        const finalTitle = title || blogPost.title;
        const finalContent = content || blogPost.content;
        const finalExcerpt = excerpt || blogPost.excerpt;
        translateBlogPost(finalTitle, finalContent, finalExcerpt).then(async (translations) => {
          try {
            await storage.updateBlogPost(id, { translations } as any);
            console.log(`Translations updated for blog post ${id}`);
          } catch (err) {
            console.error(`Failed to update translations for blog post ${id}:`, err);
          }
        }).catch(err => console.error('Translation update failed:', err));
      }
    } catch (error) {
      console.error('Error updating blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/blog/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const deleted = await storage.deleteBlogPost(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Blog post not found" });
      }

      res.json({ message: "Blog post deleted" });
    } catch (error) {
      console.error('Error deleting blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/blog/retranslate-all", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const posts = await storage.getBlogPosts({});
      res.json({ message: `Re-translating ${posts.length} posts in background` });

      for (const post of posts) {
        try {
          const postExcerpt = post.excerpt || post.content.substring(0, 200);
          const translations = await translateBlogPost(post.title, post.content, postExcerpt);
          await storage.updateBlogPost(post.id, { translations } as any);
          console.log(`Re-translated blog post ${post.id}: ${post.title}`);
        } catch (err) {
          console.error(`Failed to re-translate post ${post.id}:`, err);
        }
      }
    } catch (error) {
      console.error('Error re-translating:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Serve public objects - temporarily disabled until object storage is fixed
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    // TODO: Implement public object serving after fixing Google Cloud Storage issues
    res.status(503).json({ error: "Public object serving temporarily unavailable" });
  });

  // Helper function to get location filter for country/city selection
  function getLocationFilter(cityCode: string): string | null {
    // Handle country-level filtering
    const countryMap: Record<string, string> = {
      'georgia': 'Georgia',
      'uae': 'UAE',
      'northern-cyprus': 'Northern Cyprus',
      'turkey': 'Turkey'
    };
    
    // Handle city-level filtering  
    const cityMap: Record<string, string> = {
      'batumi': 'Batumi',
      'tbilisi': 'Tbilisi', 
      'dubai': 'Dubai',
      'sharjah': 'Sharjah',
      'rasAlKhaimah': 'Ras Al Khaimah',
      'ras-al-khaimah': 'Ras Al Khaimah',
      'lefkosa': 'Lefkoşa',
      'gazimağusa': 'Gazimağusa',
      'girne': 'Girne',
      'iskele': 'İskele',
      'guzelyurt': 'Güzelyurt',
      'esentepe': 'Esentepe',
      'istanbul': 'Istanbul',
      'trabzon': 'Trabzon'
    };
    
    // Return country filter or city filter
    return countryMap[cityCode] || cityMap[cityCode] || null;
  }

  const translationCache = new Map<string, { text: string; timestamp: number }>();
  const TRANSLATION_CACHE_TTL = 24 * 60 * 60 * 1000;
  const MAX_SERVER_CACHE = 1000;

  function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36) + '_' + str.length;
  }

  let translateFn: any = null;

  app.post("/api/translate", async (req, res) => {
    try {
      const { texts, targetLang } = req.body;
      
      if (!texts || !targetLang || !Array.isArray(texts)) {
        return res.status(400).json({ message: "texts (array) and targetLang are required" });
      }

      if (texts.length > 50) {
        return res.status(400).json({ message: "Maximum 50 texts per request" });
      }

      const langMap: Record<string, string> = {
        en: 'en', ar: 'ar', he: 'iw', ru: 'ru', 
        ka: 'ka', az: 'az', tr: 'tr', zh: 'zh-CN', pl: 'pl', it: 'it'
      };
      const target = langMap[targetLang] || targetLang;

      if (!translateFn) {
        const translateModule = await import('google-translate-api-x');
        translateFn = translateModule.default || translateModule.translate;
      }

      if (translationCache.size > MAX_SERVER_CACHE) {
        const entries = Array.from(translationCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        entries.slice(0, 200).forEach(([key]) => translationCache.delete(key));
      }

      const results: string[] = [];
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (let idx = 0; idx < texts.length; idx++) {
        const text = texts[idx];
        if (!text || text.trim().length === 0) {
          results.push(text || '');
          continue;
        }

        const cacheKey = `${simpleHash(text)}_${target}`;
        const cached = translationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < TRANSLATION_CACHE_TTL) {
          results.push(cached.text);
          continue;
        }

        let translated = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (idx > 0 || attempt > 0) {
              await delay(500 * (attempt + 1));
            }
            const result = await translateFn(text, { to: target });
            translationCache.set(cacheKey, { text: result.text, timestamp: Date.now() });
            results.push(result.text);
            translated = true;
            break;
          } catch (err: any) {
            if (err?.name === 'TooManyRequestsError' || err?.message?.includes('Too Many Requests') || err?.message?.includes('429')) {
              console.log(`Rate limited on attempt ${attempt + 1}, waiting ${3000 * (attempt + 1)}ms...`);
              await delay(3000 * (attempt + 1));
              continue;
            }
            console.error('Translation error:', err);
            break;
          }
        }
        if (!translated) {
          results.push(text);
        }
      }

      res.json({ translations: results });
    } catch (error) {
      console.error('Translation endpoint error:', error);
      res.status(500).json({ message: "Translation failed" });
    }
  });

  return httpServer;
}
