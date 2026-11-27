export function isAllowedVipQaReceiptUpload(input:{
  runtime:string|undefined;
  previewEnabled:boolean;
  isAdmin:boolean;
  source:unknown;
  normalizedFileName:string;
}):boolean{
  if(input.runtime!=="railway"||!input.previewEnabled)return true;
  if(!/^synthetic-[A-Za-z0-9._ -]{1,110}\.(?:pdf|jpg|png)$/i.test(input.normalizedFileName)){
    return false;
  }
  return input.isAdmin?input.source==="admin":input.source==="client";
}
