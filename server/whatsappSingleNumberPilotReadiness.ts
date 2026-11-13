/**
 * Fail-closed readiness report for exactly one future employee phone pilot.
 *
 * This does not connect a phone, call Meta, read messages, create a webhook,
 * or certify that a human approved any notice. All 'true' configuration flags
 * are claims pending independent evidence; they are not consent records.
 */
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";
import { stagingPilotWebhookConfig } from "./whatsappPilotSignedWebhookAdapter";

export type SingleNumberPilotGate =
  | "isolated_staging" | "worker_credentials_configured"
  | "reader_audit_credentials_configured" | "independent_keys_configured"
  | "employee_notice_attested" | "customer_notice_attested"
  | "retention_policy_attested" | "meta_verification_attested"
  | "history_pipeline_attested" | "private_media_attested"
  | "contacts_pipeline_attested" | "signed_queue_attested"
  | "pilot_enabled_attested" | "pilot_identifiers_configured"
  | "pilot_differs_from_test_waba";

const requiredFlags: ReadonlyArray<readonly [SingleNumberPilotGate,string]> = [
  ["employee_notice_attested","WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED"],
  ["customer_notice_attested","WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED"],
  ["retention_policy_attested","WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED"],
  ["meta_verification_attested","WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED"],
  ["history_pipeline_attested","WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY"],
  ["private_media_attested","WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY"],
  ["contacts_pipeline_attested","WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY"],
  ["signed_queue_attested","WHATSAPP_EMPLOYEE_ARCHIVE_SIGNED_QUEUE_READY"],
  ["pilot_enabled_attested","WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_ENABLED"],
];

function key(value:string|undefined):Buffer|null{
  if(!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))return null;
  const b=Buffer.from(value,"base64");
  return b.length===32 && b.toString("base64")===value &&
    !b.equals(Buffer.alloc(32)) ? b:null;
}
const numeric=(value:string|undefined,min=4,max=24)=>
  typeof value==="string" &&
  new RegExp("^\\d{"+min+","+max+"}$").test(value);

export function inspectStagingOneNumberPilot(
  env:NodeJS.ProcessEnv,
  config:Readonly<{workerConfigured:boolean;readerAuditConfigured:boolean}>,
){
  const staging=env.APP_DEPLOYMENT_MODE==="staging" && stagingDatabaseIsIsolated(env);
  const aes=key(env.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64);
  const hmac=key(env.WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64);
  const identifiers=Number.isSafeInteger(Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID)) &&
    Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID)>0 &&
    numeric(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID) &&
    numeric(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID) &&
    numeric(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE,8,24) &&
    env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID !== env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID;
  const pilotWaba=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID;
  const testWaba=env.WHATSAPP_META_TEST_WABA_ID;
  const checks:Record<SingleNumberPilotGate,boolean>={
    isolated_staging:staging,
    worker_credentials_configured:staging && config.workerConfigured,
    reader_audit_credentials_configured:staging && config.readerAuditConfigured,
    independent_keys_configured:staging && !!aes && !!hmac && !aes.equals(hmac),
    employee_notice_attested:false,
    customer_notice_attested:false,
    retention_policy_attested:false,
    meta_verification_attested:false,
    history_pipeline_attested:false,
    private_media_attested:false,
    contacts_pipeline_attested:false,
    signed_queue_attested:false,
    pilot_enabled_attested:false,
    pilot_identifiers_configured:staging && identifiers,
    pilot_differs_from_test_waba:staging && !!pilotWaba && !!testWaba &&
      pilotWaba!==testWaba,
  };
  for(const [gate,envName] of requiredFlags)
    checks[gate]=staging && env[envName]==="true";
  // Pilot callback only appears to be configured when ALL strict gates pass.
  // Even then this report explicitly DOES NOT assert actual route registration,
  // Meta enrollment, or legal consent evidence.
  const configured=staging && Object.values(checks).every(Boolean) &&
    stagingPilotWebhookConfig(env)!==null;
  const blockers=(Object.keys(checks) as SingleNumberPilotGate[]).filter(k=>!checks[k]);
  return {
    environment:"isolated_staging" as const,
    mode:configured?"configuration_complete_not_connected" as const:
      "blocked" as const,
    checks,blockers,
    metaTestAccount:"not_a_live_employee_connection" as const,
    employeeNumberConnection:"not_verified" as const,
    signedCallback:"not_registered_by_this_report" as const,
    realMessageDelivery:"not_verified" as const,
    action:"verify_company_number_ownership_and_coexistence_in_meta_before_cutover" as const,
  };
}
