import type { NextFunction, Request, Response } from "express";

export const WHATSAPP_EMPLOYEE_ROLE = "sub_agent" as const;

export interface WhatsappActor {
  userId: number;
  role: string;
  isAdmin: boolean;
}

export function getWhatsappActor(req: Request): WhatsappActor | null {
  const session = req.session;
  const userId = session?.userId;
  if (!Number.isSafeInteger(userId)) return null;

  return {
    userId: userId as number,
    role: typeof session.role === "string" ? session.role : "",
    isAdmin: session.isAdmin === true,
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

export function requireWhatsappEmployee(req: Request, res: Response, next: NextFunction): void {
  const actor = getWhatsappActor(req);
  if (!actor) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  if (!isWhatsappEmployee(actor)) {
    res.status(403).json({ message: "Not authorized" });
    return;
  }
  attachActor(req, actor);
  next();
}

export function getAttachedWhatsappActor(req: Request): WhatsappActor {
  const actor = (req as Request & { whatsappActor?: WhatsappActor }).whatsappActor;
  if (!actor) throw new Error("WhatsApp actor middleware was not applied");
  return actor;
}