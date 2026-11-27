import type {Express,RequestHandler} from "express";

/**
 * The isolated VIP QA server never registers CRM bridge endpoints or opens
 * a second database connection.
 */
export function registerVipCrmBridgeRoutes(
  app:Express,
  enabled:RequestHandler,
  auth:RequestHandler,
  admin:RequestHandler
):void{
 app.get("/api/admin/vip/crm-links",enabled,auth,admin,(_req,res)=>{
  res.setHeader("X-VIP-QA-Fixture","empty-read-only");
  res.json({links:[]});
 });
}
