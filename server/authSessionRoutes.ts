import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { User } from "@shared/schema";
import { isAuthAccountEligible } from "@shared/authFlowUtils";
import {
  createLoginHandler,
  type LoginStorage,
} from "./authLoginRoute";
import type { PhoneOtpAttemptLimiter } from "./phoneOtpProof";
import type { IStorage } from "./storage";

declare module "express-session" {
  interface SessionData {
    userId: number;
    isAdmin: boolean;
    role: string;
  }
}

export type AuthSessionStorage = LoginStorage & Pick<IStorage, "getUser">;

export type AuthSessionCookiePolicy = {
  secure: boolean;
  sameSite: "lax" | "none";
};

const SESSION_COOKIE_NAME = "connect.sid";

function clearSessionCookie(
  res: Response,
  cookiePolicy: AuthSessionCookiePolicy,
): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: cookiePolicy.secure,
    sameSite: cookiePolicy.sameSite,
  });
}

async function destroySession(
  req: Request,
  res: Response,
  cookiePolicy: AuthSessionCookiePolicy,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  clearSessionCookie(res, cookiePolicy);
}

function sessionUserResponse(user: User): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phoneNumber: user.phoneNumber,
    authMethod: user.authMethod,
    isAdmin: user.isAdmin === true,
    role: user.role ?? "user",
  };
}

export function createAuthMeHandler(
  storage: Pick<IStorage, "getUser">,
  cookiePolicy: AuthSessionCookiePolicy,
): RequestHandler {
  return async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || Number(userId) <= 0) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    let user: User | undefined;
    try {
      user = await storage.getUser(Number(userId));
    } catch {
      return res.status(503).json({ message: "Authentication temporarily unavailable" });
    }

    if (!user || !isAuthAccountEligible(user)) {
      try {
        await destroySession(req, res, cookiePolicy);
      } catch {
        return res.status(503).json({ message: "Authentication temporarily unavailable" });
      }
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Keep the legacy session shape current, while never trusting its cached
    // admin/role values for this response or subsequent guarded routes.
    req.session.isAdmin = user.isAdmin === true;
    req.session.role = user.role ?? "user";
    return res.json(sessionUserResponse(user));
  };
}

export function createAuthLogoutHandler(
  cookiePolicy: AuthSessionCookiePolicy,
): RequestHandler {
  return (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      clearSessionCookie(res, cookiePolicy);
      return res.json({ message: "Logged out successfully" });
    });
  };
}

type SessionIdentityResolution = {
  user: User | null;
  unavailable: boolean;
};

export function createSessionAuthGuards(
  storage: Pick<IStorage, "getUser">,
  cookiePolicy: AuthSessionCookiePolicy,
): { isAuthenticated: RequestHandler; isAdmin: RequestHandler } {
  const cache = new WeakMap<Request, Promise<SessionIdentityResolution>>();

  const resolveCurrentUser = (
    req: Request,
    res: Response,
  ): Promise<SessionIdentityResolution> => {
    const existing = cache.get(req);
    if (existing) return existing;

    const resolution = (async (): Promise<SessionIdentityResolution> => {
      const userId = req.session?.userId;
      if (!Number.isSafeInteger(userId) || Number(userId) <= 0) {
        return { user: null, unavailable: false };
      }

      let user: User | undefined;
      try {
        user = await storage.getUser(Number(userId));
      } catch {
        return { user: null, unavailable: true };
      }

      if (!user || !isAuthAccountEligible(user)) {
        try {
          await destroySession(req, res, cookiePolicy);
          return { user: null, unavailable: false };
        } catch {
          return { user: null, unavailable: true };
        }
      }

      req.session.isAdmin = user.isAdmin === true;
      req.session.role = user.role ?? "user";
      return { user, unavailable: false };
    })();

    cache.set(req, resolution);
    return resolution;
  };

  const isAuthenticated: RequestHandler = async (
    req,
    res,
    next: NextFunction,
  ) => {
    const identity = await resolveCurrentUser(req, res);
    if (identity.unavailable) {
      return res.status(503).json({ message: "Authentication temporarily unavailable" });
    }
    if (!identity.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
  };

  const isAdmin: RequestHandler = async (req, res, next: NextFunction) => {
    const identity = await resolveCurrentUser(req, res);
    if (identity.unavailable) {
      return res.status(503).json({ message: "Authentication temporarily unavailable" });
    }
    if (!identity.user || identity.user.isAdmin !== true) {
      return res.status(403).json({ message: "Not authorized" });
    }
    return next();
  };

  return { isAuthenticated, isAdmin };
}

export function registerAuthSessionRoutes(
  app: Express,
  dependencies: {
    storage: AuthSessionStorage;
    comparePassword(plainText: string, hash: string): Promise<boolean>;
    allowPhoneOtpAttempt: PhoneOtpAttemptLimiter;
    cookiePolicy: AuthSessionCookiePolicy;
  },
): void {
  const { storage, comparePassword, allowPhoneOtpAttempt, cookiePolicy } = dependencies;
  app.post(
    "/api/auth/login",
    createLoginHandler({ storage, comparePassword, allowPhoneOtpAttempt }),
  );
  app.post("/api/auth/logout", createAuthLogoutHandler(cookiePolicy));
  app.get("/api/auth/me", createAuthMeHandler(storage, cookiePolicy));
}
