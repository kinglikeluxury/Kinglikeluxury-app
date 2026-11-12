import type { Express, Request, Response } from "express";
import type { IStorage } from "./storage";
import { PROPERTY_STATUS, PROPERTY_TYPES, type Property } from "@shared/schema";
import { buildPropertyLocationFilter } from "./propertyLocationFilter";

type ReadStorage = Pick<IStorage, "getProperties" | "getProjects"> & {
  getPropertiesByType(propertyType: string): Promise<Property[]>;
};

export function registerPropertyProjectReadRoutes(
  app: Express,
  storage: ReadStorage,
  getLocationFilter: (cityCode: string) => string | null,
): void {
  app.get("/api/properties", async (req: Request, res: Response) => {
    try {
      const { type, status = PROPERTY_STATUS.APPROVED, location, minPrice, maxPrice, includeAll } = req.query;
      let filters: Record<string, unknown> = { status };

      if (includeAll === "true") filters.includeAllTypes = true;

      if (type) {
        switch (type) {
          case "studio":
            filters.type = "apartment";
            filters.bedrooms = 0;
            break;
          case "one-bedroom":
            filters.type = "apartment";
            filters.bedrooms = 1;
            break;
          case "two-bedrooms":
            filters.type = "apartment";
            filters.bedrooms = 2;
            break;
          case "three-bedrooms":
            filters.type = "apartment";
            filters.bedrooms = 3;
            break;
          case "doublex":
            filters.type = "apartment";
            break;
          default:
            filters.type = type as string;
        }
      }

      if (location && location !== "any") filters.location = location as string;
      if (minPrice) filters.minPrice = parseInt(minPrice as string);
      if (maxPrice) filters.maxPrice = parseInt(maxPrice as string);

      const countryQuery = typeof req.query.country === "string" ? req.query.country : "";
      const cityQuery =
        typeof req.query.city === "string" && req.query.city !== "any" ? req.query.city : "";

      if (countryQuery && countryQuery !== "any") {
        const geoFilter = buildPropertyLocationFilter(countryQuery, cityQuery || undefined);
        if (!geoFilter) return res.json([]);
        filters.countryLocationRegex = geoFilter.countryRegex;
        filters.cityLocationRegex = geoFilter.cityRegex;
      } else if (cityQuery) {
        const locationFilter = getLocationFilter(cityQuery);
        if (locationFilter) filters.locationContains = locationFilter;
      }

      const session = (req as Request & { session?: { userId?: number; isAdmin?: boolean } }).session;
      if (session?.isAdmin && req.query.status) {
        if (req.query.status === "all") delete filters.status;
        else filters.status = req.query.status as string;
      }
      if (session?.userId && !session.isAdmin && req.query.myProperties) {
        filters = { ownerId: session.userId };
      }

      const properties = await storage.getProperties(filters as Parameters<IStorage["getProperties"]>[0]);
      const sortedProperties = properties.sort((a, b) => {
        const now = new Date();
        const aIsActive = !a.listingExpiresAt || new Date(a.listingExpiresAt) > now;
        const bIsActive = !b.listingExpiresAt || new Date(b.listingExpiresAt) > now;
        const aListingType = aIsActive ? a.listingType : "regular";
        const bListingType = bIsActive ? b.listingType : "regular";
        const priorities = { super_vip: 3, vip: 2, regular: 1 };
        const aPriority = priorities[aListingType as keyof typeof priorities] || 1;
        const bPriority = priorities[bListingType as keyof typeof priorities] || 1;
        if (aPriority !== bPriority) return bPriority - aPriority;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      return res.json(sortedProperties);
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/projects", async (_req: Request, res: Response) => {
    try {
      const [dedicatedProjects, projectProperties] = await Promise.all([
        storage.getProjects(),
        storage.getPropertiesByType(PROPERTY_TYPES.PROJECT),
      ]);
      const dedicatedPropertyIds = new Set(dedicatedProjects.map((project) => project.propertyId));
      const standaloneProjectProperties = projectProperties.filter(
        (property) => !dedicatedPropertyIds.has(property.id),
      );
      const propertyProjects = standaloneProjectProperties.map((property) => ({
        id: `property-${property.id}`,
        propertyId: property.id,
        developer: property.title,
        completionDate: "Q4 2024",
        projectStatus: "Now Selling",
        createdAt: property.createdAt,
        property,
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
        ownerId: property.ownerId,
      }));
      return res.json([...dedicatedProjects, ...propertyProjects]);
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });
}
