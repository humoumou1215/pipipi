// UI v5 冒烟:目录选择器(pi-web 式)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const CHROME = "/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const BASE = "http://127.0.0.1:3099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Cdp {
  constructor(ws) { this.ws = ws; this.nextId = 1; this.pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = this.nextId++; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error("CDP timeout " + method)); }, 8000); this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evl(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 150)); return r?.result?.value; }
  async nav(url) { await this.send("Page.navigate", { url }); await sleep(2000); }
  async waitFor(expr, timeout = 30000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await this.evl(expr)) return; } catch {} await sleep(400); } throw new Error("waitFor timeout: " + expr); }
  async shot(path) { const r = await this.send("Page.captureScreenshot", { format: "png" }); writeFileSync(path, Buffer.from(r.data, "base64")); }
  close() { this.ws.close(); }
}
async function newTab() {
  const tab = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  return cdp;
}
let failures = 0;
async function check(name, fn) { try { await fn(); console.log("PASS " + name); } catch (e) { failures++; console.error("FAIL " + name + ": " + e.message); } }
const chrome = spawn(CHROME, ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9222", "--user-data-dir=" + mkdtempSync(join(tmpdir(), "pp7-")), "about:blank"], { stdio: "ignore" });
try {
  for (let i = 0; i < 20; i++) { try { if ((await fetch("http://127.0.0.1:9222/json/version")).ok) break; } catch {} await sleep(500); }
  const cdp = await newTab();
  await cdp.nav(BASE + "/login");
  await cdp.evl(`(() => { const setVal=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; const i=document.querySelectorAll('input'); setVal(i[0],'admin'); setVal(i[1],'admin123'); document.querySelector('form').requestSubmit(); return true; })()`);
  await cdp.waitFor("location.pathname === '/' && !!document.querySelector('select option')");
  await cdp.waitFor("document.querySelectorAll('.min-w-72').length > 0", 30000);

  await check("打开目录选择器", async () => {
    await cdp.evl(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('浏览')).click()`);
    await cdp.waitFor("document.body.textContent.includes('选择看板目录')", 10000);
    const rootDirs = await cdp.evl(`document.body.textContent.includes('tmp') || document.body.textContent.includes('media')`);
    console.log("  picker open, root dirs visible:", rootDirs);
    if (!rootDirs) throw new Error("no root dirs");
  });

  await check("进入目录并选择", async () => {
    // 进 /tmp(点 tmp 目录)
    await cdp.evl(`(() => { const el=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='tmp' && d.className.includes('cursor-pointer')); if(!el) return 'NOT FOUND'; el.click(); return 'OK'; })()`);
    await cdp.waitFor("document.body.textContent.includes('pipipi-debug')", 10000);
    console.log("  /tmp listed with pipipi-debug");
    // 选 /tmp/pipipi-debug
    const tmpClick = await cdp.evl(`(() => { const els=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='tmp' && d.className.includes('cursor-pointer')); if(!els.length) return 'NO TMP'; els[0].click(); return 'OK:'+els.length; })()`);
    console.log("  click tmp:", tmpClick);
    await sleep(2000);
    const pickerDirs = await cdp.evl(`(() => { const d=[...document.querySelectorAll('div')].find(x=>x.textContent.includes('选择看板目录')); if(!d) return 'NO PICKER'; return [...d.querySelectorAll('.cursor-pointer')].map(x=>x.textContent.trim().slice(0,25)).slice(0,12); })()`);
    console.log("  picker dirs after /tmp:", JSON.stringify(pickerDirs));
    await cdp.waitFor("[...document.querySelectorAll('div')].some(d=>d.textContent.trim()==='pipipi-debug' && d.className.includes('cursor-pointer'))", 10000);
    const clickRes = await cdp.evl(`(() => { const els=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='pipipi-debug' && d.className.includes('cursor-pointer')); if(!els.length) return 'NOT FOUND'; els[0].click(); return 'OK:'+els.length; })()`);
    console.log("  click pipipi-debug:", clickRes);
    await sleep(2000);
    const cur = await cdp.evl(`(() => { const inp=document.querySelector('input.font-mono'); return inp ? inp.value : 'NO INPUT'; })()`);
    const pickerText = await cdp.evl(`(() => { const d=[...document.querySelectorAll('div')].find(x=>x.textContent.includes('选择看板目录')); return d ? d.innerText.replace(/\s+/g,' ').slice(0,120) : 'NO PICKER'; })()`);
    console.log("  current path:", cur);
    // 使用此目录
    await cdp.evl(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('使用此目录')).click()`);
    await sleep(2500);
    const selected = await cdp.evl(`(() => { const sel=document.querySelector('select'); return [...sel.options].some(o=>o.textContent.includes('pipipi-debug')); })()`);
    console.log("  dir registered & selected:", selected);
    if (!selected) throw new Error("dir not registered");
  });

  console.log(failures === 0 ? "\nALL UI V5 SMOKE PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
} finally { chrome.kill(); }
