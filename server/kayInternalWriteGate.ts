import { getKayDataOwnership } from "./kayDataOwnership";
import { verifyKayInternalDatabase } from "./kayInternalDatabase";

export const KAY_INTERNAL_WRITE_TARGETS = Object.freeze([
  "kay_events",
  "kay_decisions",
  "kay_evaluator_queue",
  "kay_missions",
  "kay_commitments",
  "kay_promises",
  "kay_internal_briefings",
  "kay_manager_reviews",
  "kay_runtime_state",
] as const);

export interface KayInternalWriteRequest {
  operation: "KAY_INTERNAL_WRITE";
  table: string;
  externalSideEffect?: boolean;
  frozenExecution?: boolean;
}

const approved = new Set<string>(KAY_INTERNAL_WRITE_TARGETS);

export class KayInternalWriteDeniedError extends Error {
  readonly code = "KAY_INTERNAL_WRITE_DENIED";
  readonly status = 423;
  constructor(reason: string) {
    super(`KAY_INTERNAL_WRITE_DENIED:${reason}`);
    this.name = "KayInternalWriteDeniedError";
  }
}

export async function assertKayInternalWriteAllowed(request: KayInternalWriteRequest): Promise<void> {
  if (request.operation !== "KAY_INTERNAL_WRITE") throw new KayInternalWriteDeniedError("INVALID_OPERATION");
  if (request.externalSideEffect === true) throw new KayInternalWriteDeniedError("EXTERNAL_SIDE_EFFECT");
  if (request.frozenExecution === true) throw new KayInternalWriteDeniedError("FROZEN_EXECUTION");
  const table = String(request.table || "").trim().toLowerCase();
  const ownership = getKayDataOwnership(table);
  if (ownership.owner !== "KAY_OWNED" || ownership.runtimeWrite !== true) {
    throw new KayInternalWriteDeniedError("TARGET_NOT_KAY_OWNED");
  }
  if (!approved.has(table)) throw new KayInternalWriteDeniedError("TARGET_NOT_APPROVED");
  await verifyKayInternalDatabase();
}