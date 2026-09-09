import { pool } from "../server/db";
import { rescueSettingsSchema } from "../server/kayService";

const GLOBAL_LIMIT = 5;
const PER_EMPLOYEE_LIMIT = 3;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const actorResult = await client.query(
      `SELECT id FROM users
       WHERE lower(username)='kinglike_admin' AND is_admin=true AND is_active=true
       ORDER BY id LIMIT 1`,
    );
    const actorId = Number(actorResult.rows[0]?.id);
    if (!actorId) throw new Error("No active kinglike_admin admin actor exists.");

    const modeResult = await client.query(
      `SELECT value FROM kay_settings WHERE key='mode' FOR UPDATE`,
    );
    const modeValue = modeResult.rows[0]?.value;
    const mode = typeof modeValue === "string" ? modeValue : modeValue?.mode;
    if (String(mode || "").toLowerCase() !== "shadow") {
      throw new Error("Kay mode is not SHADOW; refusing safety-limit correction.");
    }

    const currentResult = await client.query(
      `SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`,
    );
    const parsedCurrent = rescueSettingsSchema.safeParse(currentResult.rows[0]?.value);
    if (!parsedCurrent.success) throw new Error("Current rescue settings failed server-side validation.");
    const current = parsedCurrent.data;

    if (current.auto_rescue_daily_limit === GLOBAL_LIMIT &&
        current.auto_rescue_per_employee_daily_limit === PER_EMPLOYEE_LIMIT) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ ok: true, changed: false, global: GLOBAL_LIMIT, perEmployee: PER_EMPLOYEE_LIMIT }));
      return;
    }

    if (current.auto_rescue_daily_limit !== 50 ||
        current.auto_rescue_per_employee_daily_limit !== 50) {
      throw new Error("Unexpected prior limits; expected exactly 50/50.");
    }
    if (current.rescue_enabled !== false ||
        current.auto_rescue_no_answer_1_enabled !== false ||
        current.auto_rescue_no_answer_2_enabled !== false ||
        current.auto_rescue_kill_switch !== true ||
        current.auto_rescue_canary_employee_ids.length !== 0) {
      throw new Error("Production safety gates are not fully disarmed.");
    }

    const nextCandidate = {
      ...current,
      auto_rescue_daily_limit: GLOBAL_LIMIT,
      auto_rescue_per_employee_daily_limit: PER_EMPLOYEE_LIMIT,
    };
    const parsedNext = rescueSettingsSchema.safeParse(nextCandidate);
    if (!parsedNext.success) throw new Error("Corrected rescue settings failed server-side validation.");

    const changedKeys = Object.keys(parsedNext.data).filter(
      key => JSON.stringify((current as any)[key]) !== JSON.stringify((parsedNext.data as any)[key]),
    );
    if (changedKeys.length !== 2 ||
        !changedKeys.includes("auto_rescue_daily_limit") ||
        !changedKeys.includes("auto_rescue_per_employee_daily_limit")) {
      throw new Error(`Unexpected settings delta: ${changedKeys.join(",")}`);
    }

    const timestampResult = await client.query(`SELECT clock_timestamp() AS changed_at`);
    const changedAt = new Date(timestampResult.rows[0].changed_at);
    await client.query(
      `UPDATE kay_settings
       SET value=$1::jsonb, updated_by=$2, updated_at=$3
       WHERE key='rescue_rules'`,
      [JSON.stringify(parsedNext.data), actorId, changedAt],
    );
    await client.query(
      `INSERT INTO kay_events
       (idempotency_key,user_id,event_type,event_source,previous_value,new_value,metadata,kay_generated,created_at)
       VALUES($1,$2,'kay_rule_changed','admin',$3::jsonb,$4::jsonb,$5::jsonb,false,$6)`,
      [
        `safety_limits:50-50_to_5-3:${changedAt.toISOString()}`,
        actorId,
        JSON.stringify(current),
        JSON.stringify(parsedNext.data),
        JSON.stringify({
          setting: "rescue_rules",
          phase: "E.2.3 final safety correction",
          changedKeys,
          previous: { global: 50, perEmployee: 50 },
          next: { global: GLOBAL_LIMIT, perEmployee: PER_EMPLOYEE_LIMIT },
          mode: "shadow",
          canaryActivated: false,
        }),
        changedAt,
      ],
    );

    await client.query("COMMIT");

    const verified = await pool.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
    const finalSettings = rescueSettingsSchema.parse(verified.rows[0]?.value);
    if (finalSettings.auto_rescue_daily_limit !== GLOBAL_LIMIT ||
        finalSettings.auto_rescue_per_employee_daily_limit !== PER_EMPLOYEE_LIMIT) {
      throw new Error("Post-commit safety-limit verification failed.");
    }
    console.log(JSON.stringify({
      ok: true,
      changed: true,
      global: { previous: 50, next: GLOBAL_LIMIT },
      perEmployee: { previous: 50, next: PER_EMPLOYEE_LIMIT },
      audit: "kay_events",
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());