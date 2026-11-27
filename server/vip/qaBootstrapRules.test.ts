import {test} from "node:test";
import {strict as assert} from "node:assert";
import {validateQaBootstrapIdentity} from "./qaBootstrapRules";
test("bootstrap can only create explicitly labeled synthetic QA identities",()=>{
 assert(validateQaBootstrapIdentity("qa_demo_admin","qa_demo_admin@fixture.test","SyntheticOnly-DemoPassword-53!"));
 assert(!validateQaBootstrapIdentity("admin","admin@example.com","SyntheticOnly-DemoPassword-53!"));
 assert(!validateQaBootstrapIdentity("qa_demo_admin","admin@kinglikeluxury.com","SyntheticOnly-DemoPassword-53!"));
 assert(!validateQaBootstrapIdentity("qa_demo_admin","qa_demo_admin@fixture.test","weak"));
});
