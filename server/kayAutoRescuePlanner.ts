/**
 * Phase E.2's side-effect-free planning rules.  This module deliberately has
 * no database dependency: workers, previews and audits must make identical
 * decisions before any execution gate or write is considered.
 */
export type RescueCandidate = {
  id: number; name: string; activeLeadCount: number; overdueTaskCount: number;
  /** True only for A→B→A within the production 30 day ping-pong window. */
  pingPongPrevented?: boolean;
  /** Retained for old Phase-B callers; it is a ranking penalty, not E.2 eligibility. */
  recentPreviousOwner?: boolean;
};
export const rescueAttemptPredicate = `(reason IN ('kay_rescue','kay_rescue_assisted','kay_rescue_automatic')
  AND (automatic=true OR metadata->>'mode' IN ('assisted','automatic')))`;
/** SQL fragments deliberately shared by E.2 worker/auditors. */
export const rescuePingPongPredicate = `h.from_user_id=$1 AND h.to_user_id=$2 AND h.assigned_at>NOW()-interval '30 days'`;
export type RescueBlocker = "PROTECTED_LEAD" | "FOLLOWUP_SCHEDULED" | "ACTIVE_TASK" | "OWNER_UNAVAILABLE";
export type RescueState = "ACTIVE" | "BLOCKED" | "STALE" | "NOT_YET_ELIGIBLE" | "SIMULATED_LIMIT_REACHED";

export function recommendRescueEmployee(candidates: RescueCandidate[], currentOwnerId: number | null | undefined) {
  // This is an eligibility exclusion, not a capacity penalty. It is exactly
  // the worker's NOT EXISTS A→B→A condition.
  const eligible = candidates.filter(candidate => candidate.id !== currentOwnerId && !candidate.pingPongPrevented);
  if (!eligible.length) return { candidate: null, managerReview: true, explanation: "NO_ELIGIBLE_EMPLOYEE", capacityScore: null };
  const ranked = eligible.map(candidate => ({
    candidate,
    capacityScore: candidate.activeLeadCount + 2 * candidate.overdueTaskCount + (candidate.recentPreviousOwner ? 1000 : 0),
  })).sort((a, b) => a.capacityScore - b.capacityScore || a.candidate.id - b.candidate.id);
  const winner = ranked[0];
  return {
    candidate: winner.candidate, managerReview: false, capacityScore: winner.capacityScore,
    explanation: `Lower fair workload selected: ${winner.candidate.activeLeadCount} active leads + 2×${winner.candidate.overdueTaskCount} overdue tasks${winner.candidate.recentPreviousOwner ? "; prior-owner penalty applied because no lower alternative exists" : ""}.`,
  };
}

export function evaluateRescueWindow(input: {
  status: string; statusEnteredAt: Date | null; now: Date; thresholdHours: number;
  blockers?: RescueBlocker[]; rescueAttempts?: number; maxAttempts?: number;
}): { eligible: boolean; state: RescueState | null; elapsedMinutes: number; blockers: RescueBlocker[] } {
  const blockers = (input.blockers ?? []).filter(blocker => blocker !== "OWNER_UNAVAILABLE");
  const elapsedMinutes = input.statusEnteredAt ? Math.max(0, Math.floor((input.now.getTime() - input.statusEnteredAt.getTime()) / 60_000)) : 0;
  if (!["no_answer_1", "no_answer_2"].includes(input.status) || !input.statusEnteredAt) return { eligible: false, state: null, elapsedMinutes, blockers };
  if ((input.rescueAttempts ?? 0) >= (input.maxAttempts ?? 2)) return { eligible: false, state: "SIMULATED_LIMIT_REACHED", elapsedMinutes, blockers };
  if (elapsedMinutes < input.thresholdHours * 60) return { eligible: false, state: "NOT_YET_ELIGIBLE", elapsedMinutes, blockers };
  return blockers.length ? { eligible: false, state: "BLOCKED", elapsedMinutes, blockers } : { eligible: true, state: "ACTIVE", elapsedMinutes, blockers };
}

/** Deterministic equivalent of the worker's daily reservations, in input order. */
export function simulateDailyLimits<T extends { ownerId: number }>(items: T[], globalLimit: number, perOwnerLimit: number, initialGlobal = 0, initialPerOwner = new Map<number, number>()) {
  let global = initialGlobal; const owners = new Map(initialPerOwner); const executable: T[] = []; let deferredGlobal = 0; let deferredEmployee = 0;
  for (const item of items) {
    if (global >= globalLimit) { deferredGlobal++; continue; }
    const owner = owners.get(item.ownerId) ?? 0;
    if (owner >= perOwnerLimit) { deferredEmployee++; continue; }
    executable.push(item); global++; owners.set(item.ownerId, owner + 1);
  }
  return { executable, deferredGlobal, deferredEmployee };
}