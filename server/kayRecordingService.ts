import { withKayInternalClient } from "./kayInternalDatabase";
import {
  createKayRecordingSignedReadUrl,
  getKayRecordingStorageStatus,
  type KayRecordingStorageStatus,
} from "./kayRecordingStorage";

export type KayRecordingArchiveType = "EMPLOYEE_CALL" | "MANAGER_DEBRIEF";
export type KayRecordingStatus =
  | "NOT_STARTED"
  | "NOTICE_PENDING"
  | "NOTICE_PLAYED"
  | "NOTICE_FAILED"
  | "RECORDING"
  | "FINALIZING"
  | "UPLOADING"
  | "READY"
  | "FAILED";

export const KAY_SUPERVISED_EMPLOYEES = Object.freeze([
  { id: 24, name: "Fadi" },
  { id: 29, name: "Samer" },
  { id: 31, name: "Jwana" },
] as const);

export function isSupervisedKayEmployee(employeeId: number): boolean {
  return KAY_SUPERVISED_EMPLOYEES.some(employee => employee.id === employeeId);
}

function employeeName(employeeId: number | null): string | null {
  return KAY_SUPERVISED_EMPLOYEES.find(employee => employee.id === employeeId)?.name ?? null;
}

function metadataUnavailable(error: any): Error & { status: number; code: string } {
  if (error?.code === "42P01" || error?.code === "42703") {
    return Object.assign(new Error("Kay recording metadata is not installed."), {
      status: 503,
      code: "KAY_RECORDING_METADATA_UNAVAILABLE",
    });
  }
  return error;
}

async function recordingQuery<T>(operation: (client: any) => Promise<T>): Promise<T> {
  try {
    return await withKayInternalClient(operation);
  } catch (error) {
    throw metadataUnavailable(error);
  }
}

export async function listKayRecordings(input: {
  archiveType: KayRecordingArchiveType;
  employeeId?: number;
  limit?: number;
}) {
  if (input.archiveType === "EMPLOYEE_CALL" && input.employeeId !== undefined &&
      !isSupervisedKayEmployee(input.employeeId)) {
    const error = Object.assign(new Error("Only Samer, Fadi, and Jwana have Kay recording archives."), { status: 403 });
    throw error;
  }
  const limit = Math.max(1, Math.min(200, input.limit ?? 100));
  const rows: any = await recordingQuery<any>(result =>
    result.query(
      `SELECT id,archive_type,call_session_id,employee_id,employee_name,counterpart_name,
              call_started_at,answered_at,ended_at,duration_seconds,
              recording_status,notice_status,notice_played_at,notice_failure_reason,
              storage_object_key,media_type,storage_upload_status,
              created_at,updated_at
         FROM kay_recording_sessions
        WHERE archive_type=$1
          AND ($2::integer IS NULL OR employee_id=$2)
        ORDER BY COALESCE(call_started_at,created_at) DESC
        LIMIT $3`,
      [input.archiveType, input.employeeId ?? null, limit],
    ),
  );
  return rows.rows;
}

export async function getKayRecording(id: number) {
  const result: any = await recordingQuery<any>(client =>
    client.query(
      `SELECT id,archive_type,call_session_id,employee_id,employee_name,counterpart_name,
              call_started_at,answered_at,ended_at,duration_seconds,
              recording_status,notice_status,notice_played_at,notice_failure_reason,
              storage_object_key,media_type,storage_upload_status,
              created_at,updated_at
         FROM kay_recording_sessions WHERE id=$1 LIMIT 1`,
      [id],
    ),
  );
  return result.rows[0] ?? null;
}

export async function getKayRecordingArchiveView() {
  const [recordings, managerDebriefs] = await Promise.all([
    listKayRecordings({ archiveType: "EMPLOYEE_CALL" }),
    listKayRecordings({ archiveType: "MANAGER_DEBRIEF" }),
  ]);
  const storage: KayRecordingStorageStatus = getKayRecordingStorageStatus();
  return {
    supervisedEmployees: KAY_SUPERVISED_EMPLOYEES,
    recordings,
    managerDebriefs,
    storage: {
      ...storage,
      playbackAvailable: storage.configured && recordings.some((row: any) => row.recording_status === "READY"),
    },
    controls: { employeeStop: false, employeeDelete: false, consentFlow: false },
  };
}

export async function getKayRecordingPlaybackUrl(
  id: number,
  disposition: "inline" | "attachment" = "inline",
): Promise<string> {
  const recording = await getKayRecording(id);
  if (!recording) throw Object.assign(new Error("Recording not found."), { status: 404 });
  if (recording.recording_status !== "READY" || !recording.storage_object_key) {
    throw Object.assign(new Error("This recording is not available for playback."), {
      status: 409,
      code: "KAY_RECORDING_NOT_READY",
    });
  }
  const signedUrl = createKayRecordingSignedReadUrl(recording.storage_object_key, 300, disposition);
  if (!signedUrl) {
    throw Object.assign(new Error("Private recording storage is not configured."), {
      status: 503,
      code: "KAY_RECORDING_STORAGE_UNAVAILABLE",
    });
  }
  return signedUrl;
}

/**
 * Future lifecycle hooks. These persist metadata only; they never request
 * consent, touch CRM tables, upload audio, or start a call.
 */
export async function ensureKayRecordingSession(input: {
  callSessionId: number;
  archiveType: KayRecordingArchiveType;
  employeeId?: number | null;
  employeeName?: string | null;
  counterpartName?: string | null;
}) {
  if (input.archiveType === "EMPLOYEE_CALL" &&
      (input.employeeId == null || !isSupervisedKayEmployee(input.employeeId))) {
    throw Object.assign(new Error("Kay recording employee is outside the supervised scope."), { status: 403 });
  }
  return recordingQuery(client =>
    client.query(
      `INSERT INTO kay_recording_sessions
        (archive_type,call_session_id,employee_id,employee_name,counterpart_name,recording_status,notice_status)
       VALUES ($1,$2,$3,$4,$5,'NOT_STARTED','NOT_PLAYED')
       ON CONFLICT (call_session_id) DO UPDATE SET
         employee_id=COALESCE(EXCLUDED.employee_id,kay_recording_sessions.employee_id),
         employee_name=COALESCE(EXCLUDED.employee_name,kay_recording_sessions.employee_name),
         counterpart_name=COALESCE(EXCLUDED.counterpart_name,kay_recording_sessions.counterpart_name),
         updated_at=NOW()
       RETURNING *`,
      [
        input.archiveType,
        input.callSessionId,
        input.employeeId ?? null,
        input.employeeName ?? employeeName(input.employeeId ?? null),
        input.counterpartName ?? null,
      ],
    ),
  );
}

export async function onKayCallAnswered(callSessionId: number) {
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET answered_at=COALESCE(answered_at,NOW()),
              call_started_at=COALESCE(call_started_at,NOW()),
              recording_status='NOTICE_PENDING',
              updated_at=NOW()
        WHERE call_session_id=$1 AND recording_status IN ('NOT_STARTED','NOTICE_PENDING')
        RETURNING id`,
      [callSessionId],
    ),
  );
}

export async function onKayRecordingNoticePlayed(callSessionId: number, played: boolean, failureReason?: string) {
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET notice_status=$2,
              notice_played_at=CASE WHEN $2='PLAYED' THEN COALESCE(notice_played_at,NOW()) ELSE notice_played_at END,
              notice_failure_reason=CASE WHEN $2='FAILED' THEN $3 ELSE NULL END,
              recording_status=CASE WHEN $2='PLAYED' THEN 'NOTICE_PLAYED' ELSE 'NOTICE_FAILED' END,
              updated_at=NOW()
        WHERE call_session_id=$1 AND recording_status IN ('NOTICE_PENDING','NOTICE_FAILED','NOTICE_PLAYED')
        RETURNING id,recording_status`,
      [callSessionId, played ? "PLAYED" : "FAILED", failureReason?.slice(0, 500) ?? null],
    ),
  );
}

export async function onKayRecordingStarted(callSessionId: number) {
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET recording_status='RECORDING',updated_at=NOW()
        WHERE call_session_id=$1 AND notice_status='PLAYED' AND recording_status='NOTICE_PLAYED'
        RETURNING id`,
      [callSessionId],
    ),
  );
}

/**
 * The future CRM conversation layer must call this gate before discussion.
 * A failed or missing informational notice is therefore a hard stop, without
 * introducing an employee consent workflow.
 */
export async function canBeginKayCrmDiscussion(callSessionId: number): Promise<boolean> {
  const result: any = await recordingQuery<any>(client =>
    client.query(
      `SELECT notice_status,recording_status
         FROM kay_recording_sessions WHERE call_session_id=$1 LIMIT 1`,
      [callSessionId],
    ),
  );
  return result.rows[0]?.notice_status === "PLAYED" &&
    ["NOTICE_PLAYED", "RECORDING", "FINALIZING", "UPLOADING", "READY"].includes(result.rows[0]?.recording_status);
}

export async function onKayCallEnded(callSessionId: number) {
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET ended_at=COALESCE(ended_at,NOW()),
              duration_seconds=CASE WHEN answered_at IS NULL THEN NULL ELSE GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-answered_at))::integer) END,
              recording_status=CASE WHEN recording_status IN ('RECORDING','NOTICE_PLAYED') THEN 'FINALIZING' ELSE recording_status END,
              updated_at=NOW()
        WHERE call_session_id=$1
        RETURNING id`,
      [callSessionId],
    ),
  );
}

export async function finalizeKayRecordingMetadata(input: {
  callSessionId: number;
  mediaType?: string;
  durationSeconds?: number;
}) {
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET duration_seconds=COALESCE($2,duration_seconds),
              media_type=COALESCE($3,media_type),
              recording_status='UPLOADING',
              storage_upload_status='PENDING',
              updated_at=NOW()
        WHERE call_session_id=$1 AND recording_status='FINALIZING'
        RETURNING id`,
      [input.callSessionId, input.durationSeconds ?? null, input.mediaType?.slice(0, 120) ?? null],
    ),
  );
}

export async function persistKayRecordingUpload(input: {
  callSessionId: number;
  objectKey: string;
  mediaType?: string;
}) {
  if (!getKayRecordingStorageStatus().configured) {
    throw Object.assign(new Error("Private recording storage is not configured."), {
      status: 503,
      code: "KAY_RECORDING_STORAGE_UNAVAILABLE",
    });
  }
  return recordingQuery(client =>
    client.query(
      `UPDATE kay_recording_sessions
          SET storage_object_key=$2,media_type=COALESCE($3,media_type),
              storage_upload_status='COMPLETE',recording_status='READY',updated_at=NOW()
        WHERE call_session_id=$1 AND recording_status='UPLOADING'
        RETURNING id`,
      [input.callSessionId, input.objectKey.trim(), input.mediaType?.slice(0, 120) ?? null],
    ),
  );
}