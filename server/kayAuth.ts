import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Kay inspection/configuration is deliberately gated by the application's
 * existing session identity fields, rather than a client-provided role.
 */
type AdminLookup = (userId: number) => Promise<boolean>;
const liveAdminLookup: AdminLookup = async userId => {
  const result = await db.execute(sql`SELECT is_admin FROM users WHERE id=${userId} LIMIT 1`).catch(() => null);
  return result?.rows[0]?.is_admin === true;
};

export function createRequireKayAdmin(lookup: AdminLookup) {
return async function requireKayAdminMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  // Authorize against the current database role, not a stale/session-controlled
  // flag. A revoked administrator loses Kay company access immediately.
  if (!(await lookup(req.session.userId))) {
    res.status(403).json({ message: "Not authorized" });
    return;
  }
  next();
};
}

export const requireKayAdmin = createRequireKayAdmin(liveAdminLookup);