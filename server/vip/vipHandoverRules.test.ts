import {test} from "node:test";
import {strict as assert} from "node:assert";
import {HANDOVER_CHECK_ITEMS,DEFAULT_HANDOVER_CHECKLIST,canUpdateHandoverState,validHandoverChecklist,validAppointmentDate} from "./vipHandoverRules";

test("handover stage transition cannot skip legal stages",()=>{
  const passed=Object.fromEntries(HANDOVER_CHECK_ITEMS.map(k=>[k,"passed"]));
  assert.equal(validHandoverChecklist(DEFAULT_HANDOVER_CHECKLIST),true);
  assert.equal(validHandoverChecklist(passed),true);
  assert.equal(validHandoverChecklist({...passed,evil:"passed"}),false);
  assert.equal(validHandoverChecklist({...passed,access:"issue"}),true);
  assert.equal(canUpdateHandoverState("not_ready","mark_ready",passed as any,0),true);
  assert.equal(canUpdateHandoverState("ready_for_appointment","finish_inspection",passed as any,0),false);
  assert.equal(canUpdateHandoverState("appointment_scheduled","finish_inspection",DEFAULT_HANDOVER_CHECKLIST,0),false);
  assert.equal(canUpdateHandoverState("appointment_scheduled","finish_inspection",passed as any,1),false);
  assert.equal(canUpdateHandoverState("appointment_scheduled","finish_inspection",passed as any,0),true);
});

test("appointment dates must be valid future UTC timestamps",()=>{
 const fixed=new Date("2026-11-22T12:00:00.000Z");
 assert.equal(validAppointmentDate("2026-11-26T11:00:00.000Z",fixed)?.toISOString(),"2026-11-26T11:00:00.000Z");
 assert.equal(validAppointmentDate("2026-11-22T12:20:00.000Z",fixed),null);
 assert.equal(validAppointmentDate("2026-02-31T12:00:00.000Z",fixed),null);
 assert.equal(validAppointmentDate("2028-01-01T12:00:00.000Z",fixed),null);
 assert.equal(validAppointmentDate("2026-11-26T11:00:00+03:00",fixed),null);
});
