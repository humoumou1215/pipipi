// pipipi 浏览器冒烟测试:通过 CDP 驱动 headless Chrome(零依赖),
// 验证 登录→看板渲染→建卡→卡片抽屉+评论 全 UI 流程。
// 用法: 先启动服务并预置数据(见 README),再 node scripts/browser-smoke.mjs
// 环境: PP_CHROME=chrome 可执行文件路径(默认用本机 playwright 缓存的 headless shell)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.PP_CHROME ?? "/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const BASE = "http://127.0.0.1:3099";

// ---------- CDP 客户端 ----------
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 1;
		this.pending = new Map();
		ws.addEventListener("message", (e) => {
			const msg = JSON.parse(e.data);
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				if (msg.error) reject(new Error(msg.error.message));
				else resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP timeout: ${method}`));
			}, 8000);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}
	async eval(expression) {
		const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
		return r.result?.value;
	}
	async navigate(url) {
		await this.send("Page.navigate", { url });
		await sleep(1500);
	}
	async screenshot(path) {
		const r = await this.send("Page.captureScreenshot", { format: "png" });
		const { writeFileSync } = await import("node:fs");
		writeFileSync(path, Buffer.from(r.data, "base64"));
		console.log("  screenshot:", path);
	}
	async waitFor(expression, timeoutMs = 30000) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			try {
				const v = await this.eval(expression);
				if (v) return v;
			} catch {}
			await sleep(400);
		}
		throw new Error("waitFor timeout: " + expression);
	}
	close() {
		this.ws.close();
	}
}

// ---------- 工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTab() {
	const res = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" });
	const tab = await res.json();
	const ws = new WebSocket(tab.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
}

// ---------- 主流程 ----------
let failures = 0;
async function check(name, fn) {
	try {
		await fn();
		console.log(`PASS ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}: ${e.message}`);
	}
}

const chrome = spawn(CHROME, [
	"--headless",
	"--no-sandbox",
	"--disable-gpu",
	"--remote-debugging-port=9222",
	"--user-data-dir=" + mkdtempSync(join(tmpdir(), "pp-chrome-")),
	"about:blank",
], { stdio: "ignore" });

try {
	// 等待 CDP 就绪
	for (let i = 0; i < 20; i++) {
		try {
			const r = await fetch("http://127.0.0.1:9222/json/version");
			if (r.ok) break;
		} catch {}
		await sleep(500);
	}

	await check("登录页渲染", async () => {
		const cdp = await newTab();
		await cdp.navigate(BASE + "/login");
		const title = await cdp.eval("document.querySelector('h1')?.textContent");
		if (title !== "pipipi") throw new Error("h1 != pipipi, got: " + title);
		await cdp.screenshot("/tmp/pp-01-login.png");
		cdp.close();
	});

	await check("登录并进入看板", async () => {
		const cdp = await newTab();
		await cdp.navigate(BASE + "/login");
		// React 受控输入:用原生 value setter 才能触发 onChange
		await cdp.eval(`(() => {
			const setVal = (el, v) => {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				setter.call(el, v);
				el.dispatchEvent(new Event('input', { bubbles: true }));
			};
			const inputs = document.querySelectorAll('input');
			setVal(inputs[0], 'admin');
			setVal(inputs[1], 'admin123');
			document.querySelector('form').requestSubmit();
			return true;
		})()`);
		await cdp.waitFor("location.pathname === '/' && !!document.querySelector('select')", 30000);
		const hasDir = await cdp.eval("!!document.querySelector('select option')");
		console.log("  dir select has options:", hasDir);
		await cdp.screenshot("/tmp/pp-02-board.png");
		cdp.close();
	});

	await check("看板渲染列与卡片", async () => {
		const cdp = await newTab();
		await cdp.navigate(BASE + "/");
		await cdp.waitFor("document.querySelectorAll('.min-w-72').length > 0");
		const cols = await cdp.eval("[...document.querySelectorAll('.min-w-72')].map(el => el.textContent.trim().split('\\n')[0])");
		console.log("  columns:", JSON.stringify(cols));
		const cards = await cdp.eval("document.querySelectorAll('[draggable]').length");
		console.log("  draggable cards:", cards);
		await cdp.screenshot("/tmp/pp-03-board-cards.png");
		cdp.close();
	});

	await check("UI 建卡", async () => {
		const cdp = await newTab();
		await cdp.navigate(BASE + "/");
		await cdp.waitFor("document.querySelectorAll('.min-w-72').length > 0", 30000);
		// 点 + card,填标题,提交(React 受控输入用原生 setter)
		await cdp.eval(`(() => {
			const btns = [...document.querySelectorAll('button')];
			btns.find(b => b.textContent.includes('+ card')).click();
			return true;
		})()`);
		await cdp.waitFor("!!document.querySelector('input[placeholder=\"Card title\"]')");
		await cdp.eval(`(() => {
			const setVal = (el, v) => {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				setter.call(el, v);
				el.dispatchEvent(new Event('input', { bubbles: true }));
			};
			const inp = document.querySelector('input[placeholder="Card title"]');
			setVal(inp, 'UI smoke card ' + Date.now());
			document.querySelector('button').click();
			return true;
		})()`);
		// 等卡片出现(在页面文本中)
		await cdp.waitFor("document.body.textContent.includes('UI smoke card')", 30000);
		console.log("  card created via UI");
		await cdp.screenshot("/tmp/pp-04-created.png");
		cdp.close();
	});

	await check("打开卡片抽屉并评论", async () => {
		const cdp = await newTab();
		await cdp.navigate(BASE + "/");
		await cdp.waitFor("document.querySelectorAll('[draggable]').length > 0", 30000);
		// 打开第一张卡片
		await cdp.eval("document.querySelector('[draggable]').click()");
		await cdp.waitFor("!!document.querySelector('textarea[placeholder^=\"Comment\"]')");
		// 写评论(React 受控 textarea 用原生 setter)
		await cdp.eval(`(() => {
			const setVal = (el, v) => {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(el, v);
				el.dispatchEvent(new Event('input', { bubbles: true }));
			};
			const ta = document.querySelector('textarea[placeholder^="Comment"]');
			setVal(ta, 'browser smoke comment');
			[...document.querySelectorAll('button')].find(b => b.textContent === 'Comment').click();
			return true;
		})()`);
		await cdp.waitFor("document.body.textContent.includes('browser smoke comment')", 30000);
		console.log("  comment posted");
		await cdp.screenshot("/tmp/pp-05-card-drawer.png");
		cdp.close();
	});

	console.log(failures === 0 ? "\nALL UI SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
	process.exit(failures === 0 ? 0 : 1);
} finally {
	chrome.kill();
}
