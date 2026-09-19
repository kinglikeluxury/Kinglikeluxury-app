import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildKayRecordingObjectKey,
  KAY_RECORDING_UPLOAD_SOURCE,
  normalizeKayRecordingContentType,
  performKayRecordingUpload,
} from "./kayRecordingService";
import { KAY_RECORDING_MAX_AUDIO_BYTES } from "./kayRecordingStorage";

const session = {
  employee_id: 29,
  archive_type: "EMPLOYEE_CALL" as const,
  recording_status: "UPLOADING",
  storage_upload_status: "PENDING",
  ended_at: "2026-09-19T14:05:06.000Z",
  call_started_at: "2026-09-19T14:00:00.000Z",
  created_at: "2026-09-19T14:00:00.000Z",
};

function input(overrides: Partial<Parameters<typeof performKayRecordingUpload>[0]> = {}) {
  return {
    source: KAY_RECORDING_UPLOAD_SOURCE,
    callSessionId: 77,
    audio: Buffer.from("synthetic-audio"),
    contentType: "audio/webm",
    ...overrides,
  };
}

function dependencies(overrides: Partial<Parameters<typeof performKayRecordingUpload>[1]> = {}) {
  return {
    loadSession: async () => session,
    uploadObject: async () => ({
      bytesUploaded: 15,
      sha256: "synthetic-sha256",
      etag: "synthetic-etag",
      checksumSha256: null,
    }),
    persist: async () => ({ rows: [{ id: 77 }] }),
    markFailed: async () => ({ rows: [{ id: 77 }] }),
    ...overrides,
  };
}

test("upload authorization accepts only the internal Kay lifecycle source", async () => {
  await assert.rejects(
    () => performKayRecordingUpload(input({ source: "http-route" as any }), dependencies()),
    (error: any) => error.code === "KAY_RECORDING_UPLOAD_UNAUTHORIZED" && error.status === 403,
  );
});

test("audio MIME validation accepts the supported formats and rejects arbitrary types", () => {
  assert.equal(normalizeKayRecordingContentType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(normalizeKayRecordingContentType("audio/ogg"), "audio/ogg");
  assert.equal(normalizeKayRecordingContentType("audio/wav"), "audio/wav");
  assert.throws(
    () => normalizeKayRecordingContentType("audio/mpeg"),
    (error: any) => error.code === "KAY_RECORDING_UNSUPPORTED_AUDIO_TYPE" && error.status === 415,
  );
});

test("object keys use employee ids and UTC date segments without employee or customer PII", () => {
  assert.equal(
    buildKayRecordingObjectKey({
      employeeId: 29,
      callSessionId: 77,
      recordedAt: "2026-09-19T14:05:06.000Z",
      extension: "audio/webm",
    }),
    "kay-recordings/employee-29/2026/09/19/77.webm",
  );
  assert.equal(
    buildKayRecordingObjectKey({
      employeeId: null,
      callSessionId: 78,
      recordedAt: "2026-09-19T14:05:06.000Z",
      extension: "audio/ogg",
    }),
    "kay-recordings/manager-debrief/2026/09/19/78.ogg",
  );
});

test("successful upload persists READY only after the storage upload succeeds", async () => {
  const events: string[] = [];
  const result = await performKayRecordingUpload(input(), dependencies({
    uploadObject: async payload => {
      events.push(`upload:${payload.objectKey}`);
      return { bytesUploaded: payload.body.length, sha256: "sha", etag: "etag", checksumSha256: null };
    },
    persist: async payload => {
      events.push(`persist:${payload.objectKey}`);
      return { rows: [{ id: 77 }] };
    },
    markFailed: async () => {
      events.push("failed");
      return { rows: [] };
    },
  }));
  assert.equal(result.objectKey, "kay-recordings/employee-29/2026/09/19/77.webm");
  assert.deepEqual(events, [
    "upload:kay-recordings/employee-29/2026/09/19/77.webm",
    "persist:kay-recordings/employee-29/2026/09/19/77.webm",
  ]);
});

test("failed upload marks FAILED and does not persist a READY object", async () => {
  const events: string[] = [];
  await assert.rejects(
    () => performKayRecordingUpload(input(), dependencies({
      uploadObject: async () => {
        events.push("upload");
        throw new Error("synthetic storage failure");
      },
      persist: async () => {
        events.push("persist");
        return { rows: [] };
      },
      markFailed: async () => {
        events.push("failed");
        return { rows: [{ id: 77 }] };
      },
    })),
    (error: any) => error.code === "KAY_RECORDING_UPLOAD_FAILED",
  );
  assert.deepEqual(events, ["upload", "failed"]);
});

test("upload rejects audio above the configured in-memory safety limit", async () => {
  const events: string[] = [];
  await assert.rejects(
    () => performKayRecordingUpload(
      input({ audio: Buffer.alloc(KAY_RECORDING_MAX_AUDIO_BYTES + 1) }),
      dependencies({
        uploadObject: async () => {
          events.push("upload");
          return { bytesUploaded: 0, sha256: "sha", etag: null, checksumSha256: null };
        },
        markFailed: async () => {
          events.push("failed");
          return { rows: [] };
        },
      }),
    ),
    (error: any) => error.code === "KAY_RECORDING_AUDIO_TOO_LARGE" && error.status === 413,
  );
  assert.deepEqual(events, ["failed"]);
});

test("recording upload changes stay outside CRM ownership and do not add an HTTP upload route", () => {
  const routes = readFileSync(new URL("./kayRecordingRoutes.ts", import.meta.url), "utf8");
  const ownership = readFileSync(new URL("./kayDataOwnership.ts", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /app\.(post|put|patch)\([^)]*recordings/i);
  assert.match(ownership, /kay_recording_sessions.*KAY_OWNED.*runtimeWrite: true/);
  for (const table of ["crm_leads", "crm_tasks", "crm_notes", "crm_projects", "users", "lead_assignment_history"]) {
    assert.match(ownership, new RegExp(`name: "${table}", owner: "CRM_OWNED", runtimeWrite: false`));
  }
});