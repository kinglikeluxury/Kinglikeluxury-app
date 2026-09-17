import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";

const defaultRescueSettings = {
  auto_rescue_kill_switch: true,
  auto_rescue_canary_enabled: false,
  auto_rescue_canary_employee_ids: [],
};

export async function getE24FadiPrecheck() {
  return withKayReadonlyAnalysis(async c => {
    const [fadi, rules, mode, health] = await Promise.all([
      c.query(`SELECT id,username,role,is_active,is_admin FROM users WHERE lower(username)=lower($1)`, ["Fadi al-Mofti"]),
      c.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`),
      c.query(`SELECT value FROM kay_settings WHERE key='mode'`),
      c.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`),
    ]);
    const settings: any = { ...defaultRescueSettings, ...(rules.rows[0]?.value || {}) };
    return { ready: false, fadi: fadi.rows[0] || null, candidates: [], candidate: null, target: null,
      mode: mode.rows[0]?.value?.mode || "shadow", period: "phase_e24_first_fadi_canary",
      checks: { uniqueFadi: { ok: fadi.rows.length === 1 }, fadiActive: { ok: false }, mode: { ok: mode.rows[0]?.value?.mode === "shadow" }, disarmed: { ok: settings.auto_rescue_kill_switch === true }, scheduler: { ok: false }, health: { ok: !!health.rows[0] }, settings: { ok: true } } };
  });
}