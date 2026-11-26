// =========================================================================
// NODE.JS CLI TEST RUNNER FOR ATEM-PROG ENGINE (tests/run-tests.js)
// Run via: node tests/run-tests.js
// Loads the exact production JS modules inside a clean VM sandbox with
// minimal localStorage/window shims (zero external npm test dependencies).
// =========================================================================

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

// Minimal localStorage mock
const _store = new Map();
const localStorageMock = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(String(k), String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear()
};

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => crypto.randomUUID() },
    localStorage: localStorageMock,
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    document: { getElementById: () => null, querySelector: () => null },
    elements: {},
    normalizeLayerTransform(layer) {
        const hasDVE = layer.keyType === "dve" || layer.flyingKey;
        if (hasDVE) return;
        layer.x = 0;
        layer.y = 0;
        layer.size = 1;
    },
    isWorkspaceAvailable(ws) {
        const p = sandbox.getProfile();
        if (!p) return true;
        if (ws.type === "me") return ws.resourceId < p.me;
        if (ws.type === "superSource") return ws.resourceId < p.superSource;
        return true;
    }
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

const loadScript = (relPath) => {
    const full = path.join(ROOT, relPath);
    const code = fs.readFileSync(full, "utf8");
    vm.runInContext(code, ctx, { filename: relPath });
};

// Load core headless modules in exact ATEM-PROG.html order
[
    "js/profiles.js",
    "js/state.js",
    "js/sources.js",
    "js/atem-xml.js",
    "js/layout.js",
    "js/engine.js",
    "js/history.js",
    "js/storage.js",
    "js/templates.js",
    "js/macro.js",
    "js/record-macro.js",
    "js/playback-macro.js",
    "js/popout.js",
    "js/patch-sheet.js",
    "js/export.js",
    "tests/engine.test.js"
].forEach(loadScript);

(async () => {
    const summary = await vm.runInContext("AtemTestSuite.runAll()", ctx);

    console.log("\n=== ATEM-PROG ENGINE TEST SUITE ===");
    summary.results.forEach(suite => {
        console.log(`\n${suite.name}`);
        suite.tests.forEach(t => {
            const icon = t.status === "pass" ? "PASS" : t.status === "skip" ? "SKIP" : "FAIL";
            const detail = t.message ? ` — ${t.message}` : "";
            console.log(`  [${icon}] ${t.name} (${t.ms}ms)${detail}`);
        });
    });

    console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.total} total)\n`);
    process.exit(summary.failed > 0 ? 1 : 0);
})();
