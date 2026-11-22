import {z} from "zod";
const isoCurrency=z.string().regex(/^[A-Z]{3}$/);
const bizDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>{
 const date=new Date(x+"T12:00:00Z");
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===x;
});
const amount=z.string().regex(/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/).refine(x=>Number(x)>0);
const percentage=z.string().regex(/^(?:[0-9]{1,2}(?:\.[0-9]{1,4})?|100(?:\.0{1,4})?)$/);

export const fxRateInput=z.object({
 baseCurrency:isoCurrency,quoteCurrency:isoCurrency,
 rate:z.string().regex(/^[0-9]{1,10}(?:\.[0-9]{1,8})?$/).refine(x=>Number(x)>0),
 effectiveDate:bizDate,
 source:z.string().trim().min(3).max(120),
 sourceReference:z.string().trim().min(8).max(180),
 published:z.boolean()
}).strict().refine(v=>v.baseCurrency!==v.quoteCurrency,{message:"Same-currency rates are not permitted"});

export const internalCommissionInput=z.object({
 unitId:z.number().int().positive(),
 side:z.enum(["income","expense"]),
 category:z.enum(["developer","employee","field","manager","referral","bonus","other"]),
 basisAmount:amount.nullable(),
 percentage:percentage.nullable(),
 fixedAmount:amount.nullable(),
 currency:isoCurrency,
 payeeLabel:z.string().trim().min(3).max(100),
 contractReference:z.string().trim().min(8).max(180),
 note:z.string().trim().max(500)
}).strict().refine(v=>(v.fixedAmount!==null) !== (v.basisAmount!==null&&v.percentage!==null),{
 message:"Exactly one calculation method must be selected"
});
export const internalCommissionAction=z.object({
 action:z.enum(["approve","void","record_settlement"]),
 note:z.string().trim().min(10).max(400),
 paymentReference:z.string().trim().min(8).max(180).nullable()
}).strict().refine(v=>v.action!=="record_settlement"||v.paymentReference!==null,{
 message:"A financial settlement record reference is required"
});
export function commissionEstimate(v:{basis_amount:string|null;percentage:string|null;fixed_amount:string|null}):string{
 if(v.fixed_amount!==null)return Number(v.fixed_amount).toFixed(2);
 if(v.basis_amount===null||v.percentage===null)throw Error("Invalid commission method");
 const cents=BigInt(Math.round(Number(v.basis_amount)*100));
 const rate=BigInt(Math.round(Number(v.percentage)*10000));
 const result=(cents*rate+500000n)/1000000n;
 return (Number(result)/100).toFixed(2);
}
