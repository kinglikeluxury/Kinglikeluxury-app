import { pool } from "../server/db";
import { KAY_OPERATIONAL_LAUNCH_AT, setKayOperationalLaunchAt, getKayScopeConfiguration } from "../server/kayLeadScopeService";

async function main() {
  const actor = await pool.query(
    `SELECT id FROM users WHERE lower(username)='kinglike_admin' AND is_admin=true AND is_active=true ORDER BY id LIMIT 1`,
  );
  if (!actor.rows[0]) throw new Error("No active kinglike_admin admin actor exists.");
  const safety = await pool.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
  const rules: any = safety.rows[0]?.value;
  if (rules && (rules.auto_rescue_kill_switch !== true ||
      rules.auto_rescue_no_answer_1_enabled === true ||
      rules.auto_rescue_no_answer_2_enabled === true ||
      (Array.isArray(rules.auto_rescue_canary_employee_ids) && rules.auto_rescue_canary_employee_ids.length > 0))) {
    throw new Error("Safety settings are not in the required disabled/kill-switch-on state; refusing to change scope.");
  }
  await setKayOperationalLaunchAt(actor.rows[0].id, KAY_OPERATIONAL_LAUNCH_AT, false);
  const result = await getKayScopeConfiguration();
  if (result.status !== "OK" || result.config?.launchAtIso !== new Date(KAY_OPERATIONAL_LAUNCH_AT).toISOString()) {
    throw new Error("Operational launch verification failed.");
  }
  console.log(JSON.stringify({ ok: true, launchAt: result.config.launchAtIso, cutoffAt: result.config.cutoffAtIso }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => pool.end());