import assert from "node:assert/strict";
import {test} from "node:test";
import {
  createQaLocalFontFaceCss,
  sanitizeQaPreviewCss,
  sanitizeQaPreviewHtml,
} from "./qaPreviewHtml.mjs";

test("local QA HTML removes inline and external scripts and retains local entrypoints", () => {
  const input = `<!doctype html><html><head>
    <link rel="preconnect" href="https://fonts.example.test">
    <link href="https://fonts.example.test/style.css" rel="stylesheet">
    <script type="module" src="/src/main.tsx"></script>
    <script async src="https://analytics.example.test/tag.js"></script>
    <script>window.dataLayer=[];function gtag(){}</script>
    </head><body><script>navigator.serviceWorker.register('/sw.js')</script></body></html>`;
  const output = sanitizeQaPreviewHtml(input);
  assert.doesNotMatch(output, /https?:\/\//i);
  assert.doesNotMatch(output, /serviceWorker\.register|googletagmanager|gtag\(/i);
  assert.doesNotMatch(output, /<script(?![^>]*\bsrc=)/i);
  assert.match(output, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.match(output, /name="robots" content="noindex, nofollow, noarchive"/);
});

test("local QA HTML fails closed if an external resource is not removed", () => {
  assert.throws(
    () => sanitizeQaPreviewHtml("<html><head><title>https://unexpected.test</title></head></html>"),
    /External resources remain/,
  );
});

test("local QA CSS removes external font and image requests but keeps local assets", () => {
  const input=`@import"https://fonts.googleapis.com/css2?family=Tajawal;wght@400&display=swap";`+
    `.local{background:url('/assets/local.svg')}`+
    `.remote{background-image:url("https://img.example.test/picture.png")}`;
  const output=sanitizeQaPreviewCss(input);
  assert.doesNotMatch(output,/@import\s*["']?https?:\/\//i);
  assert.doesNotMatch(output,/url\(\s*["']?https?:\/\//i);
  assert.match(output,/\/assets\/local\.svg/);
});

test("local QA fonts use only bundled Tajawal files", () => {
  const output=createQaLocalFontFaceCss([
    "Tajawal-Regular-local.woff2",
    "Tajawal-Medium-local.woff2",
    "Tajawal-Bold-local.woff2",
  ]);
  assert.equal((output.match(/@font-face/g)||[]).length,3);
  assert.doesNotMatch(output,/https?:\/\//i);
  assert.match(output,/font-weight:700/);
  assert.throws(()=>createQaLocalFontFaceCss([]),/Local QA font asset is missing/);
});
