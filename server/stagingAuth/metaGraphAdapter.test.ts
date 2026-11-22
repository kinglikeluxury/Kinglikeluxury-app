import assert from "node:assert/strict";
import test from "node:test";
import type { MetaGraphClient } from "../whatsappCoexistenceMetaGraph";
import { createStagingCoexistenceMetaAdapter } from "./metaGraphAdapter";

function fixture(overrides: Partial<MetaGraphClient> = {}): MetaGraphClient {
  return {
    exchangeCode: async () => "synthetic-token",
    inspectToken: async () => ({appId:"123",valid:true,expiresAt:0,scopes:[]}),
    listBusinessOwnedWabas: async () => ["789"],
    listWabaPhoneNumbers: async () => ["456"],
    listWabaPhoneNumberDetails: async () => [{id:"456",displayPhoneNumber:"+995511746491"}],
    getCoexistencePhoneStatus: async () => ({isOnBizApp:true,platformType:"CLOUD_API"}),
    subscribeAppToWaba: async () => {},
    ...overrides,
  };
}

test("staging Meta adapter forwards the exact-number Coexistence verification",async()=>{
  const calls: Array<[string,string]> = [];
  const meta = fixture({
    getCoexistencePhoneStatus:async(id,token)=>{
      calls.push([id,token]);
      return {isOnBizApp:true,platformType:"CLOUD_API"};
    },
  });
  const adapter = createStagingCoexistenceMetaAdapter(()=>meta);
  assert.equal(typeof adapter.getCoexistencePhoneStatus,"function");
  const status=await adapter.getCoexistencePhoneStatus!("456","synthetic-token");
  assert.deepEqual(status,{isOnBizApp:true,platformType:"CLOUD_API"});
  assert.deepEqual(calls,[["456","synthetic-token"]]);
});

test("staging Meta adapter cannot manufacture a positive Coexistence result",async()=>{
  const adapter = createStagingCoexistenceMetaAdapter(()=>fixture({
    getCoexistencePhoneStatus:async()=>({isOnBizApp:false,platformType:""}),
  }));
  assert.deepEqual(await adapter.getCoexistencePhoneStatus!("456","synthetic-token"),
    {isOnBizApp:false,platformType:""});
});

test("staging Meta adapter fails closed if verification API is absent",async()=>{
  const adapter=createStagingCoexistenceMetaAdapter(()=>fixture({
    getCoexistencePhoneStatus:undefined,
  }));
  await assert.rejects(
    ()=>adapter.getCoexistencePhoneStatus!("456","synthetic-token"),
    /staging_meta_coexistence_check_unavailable/,
  );
});

test("staging Meta adapter never treats a missing subscription method as success",async()=>{
  const adapter=createStagingCoexistenceMetaAdapter(()=>fixture({
    subscribeAppToWaba:undefined,
  }));
  await assert.rejects(
    ()=>adapter.subscribeAppToWaba!("789","synthetic-token"),
    /staging_meta_subscription_unavailable/,
  );
});
