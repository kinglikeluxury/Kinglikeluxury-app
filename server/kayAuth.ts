import type { Request, Response, NextFunction } from "express";

/**
 * Kay inspection/configuration is deliberately gated by the application's
 * existing session identity fields, rather than a client-provided role.
 */
export function requireKayAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ message: "Not authorized" });
    return;
  }
  next();
}