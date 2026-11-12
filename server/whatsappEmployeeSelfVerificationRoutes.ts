import type { Express, Request } from "express";
import {isCrmEmployeeRole} from "@shared/crmRoles";

/**
 * Read-only and scoped to the currently signed-in Kinglike employee.
 * No authorization to cancel, disconnect or migrate any Meta phone exists here.
 * The Meta signup is deliberately NOT started until the separate validated
 * business-owned number and live ingress are independently ready.
 */
export type EmployeeVerificationActor = Readonly<{
  id: number;
  isActive: boolean;
  isAdmin: boolean;
  role: string | null;
}>;
export type EmployeeVerificationState =
  "awaiting_company_setup" | "awaiting_meta_verification";

export function employeeWhatsappVerificationState(
  env: NodeJS.ProcessEnv,
  actor: EmployeeVerificationActor,
): EmployeeVerificationState {
  // Explicit one-employee staging pilot; no generic employee can claim it.
  const stage=env.APP_DEPLOYMENT_MODE==="staging";
  const ownPilot=stage &&
    /^[1-9]\d*$/.test(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID??"") &&
    Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID)===actor.id;
  if(ownPilot && env.WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED==="true" &&
    env.WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED==="true")
    return "awaiting_meta_verification";
  return "awaiting_company_setup";
}

export function registerEmployeeWhatsappVerificationRoutes(
  app:Express,
  deps:Readonly<{
    currentActor(req:Request):Promise<EmployeeVerificationActor|null>;
    env?:NodeJS.ProcessEnv;
  }>,
):void{
  const env=deps.env??process.env;
  app.get("/api/employee/whatsapp-meta-verification",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    let actor:EmployeeVerificationActor|null=null;
    try{actor=await deps.currentActor(req);}
    catch{return res.sendStatus(503);}
    if(!actor || !Number.isSafeInteger(actor.id) || actor.id<1 ||
      actor.isActive!==true || actor.isAdmin===true || !isCrmEmployeeRole(actor.role))
      return res.sendStatus(403);
    return res.json({
      mode:"employee_verification_only",
      status:employeeWhatsappVerificationState(env,actor),
      phoneConnected:false,
      metaEnrollmentVerified:false,
      availableActions:[] as string[],
      employeeCanDisconnect:false,
      employeeCanCancelEnrollment:false,
      notes:"The company must first complete the independent Meta and privacy preflight.",
    });
  });
}
