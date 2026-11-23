import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readVipNeonStorageConfig } from "./vipNeonStorageConfig";

function configuration(overrides: Record<string,string|undefined> = {}) {
  return {
    KINGLIKE_VIP_STORAGE_PROVIDER:"neon-s3",
    KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED:"true",
    KINGLIKE_VIP_NEON_BUCKET_NAME:"kinglike-vip-private",
    KINGLIKE_VIP_NEON_S3_ENDPOINT:"https://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech",
    KINGLIKE_VIP_NEON_S3_REGION:"us-east-1",
    KINGLIKE_VIP_NEON_S3_ACCESS_KEY_ID:"nak_live_fixturenotreal",
    KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY:"nsk_live_this-is-test-only-and-not-real",
    ...overrides,
  };
}

test("accepts only explicitly enabled Neon private storage settings", () => {
  const parsed=readVipNeonStorageConfig(configuration());
  assert.equal(parsed.bucket,"kinglike-vip-private");
  assert.equal(parsed.region,"us-east-1");
  assert.equal(parsed.endpoint,"https://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech");
  assert(Object.isFrozen(parsed));
});

test("missing approval or provider flag keeps private files unavailable", () => {
  assert.throws(()=>readVipNeonStorageConfig(configuration({
    KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED:"false"
  })),/approved/);
  assert.throws(()=>readVipNeonStorageConfig(configuration({
    KINGLIKE_VIP_STORAGE_PROVIDER:"gcs"
  })),/approved/);
  assert.throws(()=>readVipNeonStorageConfig(configuration({
    KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY:undefined
  })),/invalid/);
});

test("rejects arbitrary endpoints, insecure HTTP, userinfo, query params and region mismatch", () => {
  const bad=[
    "http://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech",
    "https://evil.example.invalid",
    "https://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech.evil.invalid",
    "https://user:pass@br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech",
    "https://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech/?token=secret",
    "https://br-test-branch-xyz.storage.c-8.eu-west-1.aws.neon.tech",
    "https://br-test-branch-xyz.storage.c-8.us-east-1.aws.neon.tech:8443",
    "https://127.0.0.1",
  ];
  for(const endpoint of bad){
    assert.throws(()=>readVipNeonStorageConfig(configuration({
      KINGLIKE_VIP_NEON_S3_ENDPOINT:endpoint,
    })),undefined,endpoint);
  }
});

test("rejects malformed bucket names and missing credentials", () => {
  for(const bucket of ["public.vault","../private","private/path","A-PRIVATE","x","a".repeat(70)]){
    assert.throws(()=>readVipNeonStorageConfig(configuration({
      KINGLIKE_VIP_NEON_BUCKET_NAME:bucket,
    })),undefined,bucket);
  }
  assert.throws(()=>readVipNeonStorageConfig(configuration({
    KINGLIKE_VIP_NEON_S3_ACCESS_KEY_ID:"short",
  })),/invalid/);
});
