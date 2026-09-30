"use strict";
const path = require("path");
const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 8741;
const FILE = "BITS_Digital_CodeForge_Challenge.html";
const OUT = path.join(__dirname, "..", "shots");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || FILE;
    const file = path.join(__dirname, "..", name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": /\.xlsx$/i.test(name)
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/html; charset=utf-8" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const { spawn } = require("child_process");
  const userDir = path.join(require("os").tmpdir(), "codeforge-shot-" + process.pid);
  const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-debugging-port=" + (PORT + 1), "--user-data-dir=" + userDir,
    "--window-size=1280,1000", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { target = (await fetch("http://127.0.0.1:" + (PORT + 1) + "/json/list").then((r) => r.json())).find((t) => t.type === "page"); }
    catch (e) { /* retry */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.on("open", r));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const shot = async (name, full) => {
    const p = full ? { captureBeyondViewport: true } : {};
    const r = await send("Page.captureScreenshot", Object.assign({ format: "png" }, p));
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    console.log("shot " + name);
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" + FILE });
  await new Promise((r) => setTimeout(r, 3500));
  await shot("01-empty.png", true);

  await ev(`fetch('/dummy_valid_marks.xlsx').then(r=>r.arrayBuffer()).then(buf=>{
    var f=new File([buf],'dummy_valid_marks.xlsx');var i=document.getElementById('file');
    var dt=new DataTransfer();dt.items.add(f);i.files=dt.files;
    i.dispatchEvent(new Event('change',{bubbles:true}));return 1;})`);
  await new Promise((r) => setTimeout(r, 1500));
  await shot("02-loaded.png", true);

  await ev(`(function(){var s=document.getElementById('course');s.value='csec301';
    s.dispatchEvent(new Event('change',{bubbles:true}));
    var n=document.getElementById('instructor');n.value='A. Sharma';
    n.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await new Promise((r) => setTimeout(r, 1200));
  await shot("03-graded.png", true);

  await ev(`(function(){var d=document.getElementById('qualityDetails');d.open=true;return 1;})()`);
  await ev(`fetch('/dummy_edge_cases.xlsx').then(r=>r.arrayBuffer()).then(buf=>{
    var f=new File([buf],'dummy_edge_cases.xlsx');var i=document.getElementById('file');
    var dt=new DataTransfer();dt.items.add(f);i.files=dt.files;
    i.dispatchEvent(new Event('change',{bubbles:true}));return 1;})`);
  await new Promise((r) => setTimeout(r, 1600));
  await ev(`(function(){var d=document.getElementById('qualityDetails');d.open=true;
    var s=document.getElementById('course');s.value=s.options[1].value;
    s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot("04-quality.png", true);

  await ev("document.getElementById('download').click()");
  await new Promise((r) => setTimeout(r, 700));
  await shot("05-review.png");
  await ev("document.getElementById('reviewCancel').click()");

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1500, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 800));
  await ev(`(function(){var d=document.getElementById('qualityDetails');d.open=false;return 1;})()`);
  await shot("06-mobile.png", true);

  try { child.kill(); } catch (e) {}
  server.close();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}
main().catch((e) => { console.log("SHOT ERROR " + e.stack); process.exit(1); });
