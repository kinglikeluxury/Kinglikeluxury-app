export type KayMission = {
  id: number;
  leadId: number | null;
  missionType: string;
  priority: string;
  priorityScore: number;
  status: string;
  objective: string;
  suggestedAction: string;
  dueAt: string | null;
  completedAt: string | null;
  reasonDetails?: {
    explanation?: string;
    factors?: { label: string; points: number }[];
  };
  historicalObligation?: boolean;
};

export type KayMissionData = {
  missions: KayMission[];
  next60Minutes: KayMission[];
  maxNext60MinutesItems: number | null;
};

export type KayBriefing = {
  id: number;
  text: string;
  acknowledgedAt: string | null;
  deepLink: string | null;
  severity: string;
};

export type KayCommitment = {
  id: number;
  action: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
};

export type KayPromise = {
  id: number;
  promiseText: string;
  status: string;
  importance: string;
  dueAt: string | null;
  completedAt: string | null;
};

export type KayHandoff = {
  id: number;
  promiseText: string;
  dueAt: string | null;
  acceptedAt: string | null;
  importance: string | null;
  originalOwnerId: number | null;
};

export type KayVoiceSettings = {
  voiceEnabled: boolean | null;
  defaultLanguage: string | null;
  speechRate: number | null;
  speechPitch: number | null;
  preferredVoiceName: string | null;
  profile: {
    language?: string;
    preferredVoiceName?: string | null;
  } | null;
};

export type KayAvailability = {
  availability: string | null;
  updatedAt: string | null;
};

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" ? value as RawRecord : {};
}

function valueAt(source: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function nullableString(value: unknown): string | null {
  if (value == null || value === "") return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value: unknown): number | null {
  const result = numberValue(value, Number.NaN);
  return Number.isFinite(result) ? result : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function adaptMission(raw: unknown): KayMission {
  const source = record(raw);
  const reasonDetails = record(valueAt(source, "reasonDetails", "reason_details"));
  const rawFactors = valueAt(reasonDetails, "factors");
  const factors = Array.isArray(rawFactors)
    ? rawFactors.map((factor) => {
      const item = record(factor);
      return {
        label: stringValue(item.label),
        points: numberValue(item.points),
      };
    })
    : undefined;

  return {
    id: numberValue(source.id),
    leadId: nullableNumber(valueAt(source, "leadId", "lead_id")),
    missionType: stringValue(valueAt(source, "missionType", "mission_type")),
    priority: stringValue(source.priority),
    priorityScore: numberValue(valueAt(source, "priorityScore", "priority_score")),
    status: stringValue(source.status),
    objective: stringValue(source.objective),
    suggestedAction: stringValue(valueAt(source, "suggestedAction", "suggested_action")),
    dueAt: nullableString(valueAt(source, "dueAt", "due_at")),
    completedAt: nullableString(valueAt(source, "completedAt", "completed_at")),
    reasonDetails: Object.keys(reasonDetails).length
      ? {
        explanation: nullableString(valueAt(reasonDetails, "explanation")) ?? undefined,
        factors,
      }
      : undefined,
    historicalObligation: source.historicalObligation === true || source.historical_obligation === true,
  };
}

export function adaptMissionData(raw: unknown): KayMissionData {
  const source = record(raw);
  const settings = record(source.settings);
  return {
    missions: asArray(source.missions).map(adaptMission),
    next60Minutes: asArray(valueAt(source, "next60Minutes", "next_60_minutes")).map(adaptMission),
    maxNext60MinutesItems: nullableNumber(valueAt(settings, "maxNext60MinutesItems", "max_next_60_minutes_items")),
  };
}

export function adaptBriefing(raw: unknown): KayBriefing {
  const source = record(raw);
  return {
    id: numberValue(source.id),
    text: stringValue(source.text),
    acknowledgedAt: nullableString(valueAt(source, "acknowledgedAt", "acknowledged_at")),
    deepLink: nullableString(valueAt(source, "deepLink", "deep_link")),
    severity: stringValue(source.severity),
  };
}

export function adaptBriefingsPayload(raw: unknown): { briefings: KayBriefing[] } {
  return { briefings: asArray(record(raw).briefings).map(adaptBriefing) };
}

export function adaptCommitment(raw: unknown): KayCommitment {
  const source = record(raw);
  return {
    id: numberValue(source.id),
    action: stringValue(source.action),
    status: stringValue(source.status),
    dueAt: nullableString(valueAt(source, "dueAt", "due_at")),
    completedAt: nullableString(valueAt(source, "completedAt", "completed_at")),
  };
}

export function adaptCommitmentsPayload(raw: unknown): { commitments: KayCommitment[] } {
  return { commitments: asArray(record(raw).commitments).map(adaptCommitment) };
}

export function adaptPromise(raw: unknown): KayPromise {
  const source = record(raw);
  return {
    id: numberValue(source.id),
    promiseText: stringValue(valueAt(source, "promiseText", "promise_text")),
    status: stringValue(source.status),
    importance: stringValue(source.importance),
    dueAt: nullableString(valueAt(source, "dueAt", "due_at")),
    completedAt: nullableString(valueAt(source, "completedAt", "completed_at")),
  };
}

export function adaptPromisesPayload(raw: unknown): { promises: KayPromise[] } {
  return { promises: asArray(record(raw).promises).map(adaptPromise) };
}

export function adaptHandoff(raw: unknown): KayHandoff {
  const source = record(raw);
  return {
    id: numberValue(source.id),
    promiseText: stringValue(valueAt(source, "promiseText", "promise_text")),
    dueAt: nullableString(valueAt(source, "dueAt", "due_at")),
    acceptedAt: nullableString(valueAt(source, "acceptedAt", "accepted_at")),
    importance: nullableString(source.importance),
    originalOwnerId: nullableNumber(valueAt(source, "originalOwnerId", "original_owner_id")),
  };
}

export function adaptHandoffsPayload(raw: unknown): { handoffs: KayHandoff[] } {
  return { handoffs: asArray(record(raw).handoffs).map(adaptHandoff) };
}

export function adaptVoiceSettings(raw: unknown): KayVoiceSettings {
  const source = record(raw);
  const rawProfile = record(source.profile);
  return {
    voiceEnabled: typeof valueAt(source, "voiceEnabled", "voice_enabled") === "boolean"
      ? valueAt(source, "voiceEnabled", "voice_enabled") as boolean
      : null,
    defaultLanguage: nullableString(valueAt(source, "defaultLanguage", "default_language")),
    speechRate: nullableNumber(valueAt(source, "speechRate", "speech_rate")),
    speechPitch: nullableNumber(valueAt(source, "speechPitch", "speech_pitch")),
    preferredVoiceName: nullableString(valueAt(source, "preferredVoiceName", "preferred_voice_name")),
    profile: Object.keys(rawProfile).length
      ? {
        language: nullableString(rawProfile.language) ?? undefined,
        preferredVoiceName: nullableString(valueAt(rawProfile, "preferredVoiceName", "preferred_voice_name")),
      }
      : null,
  };
}

export function adaptAvailability(raw: unknown): KayAvailability {
  const source = record(raw);
  return {
    availability: nullableString(source.availability),
    updatedAt: nullableString(valueAt(source, "updatedAt", "updated_at")),
  };
}

export function isLocalDateToday(value: string | Date | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function completedToday<T extends { status: string; completedAt: string | null }>(
  items: T[],
  now = new Date(),
): T[] {
  return items.filter((item) => item.status.toUpperCase() === "COMPLETED" && isLocalDateToday(item.completedAt, now));
}

export const promiseGroupNames = ["Overdue", "Due soon", "Upcoming", "Completed today"] as const;
export type PromiseGroupName = typeof promiseGroupNames[number];

export function groupPromises(items: KayPromise[], now = new Date()): ReadonlyArray<readonly [PromiseGroupName, KayPromise[]]> {
  const grouped = new Map<PromiseGroupName, KayPromise[]>(
    promiseGroupNames.map((name) => [name, []]),
  );

  for (const item of items) {
    const status = item.status.toUpperCase();
    if (status === "CANCELLED") continue;
    if (status === "COMPLETED") {
      if (isLocalDateToday(item.completedAt, now)) grouped.get("Completed today")?.push(item);
      continue;
    }

    const due = item.dueAt ? new Date(item.dueAt) : null;
    const dueTime = due?.getTime() ?? Number.NaN;
    const group = Number.isFinite(dueTime) && dueTime < now.getTime()
      ? "Overdue"
      : Number.isFinite(dueTime) && dueTime < now.getTime() + 172800000
        ? "Due soon"
        : "Upcoming";
    grouped.get(group)?.push(item);
  }

  return promiseGroupNames.map((name) => [name, grouped.get(name) ?? []] as const);
}