import type { NextFunction, Request, Response } from "express";

export const WHATSAPP_EMPLOYEE_ROLE = "sub_agent" as const;

export interface WhatsappUserRecord {
  id: number;
  role: string | null;
  isAdmin: boolean;
  isActive: boolean;
}

export type WhatsappUserLookup = (userId: number) => Promise<WhatsappUserRecord | undefined>;

export interface WhatsappActor {
  userId: number;
  role: string;
  isAdmin: boolean;
  isActive: boolean;
}

export function getWhatsappActor(req: Request): WhatsappActor | null {
  const session = req.session;
  const userId = session?.userId;
  if (!Number.isSafeInteger(userId)) return null;

  return {
    userId: userId as number,
    role: typeof session.role === "string" ? session.role : "",
    isAdmin: session.isAdmin === true,
    isActive: session.isActive === true,
  };
}

export function isWhatsappEmployee(actor: WhatsappActor): boolean {
  return !actor.isAdmin && actor.role === WHATSAPP_EMPLOYEE_ROLE;
}

function attachActor(req: Request, actor: WhatsappActor): void {
  (req as Request & { whatsappActor?: WhatsappActor }).whatsappActor = actor;
}

export function requireWhatsappAuthentication(req: Request, res: Response, next: NextFunction): void {
  const actor = getWhatsappActor(req);
  if (!actor) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  attachActor(req, actor);
  next();
}

export function requireWhatsappAdmin(req: Request, res: Response, next: NextFunction): void {
  const actor = getWhatsappActor(req);
  if (!actor) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  if (!actor.isAdmin) {
    res.status(403).json({ message: "Not authorized" });
    return;
  }
  attachActor(req, actor);
  next();
}

export function createRequireWhatsappEmployee(userLookup: WhatsappUserLookup) {
  return function requireWhatsappEmployee(req: Request, res: Response, next: NextFunction): void {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId)) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    void userLookup(userId as number).then((user) => {
      if (
        !user ||
        user.isActive !== true ||
        user.role !== WHATSAPP_EMPLOYEE_ROLE ||
        user.isAdmin === true
      ) {
        res.status(403).json({ message: "Not authorized" });
        return;
      }

      const actor: WhatsappActor = {
        userId: user.id,
        role: user.role,
        isAdmin: false,
        isActive: true,
      };

      req.session.isAdmin = false;
      req.session.isActive = true;
      req.session.role = user.role;
      attachActor(req, actor);
      next();
    }).catch(() => {
      console.error("[WhatsApp auth] employee lookup failed");
      if (!res.headersSent) {
        res.status(503).json({ message: "Service temporarily unavailable" });
      }
    });
  };
}

export function getAttachedWhatsappActor(req: Request): WhatsappActor {
  const actor = (req as Request & { whatsappActor?: WhatsappActor }).whatsappActor;
  if (!actor) throw new Error("WhatsApp actor middleware was not applied");
  return actor;
}