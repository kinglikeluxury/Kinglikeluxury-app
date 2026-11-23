import type { QueryClient } from "@tanstack/react-query";

/**
 * Forget all in-memory VIP client/admin/seller data when the signed-in account
 * changes. The app's public/non-VIP queries remain cached as before.
 * This is a browser privacy measure, not a substitute for server authorization.
 */
export function clearVipSessionCache(client: Pick<QueryClient, "removeQueries">): void {
  client.removeQueries({ queryKey: ["vip"] });
}
