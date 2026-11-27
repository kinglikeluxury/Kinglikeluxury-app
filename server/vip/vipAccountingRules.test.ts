import {test} from "node:test";
import {strict as assert} from "node:assert";
import {financeAdjustmentInput,validDeveloperStatementUpload} from "./vipAccountingRules";
test("published costs require evidence, currencies and exact amount precision",()=>{
 const base={category:"maintenance",amount:"2.06",currency:"USD",description:"Confirmed 2027 service fee",source:"developer_statement",sourceReference:"Statement 2027-04",publish:true};
 assert(financeAdjustmentInput.safeParse(base).success);
 assert(!financeAdjustmentInput.safeParse({...base,source:"internal_note"}).success);
 assert(!financeAdjustmentInput.safeParse({...base,amount:"2.069"}).success);
 assert(!financeAdjustmentInput.safeParse({...base,sourceReference:""}).success);
 assert(!financeAdjustmentInput.safeParse({...base,amount:"0"}).success);
 assert(financeAdjustmentInput.safeParse({...base,publish:false,source:"internal_note",sourceReference:""}).success);
});
test("only structured PDFs with an EOF marker are accepted as official statements",()=>{
 const pdf=Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
 assert(validDeveloperStatementUpload(pdf));
 assert(!validDeveloperStatementUpload(Buffer.from("%PDF-1.7fake")));
 assert(!validDeveloperStatementUpload(Buffer.from("hello.pdf")));
});
