/* Real-browser QA. Drives the shipped HTML in headless Edge over the DevTools
   protocol: checks the rendered layout at desktop and phone widths, that
   nothing overflows, that hidden components really are hidden, that the canvas
   paints, and that no console error or unhandled rejection occurs.

   Usage: node browser-qa.js            (run from tests/)
*/
"use strict";

const path = require("path");
const http = require("http");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 8731;
const FILE = "BITS_Digital_CodeForge_Challenge.html";

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? " | " + extra : "")); console.log("  FAIL: " + name + (extra ? " | " + extra : "")); }
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || FILE;
      const file = path.join(__dirname, "..", name);
      if (!fs.existsSync(file) || !/\.(html|xlsx)$/i.test(name)) { res.writeHead(404); res.end("no"); return; }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": ext === ".xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/html; charset=utf-8",
      });
      res.end(fs.readFileSync(file));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(EDGE)) { console.log("Edge not found, skipping browser QA."); return; }
  const server = await serve();
  const { spawn } = require("child_process");
  const userDir = path.join(require("os").tmpdir(), "codeforge-qa-" + process.pid);
  const child = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + (PORT + 1),
    "--user-data-dir=" + userDir,
    "--window-size=1280,900",
    "about:blank",
  ], { stdio: "ignore" });

  const cleanup = () => {
    try { child.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  };

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const list = await fetch("http://127.0.0.1:" + (PORT + 1) + "/json/list").then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch (e) { target = null; }
  }
  if (!target) { console.log("Could not attach to the browser; skipping browser QA."); cleanup(); return; }

  const WebSocket = await loadWs();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];

  await new Promise((r) => ws.on("open", r));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      consoleErrors.push(m.params.type + ": " + m.params.args.map((a) => a.value || a.description || "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      pageErrors.push(m.params.exceptionDetails.text + " " +
        (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : ""));
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  async function evaluate(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  }

  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" + FILE });
    await new Promise((r) => setTimeout(r, 3500));

    console.log("== Browser QA (headless Edge) ==");

    const libReady = await evaluate("typeof XLSX !== 'undefined'");
    ok(libReady === true, "SheetJS loads in a real browser from the CDN");
    ok((await evaluate("document.getElementById('file').disabled")) === false, "file input enabled once the reader is ready");

    /* Hidden components must really be hidden, not just flagged. */
    const displayOf = (id) => evaluate("(function(){var e=document.getElementById('" + id +
      "');return e?getComputedStyle(e).display:'missing';})()");
    ok(await displayOf("fileBanner") === "none", "the error banner is not painted when there is no error",
       "display=" + await displayOf("fileBanner"));
    ok(await displayOf("spread") === "none", "the spread bar is hidden with no course");
    ok(await displayOf("qualityActions") === "none", "the issues toolbar is hidden with no file");

    /* Deselect nothing: initial analytics must be a clean empty state. */
    ok(await evaluate("document.getElementById('min').textContent") === "-", "min is a dash before any file");
    ok(await evaluate("document.body.innerText.indexOf('NaN')") < 0, "no NaN anywhere in the first paint");
    ok(await evaluate("document.body.innerText.indexOf('undefined')") < 0, "no undefined in the first paint");

    /* Load the shipped valid workbook through the real file input. */
    await evaluate(`(function(){
      return fetch('/dummy_valid_marks.xlsx').then(function(r){return r.arrayBuffer();}).then(function(buf){
        var file = new File([buf], 'dummy_valid_marks.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        var input = document.getElementById('file');
        var dt = new DataTransfer(); dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', {bubbles:true}));
        return true;
      });
    })()`);
    await new Promise((r) => setTimeout(r, 1500));

    const courseCount = await evaluate("document.getElementById('course').options.length");
    ok(courseCount === 5, "the shipped workbook loads 4 courses", "options=" + courseCount);
    ok(await evaluate("getComputedStyle(document.getElementById('qualityActions')).display") === "none",
       "the issues toolbar stays hidden for a file with no issues");
    ok(await evaluate("getComputedStyle(document.getElementById('fileBanner')).display") === "none",
       "a clean file paints no banner");

    await evaluate(`(function(){
      var s = document.getElementById('course');
      s.value = 'csec301';
      s.dispatchEvent(new Event('change', {bubbles:true}));
      var i = document.getElementById('instructor');
      i.value = 'A. Sharma';
      i.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 700));

    /* Canvas really painted? */
    const canvas = await evaluate(`(function(){
      var c = document.getElementById('hist');
      var ctx = c.getContext('2d');
      var d = ctx.getImageData(0,0,c.width,c.height).data;
      var painted = 0, purple = 0;
      for (var i=0;i<d.length;i+=4){
        if (d[i+3] > 0) painted++;
        if (d[i] > 70 && d[i] < 150 && d[i+2] > 150 && d[i+3] > 200) purple++;
      }
      return {w:c.width, h:c.height, cssW:c.clientWidth, painted:painted, purple:purple, total:d.length/4};
    })()`);
    ok(canvas.painted > canvas.total * 0.05, "the histogram actually paints pixels",
       JSON.stringify(canvas));
    ok(canvas.purple > 200, "the brand-coloured bars are present", JSON.stringify(canvas));
    ok(canvas.w >= canvas.cssW, "the canvas backing store covers its CSS box",
       "backing=" + canvas.w + " css=" + canvas.cssW);

    ok(await evaluate("getComputedStyle(document.getElementById('spread')).display") !== "none",
       "the spread bar appears once a cohort is selected");
    ok(await evaluate("document.getElementById('n').textContent") === "36", "cohort size is on screen");
    ok(await evaluate("document.getElementById('min').textContent") === "0", "min is 0");
    ok(await evaluate("document.getElementById('max').textContent") === "100", "max is 100");

    /* Layout: nothing may overflow the viewport horizontally. */
    async function overflowAt(width, height, label) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
      await new Promise((r) => setTimeout(r, 600));
      const bad = await evaluate(`(function(){
        var vw = document.documentElement.clientWidth, out = [];
        document.querySelectorAll('body *').forEach(function(n){
          var r = n.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          if (r.right > vw + 1.5 || r.left < -1.5) {
            out.push((n.id ? '#'+n.id : n.tagName.toLowerCase()+'.'+(n.className||'').toString().split(' ')[0]) +
              ' [' + Math.round(r.left) + ',' + Math.round(r.right) + '] vw=' + vw);
          }
        });
        return out.slice(0, 8);
      })()`);
      ok(bad.length === 0, "no horizontal overflow at " + label, bad.join(" ; "));
      const scrollable = await evaluate("(function(){var w=document.querySelectorAll('.table-wrap');" +
        "return Array.prototype.map.call(w,function(n){return getComputedStyle(n).overflowX;}).join(',');})()");
      ok(scrollable === "" || scrollable.split(",").every((v) => v === "auto" || v === "scroll"),
         "wide tables scroll instead of spilling at " + label, "overflow-x=" + scrollable);
    }
    await overflowAt(1280, 900, "1280px");
    await overflowAt(1024, 800, "1024px");
    await overflowAt(820, 900, "820px");
    await overflowAt(414, 900, "414px phone");
    await overflowAt(360, 800, "360px small phone");

    /* Touch targets on a phone. */
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await new Promise((r) => setTimeout(r, 500));
    const small = await evaluate(`(function(){
      var out = [];
      document.querySelectorAll('button, select, input[type=file], input[type=text], input[type=search]').forEach(function(n){
        var r = n.getBoundingClientRect();
        if (r.height > 0 && r.height < 28) out.push((n.id||n.tagName) + ' h=' + Math.round(r.height));
      });
      return out;
    })()`);
    ok(small.length === 0, "every control is at least 28px tall on a phone", small.join(" ; "));

    /* Keyboard: tab to the export control and activate it with the keyboard. */
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 400));
    const focusable = await evaluate("(function(){var b=document.getElementById('download');b.focus();return document.activeElement===b;})()");
    ok(focusable, "the export control is reachable by keyboard");
    await evaluate("document.getElementById('download').click()");
    await new Promise((r) => setTimeout(r, 500));
    const dialogOpen = await evaluate("document.getElementById('review').open === true");
    ok(dialogOpen, "the final review opens");
    const focusInDialog = await evaluate("document.getElementById('review').contains(document.activeElement)");
    ok(focusInDialog, "focus moves into the dialog");
    await evaluate("document.getElementById('reviewConfirm').click()");
    await new Promise((r) => setTimeout(r, 700));
    ok(await evaluate("document.getElementById('review').open === false"), "the dialog closes after the export");
    ok(await evaluate("document.getElementById('thankyou').textContent.length > 0"), "confirmation shown");

    /* The edge-case workbook, end to end in the browser. */
    await evaluate(`(function(){
      return fetch('/dummy_edge_cases.xlsx').then(function(r){return r.arrayBuffer();}).then(function(buf){
        var file = new File([buf], 'dummy_edge_cases.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        var input = document.getElementById('file');
        var dt = new DataTransfer(); dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', {bubbles:true}));
        return true;
      });
    })()`);
    await new Promise((r) => setTimeout(r, 1600));
    const edgeTitle = await evaluate("document.getElementById('fileBannerTitle').textContent");
    ok(/rows need attention/.test(edgeTitle), "the edge workbook raises a counted warning", edgeTitle);
    ok(await evaluate("getComputedStyle(document.getElementById('fileBanner')).display") !== "none",
       "the warning banner is visible");
    ok(await evaluate("document.body.innerText.indexOf('NaN')") < 0, "no NaN with messy data");
    ok(await evaluate("document.getElementById('course').options.length") > 5, "all edge courses listed");
    await evaluate("(function(){var s=document.getElementById('course');s.value=s.options[1].value;" +
      "s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await new Promise((r) => setTimeout(r, 500));
    ok(await evaluate("document.getElementById('qualityDetails').querySelectorAll('tbody tr').length") > 0,
       "row-level issues are listed for the selected course's file");
    ok(await evaluate("getComputedStyle(document.getElementById('qualityActions')).display") !== "none",
       "the issues toolbar appears once there is something to report");
    ok(await evaluate("getComputedStyle(document.getElementById('spread')).display") !== "none",
       "the spread bar paints for the selected cohort");

    /* Console hygiene. */
    const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_FILE_NOT_FOUND|Failed to load resource/i.test(e));
    ok(realErrors.length === 0, "no console errors or warnings", realErrors.slice(0, 4).join(" ; "));
    ok(pageErrors.length === 0, "no uncaught exceptions", pageErrors.slice(0, 4).join(" ; "));

    console.log("\n== BROWSER RESULT: PASS " + pass + "  FAIL " + fail + " ==");
    if (failures.length) { console.log("Failed:"); failures.forEach((f) => console.log("  - " + f)); }
  } finally {
    try { ws.close(); } catch (e) {}
    cleanup();
  }
  process.exit(fail ? 1 : 0);
}

async function loadWs() {
  try { return require("ws"); } catch (e) { /* fall through */ }
  return new Promise((resolve, reject) => {
    try { resolve(require(path.join(__dirname, "node_modules", "ws"))); }
    catch (e2) { reject(new Error("This QA pass needs the 'ws' package: npm install")); }
  });
}

main().catch((e) => { console.log("BROWSER QA ERROR: " + (e && e.stack ? e.stack : e)); process.exit(2); });
