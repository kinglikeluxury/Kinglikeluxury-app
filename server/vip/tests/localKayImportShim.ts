/**
 * Prevents DatabaseStorage's unrelated optional post-commit observer from
 * entering or running in this auth/VIP-only integration bundle.
 */
export async function observeLeadAssignmentAfterCommit(): Promise<void> {
  return undefined;
}
