import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  saveNeonPrivateObject, readNeonPrivateObject, removeNeonPrivateObject
} from "./vipNeonS3Storage";
import {savePrivateReceipt,readPrivateReceipt,removePrivateReceipt,
  savePrivateProjectPhoto,readPrivateProjectPhoto,removePrivateProjectPhoto,
  savePrivateOfficialStatement,readPrivateOfficialStatement,removePrivateOfficialStatement
} from "./vipPrivateReceiptStorage";

const key="kinglike-vip/receipts/00000000-0000-4000-8000-000000000001.pdf";
const fakeConfig:Record<string,string>={
  KINGLIKE_VIP_STORAGE_PROVIDER:"neon-s3",
  KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED:"true",
  KINGLIKE_VIP_NEON_BUCKET_NAME:"vip-ci-private",
  KINGLIKE_VIP_NEON_S3_ENDPOINT:"https://br-test-branch.storage.c-8.us-east-1.aws.neon.tech",
  KINGLIKE_VIP_NEON_S3_REGION:"us-east-1",
  KINGLIKE_VIP_NEON_S3_ACCESS_KEY_ID:"nak_live_fixture_only_123",
  KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY:"nsk_live_fixture_only_never_a_real_secret",
};

async function mockStorage(
  fn:(ctx:{calls:Array<{method:string;url:string;headers:Record<string,string>}>;objects:Map<string,Buffer>})=>Promise<void>
) {
  const before=Object.fromEntries(Object.keys(fakeConfig).map(k=>[k,process.env[k]]));
  const originalFetch=globalThis.fetch;
  const objects=new Map<string,Buffer>();
  const calls:Array<{method:string;url:string;headers:Record<string,string>}>=[];
  try{
    Object.assign(process.env,fakeConfig);
    globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const method=init?.method||"GET";
      const headers=init?.headers as Record<string,string>;
      calls.push({method,url,headers});
      assert(url.startsWith(fakeConfig.KINGLIKE_VIP_NEON_S3_ENDPOINT+
        "/vip-ci-private/kinglike-vip/"));
      assert(!url.includes(fakeConfig.KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY));
      assert(!url.includes("X-Amz-Signature"));
      assert(headers.Authorization?.startsWith("AWS4-HMAC-SHA256 Credential=nak_live_fixture_only_123"));
      const objectKey=decodeURIComponent(url.split("/vip-ci-private/")[1]);
      if(method==="PUT"){
        assert.equal(headers["If-None-Match"],"*");
        if(objects.has(objectKey))return new Response("duplicate",{status:412});
        const body=Buffer.from(init?.body as Uint8Array);
        objects.set(objectKey,body);
        return new Response(null,{status:200});
      }
      if(method==="HEAD"){
        const item=objects.get(objectKey);
        return new Response(null,{status:item?200:404,
          headers:item?{"Content-Length":String(item.length)}:undefined});
      }
      if(method==="GET"){
        const item=objects.get(objectKey);
        return item?new Response(item,{status:200,
          headers:{"Content-Length":String(item.length)}}):
          new Response(null,{status:404});
      }
      if(method==="DELETE"){
        objects.delete(objectKey);
        return new Response(null,{status:204});
      }
      throw Error("Unexpected method "+method);
    };
    await fn({calls,objects});
  }finally{
    globalThis.fetch=originalFetch;
    for(const [k,value] of Object.entries(before)){
      if(value===undefined)delete process.env[k];else process.env[k]=value;
    }
  }
}

test("Neon private PUT verifies size, reads through backend and deletes object",async()=>{
  await mockStorage(async({calls,objects})=>{
    const pdf=Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF");
    assert.equal(await saveNeonPrivateObject(key,pdf,"application/pdf"),key);
    assert.deepEqual(await readNeonPrivateObject(key),pdf);
    await removeNeonPrivateObject(key);
    assert.equal(objects.size,0);
    assert.deepEqual(calls.map(c=>c.method),["PUT","HEAD","GET","DELETE"]);
  });
});

test("No approved private bucket means fail closed before any S3 request",async()=>{
  await mockStorage(async({calls})=>{
    process.env.KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED="false";
    await assert.rejects(readNeonPrivateObject(key),/approved/);
    await assert.rejects(saveNeonPrivateObject(key,Buffer.from("a"),"application/pdf"),/approved/);
    assert.equal(calls.length,0);
  });
});

test("No overwrite and no path traversal outside VIP namespace",async()=>{
  await mockStorage(async({calls})=>{
    await assert.rejects(readNeonPrivateObject("../../users.sql"),/Invalid VIP object key/);
    await assert.rejects(removeNeonPrivateObject("kinglike-vip/receipts/../secret.pdf"),/Invalid VIP object key/);
    await assert.rejects(saveNeonPrivateObject(key,Buffer.alloc(10*1024*1024+1),"application/pdf"),/size/);
    await assert.rejects(saveNeonPrivateObject(key,Buffer.from("wrong-type"),"image/png"),/type does not match/);
    assert.equal(calls.length,0);
    const body=Buffer.from("one");
    await saveNeonPrivateObject(key,body,"application/pdf");
    await assert.rejects(saveNeonPrivateObject(key,Buffer.from("two"),"application/pdf"),/write failed/);
    assert.deepEqual(await readNeonPrivateObject(key),body);
  });
});

test("Bounded backend reads fail closed when object exceeds approved size",async()=>{
  await mockStorage(async({calls})=>{
    await saveNeonPrivateObject(key,Buffer.from("12345"),"application/pdf");
    await assert.rejects(readNeonPrivateObject(key,4),/too large/);
    assert.equal(calls.filter(x=>x.method==="GET").length,1);
  });
});

test("existing VIP file API uses the same private Neon adapter for all three document types",async()=>{
  await mockStorage(async({calls,objects})=>{
    const receipt=Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF");
    const receiptKey=await savePrivateReceipt(receipt,"application/pdf","pdf");
    assert.equal(receiptKey.startsWith("kinglike-vip/receipts/"),true);
    assert.deepEqual(await readPrivateReceipt(receiptKey),receipt);

    const photo=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
    const photoKey=await savePrivateProjectPhoto(7,photo,"image/png");
    assert.equal(photoKey.startsWith("kinglike-vip/project-photos/7/"),true);
    assert.deepEqual(await readPrivateProjectPhoto(photoKey),photo);

    const statement=Buffer.from("%PDF-1.7\nStatement test document");
    const statementKey=await savePrivateOfficialStatement(statement);
    assert.equal(statementKey.startsWith("kinglike-vip/official-statements/"),true);
    assert.deepEqual(await readPrivateOfficialStatement(statementKey),statement);

    await removePrivateReceipt(receiptKey);
    await removePrivateProjectPhoto(photoKey);
    await removePrivateOfficialStatement(statementKey);
    assert.equal(objects.size,0);
    assert.equal(calls.filter(x=>x.method==="PUT").length,3);
    assert.equal(calls.filter(x=>x.method==="GET").length,3);
    assert.equal(calls.filter(x=>x.method==="DELETE").length,3);
  });
});
