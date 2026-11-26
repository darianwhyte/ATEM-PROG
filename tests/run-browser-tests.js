// =========================================================================
// AUTOMATED HEADLESS BROWSER E2E TEST RUNNER (tests/run-browser-tests.js)
// Run via: node tests/run-browser-tests.js
// Launches an isolated headless Edge/Chrome instance against tests.html,
// runs ALL Engine + native DOMParser XML Round-Trip + Live DOM/Canvas UI
// tests, reports every console/runtime error, and exits non-zero on failure.
// =========================================================================

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WebSocket = require(path.join(ROOT, "bridge", "node_modules", "ws"));

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png"
};

function findBrowserExecutable() {
    const candidates = process.platform === "win32"
        ? [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
        ]
        : process.platform === "darwin"
            ? [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
            ]
            : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function startStaticServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const rel = (req.url || "/").split("?")[0].replace(/^\/+/, "") || "tests.html";
            const full = path.resolve(ROOT, rel);
            if (!full.startsWith(ROOT) || !fs.existsSync(full)) {
                res.writeHead(404);
                res.end("Not Found");
                return;
            }
            res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
            fs.createReadStream(full).pipe(res);
        });
        server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    });
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = "";
            res.on("data", c => { body += c; });
            res.on("end", () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

async function run() {
    const browserExe = findBrowserExecutable();
    if (!browserExe) {
        console.error("No Chromium/Edge/Chrome executable found for headless browser E2E tests.");
        process.exit(1);
    }

    const { server, port } = await startStaticServer();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atem-prog-test-"));
    const url = `http://127.0.0.1:${port}/tests.html`;

    const proc = spawn(browserExe, [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        url
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let ws = null;
    try {
        // Wait for DevTools port from stderr
        const debugPort = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timed out waiting for headless browser DevTools port")), 12000);
            let buf = "";
            proc.stderr.on("data", chunk => {
                buf += chunk.toString();
                const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
                if (m) {
                    clearTimeout(timeout);
                    resolve(Number(m[1]));
                }
            });
            proc.on("exit", code => {
                clearTimeout(timeout);
                reject(new Error(`Browser exited early with code ${code}`));
            });
        });

        // Locate the tests.html page target
        let target = null;
        for (let i = 0; i < 30; i++) {
            const list = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
            target = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
            if (target) break;
            await new Promise(r => setTimeout(r, 150));
        }
        if (!target) throw new Error("Could not find page target in headless browser.");

        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

        let cmdId = 1;
        const pending = new Map();
        const exceptions = [];
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            } else if (msg.method === "Runtime.exceptionThrown") {
                const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "Runtime exception";
                exceptions.push(desc);
            }
        });

        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = cmdId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });

        await send("Runtime.enable");

        // Poll for window.__ATEM_TEST_REPORT__
        let report = null;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const evalRes = await send("Runtime.evaluate", {
                expression: "window.__ATEM_TEST_REPORT__ ? JSON.stringify(window.__ATEM_TEST_REPORT__) : null",
                returnByValue: true
            });
            if (evalRes?.result?.value) {
                report = JSON.parse(evalRes.result.value);
                break;
            }
            if (exceptions.length > 0) break;
            await new Promise(r => setTimeout(r, 150));
        }

        if (exceptions.length > 0) {
            console.error("\nBrowser runtime exceptions:");
            exceptions.forEach(e => console.error("  " + e));
        }
        if (!report) {
            throw new Error("Timed out waiting for tests.html to finish.");
        }

        console.log("\n=== ATEM-PROG BROWSER ENGINE + UI E2E TEST SUITE ===");
        report.results.forEach(suite => {
            console.log(`\n${suite.name}`);
            suite.tests.forEach(t => {
                const icon = t.status === "pass" ? "PASS" : t.status === "skip" ? "SKIP" : "FAIL";
                const detail = t.message ? ` — ${t.message}` : "";
                console.log(`  [${icon}] ${t.name} (${t.ms}ms)${detail}`);
            });
        });
        console.log(`\nSummary: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.total} total)\n`);
        process.exitCode = (report.failed > 0 || exceptions.length > 0) ? 1 : 0;
    } finally {
        try { ws?.close(); } catch {}
        try { proc.kill(); } catch {}
        try { server.close(); } catch {}
        setTimeout(() => {
            try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
        }, 300);
    }
}

run().catch(err => {
    console.error("Browser E2E Runner Error:", err.message || err);
    process.exit(1);
});
