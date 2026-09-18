import assert from "node:assert/strict";
import test from "node:test";
import {
  KAY_SUPERVISION_TIME_ZONE,
  KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED,
  applyNewerNoteOverride,
  buildHumanCallBrief,
  callAntiSpamDecision,
  classifyTask,
  classifyVisitorTiming,
  createCallCommitmentPayload,
  evidenceRecheckResult,
  isExplicitCompletionNote,
  isDailyBriefDue,
  isKayCallWindow,
  parseArabicFollowUp,
  rescueRecommendation,
  unavailableConversationEvidenceProvider,
} from "./kaySupervisorIntelligenceService";

const at = (value: string) => new Date(value);

test("uses the required Istanbul timezone and call window", () => {
  assert.equal(KAY_SUPERVISION_TIME_ZONE, "Europe/Istanbul");
  assert.equal(isKayCallWindow(at("2025-01-15T12:59:00.000Z")), false); // 15:59 Istanbul
  assert.equal(isKayCallWindow(at("2025-01-15T13:00:00.000Z")), true); // 16:00 Istanbul
  assert.equal(isKayCallWindow(at("2025-01-15T17:59:00.000Z")), true); // 20:59 Istanbul
  assert.equal(isKayCallWindow(at("2025-01-15T18:00:00.000Z")), false); // 21:00 Istanbul
  assert.equal(isDailyBriefDue(at("2025-01-15T09:00:00.000Z")), true); // 12:00 Istanbul
  assert.equal(KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED(), false);
});

test("classifies task and current-month visitor timing", () => {
  const now = at("2025-01-15T10:00:00.000Z");
  assert.equal(classifyTask({ dueAt: at("2025-01-14T09:00:00.000Z") }, now), "OVERDUE");
  assert.equal(classifyTask({ dueAt: at("2025-01-15T09:00:00.000Z") }, now), "DUE_TODAY");
  assert.equal(classifyTask({ dueAt: at("2025-01-16T09:00:00.000Z") }, now), "DUE_TOMORROW");
  assert.equal(classifyTask({ dueAt: at("2025-01-20T09:00:00.000Z") }, now), "UPCOMING");
  assert.equal(classifyTask({ dueAt: at("2025-01-14T09:00:00.000Z"), completedAt: now }, now), "COMPLETED");
  assert.equal(classifyVisitorTiming({ expectedPurchaseMonth: "2025-01" }, now)?.timing, "APPROXIMATE_THIS_MONTH");
  assert.equal(classifyVisitorTiming({ expectedPurchaseMonth: "2025-02" }, now), null);
  assert.equal(classifyVisitorTiming({ visitDate: at("2025-01-15T11:00:00.000Z") }, now)?.timing, "TODAY");
  assert.equal(classifyVisitorTiming({ visitDate: at("2025-01-17T10:00:00.000Z") }, now)?.timing, "WITHIN_72H");
  assert.equal(classifyVisitorTiming({ visitDate: at("2025-01-20T10:00:00.000Z") }, now)?.timing, "WITHIN_7_DAYS");
  assert.equal(classifyVisitorTiming({ visitDate: at("2025-01-25T10:00:00.000Z") }, now)?.timing, "LATER_THIS_MONTH");
  assert.equal(classifyVisitorTiming({ visitDate: at("2025-01-14T10:00:00.000Z") }, now), null);
});

test("Arabic follow-up parser is fail-closed and carries provenance", () => {
  const now = at("2025-01-15T10:00:00.000Z");
  const parsed = parseArabicFollowUp({ id: 9, leadId: 4, note: "اتصل فيه بكرا", createdAt: now }, now);
  assert.equal(parsed?.confidence, "HIGH_CONFIDENCE");
  assert.equal(parsed?.sourceNoteId, 9);
  assert.equal(parseArabicFollowUp({ note: "موعدنا 20/01 الساعة 16:30", createdAt: now }, now)?.confidence, "EXACT");
  assert.equal(parseArabicFollowUp({ note: "اتصل فيه بعد يومين", createdAt: now }, now)?.confidence, "HIGH_CONFIDENCE");
  assert.equal(parseArabicFollowUp({ note: "اتصل فيه الاثنين", createdAt: now }, now)?.confidence, "HIGH_CONFIDENCE");
  assert.equal(parseArabicFollowUp({ note: "المتابعة الاسبوع الجاي", createdAt: now }, now)?.confidence, "APPROXIMATE");
  assert.equal(parseArabicFollowUp({ note: "اتصل فيه", createdAt: now }, now)?.confidence, "AMBIGUOUS");
  assert.equal(parseArabicFollowUp({ note: "الطقس غدا سيكون مشمسا", createdAt: now }, now), null);
  assert.equal(parseArabicFollowUp({ note: "اتصل فيه يوم 20/01 الساعة 3", createdAt: now }, now)?.confidence, "AMBIGUOUS");
  assert.equal(parseArabicFollowUp({ note: "موعدنا 31/02 الساعة 10", createdAt: now }, now)?.confidence, "AMBIGUOUS");
  assert.equal(parseArabicFollowUp({ note: "ربما نتواصل لاحقا", createdAt: now }, now), null);
  assert.deepEqual(applyNewerNoteOverride(
    { id: 2, createdAt: at("2025-01-01T00:00:00Z") },
    { id: 9, createdAt: now },
    { dueAt: at("2025-01-16T10:00:00Z") },
  )?.sourceNoteId, 9);
});

test("anti-spam, evidence and rescue remain recommendation-only", () => {
  const now = at("2025-01-15T10:00:00.000Z");
  assert.equal(callAntiSpamDecision({
    now, sessions: [], meaningfulActionItems: false, reasonCode: "OVERDUE",
  }).allowed, false);
  const rejected = [{ status: "REJECTED", reasonCode: "OVERDUE", createdAt: now }];
  assert.equal(callAntiSpamDecision({
    now, sessions: rejected, meaningfulActionItems: true, reasonCode: "OVERDUE",
  }).allowed, true);
  assert.equal(callAntiSpamDecision({
    now, sessions: [...rejected, ...rejected], meaningfulActionItems: true, reasonCode: "OVERDUE",
  }).reason, "REJECT_RETRY_LIMIT");
  assert.equal(callAntiSpamDecision({
    now,
    sessions: [{ status: "ENDED", reasonCode: "DAILY", createdAt: now }],
    meaningfulActionItems: true,
    reasonCode: "OTHER",
  }).reason, "DAILY_NORMAL_LIMIT");
  assert.equal(callAntiSpamDecision({
    now, sessions: [], meaningfulActionItems: true,
    reasonCode: "OVERDUE_SAME_DAY_COMMITMENT",
    materiallyOverdueSameDayCommitment: false,
  }).reason, "NO_MATERIAL_OVERDUE_COMMITMENT");
  assert.equal(evidenceRecheckResult({
    currentOwnerId: 1, leadStatus: "OPEN", openTasks: 1, matchingNotes: 0,
    commitmentStatus: "PENDING", whatsappMatch: "MULTIPLE_MATCHES",
  }).outcome, "ASK_EMPLOYEE");
  assert.match(rescueRecommendation("العميل"), /توصية/);
});

test("future conversation evidence adapter is explicitly unavailable", async () => {
  const result = await unavailableConversationEvidenceProvider.check("+995555555555");
  assert.equal(result.providerAvailable, false);
  assert.equal(result.normalizedPhoneMatchStatus, "NO_MATCH");
});

test("completion-note evidence rejects Arabic negation", () => {
  assert.equal(isExplicitCompletionNote("تم التواصل مع العميل"), true);
  assert.equal(isExplicitCompletionNote("لم يتم التواصل مع العميل"), false);
  assert.equal(isExplicitCompletionNote("لن يتم التواصل اليوم"), false);
});

test("call briefs and commitments are structured and idempotent", () => {
  const brief = buildHumanCallBrief({ employeeName: "سارة", topPriorities: ["a", "b"] });
  assert.equal(brief.topPriorities.length, 2);
  const payload = createCallCommitmentPayload({
    employeeId: 7, leadRef: 12, actionType: "FOLLOW_UP",
    dueAt: at("2025-01-16T10:00:00Z"), sourceCallSessionId: 99,
  });
  assert.equal(payload.details.internalOnly, true);
  assert.equal(payload.idempotencyKey, "call:99:7:12:FOLLOW_UP:2025-01-16T10:00:00.000Z");
});