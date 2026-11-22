export const MAX_VIP_PHOTO_BYTES = 8 * 1024 * 1024;
export function validVipPhoto(buffer:Buffer):"image/jpeg"|"image/png"|null{
  if(!Buffer.isBuffer(buffer)||buffer.length<12||buffer.length>MAX_VIP_PHOTO_BYTES)return null;
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return "image/jpeg";
  return null;
}
export function vipDate(raw:unknown):string|null{
  if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
  const d=new Date(raw+"T12:00:00Z");
  return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==raw?null:raw;
}
