import {test} from "node:test";
import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import vm from "node:vm";

test("VIP client, staff and admin URLs are never intercepted by the PWA cache",()=>{
 const sw=readFileSync("client/public/sw.js","utf8");
 const handlers:Record<string,(event:{request:{method:string;url:string};respondWith:(value:unknown)=>void})=>void>={};
 vm.runInNewContext(sw,{
  self:{
   addEventListener(name:string,handler:(event:{request:{method:string;url:string};respondWith:(value:unknown)=>void})=>void){handlers[name]=handler;},
   skipWaiting(){},clients:{claim(){}}
  },
  URL,
   caches:{open:()=>Promise.resolve({put:()=>Promise.resolve()}),keys:()=>Promise.resolve([]),match:()=>Promise.resolve(null)},
  fetch:()=>Promise.resolve({status:200,clone(){return this}}),
  console
 });
 const callback=handlers.fetch;
 assert(callback,"fetch listener exists");
 for(const path of [
  "/api/vip/me","/api/vip/receipts/100/download",
  "/vip","/vip/activate?token=private-token",
  "/vip/refer/KLR-0123456789ABCDEF0123456789ABCDEF",
  "/vip/card/verify?code=secret","/vip/support",
  "/vip/sales","/admin/vip","/admin/vip/security"
 ]){
  let intercepted=false;
  callback({request:{method:"GET",url:"https://vip.example.test"+path},respondWith(){intercepted=true}});
  assert(!intercepted,path+" must remain network-only");
 }
 let publicIntercepted=false;
 callback({request:{method:"GET",url:"https://vip.example.test/properties"},respondWith(){publicIntercepted=true}});
 assert(publicIntercepted,"Public static navigation remains cache-capable");
});
