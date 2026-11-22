export function canAccessStagingArchive(actor: {
  isAdmin?: unknown;
  role?: unknown;
} | null | undefined): boolean {
  return actor?.isAdmin === true && actor.role === "owner_approver";
}
