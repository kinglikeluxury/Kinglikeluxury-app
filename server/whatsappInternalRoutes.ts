import type { Express, NextFunction, Request, Response } from "express";
import {
  createRequireWhatsappEmployee,
  getAttachedWhatsappActor,
  requireWhatsappAdmin,
} from "./whatsappInternalAuth";
import { WhatsappInternalServiceError, whatsappInternalService } from "./whatsappInternalService";
import type { WhatsappListQuery } from "./whatsappInternalRepository";
import type { WhatsappUserLookup } from "./whatsappInternalAuth";
import { storage } from "./storage";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_SEARCH_LENGTH = 100;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const rateBuckets = new Map<string, number[]>();

/** Small, route-local limiter; it does not affect the rest of the API. */
export function whatsappInternalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (rateBuckets.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ message: "Too many WhatsApp monitoring requests" });
    return;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  next();
}

export function clearWhatsappInternalRateLimit(): void {
  rateBuckets.clear();
}

function singleQueryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseNonNegativeInteger(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new WhatsappInternalServiceError(400, `Invalid ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WhatsappInternalServiceError(400, `Invalid ${field}`);
  }
  return parsed;
}

function parseLimit(value: unknown): number {
  const limit = parseNonNegativeInteger(value, "limit", DEFAULT_LIMIT);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new WhatsappInternalServiceError(400, "limit must be between 1 and 100");
  }
  return limit;
}

export function parseListQuery(req: Request, allowEmployeeId: boolean): WhatsappListQuery {
  const allowedKeys = new Set(["offset", "limit", "search", ...(allowEmployeeId ? ["employeeId"] : [])]);
  if (Object.keys(req.query).some((key) => !allowedKeys.has(key))) {
    throw new WhatsappInternalServiceError(400, "Unsupported query parameter");
  }
  const search = singleQueryValue(req.query.search);
  if (req.query.search !== undefined && search === undefined) {
    throw new WhatsappInternalServiceError(400, "Invalid search");
  }
  if (search && search.length > MAX_SEARCH_LENGTH) {
    throw new WhatsappInternalServiceError(400, "search is too long");
  }

  const employeeId = singleQueryValue(req.query.employeeId);
  if (req.query.employeeId !== undefined && (!allowEmployeeId || !employeeId || !/^[a-z][a-z0-9-]{1,40}$/.test(employeeId))) {
    throw new WhatsappInternalServiceError(400, "Invalid employeeId");
  }

  return {
    offset: parseNonNegativeInteger(req.query.offset, "offset", 0),
    limit: parseLimit(req.query.limit),
    ...(search ? { search } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
}

function parseConversationId(req: Request): string {
  const id = req.params.id;
  if (!/^[a-z][a-z0-9-]{2,80}$/.test(id)) {
    throw new WhatsappInternalServiceError(400, "Invalid conversation ID");
  }
  return id;
}

function parseNote(req: Request): string {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new WhatsappInternalServiceError(400, "Request body must be an object");
  }
  const keys = Object.keys(req.body);
  if (keys.some((key) => key !== "text")) {
    throw new WhatsappInternalServiceError(400, "Only text is accepted");
  }
  if (typeof req.body.text !== "string" || req.body.text.trim().length < 1 || req.body.text.length > 2000) {
    throw new WhatsappInternalServiceError(400, "text must be between 1 and 2000 characters");
  }
  return req.body.text;
}

function respondWithError(res: Response, error: unknown): void {
  if (error instanceof WhatsappInternalServiceError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  console.error("[WhatsApp internal] request failed:", error instanceof Error ? error.message : error);
  res.status(500).json({ message: "Unable to access WhatsApp mock data" });
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch((error) => {
      if (res.headersSent) return next(error);
      respondWithError(res, error);
    });
  };
}

export function registerWhatsappInternalRoutes(
  app: Express,
  userLookup: WhatsappUserLookup = async (userId) => storage.getUser(userId),
): void {
  const requireWhatsappEmployee = createRequireWhatsappEmployee(userLookup);

  app.get("/api/admin/whatsapp/employees", whatsappInternalRateLimit, requireWhatsappAdmin, asyncRoute(async (req, res) => {
    const result = await whatsappInternalService.listEmployees(req, getAttachedWhatsappActor(req), parseListQuery(req, false));
    res.json({ ...result, mode: "mock" });
  }));

  app.get("/api/admin/whatsapp/conversations", whatsappInternalRateLimit, requireWhatsappAdmin, asyncRoute(async (req, res) => {
    const result = await whatsappInternalService.listConversations(req, getAttachedWhatsappActor(req), parseListQuery(req, true));
    res.json({ ...result, mode: "mock" });
  }));

  app.get("/api/admin/whatsapp/conversations/:id/messages", whatsappInternalRateLimit, requireWhatsappAdmin, asyncRoute(async (req, res) => {
    const result = await whatsappInternalService.getConversationMessages(req, getAttachedWhatsappActor(req), parseConversationId(req));
    res.json({ ...result, mode: "mock" });
  }));

  app.post("/api/admin/whatsapp/conversations/:id/notes", whatsappInternalRateLimit, requireWhatsappAdmin, asyncRoute(async (req, res) => {
    const conversationId = parseConversationId(req);
    const note = await whatsappInternalService.addInternalNote(req, getAttachedWhatsappActor(req), conversationId, parseNote(req));
    res.status(201).json({ note, mode: "mock", persistence: "memory_until_restart" });
  }));

  app.get("/api/employee/whatsapp/conversations", whatsappInternalRateLimit, requireWhatsappEmployee, asyncRoute(async (req, res) => {
    const query = parseListQuery(req, false);
    const result = await whatsappInternalService.listConversations(req, getAttachedWhatsappActor(req), query);
    res.json({ ...result, mode: "mock" });
  }));

  app.get("/api/employee/whatsapp/conversations/:id/messages", whatsappInternalRateLimit, requireWhatsappEmployee, asyncRoute(async (req, res) => {
    const result = await whatsappInternalService.getConversationMessages(req, getAttachedWhatsappActor(req), parseConversationId(req));
    res.json({ ...result, mode: "mock" });
  }));
}