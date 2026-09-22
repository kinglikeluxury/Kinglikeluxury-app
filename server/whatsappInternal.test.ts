import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Request, Response } from "express";
import {
  getWhatsappActor,
  isWhatsappEmployee,
  requireWhatsappAdmin,
  requireWhatsappEmployee,
} from "./whatsappInternalAuth";
import { clearWhatsappAuditEntries, getWhatsappAuditEntries } from "./whatsappInternalAudit";
import {
  clearMockWhatsappInternalNotes,
  MockWhatsappInternalRepository,
} from "./whatsappInternalRepository";
import { WhatsappInternalService } from "./whatsappInternalService";
import { parseListQuery } from "./whatsappInternalRoutes";

const request = (session: Record<string, unknown> = {}, body?: unknown): Request =>
  ({ session, body, headers: {}, header: () => undefined } as unknown as Request);

function response() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return { res: res as unknown as Response, get statusCode() { return statusCode; }, get body() { return body; } };
}

async function serviceFor(req = request()) {
  return new WhatsappInternalService(new MockWhatsappInternalRepository());
}

test("WhatsApp auth returns 401 and 403 at the middleware boundary", () => {
  const unauthenticated = response();
  requireWhatsappAdmin(request(), unauthenticated.res, () => undefined);
  assert.equal(unauthenticated.statusCode, 401);

  const unauthorized = response();
  requireWhatsappAdmin(request({ userId: 9, isAdmin: false, role: "sub_agent" }), unauthorized.res, () => undefined);
  assert.equal(unauthorized.statusCode, 403);

  const employeeOnAdminRoute = response();
  requireWhatsappEmployee(request({ userId: 9, isAdmin: true, role: "admin" }), employeeOnAdminRoute.res, () => undefined);
  assert.equal(employeeOnAdminRoute.statusCode, 403);
});

test("admin sees all mock employees and employee sees only owned conversations", async () => {
  clearWhatsappAuditEntries();
  const service = await serviceFor();
  const admin = { userId: 99, role: "admin", isAdmin: true };
  const employee = { userId: 1, role: "sub_agent", isAdmin: false };
  const query = { offset: 0, limit: 100 };

  const allEmployees = await service.listEmployees(request(), admin, query);
  assert.deepEqual(allEmployees.items.map((item) => item.id), ["samer", "fadi", "joanna"]);

  const owned = await service.listConversations(request(), employee, query);
  assert.ok(owned.items.length > 0);
  assert.ok(owned.items.every((item) => item.employeeId === "samer"));
});

test("conversation ownership blocks IDOR without revealing another employee's conversation", async () => {
  const service = await serviceFor();
  const employee = { userId: 1, role: "sub_agent", isAdmin: false };
  const own = await service.getConversationMessages(request(), employee, "conversation-demo-1");
  assert.equal(own.conversation.employeeId, "samer");
  await assert.rejects(
    service.getConversationMessages(request(), employee, "conversation-demo-2"),
    (error: unknown) => error instanceof Error && error.message === "Conversation not found",
  );
});

test("internal notes are stored in memory, never mixed into WhatsApp messages", async () => {
  clearMockWhatsappInternalNotes();
  const service = await serviceFor();
  const admin = { userId: 99, role: "admin", isAdmin: true };
  const noteText = "confidential note: لا تُرسل للخارج";
  const note = await service.addInternalNote(request(), admin, "conversation-demo-1", noteText);
  assert.equal(noteText, note.text);
  const thread = await service.getConversationMessages(request(), admin, "conversation-demo-1");
  assert.ok(thread.messages.every((message) => message.kind !== "note" && message.text !== noteText));
});

test("deleted messages stay archived and multilingual text is preserved", async () => {
  const service = await serviceFor();
  const admin = { userId: 99, role: "admin", isAdmin: true };
  const deletedThread = await service.getConversationMessages(request(), admin, "conversation-demo-1");
  assert.ok(deletedThread.messages.some((message) => message.kind === "deleted"));
  const unicodeThread = await service.getConversationMessages(request(), admin, "conversation-unicode-demo");
  assert.match(unicodeThread.messages[0].text, /مُرحبًا/);
  assert.match(unicodeThread.messages[0].text, /ליאה/);
  assert.match(unicodeThread.messages[0].text, /mixed English/);
});

test("audit metadata excludes note text, phone numbers, and request bodies", async () => {
  clearWhatsappAuditEntries();
  const service = await serviceFor();
  const admin = { userId: 99, role: "admin", isAdmin: true };
  const secretNote = "do not put this in audit";
  const req = request({ userId: 99, isAdmin: true, role: "admin" }, { text: secretNote });
  await service.addInternalNote(req, admin, "conversation-demo-1", secretNote);
  const auditJson = JSON.stringify(getWhatsappAuditEntries());
  assert.doesNotMatch(auditJson, /do not put this in audit/);
  assert.doesNotMatch(auditJson, /\+999 555 1001/);
  assert.doesNotMatch(auditJson, /body/);
  assert.match(auditJson, /add_internal_note/);
});

test("media storage and internal repository make no external network calls", () => {
  const source = readFileSync(new URL("./whatsappInternalRepository.ts", import.meta.url), "utf8");
  const mediaSource = readFileSync(new URL("./whatsappMediaStorage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(fetch|axios|https?:\/\/)\b/);
  assert.doesNotMatch(mediaSource, /\b(fetch|axios|https?:\/\/)\b/);
});

test("session actor identity is required and role matching is exact", () => {
  assert.equal(getWhatsappActor(request()), null);
  const actor = getWhatsappActor(request({ userId: 1, isAdmin: false, role: "sub_agent_extra" }));
  assert.ok(actor);
  assert.equal(isWhatsappEmployee(actor), false);
});

test("pagination validation is bounded and rejects negative, non-numeric, and unsupported values", () => {
  assert.deepEqual(parseListQuery(requestWithQuery({ offset: "2", limit: "100" }), false), {
    offset: 2,
    limit: 100,
  });
  assert.throws(() => parseListQuery(requestWithQuery({ limit: "101" }), false), /between 1 and 100/);
  assert.throws(() => parseListQuery(requestWithQuery({ offset: "-1" }), false), /Invalid offset/);
  assert.throws(() => parseListQuery(requestWithQuery({ limit: "abc" }), false), /Invalid limit/);
  assert.throws(() => parseListQuery(requestWithQuery({ employeeId: "samer" }), false), /Unsupported query parameter/);
  assert.throws(() => parseListQuery(requestWithQuery({ employeeId: "Samer" }), true), /Invalid employeeId/);
});

test("the monitoring page keeps the composer disabled", () => {
  const source = readFileSync(new URL("../client/src/pages/admin/whatsapp-employee-monitoring.tsx", import.meta.url), "utf8");
  assert.match(source, /composerDisabled/);
  assert.match(source, /Sending is disabled in this mock-only phase/);
});

function requestWithQuery(query: Record<string, string>): Request {
  return { ...request(), query } as Request;
}