import type { Request } from "express";

export async function establishAuthenticatedSession(
  req: Request,
  user: { id: number; isAdmin: boolean; role?: string | null },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
  req.session.userId = user.id;
  req.session.isAdmin = user.isAdmin;
  req.session.role = user.role ?? "user";
  await new Promise<void>((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}
