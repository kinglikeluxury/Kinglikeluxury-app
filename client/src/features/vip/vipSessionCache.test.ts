import { strict as assert } from "node:assert";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearVipSessionCache } from "./vipSessionCache";

test("switching accounts removes all sensitive VIP cache entries but not public app data", () => {
  const client = new QueryClient();
  client.setQueryData(["vip", "me"], { units: [{ unit_id: 101 }] });
  client.setQueryData(["vip", "finance", "101"], { verified_paid: "900.00" });
  client.setQueryData(["vip", "admin", "overview"], { clients: 12 });
  client.setQueryData(["vip", "seller", "units"], { units: [{ unit_id: 101 }] });
  client.setQueryData(["/api/projects"], [{ id: 1 }]);

  clearVipSessionCache(client);

  assert.deepEqual(client.getQueryData(["vip", "me"]), undefined);
  assert.deepEqual(client.getQueryData(["vip", "finance", "101"]), undefined);
  assert.deepEqual(client.getQueryData(["vip", "admin", "overview"]), undefined);
  assert.deepEqual(client.getQueryData(["vip", "seller", "units"]), undefined);
  assert.deepEqual(client.getQueryData(["/api/projects"]), [{ id: 1 }]);
});
