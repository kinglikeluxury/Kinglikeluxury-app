import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertUserSchema, 
  insertPropertySchema, 
  insertProjectSchema,
  PROPERTY_TYPES,
  PROPERTY_STATUS
} from "@shared/schema";
import session from "express-session";
import { z } from "zod";
import { processImages } from "./utils/imageProcessing";
// TODO: Fix Google Cloud Storage TypeScript compatibility issues
// import {
//   ObjectStorageService,
//   ObjectNotFoundError,
// } from "./objectStorage";
import multer from "multer";
import { ObjectStorageService } from "./objectStorage";
import path from "path";

// Configure multer for unlimited file uploads (videos, audio, any duration)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: Infinity, // No file size limit - unlimited duration videos/audio
    fieldSize: Infinity, // No field size limit
    files: Infinity // No file count limit
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
      
      // For phone/WhatsApp/Facebook authentication methods, we'd check for duplicates here
      // This would require additional storage methods we'd need to implement
      
      // For demo purposes, we'll mark users as verified immediately
      // In a production app, email/SMS/WhatsApp verification would be implemented
      const userWithVerification = {
        ...userData,
        isAdmin: false, // Ensure regular users can't register as admin
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
      
      if (type) filters.type = type as string;
      if (location) filters.location = location as string;
      if (minPrice) filters.minPrice = parseInt(minPrice as string);
      if (maxPrice) filters.maxPrice = parseInt(maxPrice as string);
      
      // Support country+city filtering for main feed (Hero search)
      if (req.query.city && req.query.city !== 'any') {
        const cityName = getCityFullName(req.query.city as string);
        if (cityName) {
          filters.location = cityName;
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
      res.json(properties);
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

  app.post("/api/properties", isAuthenticated, async (req, res) => {
    try {
      const propertyData = insertPropertySchema.parse(req.body);
      
      // Allow regular users to submit projects, but they need admin approval
      // Projects are always created with pending status unless user is admin
      
      // Add watermark to all property images
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to images:', err);
        // Continue with original images if watermarking fails
      }
      
      // Set current user as owner
      const property = await storage.createProperty({
        ...propertyData,
        ownerId: req.session.userId!
      });
      
      // If this is a project, create project details (for both admin and regular users)
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
      
      res.status(201).json(property);
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
      // First create the property
      const propertyData = insertPropertySchema.parse({
        ...req.body.property,
        propertyType: PROPERTY_TYPES.PROJECT,
        ownerId: req.session.userId!
      });
      
      // Add watermark to all project images
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to project images:', err);
        // Continue with original images if watermarking fails
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

  // Photo upload routes
  app.post("/api/photos/upload", isAuthenticated, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting photo upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.post("/api/photos/process", isAuthenticated, async (req, res) => {
    try {
      const { photoURL } = req.body;
      
      if (!photoURL) {
        return res.status(400).json({ error: "photoURL is required" });
      }

      // Get authenticated user ID from session
      const userId = req.session.userId || 1;

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        photoURL,
        {
          owner: userId.toString(),
          visibility: "public", // Property images should be publicly viewable
        }
      );

      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error processing photo:", error);
      res.status(500).json({ error: "Failed to process photo" });
    }
  });

  // Route to serve uploaded images
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Error serving object:", error);
      // Instead of returning JSON error, redirect to placeholder image for property cards
      if (error.name === 'ObjectNotFoundError') {
        return res.redirect('https://via.placeholder.com/800x600?text=Image+Not+Found');
      }
      return res.status(404).json({ error: "Object not found" });
    }
  });

  // Video upload routes - supports unlimited duration  
  app.post("/api/videos/upload", isAuthenticated, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting video upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.post("/api/videos/process", isAuthenticated, async (req, res) => {
    try {
      const { videoURL } = req.body;
      
      if (!videoURL) {
        return res.status(400).json({ error: "videoURL is required" });
      }

      // Return the path for local storage
      res.status(200).json({ objectPath: videoURL });
    } catch (error) {
      console.error("Error processing video:", error);
      res.status(500).json({ error: "Failed to process video" });
    }
  });

  // Audio upload routes - supports unlimited duration MP3, MP4 audio, etc.
  app.post("/api/audios/upload", isAuthenticated, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL: uploadUrl });
    } catch (error) {
      console.error("Error getting audio upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.post("/api/audios/process", isAuthenticated, async (req, res) => {
    try {
      const { audioURL } = req.body;
      
      if (!audioURL) {
        return res.status(400).json({ error: "audioURL is required" });
      }

      // Return the path for local storage
      res.status(200).json({ objectPath: audioURL });
    } catch (error) {
      console.error("Error processing audio:", error);
      res.status(500).json({ error: "Failed to process audio" });
    }
  });

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Blog routes
  app.get("/api/blog", async (req, res) => {
    try {
      const { published = true, authorId, category } = req.query;
      
      const filters: any = {};
      if (published !== undefined) filters.published = published === 'true';
      if (authorId) filters.authorId = parseInt(authorId as string);
      if (category) filters.category = category as string;
      
      const blogPosts = await storage.getBlogPosts(filters);
      res.json(blogPosts);
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/blog/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const blogPost = await storage.getBlogPostById(id);
      
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }
      
      res.json(blogPost);
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });





  // Serve public objects - temporarily disabled until object storage is fixed
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    // TODO: Implement public object serving after fixing Google Cloud Storage issues
    res.status(503).json({ error: "Public object serving temporarily unavailable" });
  });

  // Helper function to convert city codes to full names for filtering
  function getCityFullName(cityCode: string): string | null {
    const cityMap: Record<string, string> = {
      'batumi': 'Batumi',
      'tbilisi': 'Tbilisi', 
      'dubai': 'Dubai',
      'sharjah': 'Sharjah',
      'ras-al-khaimah': 'Ras Al Khaimah'
    };
    return cityMap[cityCode] || null;
  }

  return httpServer;
}
