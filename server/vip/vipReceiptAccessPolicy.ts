export function canDownloadVipReceipt(input:{
  isAdmin:boolean;
  hasUnitEntitlement:boolean;
  isFinanceApprover:boolean;
  reviewStatus:string;
  uploadedBy:number;
  actorId:number;
}):boolean{
  if(input.isAdmin||input.hasUnitEntitlement)return true;
  return input.isFinanceApprover&&input.reviewStatus==="pending"&&
    input.uploadedBy!==input.actorId;
}
