// The mission service keeps this import boundary so loading its pure helpers
// does not initialize the CRM pool. All policy decisions remain canonical.
export {
  KAY_OPERATIONAL_LAUNCH_AT,
  KAY_OPERATIONAL_SETTING_KEY,
  KAY_OPERATIONAL_TIMEZONE,
  classifyKayLead,
  classifyKayMissionAssignment,
  getKayMissionScope,
  getKayOperationalScopeAdminView,
  getKayScopeConfiguration,
  getKayScopeForLead,
  kayScopeSql,
} from "./kayLeadScopeService";
export type { KayMissionScopeOutcome, KayScopeConfig, KayScopeOutcome } from "./kayLeadScopeService";