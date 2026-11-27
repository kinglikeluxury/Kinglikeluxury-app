import type { Express, Request, Response, RequestHandler } from "express";
import multer from "multer";
import { pool } from "../db";
import { validVipPhoto, vipDate,MAX_VIP_PHOTO_BYTES } from "./vipPhotoValidation";
import {savePrivateProjectPhoto,readPrivateProjectPhoto,removePrivateProjectPhoto} from "./vipPrivateReceiptStorage";

const idFrom=(raw:unknown):number|null=>{
 if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
 const id=Number(raw);return Number.isSafeInteger(id)?id:null;
};
const sameOrigin:RequestHandler=(req,res,next)=>{
 const origin=req.get("Origin");
 try{if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});}
 catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
const upload=multer({
 storage:multer.memoryStorage(),
 limits:{fileSize:MAX_VIP_PHOTO_BYTES,files:1,fields:3,fieldSize:500}
}).single("photo");
const uploaded:RequestHandler=(req,res,next)=>{
 upload(req,res,(err:unknown)=>{
  if(!err)return next();
  if(err instanceof multer.MulterError&&err.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"Photo exceeds 8 MB"});
  return res.status(400).json({error:"Invalid photo upload"});
 });
};
async function ownsProject(projectId:number,userId:number):Promise<boolean>{
 const access=await pool.query(
  "SELECT 1 FROM vip_units u JOIN vip_unit_access a ON a.unit_id=u.id "+
  "WHERE u.project_id=$1 AND a.user_id=$2 AND a.access_role='owner' AND a.revoked_at IS NULL LIMIT 1",
  [projectId,userId]);
 return access.rowCount===1;
}

export function registerVipPhotoRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void{
 app.get("/api/vip/projects/:projectId/photos",enabled,authenticated,async(req:Request,res:Response)=>{
   const projectId=idFrom(req.params.projectId);
   if(!projectId)return res.status(404).json({error:"Project not found"});
   try{
     if(!(await ownsProject(projectId,res.locals.vipUser.id)))return res.status(404).json({error:"Project not found"});
     const r=await pool.query(
       "SELECT id::text AS id,photo_date::text AS photo_date,caption,created_at "+
       "FROM vip_project_photos WHERE project_id=$1 AND is_published=TRUE "+
       "ORDER BY photo_date DESC,id DESC LIMIT 100",[projectId]);
     return res.json({photos:r.rows});
   }catch{return res.status(503).json({error:"Photos unavailable"});}
 });

 app.get("/api/admin/vip/projects/:projectId/photos",enabled,authenticated,adminOnly,async(req:Request,res:Response)=>{
   const projectId=idFrom(req.params.projectId);
   if(!projectId)return res.status(400).json({error:"Invalid project"});
   try{
     const r=await pool.query(
       "SELECT id::text AS id,photo_date::text AS photo_date,caption,is_published,created_at "+
       "FROM vip_project_photos WHERE project_id=$1 ORDER BY photo_date DESC,id DESC LIMIT 100",
       [projectId]);
     return res.json({photos:r.rows});
   }catch{return res.status(503).json({error:"Photos unavailable"});}
 });

 app.post("/api/admin/vip/projects/:projectId/photos",enabled,authenticated,adminOnly,sameOrigin,uploaded,async(req:Request,res:Response)=>{
   const projectId=idFrom(req.params.projectId);
   const date=vipDate(req.body?.photoDate);
   const caption=typeof req.body?.caption==="string"?req.body.caption.trim():"";
   if(!projectId||!date||caption.length>250||!req.file)return res.status(400).json({error:"Invalid project, date or file"});
   const mime=validVipPhoto(req.file.buffer);
   if(!mime)return res.status(415).json({error:"Only JPEG/PNG project images accepted"});
   const exists=await pool.query("SELECT 1 FROM vip_projects WHERE id=$1 LIMIT 1",[projectId]).catch(()=>null);
   if(!exists||!exists.rowCount)return res.status(404).json({error:"Project not found"});
   let objectPath:string|undefined;
   try{
     objectPath=await savePrivateProjectPhoto(projectId,req.file.buffer,mime);
     const db=await pool.connect();
     try{
       await db.query("BEGIN");
       const p=await db.query("SELECT id FROM vip_projects WHERE id=$1 FOR UPDATE",[projectId]);
       if(p.rowCount!==1)throw Error("PROJECT_REMOVED");
       const r=await db.query(
         "INSERT INTO vip_project_photos(project_id,object_path,photo_date,caption,mime_type,size_bytes,uploaded_by,is_published) "+
         "VALUES($1,$2,$3,$4,$5,$6,$7,FALSE) RETURNING id::text AS id",
         [projectId,objectPath,date,caption||null,mime,req.file.size,res.locals.vipUser.id]);
       await db.query(
         "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
         "VALUES($1,'project_photo_uploaded',$2::jsonb)",
         [res.locals.vipUser.id,JSON.stringify({projectId,photoId:r.rows[0].id})]);
       await db.query("COMMIT");
       return res.status(201).json({photo:{id:r.rows[0].id,isPublished:false}});
     }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e;}
     finally{db.release();}
   }catch{
     if(objectPath)await removePrivateProjectPhoto(objectPath).catch(()=>{});
     return res.status(503).json({error:"Photo could not be saved"});
   }
 });

 app.patch("/api/admin/vip/projects/:projectId/photos/:photoId",
  enabled,authenticated,adminOnly,sameOrigin,async(req:Request,res:Response)=>{
    if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
    const projectId=idFrom(req.params.projectId),photoId=idFrom(req.params.photoId);
    const published=req.body?.isPublished;
    if(!projectId||!photoId||typeof published!=="boolean")return res.status(400).json({error:"Invalid photo update"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Unavailable"});
    try{
      await db.query("BEGIN");
      const r=await db.query(
        "UPDATE vip_project_photos SET is_published=$3 "+
        "WHERE project_id=$1 AND id=$2 RETURNING id::text AS id,is_published",
        [projectId,photoId,published]);
      if(!r.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Photo not found"});}
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'project_photo_visibility_changed',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({projectId,photoId,published})]);
      await db.query("COMMIT");
      return res.json({photo:r.rows[0]});
    }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"Could not update photo"});}
    finally{db.release();}
  });

 app.get("/api/vip/photos/:photoId/view",enabled,authenticated,async(req:Request,res:Response)=>{
   const photoId=idFrom(req.params.photoId);
   if(!photoId)return res.status(404).json({error:"Photo not found"});
   try{
     const data=await pool.query(
       "SELECT project_id,object_path,mime_type,is_published FROM vip_project_photos WHERE id=$1 LIMIT 1",[photoId]);
     if(!data.rowCount)return res.status(404).json({error:"Photo not found"});
     const p=data.rows[0];
     if(!res.locals.vipUser.isAdmin && (!p.is_published||!(await ownsProject(Number(p.project_id),res.locals.vipUser.id)))){
       return res.status(404).json({error:"Photo not found"});
     }
     const contents=await readPrivateProjectPhoto(p.object_path);
     res.setHeader("Content-Type",p.mime_type);
     res.setHeader("X-Content-Type-Options","nosniff");
     res.setHeader("Cache-Control","private, no-store");
     res.setHeader("Cross-Origin-Resource-Policy","same-origin");
     res.setHeader("Content-Disposition","inline");
     return res.status(200).end(contents);
   }catch{return res.status(503).json({error:"Photo unavailable"});}
 });
}
