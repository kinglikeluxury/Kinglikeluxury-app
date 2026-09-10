import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptCommitment,
  adaptMission,
  adaptPromise,
  completedToday,
  groupPromises,
  isLocalDateToday,
} from "../../components/kay/kaySalesAdapters";

test("Kay adapters map raw SELECT snake_case fields to the frontend model", () => {
  const mission = adaptMission({
    id: 7,
    lead_id: 42,
    mission_type: "FOLLOW_UP_DUE",
    priority: "HIGH",
    priority_score: 75,
    status: "COMPLETED",
    objective: "Review the lead",
    suggested_action: "Open CRM",
    due_at: "2026-05-10T09:00:00.000Z",
    completed_at: "2026-05-10T10:00:00.000Z",
  });
  const commitment = adaptCommitment({
    id: 8,
    action: "Call the buyer",
    status: "ACTIVE",
    due_at: "2026-05-10T11:00:00.000Z",
    completed_at: null,
  });
  const promise = adaptPromise({
    id: 9,
    promise_text: "Send the comparison",
    status: "OPEN",
    importance: "IMPORTANT",
    due_at: "2026-05-10T12:00:00.000Z",
    completed_at: null,
  });

  assert.equal(mission.leadId, 42);
  assert.equal(mission.completedAt, "2026-05-10T10:00:00.000Z");
  assert.equal(commitment.dueAt, "2026-05-10T11:00:00.000Z");
  assert.equal(promise.promiseText, "Send the comparison");
  assert.equal(promise.dueAt, "2026-05-10T12:00:00.000Z");
  assert.equal(adaptMission({ id: 10, status: "COMPLETED", completedAt: "2026-05-10T13:00:00.000Z" }).completedAt, "2026-05-10T13:00:00.000Z");
  assert.equal(adaptPromise({ id: 11, promiseText: "Mapped", status: "OPEN", dueAt: "2026-05-10T14:00:00.000Z" }).promiseText, "Mapped");
});

test("completed missions are limited to completedAt on the local calendar date", () => {
  const now = new Date(2026, 4, 10, 12, 0, 0);
  const today = new Date(2026, 4, 10, 8, 0, 0).toISOString();
  const yesterday = new Date(2026, 4, 9, 23, 59, 0).toISOString();
  const items = [
    adaptMission({ id: 1, status: "COMPLETED", completed_at: today }),
    adaptMission({ id: 2, status: "COMPLETED", completed_at: yesterday }),
    adaptMission({ id: 3, status: "IN_PROGRESS", completed_at: today }),
    adaptMission({ id: 4, status: "COMPLETED", completed_at: null }),
  ];

  assert.equal(isLocalDateToday(today, now), true);
  assert.deepEqual(completedToday(items, now).map((item) => item.id), [1]);
});

test("promise groups exclude cancelled and old completed promises", () => {
  const now = new Date(2026, 4, 10, 12, 0, 0);
  const today = new Date(2026, 4, 10, 8, 0, 0).toISOString();
  const yesterday = new Date(2026, 4, 9, 8, 0, 0).toISOString();
  const groups = groupPromises([
    adaptPromise({ id: 1, promise_text: "Due", status: "OPEN", due_at: new Date(2026, 4, 10, 13, 0, 0).toISOString() }),
    adaptPromise({ id: 2, promise_text: "Cancelled", status: "CANCELLED", due_at: today }),
    adaptPromise({ id: 3, promise_text: "Today", status: "COMPLETED", completed_at: today }),
    adaptPromise({ id: 4, promise_text: "Old", status: "COMPLETED", completed_at: yesterday }),
  ], now);

  assert.deepEqual(
    groups.map(([name, items]) => [name, items.map((item) => item.id)]),
    [
      ["Overdue", []],
      ["Due soon", [1]],
      ["Upcoming", []],
      ["Completed today", [3]],
    ],
  );
});