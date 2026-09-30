/* Verification harness for BITS Digital CodeForge Grading Console.
   Drives the real app through DOM events in jsdom with the real SheetJS
   library. No app code is modified for testing. */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const XLSX = require("xlsx");

const HTML_PATH = path.join(__dirname, "..", "BITS_Digital_CodeForge_Challenge.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log("  FAIL: " + name); }
}
function eq(actual, expected, name) {
  ok(actual === expected, name + " | expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(dom, predicate, label, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let v;
    try { v = predicate(dom.window.document); } catch (e) { v = false; }
    if (v) return v;
    await sleep(15);
  }
  ok(false, "timeout waiting for: " + label);
  return null;
}

function makeWorkbook(sheets, header, bookType) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((rows, i) => {
    const ws = XLSX.utils.aoa_to_sheet(header ? [header, ...rows] : rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet" + (i + 1));
  });
  return XLSX.write(wb, { type: "array", bookType: bookType || "xlsx" });
}

function makeCsv(text) {
  return Buffer.from(text, "utf8");
}

function createDom() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: false,
    beforeParse(window) {
      window.XLSX = XLSX;
      window.__errors = [];
      window.addEventListener("error", (e) => window.__errors.push(e.message));
      window.confirm = () => true;
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
      window.__intervals = [];
      const origSet = window.setInterval.bind(window);
      window.setInterval = function (fn, ms) {
        const id = origSet(fn, ms);
        window.__intervals.push(id);
        return id;
      };
      const origClear = window.clearInterval.bind(window);
      window.clearInterval = function (id) {
        const idx = window.__intervals.indexOf(id);
        if (idx >= 0) window.__intervals.splice(idx, 1);
        return origClear(id);
      };
      window.HTMLCanvasElement.prototype.getContext = function () { return null; };
      window.__lastBlob = null;
      window.URL.createObjectURL = function (blob) {
        window.__lastBlob = blob;
        return "blob:mock";
      };
      window.URL.revokeObjectURL = function () {};
      window.HTMLAnchorElement.prototype.click = function () {};
    },
  });
  return dom;
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

function dispatchUpload(dom, buffer, name) {
  const doc = dom.window.document;
  const input = doc.getElementById("file");
  const file = new dom.window.File([buffer], name, { type: "application/octet-stream" });
  setInputFiles(input, [file]);
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

async function upload(dom, buffer, name) {
  dispatchUpload(dom, buffer, name);
  await sleep(60);
}

function setInstructor(dom, name) {
  const doc = dom.window.document;
  const el = doc.getElementById("instructor");
  el.value = name;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function selectCourse(dom, value) {
  const doc = dom.window.document;
  const el = doc.getElementById("course");
  el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function click(dom, id) {
  dom.window.document.getElementById(id).click();
}

function blocked(dom) { return dom.window.document.getElementById("download").getAttribute("aria-disabled") === "true"; }
function visible(dom, id) {
  const el = dom.window.document.getElementById(id);
  return el && !el.hidden;
}

function text(dom, id) {
  const el = dom.window.document.getElementById(id);
  return el ? el.textContent : null;
}

async function lastCsv(dom) {
  const blob = dom.window.__lastBlob;
  if (!blob) return null;
  return blob.text();
}

async function lastCsvBytes(dom) {
  const blob = dom.window.__lastBlob;
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

const HEADER = ["BITS ID", "Course", "Total Marks"];

async function main() {
  console.log("== CodeForge verification ==\n");
  const extra = [];

  /* ---------- 1. Boot: no runtime errors, timer not started ---------- */
  console.log("[1] Boot");
  const dom = createDom();
  const doc = dom.window.document;
  await waitFor(dom, () => doc.getElementById("course") && doc.getElementById("course").options.length >= 1, "boot");
  eq(text(dom, "timerText"), "00:00", "timer shows 00:00 at boot");
  eq(dom.window.__intervals.length, 0, "timer NOT started at page load");
  eq(doc.getElementById("file").disabled, false, "file input enabled once SheetJS ready");
  eq(blocked(dom), true, "download blocked before upload");
  eq(text(dom, "min"), "-", "min placeholder before upload");
  eq(text(dom, "avg"), "-", "avg placeholder before upload");

  /* ---------- 2. Valid .xlsx upload ---------- */
  console.log("[2] Valid .xlsx upload");
  const goodRows = [
    ["2024A001", "CSEC301", 82],
    ["2024A002", "CSEC301", 71],
    ["2024A003", "CSEC301", 64],
    ["2024A004", "CSEC301", 40],
    ["2024A005", "CSEC301", 0],
    ["2024A006", "CSEC301", 100],
  ];
  await upload(dom, makeWorkbook([goodRows], HEADER), "marks.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "course option appears");
  eq(doc.getElementById("course").options.length, 2, "placeholder + 1 course");
  eq(doc.getElementById("course").options[1].textContent, "CSEC301 - 6 students", "course option label with count");
  eq(visible(dom, "fileBanner"), false, "no error banner on valid upload");
  eq(text(dom, "analyticsSub").indexOf("Select a course above") === 0, true, "analytics prompts for course once file is loaded");

  /* select the course */
  selectCourse(dom, "csec301");
  await sleep(30);
  eq(text(dom, "min"), "0", "min = 0");
  eq(text(dom, "max"), "100", "max = 100");
  eq(text(dom, "avg"), "59.50", "avg = 59.50");
  eq(text(dom, "med"), "67.5", "median = 67.5");
  eq(dom.window.__intervals.length, 1, "timer STARTS on course selection");
  eq(text(dom, "passRate"), "83.3%", "pass rate 5/6 = 83.3%");
  eq(blocked(dom), true, "download still blocked (no instructor)");

  /* ---------- 3. Instructor + finalize gating ---------- */
  console.log("[3] Instructor gate");
  setInstructor(dom, "A. Sharma");
  await sleep(20);
  eq(blocked(dom), false, "download enabled with instructor");
  eq(text(dom, "welcome"), "Welcome A. SHARMA. Please review and finalize grading.", "welcome message");

  /* ---------- 4. Grade distribution ---------- */
  console.log("[4] Grade distribution");
  const summary = text(dom, "gradeSummary");
  ok(summary.indexOf("A") >= 0 && summary.indexOf("E") >= 0, "distribution lists all grades");
  ok(summary.indexOf("80-100") >= 0, "band A shows 80-100 (hyphen, no en-dash)");
  ok(summary.indexOf("0-19") >= 0, "band E shows 0-19");

  /* ---------- 5. Grade-range validation: gap ---------- */
  console.log("[5] Grade-range gap/overlap");
  const aMinusMax = doc.getElementById("A-max");
  aMinusMax.value = "75";
  aMinusMax.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await sleep(20);
  eq(blocked(dom), true, "download blocked when A- max lowered (gap)");
  const rangeErr = text(dom, "rangeError");
  ok(rangeErr.indexOf("Gap or overlap between A and A-") >= 0, "range error names the gap between A and A-");
  ok(rangeErr.indexOf("starts at") >= 0, "range error describes the gap");
  click(dom, "resetRanges");
  await sleep(20);
  eq(blocked(dom), false, "download re-enabled after reset");

  /* ---------- 6. Ungraded students block export ---------- */
  console.log("[6] Ungraded students");
  const bmax = doc.getElementById("Bmax");
  bmax.value = "65";
  bmax.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await sleep(20);
  eq(blocked(dom), true, "download blocked with ungraded students");
  ok(text(dom, "rangeError").length > 0, "range error shown for ungraded gap");
  click(dom, "resetRanges");
  await sleep(20);

  /* ---------- 7. Student search ---------- */
  console.log("[7] Student search");
  const search = doc.getElementById("search");
  eq(search.disabled, false, "search enabled for course with rows");
  search.value = "2024A00";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await sleep(20);
  const results = doc.getElementById("searchResults");
  eq(results.children.length, 6, "search finds all 6 by prefix");
  ok(results.children[0].textContent.indexOf("2024A001") >= 0, "first result is 2024A001");
  ok(results.children[0].textContent.indexOf("A") >= 0, "result shows grade A");
  ok(results.children[0].innerHTML.indexOf("<mark>") >= 0, "match highlighted with <mark>");
  eq(text(dom, "searchStatus").indexOf("6 of 6") >= 0, true, "search status counts matches");
  search.value = "9999";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await sleep(20);
  eq(results.children.length, 1, "no-match shows empty note");
  click(dom, "searchClear");
  await sleep(20);
  eq(search.value, "", "clear empties search");

  /* ---------- 8. Final review + CSV export ---------- */
  console.log("[8] Final review + CSV export");
  click(dom, "download");
  await sleep(30);
  eq(doc.getElementById("review").hasAttribute("open"), true, "review dialog opens");
  const reviewBody = text(dom, "reviewBody");
  ok(reviewBody.indexOf("A. Sharma") >= 0, "review shows instructor");
  ok(reviewBody.indexOf("CSEC301") >= 0, "review shows course");
  ok(reviewBody.indexOf("Students graded") >= 0, "review shows students graded");
  ok(reviewBody.indexOf("Total") >= 0, "review shows distribution total");
  eq(doc.getElementById("reviewConfirm").disabled, false, "review confirm enabled");

  click(dom, "reviewConfirm");
  await sleep(40);
  eq(doc.getElementById("review").hasAttribute("open"), false, "review closes after confirm");
  eq(dom.window.__intervals.length, 0, "timer STOPS on export");
  const csv = await lastCsv(dom);
  ok(csv !== null, "CSV blob captured");
  const csvBytes = await lastCsvBytes(dom);
  ok(csvBytes && csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF, "CSV has UTF-8 BOM");
  ok(csv.indexOf("\r\n") >= 0, "CSV uses CRLF");
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
  eq(lines[0], "Instructor,A. Sharma", "CSV header line 1");
  eq(lines[1], "Course,CSEC301", "CSV header line 2");
  eq(lines[2], "Students graded,6", "CSV students graded = 6");
  eq(lines[5], "Pass mark,40", "CSV pass mark");
  ok(lines[6].indexOf("A 80-100") >= 0, "CSV band legend uses hyphens");
  eq(lines[9], "BITS ID,Total Marks,Grade", "CSV column header");
  const dataRows = lines.slice(10).filter((l) => l.length > 0);
  eq(dataRows.length, 6, "CSV has 6 student rows");
  ok(csv.indexOf("2024A001,82,A") >= 0, "CSV row 2024A001 graded A");
  ok(csv.indexOf("2024A005,0,E") >= 0, "CSV row 2024A005 graded E");
  ok(csv.indexOf("2024A006,100,A") >= 0, "CSV row 2024A006 graded A");
  ok(text(dom, "thankyou").indexOf("first attempt") >= 0, "thankyou after first export");

  /* ---------- 9. Formula injection + CSV escaping ---------- */
  console.log("[9] CSV escaping + formula injection");
  const trickyRows = [
    ["=SUM(A1)", "Q, \"quoted\"", 55],
    ["+1234", "Course-B", 65],
  ];
  await upload(dom, makeWorkbook([trickyRows], HEADER), "tricky.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 3, "tricky courses appear");
  const qOpt = Array.from(doc.getElementById("course").options).find((o) => o.textContent.indexOf("Q,") >= 0);
  ok(!!qOpt, "Q course option present");
  selectCourse(dom, qOpt.value);
  await sleep(30);
  setInstructor(dom, "A. Sharma");
  await sleep(20);
  click(dom, "download");
  await sleep(30);
  click(dom, "reviewConfirm");
  await sleep(40);
  const csv2 = await lastCsv(dom);
  ok(csv2.indexOf("'=SUM(A1)") >= 0, "formula injection neutralised with leading quote");
  ok(csv2.indexOf('"Q, ""quoted"""') >= 0, "comma+quote course escaped as one cell");

  /* ---------- 10. Multiple sequential uploads: no stale/duplicate courses ---------- */
  console.log("[10] Sequential uploads");
  await upload(dom, makeWorkbook([goodRows], HEADER), "marks.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "re-upload rebuilds courses");
  eq(doc.getElementById("course").options.length, 2, "no duplicate course options after re-upload");
  const otherRows = [["2024B001", "CSEC401", 50]];
  await upload(dom, makeWorkbook([otherRows], HEADER), "other.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "second file replaces courses");
  eq(doc.getElementById("course").options[1].textContent, "CSEC401 - 1 student", "course list fully replaced");
  eq(text(dom, "min"), "-", "analytics reset after new upload");

  /* ---------- 11. Duplicate courses (case/whitespace) merge ---------- */
  console.log("[11] Course name folding");
  const foldRows = [
    ["2024C001", "csec 501", 60],
    ["2024C002", "CSEC501", 70],
    ["2024C003", " Csec501 ", 80],
  ];
  await upload(dom, makeWorkbook([foldRows], HEADER), "fold.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "folded course appears");
  eq(doc.getElementById("course").options.length, 2, "case/whitespace variants merged into one course");
  eq(doc.getElementById("course").options[1].textContent, "csec 501 - 3 students", "folded course keeps first spelling");

  /* ---------- 12. Duplicate BITS IDs ---------- */
  console.log("[12] Duplicate BITS IDs");
  const dupRows = [
    ["2024D001", "CSEC601", 60],
    ["2024D001", "CSEC601", 99],
    ["2024d001", "CSEC601", 50],
  ];
  await upload(dom, makeWorkbook([dupRows], HEADER), "dup.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "dup course appears");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(text(dom, "analyticsSub").indexOf("1 student") >= 0, true, "only 1 valid student after dedupe");
  const qBody = text(dom, "qualityBody");
  ok(qBody.indexOf("Duplicate BITS ID") >= 0, "duplicate reported in quality table");
  ok(qBody.indexOf("first seen at row 2") >= 0, "duplicate names first row");
  ok(text(dom, "qualityChips").indexOf("duplicate BITS ID") >= 0, "duplicate chip present");

  /* ---------- 13. Invalid marks ---------- */
  console.log("[13] Invalid marks");
  const badRows = [
    ["2024E001", "CSEC701", 105],
    ["2024E002", "CSEC701", -4],
    ["2024E003", "CSEC701", "N/A"],
    ["2024E004", "CSEC701", ""],
    ["2024E005", "CSEC701", 80.2],
    ["2024E006", "CSEC701", 50],
  ];
  await upload(dom, makeWorkbook([badRows], HEADER), "bad.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "bad-marks course appears");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(text(dom, "analyticsSub").indexOf("2 students") >= 0, true, "2 valid students (80.2 rounds to 80, plus 50)");
  const qBody2 = text(dom, "qualityBody");
  ok(qBody2.indexOf("outside 0-100") >= 0, "out-of-range reported with hyphen range");
  ok(qBody2.indexOf("not a number") >= 0, "non-numeric reported");
  ok(qBody2.indexOf("Missing Total Marks") >= 0, "blank marks reported");
  ok(qBody2.indexOf("Fractional marks 80.2 rounded to 80") >= 0, "fractional rounding noted");
  ok(text(dom, "qualityChips").indexOf("rounded to whole marks") >= 0, "rounding chip present");

  /* ---------- 14. Missing columns ---------- */
  console.log("[14] Missing columns");
  const noHeader = [["2024F001", "CSEC801"]];
  await upload(dom, makeWorkbook([noHeader], ["BITS ID", "Course"]), "missing.xlsx");
  await waitFor(dom, () => visible(dom, "fileBanner"), "error banner for missing columns");
  ok(text(dom, "fileBannerText").indexOf("Required columns not found") >= 0, "missing-column message shown");
  eq(doc.getElementById("course").options.length, 1, "course list cleared after failed parse");
  eq(text(dom, "min"), "-", "analytics cleared after failed parse");
  eq(text(dom, "qualitySub"), "No marks file loaded yet.", "quality panel reset after failed parse");

  /* ---------- 15. Empty course (all rows invalid) ---------- */
  console.log("[15] Empty course");
  const allBad = [
    ["2024G001", "CSEC901", "abc"],
    ["2024G002", "CSEC901", 200],
  ];
  await upload(dom, makeWorkbook([allBad], HEADER), "empty.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "empty course appears");
  eq(doc.getElementById("course").options[1].textContent, "CSEC901 - no valid rows", "empty course labelled");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(text(dom, "min"), "-", "empty course min is dash, not NaN");
  eq(text(dom, "avg"), "-", "empty course avg is dash, not NaN");
  eq(text(dom, "passRate"), "-", "empty course pass rate is dash");
  eq(blocked(dom), true, "download blocked for empty course");
  ok(text(dom, "passNote").indexOf("No valid students") >= 0, "pass note explains empty course");

  /* ---------- 16. Zero variance (all identical marks) ---------- */
  console.log("[16] Zero variance");
  const sameRows = [
    ["2024H001", "CSEC1001", 50],
    ["2024H002", "CSEC1001", 50],
    ["2024H003", "CSEC1001", 50],
  ];
  await upload(dom, makeWorkbook([sameRows], HEADER), "same.xlsx");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "zero-variance course appears");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(text(dom, "min"), "50", "zero-variance min");
  eq(text(dom, "max"), "50", "zero-variance max");
  eq(text(dom, "avg"), "50.00", "zero-variance avg");
  ok(text(dom, "passNote").indexOf("Every mark is identical") >= 0, "zero-variance noted in UI");
  eq(text(dom, "passRate"), "100.0%", "zero-variance pass rate 100% (all 50 >= 40)");

  /* ---------- 17. Multi-sheet warning ---------- */
  console.log("[17] Multi-sheet workbook");
  await upload(dom, makeWorkbook([goodRows, otherRows], HEADER), "multi.xlsx");
  await waitFor(dom, () => text(dom, "qualityLegend").indexOf("2 sheets") >= 0, "multi-sheet warning");
  ok(text(dom, "qualityLegend").indexOf("only") >= 0, "multi-sheet warning names the sheet read");

  /* ---------- 18. CSV upload ---------- */
  console.log("[18] CSV upload");
  const csvText = "BITS ID,Course,Total Marks\n2024J001,CSEC1101,75\n2024J002,CSEC1101,45\n";
  await upload(dom, makeCsv(csvText), "marks.csv");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "csv course appears");
  eq(doc.getElementById("course").options[1].textContent, "CSEC1101 - 2 students", "csv parsed correctly");

  /* ---------- 19. Timer resets on new file ---------- */
  console.log("[19] Timer reset on new file");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(dom.window.__intervals.length, 1, "timer running for csv course");
  await upload(dom, makeWorkbook([goodRows], HEADER), "again.xlsx");
  await waitFor(dom, () => dom.window.__intervals.length === 0, "timer reset after new upload");
  eq(text(dom, "timerText"), "00:00", "timer back to 00:00 after reset");

  /* ---------- 20. Loading state ---------- */
  console.log("[20] Loading state");
  dispatchUpload(dom, makeWorkbook([goodRows], HEADER), "load.xlsx");
  eq(text(dom, "welcome").indexOf("Reading load.xlsx") >= 0, true, "loading message shown while reading");
  eq(doc.getElementById("welcome").classList.contains("loading"), true, "loading class applied");
  await waitFor(dom, () => !doc.getElementById("welcome").classList.contains("loading"), "loading cleared");
  eq(doc.getElementById("welcome").classList.contains("loading"), false, "loading class removed after read");
  ok(text(dom, "welcome").indexOf("Reading") < 0, "loading message replaced by welcome after read");

  /* ---------- 21. Legacy .xls (BIFF8) upload ---------- */
  console.log("[21] Legacy .xls upload");
  const xlsRows = [
    ["2024K001", "CSEC1201", 91],
    ["2024K002", "CSEC1201", 58],
    ["2024K003", "CSEC1201", 33],
  ];
  await upload(dom, makeWorkbook([xlsRows], HEADER, "xls"), "legacy.xls");
  await waitFor(dom, () => doc.getElementById("course").options.length === 2, "xls course appears");
  eq(doc.getElementById("course").options[1].textContent, "CSEC1201 - 3 students", "xls parsed correctly");
  selectCourse(dom, doc.getElementById("course").options[1].value);
  await sleep(30);
  eq(text(dom, "min"), "33", "xls min");
  eq(text(dom, "max"), "91", "xls max");
  eq(text(dom, "avg"), "60.67", "xls avg");
  eq(visible(dom, "fileBanner"), false, "no error banner on legacy .xls");
  eq(dom.window.__intervals.length, 1, "timer runs for the selected .xls course");

  /* instructor name persists across uploads, so clear it to prove the gate */
  setInstructor(dom, "");
  await sleep(20);
  eq(blocked(dom), true, "download blocked when instructor is cleared");

  /* ---------- 22. Static-hosting and offline-readiness ---------- */
  console.log("[22] Static hosting");
  const htmlText = html;
  eq((htmlText.match(/<script(?![^>]+src=)[^>]*>/gi) || []).length, 1, "exactly one inline script (no build step, no bundler)");
  eq((htmlText.match(/<link[^>]+rel="stylesheet"/gi) || []).length, 0, "no external stylesheet needed (CSS is inline)");
  eq((htmlText.match(/<style/gi) || []).length, 1, "styles live in a single inline <style> block");
  ok(htmlText.indexOf("fetch(") < 0, "no fetch calls (fully client-side, no backend)");
  ok(htmlText.indexOf("XMLHttpRequest") < 0, "no XHR calls (fully client-side, no backend)");
  ok(htmlText.indexOf("localStorage") < 0, "no localStorage dependency (incognito-safe)");
  ok(htmlText.indexOf("cdn.jsdelivr.net") >= 0, "SheetJS loaded from CDN with fallback");

  /* ---------- 23. No em/en dashes anywhere in visible strings ---------- */
  console.log("[23] Dash sweep");
  const visibleText = doc.body.textContent;
  ok(visibleText.indexOf("\u2014") < 0, "no em-dash in rendered text");
  ok(visibleText.indexOf("\u2013") < 0, "no en-dash in rendered text");
  ok(htmlText.indexOf("&mdash;") < 0 && htmlText.indexOf("&ndash;") < 0, "no em/en dash entities in source");
  ok(htmlText.indexOf("&#8212;") < 0 && htmlText.indexOf("&#8211;") < 0, "no numeric em/en dash entities in source");

  /* ---------- 24. Accessibility basics ---------- */
  console.log("[24] Accessibility basics");
  const sel = doc.getElementById("course");
  ok(!!sel.getAttribute("aria-label") || !!doc.querySelector("label[for=course]"), "course select is labelled");
  const gradeCards = doc.querySelectorAll("#grades select");
  ok(gradeCards.length === 16, "16 grade range selects (8 grades x min/max)");
  let labelled = 0;
  gradeCards.forEach((s) => { if (s.getAttribute("aria-label")) labelled++; });
  eq(labelled, 16, "every grade range select has an aria-label");
  const timerClock = doc.querySelector(".timer-clock");
  eq(timerClock.getAttribute("role"), "timer", "timer exposes role=timer");
  ok(!!timerClock.getAttribute("aria-label"), "timer has an aria-label");
  eq(timerClock.getAttribute("aria-live"), "off", "ticking clock does not spam screen readers");
  eq(doc.getElementById("timerText").getAttribute("aria-hidden"), "true", "inner clock text hidden from AT (parent is labelled)");
  eq(doc.getElementById("rangeError").getAttribute("role"), "alert", "range error is announced as an alert");
  eq(doc.getElementById("fileBanner").getAttribute("role"), "alert", "file banner is announced as an alert");
  eq(doc.documentElement.lang, "en", "html lang attribute set");
  ok(!!doc.querySelector("meta[name=viewport]"), "viewport meta present for mobile");
  eq(doc.getElementById("file").getAttribute("accept").indexOf(".xls") >= 0, true, "accept attribute lists .xls");
  ok(doc.querySelectorAll("img:not([alt])").length === 0, "every img has alt text");

  /* ---------- 25. Export stops the timer and leaves no interval behind ---------- */
  console.log("[25] Runtime errors and cleanup");
  setInstructor(dom, "A. Sharma");
  await sleep(20);
  eq(blocked(dom), false, "download re-enabled once instructor is set again");
  eq(dom.window.__intervals.length, 1, "timer running before final export");
  click(dom, "download");
  await sleep(30);
  click(dom, "reviewConfirm");
  await sleep(60);
  eq(dom.window.__intervals.length, 0, "no timer interval left running after export");
  const done = text(dom, "thankyou");
  ok(done.indexOf("You completed grading in") >= 0 || done.indexOf("You took a total of") >= 0,
     "finalize confirmation shown | got " + JSON.stringify(done));
  eq((dom.window.__errors || []).length, 0, "no window errors captured");

  /* ---------- 26. Sheet-row numbers when the used range misses A1 ---------- */
  console.log("[26] Sheet row numbering");
  {
    const d2 = createDom();
    extra.push(d2);
    const doc2 = d2.window.document;
    await waitFor(d2, () => doc2.getElementById("course"), "boot d2");
    /* header on sheet row 2, the bad mark on sheet row 4 */
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null, null, null, null],
      [null, null, "BITS ID", "Course", "Total Marks"],
      [null, null, "2024A001", "CSEC301", 82],
      [null, null, "2024A002", "CSEC301", 105],
    ]);
    ws["!ref"] = "C2:E4";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    await upload(d2, Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" })), "offset.xlsx");
    ok(text(d2, "qualitySub").indexOf("Header on row 2") >= 0, "header row honours the sheet range start");
    const rowText = text(d2, "qualityBody");
    ok(rowText.indexOf("4") === 0, "issue reported at its real sheet row | got: " + rowText.slice(0, 40));
  }

  /* ---------- 27. Marks are range-checked before rounding ---------- */
  console.log("[27] Mark range vs rounding");
  {
    const d3 = createDom();
    extra.push(d3);
    const doc3 = d3.window.document;
    await waitFor(d3, () => doc3.getElementById("course"), "boot d3");
    const rows = [
      ["2024P001", "CSEC301", -0.4],   /* rounds to 0 -> must still be refused */
      ["2024P002", "CSEC301", 100.6],  /* rounds to 101 -> must still be refused */
      ["2024P003", "CSEC301", 0.82],   /* percent cell */
      ["2024P004", "CSEC301", 0.5],    /* percent cell */
      ["2024P005", "CSEC301", 82],
    ];
    await upload(d3, makeWorkbook([rows], HEADER), "range.xlsx");
    await waitFor(d3, () => doc3.getElementById("course").options.length === 2, "range course");
    eq(doc3.getElementById("course").options[1].textContent, "CSEC301 - 1 student", "only the in-range mark survives");
    const body = text(d3, "qualityBody");
    ok(body.indexOf("Total Marks (-0.4) is outside 0-100") >= 0, "-0.4 rejected, not rounded to 0");
    ok(body.indexOf("Total Marks (100.6) is outside 0-100") >= 0, "100.6 rejected, not rounded to 100");
    ok(body.indexOf("looks like a percentage cell") >= 0, "0.82 reported as a percentage cell");
    ok(body.indexOf("0.5") >= 0, "0.5 named in the issues table");
  }

  /* ---------- 28. Wrong file type gets a file-type message ---------- */
  console.log("[28] File type detection");
  {
    const d4 = createDom();
    extra.push(d4);
    const doc4 = d4.window.document;
    await waitFor(d4, () => doc4.getElementById("course"), "boot d4");
    await upload(d4, Buffer.from("just some prose, not a workbook at all", "utf8"), "notes.txt");
    await waitFor(d4, () => visible(d4, "fileBanner"), "banner for a non-spreadsheet");
    ok(text(d4, "fileBannerText").indexOf("not a marks spreadsheet") >= 0,
       "non-spreadsheet is named as such | got: " + text(d4, "fileBannerText"));
    eq(doc4.getElementById("course").options.length, 1, "no courses invented from prose");
  }

  /* ---------- 29. Timer accumulates across a course switch ---------- */
  console.log("[29] Timer lifecycle");
  {
    const d5 = createDom();
    extra.push(d5);
    const doc5 = d5.window.document;
    await waitFor(d5, () => doc5.getElementById("course"), "boot d5");
    await upload(d5, makeWorkbook([[["2024T001", "CSEC301", 82]]], HEADER), "t1.xlsx");
    doc5.getElementById("course").value = "csec301";
    doc5.getElementById("course").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    setInstructor(d5, "A. Sharma");
    await sleep(1400);
    click(d5, "download");
    await sleep(30);
    click(d5, "reviewConfirm");
    await sleep(50);
    ok(text(d5, "thankyou").indexOf("first attempt") >= 0, "first attempt wording | got: " + text(d5, "thankyou"));
    doc5.getElementById("course").value = "";
    doc5.getElementById("course").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    doc5.getElementById("course").value = "csec301";
    doc5.getElementById("course").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(60);
    ok(text(d5, "timerText") !== "00:00", "clock keeps the earlier segment after a course switch");
    click(d5, "download");
    await sleep(30);
    click(d5, "reviewConfirm");
    await sleep(50);
    const second = text(d5, "thankyou");
    ok(second.indexOf("2nd attempt") >= 0, "second attempt wording | got: " + second);
    ok(second.indexOf("0 min 0 sec") < 0, "the reported total is not zero after grading | got: " + second);
  }

  /* ---------- 30. Attempt counter resets with a new file ---------- */
  console.log("[30] Attempt counter scope");
  {
    const d6 = createDom();
    extra.push(d6);
    const doc6 = d6.window.document;
    await waitFor(d6, () => doc6.getElementById("course"), "boot d6");
    await upload(d6, makeWorkbook([[["2024U001", "CSEC301", 82]]], HEADER), "a.xlsx");
    selectCourse(d6, "csec301");
    setInstructor(d6, "A. Sharma");
    await sleep(30);
    click(d6, "download"); await sleep(30); click(d6, "reviewConfirm"); await sleep(50);
    ok(text(d6, "thankyou").indexOf("first attempt") >= 0, "attempt 1 on the first file");
    await upload(d6, makeWorkbook([[["2024U002", "CSEC302", 61]]], HEADER), "b.xlsx");
    selectCourse(d6, "csec302");
    await sleep(40);
    click(d6, "download"); await sleep(30); click(d6, "reviewConfirm"); await sleep(50);
    ok(text(d6, "thankyou").indexOf("first attempt") >= 0,
       "a new marks file restarts the attempt count | got: " + text(d6, "thankyou"));
  }

  /* ---------- 31. All blockers are listed, not just the first ---------- */
  console.log("[31] Blocker list");
  {
    const d7 = createDom();
    extra.push(d7);
    const doc7 = d7.window.document;
    await waitFor(d7, () => doc7.getElementById("course"), "boot d7");
    eq(blocked(d7), true, "blocked with no file");
    let hint = text(d7, "finalizeHint");
    ok(hint.indexOf("Upload a marks file") >= 0, "blocker: no file");
    ok(hint.indexOf("instructor name") >= 0, "blocker: no instructor, listed at the same time");
    await upload(d7, makeWorkbook([[["2024V001", "CSEC301", 82]]], HEADER), "c.xlsx");
    selectCourse(d7, "csec301");
    await sleep(40);
    const amax = doc7.getElementById("A-max");
    amax.value = "90";
    amax.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(40);
    hint = text(d7, "finalizeHint");
    ok(hint.indexOf("Gap or overlap") >= 0, "blocker: the range gap is listed");
    ok(hint.indexOf("instructor name") >= 0, "blocker: the missing instructor listed alongside it");
    eq(doc7.getElementById("download").getAttribute("aria-disabled"), "true", "aria-disabled set while blocked");
    eq(doc7.getElementById("download").disabled, false, "control stays focusable while blocked");
    const errBox = doc7.getElementById("rangeError");
    ok(errBox.querySelectorAll("li").length >= 1, "range errors render as a list");
    ok(errBox.textContent.indexOf("range problem") >= 0, "range error is summarised");
  }

  /* ---------- 32. Data quality issues export ---------- */
  console.log("[32] Issues export");
  {
    const d8 = createDom();
    extra.push(d8);
    const doc8 = d8.window.document;
    await waitFor(d8, () => doc8.getElementById("course"), "boot d8");
    eq(doc8.getElementById("qualityActions").hidden, true, "no issues button before upload");
    const bad = [
      ["2024W001", "CSEC701", 105],
      ["2024W002", "CSEC701", "N/A"],
      ["2024W003", "CSEC701", 77],
      ["2024W003", "CSEC701", 44],
    ];
    await upload(d8, makeWorkbook([bad], HEADER), "issues.xlsx");
    await waitFor(d8, () => !doc8.getElementById("qualityActions").hidden, "issues button appears");
    click(d8, "downloadIssues");
    await sleep(50);
    const issues = (await lastCsv(d8)).replace(/^\uFEFF/, "");
    const il = issues.split("\r\n");
    eq(il[0], "Sheet row,BITS ID,Course,Field,Value,Issue,Severity", "issues CSV header");
    ok(issues.indexOf("2024W002") >= 0, "non-numeric row is in the issues file");
    ok(issues.indexOf("Duplicate BITS ID") >= 0, "duplicate row is in the issues file");
    ok(issues.indexOf(",excluded") >= 0, "severity is recorded");
    ok(text(d8, "qualityIssuesNote").indexOf("Downloaded issues-") >= 0, "download confirmed in the UI");
  }

  /* ---------- 33. Stepper reflects real progress ---------- */
  console.log("[33] Progress rail");
  {
    const d9 = createDom();
    extra.push(d9);
    const doc9 = d9.window.document;
    await waitFor(d9, () => doc9.getElementById("steps"), "boot d9");
    const stepState = (k) => doc9.querySelector('#steps [data-step="' + k + '"]').getAttribute("data-state");
    eq(stepState("import"), "blocked", "step 1 blocked with no file");
    await upload(d9, makeWorkbook([[["2024X001", "CSEC301", 82], ["2024X002", "CSEC301", 41]]], HEADER), "s.xlsx");
    await waitFor(d9, () => doc9.getElementById("course").options.length === 2, "step course");
    eq(stepState("import"), "done", "step 1 done after load");
    eq(stepState("validate"), "done", "step 2 done once every row has been checked");
    eq(stepState("grade"), "current", "step 3 current while grading");
    selectCourse(d9, "csec301");
    await sleep(40);
    eq(stepState("grade"), "blocked", "step 3 blocked while the instructor name is missing");
    setInstructor(d9, "A. Sharma");
    await sleep(40);
    eq(stepState("grade"), "done", "step 3 done once the name is in and the bands validate");
    eq(stepState("export"), "current", "step 4 current when the export is available");
    click(d9, "download"); await sleep(30); click(d9, "reviewConfirm"); await sleep(50);
    eq(stepState("export"), "done", "step 4 done once the sheet is written");
  }

  /* ---------- 34. The shipped dummy workbooks, end to end ---------- */
  console.log("[34] Shipped dummy workbooks");
  {
    const valid = fs.readFileSync(path.join(__dirname, "..", "dummy_valid_marks.xlsx"));
    const edge = fs.readFileSync(path.join(__dirname, "..", "dummy_edge_cases.xlsx"));
    ok(valid.length > 2000, "dummy_valid_marks.xlsx exists and is non-trivial");

    const dA = createDom();
    extra.push(dA);
    const docA = dA.window.document;
    await waitFor(dA, () => docA.getElementById("course"), "boot dA");
    await upload(dA, valid, "dummy_valid_marks.xlsx");
    await waitFor(dA, () => docA.getElementById("course").options.length === 5, "4 courses + placeholder");
    const labels = Array.from(docA.getElementById("course").options).map((o) => o.textContent);
    eq(labels[0], "Select a course to grade", "placeholder present");
    ok(labels.join("|").indexOf("36 students") >= 0, "cohort sizes shown | " + labels.join(" | "));
    eq(visible(dA, "fileBanner"), false, "the valid file raises no warning | got: " + text(dA, "fileBannerText"));
    ok(text(dA, "qualityBody").indexOf("No data quality issues found") >= 0, "every row in the valid file passes");

    selectCourse(dA, "csec301");
    setInstructor(dA, "A. Sharma");
    await sleep(60);
    eq(text(dA, "n"), "36", "CSEC301 cohort size");
    eq(text(dA, "min"), "0", "CSEC301 min is 0");
    eq(text(dA, "max"), "100", "CSEC301 max is 100");
    ok(text(dA, "passRate").indexOf("%") > 0, "pass rate computed");
    eq(blocked(dA), false, "the valid file is exportable straight away");

    const s = docA.getElementById("search");
    s.value = "2024A101";
    s.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await sleep(30);
    ok(text(dA, "searchStatus").indexOf("1 of 36") >= 0, "search finds the pinned 100 | got: " + text(dA, "searchStatus"));
    ok(text(dA, "searchResults").indexOf("A") >= 0, "the 100-marker student is graded A");
    click(dA, "searchClear");
    await sleep(20);

    click(dA, "download"); await sleep(30); click(dA, "reviewConfirm"); await sleep(60);
    const csv = (await lastCsv(dA)).replace(/^\uFEFF/, "");
    const headerAt = csv.split("\r\n").indexOf("BITS ID,Total Marks,Grade");
    const rowsOut = csv.split("\r\n").slice(headerAt + 1).filter(Boolean);
    eq(rowsOut.length, 36, "one CSV row per valid student");
    ok(csv.indexOf("2024A101,100,A") >= 0, "the 100 is exported as A");
    ok(csv.indexOf("2024A116,0,E") >= 0, "the 0 is exported as E | " + rowsOut.filter((l) => l.indexOf(",0,") >= 0).join(" | "));

    const edgeDom = createDom();
    extra.push(edgeDom);
    const docE = edgeDom.window.document;
    await waitFor(edgeDom, () => docE.getElementById("course"), "boot dE");
    await upload(edgeDom, edge, "dummy_edge_cases.xlsx");
    await waitFor(edgeDom, () => docE.getElementById("course").options.length > 1, "edge courses");
    ok(visible(edgeDom, "fileBanner"), "the edge file raises a warning");
    ok(text(edgeDom, "fileBannerTitle").indexOf("need attention") >= 0, "warning counts the withheld rows");
    const q = text(edgeDom, "qualityBody");
    ok(q.indexOf("Duplicate BITS ID") >= 0, "duplicates surfaced");
    ok(q.indexOf("is outside 0-100") >= 0, "out-of-range surfaced");
    ok(q.indexOf("is not a number") >= 0, "non-numeric surfaced");
    ok(q.indexOf("Missing BITS ID") >= 0, "missing ID surfaced");
    ok(q.indexOf("Missing Course") >= 0, "missing course surfaced");
    ok(q.indexOf("Missing Total Marks") >= 0, "missing marks surfaced");
    ok(q.indexOf("looks like a percentage cell") >= 0, "percentage cells surfaced");
    ok(q.indexOf("rounded to") >= 0, "fractional rounding surfaced");
    const emptyCourse = Array.from(docE.getElementById("course").options)
      .filter((o) => o.textContent.indexOf("no valid rows") >= 0);
    ok(emptyCourse.length >= 1, "a course with no valid row is still listed and labelled");
    const folded = Array.from(docE.getElementById("course").options)
      .filter((o) => /^CSEC\s*510/.test(o.textContent));
    eq(folded.length, 1, "the CSEC510 name variants folded into one course");
  }

  /* ---------- 35. Exported grades match the configured bands exactly ---------- */
  console.log("[35] Export honours the configured ranges");
  {
    const dB = createDom();
    extra.push(dB);
    const docB = dB.window.document;
    await waitFor(dB, () => docB.getElementById("course"), "boot dB");
    const cohort = [
      ["2024Y001", "CSEC801", 100], ["2024Y002", "CSEC801", 95], ["2024Y003", "CSEC801", 84],
      ["2024Y004", "CSEC801", 80], ["2024Y005", "CSEC801", 79], ["2024Y006", "CSEC801", 70],
      ["2024Y007", "CSEC801", 69], ["2024Y008", "CSEC801", 60], ["2024Y009", "CSEC801", 59],
      ["2024Y010", "CSEC801", 50], ["2024Y011", "CSEC801", 49], ["2024Y012", "CSEC801", 40],
      ["2024Y013", "CSEC801", 39], ["2024Y014", "CSEC801", 30], ["2024Y015", "CSEC801", 29],
      ["2024Y016", "CSEC801", 20], ["2024Y017", "CSEC801", 19], ["2024Y018", "CSEC801", 0],
    ];
    await upload(dB, makeWorkbook([cohort], HEADER), "bands.xlsx");
    await waitFor(dB, () => docB.getElementById("course").options.length === 2, "band course");
    selectCourse(dB, "csec801");
    setInstructor(dB, "A. Sharma");
    await sleep(50);

    const GR = ["A", "A-", "B", "B-", "C", "C-", "D", "E"];
    const ranges = () => {
      const out = {};
      GR.forEach((g) => {
        out[g] = [Number(docB.getElementById(g + "min").value), Number(docB.getElementById(g + "max").value)];
      });
      return out;
    };
    async function exportAndRead() {
      click(dB, "download"); await sleep(30); click(dB, "reviewConfirm"); await sleep(60);
      const txt = (await lastCsv(dB)).replace(/^\uFEFF/, "");
      const idx = txt.split("\r\n").indexOf("BITS ID,Total Marks,Grade");
      const out = {};
      txt.split("\r\n").slice(idx + 1).filter(Boolean).forEach((l) => {
        const p = l.split(",");
        out[p[0]] = { marks: Number(p[1]), grade: p[2] };
      });
      return out;
    }
    function expectGrade(mark, r) {
      for (const g of GR) if (mark >= r[g][0] && mark <= r[g][1]) return g;
      return null;
    }

    let got = await exportAndRead();
    let r = ranges();
    eq(Object.keys(got).length, 18, "every student exported under the default bands");
    let mismatched = cohort.filter((row) => {
      const e = expectGrade(row[2], r);
      return !got[row[0]] || got[row[0]].grade !== e || got[row[0]].marks !== row[2];
    });
    eq(mismatched.length, 0, "default bands grade every boundary mark correctly | " + JSON.stringify(mismatched));

    const set = (g, min, max) => {
      const mn = docB.getElementById(g + "min"), mx = docB.getElementById(g + "max");
      mx.value = String(max);
      mx.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      mn.value = String(min);
      mn.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    };
    set("A", 90, 100);
    set("A-", 80, 89);
    set("B", 70, 79);
    set("B-", 60, 69);
    set("C", 50, 59);
    set("C-", 40, 49);
    set("D", 30, 39);
    set("E", 0, 29);
    await sleep(60);
    eq(text(dB, "rangeError"), "", "the re-cut bands validate clean | got: " + text(dB, "rangeError"));
    got = await exportAndRead();
    r = ranges();
    mismatched = cohort.filter((row) => {
      const e = expectGrade(row[2], r);
      return !got[row[0]] || got[row[0]].grade !== e;
    });
    eq(mismatched.length, 0, "the re-cut bands are honoured on export | " + JSON.stringify(mismatched));
    eq(got["2024Y004"].grade, "A-", "80 is A- under the new bands");
    eq(got["2024Y012"].grade, "C-", "40 is C- under the new bands");
    eq(got["2024Y018"].grade, "E", "0 stays E");
    eq(got["2024Y001"].grade, "A", "100 stays A");

    /* A band that can no longer cover the whole scale must be refused, and the
       student left outside every band must be named rather than skipped. */
    const blobBefore = dB.window.__lastBlob;
    const bMax = docB.getElementById("Bmax");
    bMax.value = "65";
    bMax.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(60);
    eq(blocked(dB), true, "an uncovered student blocks the export");
    ok(text(dB, "finalizeHint").indexOf("outside the configured grade bands") >= 0,
       "the uncovered student is named | got: " + text(dB, "finalizeHint"));
    ok(text(dB, "finalizeHint").indexOf("Grade B") >= 0, "the underlying range fault is listed too");
    click(dB, "download");
    await sleep(40);
    eq(docB.getElementById("review").hasAttribute("open"), false, "no review opens while blocked");
    ok(dB.window.__lastBlob === blobBefore, "nothing new was downloaded while blocked");
  }

  /* ---------- 36. No runtime error anywhere in the whole run ---------- */
  console.log("[36] Runtime error sweep");
  [dom].concat(extra).forEach((d, i) => {
    eq((d.window.__errors || []).length, 0, "dom #" + (i + 1) + " raised no window error | " +
       JSON.stringify((d.window.__errors || []).slice(0, 3)));
  });

  console.log("\n== RESULT: PASS " + pass + "  FAIL " + fail + " ==");
  if (failures.length) {
    console.log("Failed assertions:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(fail ? 1 : 0);
}

process.on("uncaughtException", (e) => {
  console.log("UNCAUGHT: " + e.message);
  process.exit(2);
});

main().catch((e) => {
  console.log("HARNESS ERROR: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
