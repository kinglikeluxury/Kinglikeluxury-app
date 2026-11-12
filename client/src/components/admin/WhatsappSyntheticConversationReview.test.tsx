import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WhatsappSyntheticConversationReview from "./WhatsappSyntheticConversationReview";

test("staging synthetic chat preview labels all content and preserves original after mocked revoke",()=>{
  const markup=renderToStaticMarkup(<WhatsappSyntheticConversationReview/>);
  assert.match(markup,/بيانات اصطناعية محلية/);
  assert.match(markup,/عرض تجريبي/);
  assert.match(markup,/أريد موعد جولة غداً/);
  assert.match(markup,/حُذفت وفق حدث Meta تجريبي/);
  assert.match(markup,/حذف «لديّ فقط»/);
  assert.match(markup,/مقطع صوتي تجريبي/);
  assert.doesNotMatch(markup,/\+995|\+994|api\/whatsapp|webhook|sendMessage/);
});
