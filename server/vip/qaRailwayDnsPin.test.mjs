import assert from "node:assert/strict";
import {test} from "node:test";
import {
  isPrivateRailwayIpv4,
  selectSingleRailwayIpv4,
} from "./qaRailwayDnsPin.mjs";

test("Railway QA DNS pin accepts one private IPv4 result",()=>{
  assert.equal(selectSingleRailwayIpv4([
    {address:"10.21.4.7",family:4},
    {address:"fd12::7",family:6},
  ]),"10.21.4.7");
  assert.equal(isPrivateRailwayIpv4("100.64.12.34"),true);
});

test("Railway QA DNS pin rejects public, missing, or ambiguous IPv4 results",()=>{
  for(const addresses of [
    [],
    [{address:"203.0.113.10",family:4}],
    [{address:"10.21.4.7",family:4},{address:"10.21.4.8",family:4}],
  ]){
    assert.throws(()=>selectSingleRailwayIpv4(addresses));
  }
  assert.equal(isPrivateRailwayIpv4("fd12::7"),false);
});
