import { validatePhone, validateEmail } from "../shared/crmValidation";

const phoneTests = [
  { input: "+995591000058", expect: { valid: true,  country: "Georgia" } },
  { input: "+972568455665", expect: { valid: true,  country: "Israel" } },
  { input: "+905551112233", expect: { valid: true,  country: "Turkey" } },
  { input: "+971501234567", expect: { valid: true,  country: "United Arab Emirates" } },
  { input: "+966501234567", expect: { valid: true,  country: "Saudi Arabia" } },
  { input: "+96550000000",  expect: { valid: true,  country: "Kuwait" } },
  { input: "+97450000000",  expect: { valid: true,  country: "Qatar" } },
  { input: "12345",         expect: { valid: false, error: "Invalid phone number." } },
  { input: "+995",          expect: { valid: false, error: "Invalid phone number." } },
  { input: "",              expect: { valid: false, error: "Phone number is required." } },
];

const emailTests = [
  { input: "hello@gmail.com",   expect: { valid: true } },
  { input: "test@example.co",   expect: { valid: true } },
  { input: "",                  expect: { valid: true } },  // optional
  { input: "test@",             expect: { valid: false } },
  { input: "abc.com",           expect: { valid: false } },
  { input: "hello@",            expect: { valid: false } },
  { input: "hello@gmail",       expect: { valid: false } },
  { input: "test",              expect: { valid: false } },
];

let pass = 0, fail = 0;

console.log("\n=== PHONE VALIDATION ===");
for (const t of phoneTests) {
  const r = validatePhone(t.input);
  const ok = r.valid === t.expect.valid
    && (!t.expect.country || r.country === t.expect.country)
    && (!t.expect.error   || r.error   === t.expect.error);
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} "${t.input}" → valid=${r.valid}, country="${r.country}", error="${r.error ?? ""}"`);
  ok ? pass++ : fail++;
}

console.log("\n=== EMAIL VALIDATION ===");
for (const t of emailTests) {
  const r = validateEmail(t.input);
  const ok = r.valid === t.expect.valid;
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} "${t.input}" → valid=${r.valid}, error="${r.error ?? ""}"`);
  ok ? pass++ : fail++;
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
