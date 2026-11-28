const setupCredentialNames=Object.freeze([
  "KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL",
  "KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD",
]);
const bootstrapFlagNames=Object.freeze([
  "KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE",
  "KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED",
]);

export function qaBootstrapPrivilegesPresent(env=process.env){
  if(bootstrapFlagNames.some(name=>
    env[name]!==undefined&&env[name]!==""&&env[name]!=="false"))return true;
  return setupCredentialNames.some(name=>
    env[name]!==undefined&&env[name]!=="");
}
