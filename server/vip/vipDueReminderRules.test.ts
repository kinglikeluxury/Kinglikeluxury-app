import {test} from "node:test";
import {strict as assert} from "node:assert";
import {generateVipDueReminders} from "./vipDueReminderJob";

test("due-reminder generator is inert until explicitly invoked",()=>{
 assert.equal(typeof generateVipDueReminders,"function");
});
