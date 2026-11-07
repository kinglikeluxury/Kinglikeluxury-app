import test from "node:test";
import assert from "node:assert/strict";
import { shouldLogApiResponseBody } from "./apiResponseLogPolicy";

test("sensitive employee WhatsApp APIs never put response bodies in application logs", () => {
  for (const path of [
    "/api/whatsapp-employee/archive/employees/1/conversations",
    "/api/whatsapp-employee/archive/conversations/2/messages",
    "/api/employee/whatsapp-consents",
    "/api/employee/whatsapp-consents/123",
    "/api/admin/whatsapp-employees/supervisor-grants",
    "/api/admin/whatsapp-employee/local-review/archive",
    "/api/webhooks/whatsapp-employee",
  ]) {
    assert.equal(shouldLogApiResponseBody(path), false, path);
  }
});

test("non-sensitive API paths retain existing response logging behavior", () => {
  assert.equal(shouldLogApiResponseBody("/api/health"), true);
  assert.equal(shouldLogApiResponseBody("/api/admin/properties"), true);
  assert.equal(shouldLogApiResponseBody("/health"), false);
});
