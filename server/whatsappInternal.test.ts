import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Request, Response } from "express";
import {
  createRequireWhatsappEmployee,
  getWhatsappActor,
  isWhatsappEmployee,
  requireWhatsappAdmin,
} from "./whatsappInternalAuth";
import { clearWhatsappAuditEntries, getWhatsappAuditEntries } from "./whatsappInternalAudit";
import {
  clearMockWhatsappInternalNotes,
  MockWhatsappInternalRepository,
} from "./whatsappInternalRepository";
import { WhatsappInternalService } from "./whatsappInternalService";
import { parseListQuery } from "./whatsappInternalRoutes";
import { avatarDataUrl } from "../client/src/lib/whatsappEmployeeMonitoringEmployeeRepository";

const request = (session: Record<string, unknown> = {}, body?: unknown): Request =>
  ({ session, body, headers: {}, header: () => undefined } as unknown as Request);

const TEST_MOCK_EMPLOYEE_MAPPING = new Map<number, string>([
  [1, "samer"],
  [2, "fadi"],
  [3, "joanna"],
]);

function response(onJson?: () => void) {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(value: unknown) {
      body = value;
      onJson?.();
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return { res: res as unknown as Response, get statusCode() { return statusCode; }, get body() { return body; } };
}

async function serviceFor(mapping: ReadonlyMap<number, string> = TEST_MOCK_EMPLOYEE_MAPPING) {
  return new WhatsappInternalService(new MockWhatsappInternalRepository(mapping));
}

async function invokeEmployeeGuard(
  session: Record<string, unknown>,
  userLookup: Parameters<typeof createRequireWhatsappEmployee>[0],
) {
  let nextCalls = 0;
  let responseCompleted = false;
  let resolveCompletion!: () => void;
  const completed = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const result = response(() => {
    responseCompleted = true;
    resolveCompletion();
  });
  const middleware = createRequireWhatsappEmployee(userLookup);
  middleware(request(session), result.res, () => {
    nextCalls += 1;
    resolveCompletion();
  });
  await completed;
  return {
    statusCode: result.statusCode,
    body: result.body,
    nextCalls,
    responseCompleted,
    session,
  };
}

test("WhatsApp auth returns 401 and 403 at the middleware boundary", async () => {
  const unauthenticated = response();
  requireWhatsappAdmin(request(), unauthenticated.res, () => undefined);
  assert.equal(unauthenticated.statusCode, 401);

  const unauthorized = response();
  requireWhatsappAdmin(request({ userId: 9, isAdmin: false, role: "sub_agent" }), unauthorized.res, () => undefined);
  assert.equal(unauthorized.statusCode, 403);

  const employeeOnAdminRoute = await invokeEmployeeGuard(
    { userId: 9, isAdmin: true, role: "admin", isActive: true },
    async () => ({ id: 9, role: "admin", isAdmin: true, isActive: true }),
  );
  assert.equal(employeeOnAdminRoute.statusCode, 403);

  const inactiveEmployee = await invokeEmployeeGuard(
    { userId: 1, isAdmin: false, role: "sub_agent", isActive: true },
    async () => ({ id: 1, role: "sub_agent", isAdmin: false, isActive: false }),
  );
  assert.equal(inactiveEmployee.statusCode, 403);
});

test("Employee avatar data URLs are valid SVG and safely encoded", () => {
  const safeUrl = avatarDataUrl("LQ", "#0f766e");
  const safeSvg = decodeURIComponent(safeUrl.split(",", 2)[1] ?? "");

  assert.match(safeUrl, /^data:image\/svg\+xml;charset=UTF-8,/);
  assert.match(safeSvg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(safeSvg, />LQ<\/text><\/svg>$/);
  assert.match(safeSvg, /fill="#0f766e"/);

  const hostileUrl = avatarDataUrl(`<svg onload="alert('x')">&`, `url("https://attacker.example/avatar")`);
  const hostileSvg = decodeURIComponent(hostileUrl.split(",", 2)[1] ?? "");

  assert.match(hostileSvg, /&lt;svg onload=&quot;alert\(&apos;x&apos;\)&quot;&gt;&amp;<\/text>/);
  assert.doesNotMatch(hostileSvg, /<svg onload|<script|attacker\.example|url\(/i);
  assert.match(hostileSvg, /fill="#005476"/);
});

test("employee auth uses the current user record and updates session only after success", async () => {
  let lookupCalls = 0;
  const session = { userId: 1, isAdmin: true, role: "admin", isActive: false };
  const result = await invokeEmployeeGuard(session, async (userId) => {
    lookupCalls += 1;
    assert.equal(userId, 1);
    return { id: 1, role: "sub_agent", isAdmin: false, isActive: true };
  });

  assert.equal(lookupCalls, 1);
  assert.equal(result.statusCode, 200);
  assert.equal(result.nextCalls, 1);
  assert.equal(result.responseCompleted, false);
  assert.deepEqual(session, { userId: 1, isAdmin: false, role: "sub_agent", isActive: true });
});

test("employee auth rejects missing, inactive, wrong-role, and missing users", async () => {
  let lookupCalls = 0;
  const missingSession = await invokeEmployeeGuard({}, async () => {
    lookupCalls += 1;
    return undefined;
  });
  assert.equal(missingSession.statusCode, 401);
  assert.equal(lookupCalls, 0);
  assert.equal(missingSession.nextCalls, 0);

  const missingUser = await invokeEmployeeGuard({ userId: 1 }, async () => undefined);
  assert.equal(missingUser.statusCode, 403);
  assert.equal(missingUser.nextCalls, 0);

  const inactiveUser = await invokeEmployeeGuard({ userId: 1 }, async () => ({
    id: 1,
    role: "sub_agent",
    isAdmin: false,
    isActive: false,
  }));
  assert.equal(inactiveUser.statusCode, 403);

  const wrongRole = await invokeEmployeeGuard({ userId: 1 }, async () => ({
    id: 1,
    role: "user",
    isAdmin: false,
    isActive: true,
  }));
  assert.equal(wrongRole.statusCode, 403);
});

test("employee auth fails closed on lookup failure without exposing the database error", async () => {
  let nextCalls = 0;
  const session = { userId: 1, isAdmin: false, role: "sub_agent", isActive: true };
  const result = await invokeEmployeeGuard(session, async () => {
    throw new Error("database password and connection details");
  });

  nextCalls += result.nextCalls;
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { message: "Service temporarily unavailable" });
  assert.doesNotMatch(JSON.stringify(result.body), /database|password|connection/i);
  assert.equal(nextCalls, 0);
  assert.deepEqual(session, { userId: 1, isAdmin: false, role: "sub_agent", isActive: true });
});

test("admin sees all mock employees and employee sees only owned conversations", async () => {
  clearWhatsappAuditEntries();
  const service = await serviceFor();
  const admin = { userId: 99, role: "admin", isAdmin: true };
  const employee = { userId: 1, role: "sub_agent", isAdmin: false, isActive: true };
  const query = { offset: 0, limit: 100 };

  const allEmployees = await service.listEmployees(request(), admin, query);
  assert.deepEqual(allEmployees.items.map((item) => item.id), ["samer", "fadi", "joanna"]);

  const owned = await service.listConversations(request(), employee, query);
  assert.ok(owned.items.length > 0);
  assert.ok(owned.items.every((item) => item.employeeId === "samer"));
});

test("conversation ownership blocks IDOR without revealing another employee's conversation", async () => {
  const service = await serviceFor();
  const employee = { userId: 1, role: "sub_agent", isAdmin: false, isActive: true };
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

test("an active sub-agent without an explicit mock mapping receives no conversations", async () => {
  const service = await serviceFor();
  const unmappedEmployee = { userId: 99999, role: "sub_agent", isAdmin: false, isActive: true };
  const result = await service.listConversations(request(), unmappedEmployee, { offset: 0, limit: 100 });
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
});

test("runtime repository has no default mapping for IDs 1, 2, or 3", async () => {
  const service = await serviceFor(new Map());
  for (const userId of [1, 2, 3]) {
    const result = await service.listConversations(
      request(),
      { userId, role: "sub_agent", isAdmin: false, isActive: true },
      { offset: 0, limit: 100 },
    );
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  }
});

test("injected test mapping is isolated from the runtime default", async () => {
  const injected = await serviceFor(TEST_MOCK_EMPLOYEE_MAPPING);
  const owned = await injected.listConversations(
    request(),
    { userId: 2, role: "sub_agent", isAdmin: false, isActive: true },
    { offset: 0, limit: 100 },
  );
  assert.deepEqual(owned.items.map((item) => item.employeeId), ["fadi"]);

  const runtime = await serviceFor(new Map());
  const empty = await runtime.listConversations(
    request(),
    { userId: 2, role: "sub_agent", isAdmin: false, isActive: true },
    { offset: 0, limit: 100 },
  );
  assert.deepEqual(empty.items, []);
});

test("employee UI uses only employee endpoints and does not import the local repository", () => {
  const pageSource = readFileSync(new URL("../client/src/pages/employee/whatsapp.tsx", import.meta.url), "utf8");
  const repositorySource = readFileSync(new URL("../client/src/lib/whatsappEmployeeMonitoringEmployeeRepository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(pageSource, /whatsappEmployeeMonitoringRepository/);
  assert.doesNotMatch(repositorySource, /\/api\/admin\/whatsapp/);
  assert.match(repositorySource, /\/api\/employee\/whatsapp\/conversations/);
  assert.match(repositorySource, /credentials:\s*"include"/);
});

test("employee workspace does not render the employee panel in employee mode", () => {
  const source = readFileSync(new URL("../client/src/components/whatsapp/WhatsAppMonitoringWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /workspaceMode === "admin"/);
  assert.match(source, /EmployeePanel/);
  assert.match(source, /workspaceMode === "employee"/);
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

test("review login and monitoring entry routes are wired in the client router", () => {
  const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const loginSource = readFileSync(new URL("../client/src/pages/login.tsx", import.meta.url), "utf8");
  assert.ok(appSource.includes('path="/login" component={Login}'));
  assert.ok(appSource.includes('path="/admin/whatsapp-monitoring"'));
  assert.ok(loginSource.includes('get("redirect")'));
  assert.ok(loginSource.includes('"/admin/whatsapp-monitoring"'));
});

test("employee rate limiting remains before live authorization", () => {
  const source = readFileSync(new URL("./whatsappInternalRoutes.ts", import.meta.url), "utf8");
  assert.match(source, /whatsappInternalRateLimit,\s*requireWhatsappEmployee/);
});

function requestWithQuery(query: Record<string, string>): Request {
  return { ...request(), query } as Request;
}