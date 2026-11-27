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
    elements: {}
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
    "js/engine/ss-animator.js",
    "js/engine/stream-rec.js",
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
    if (summary.failed > 0) process.exit(1);

    // Node-side ATEM 10.2 Raw Bus Mapping Binary Parser Test (captured Constellation HD UDP 9910 packets)
    const { createBusMappingStore } = require(path.join(ROOT, "bridge", "bus-mapping.js"));
    const assert = require("assert");
    const store = createBusMappingStore();

    // 1. Disabled meSE packets must not pollute serialized rules
    assert.strictEqual(store.ingestPacket("meSE", Buffer.from("00010000", "hex")), true);
    assert.strictEqual(store.ingestPacket("meSE", Buffer.from("010200ff", "hex")), true);
    assert.strictEqual(store.ingestPacket("meSE", Buffer.from("03020005", "hex")), true);

    // 2. Enabled auSE (AUX 1 = 0x1f41 = 8001, leadMe = 0, enabled = 1) vs disabled auSE (AUX 2 = 0x1f42, enabled = 0)
    assert.strictEqual(store.ingestPacket("auSE", Buffer.from("00071f4101060006", "hex")), true);
    assert.strictEqual(store.ingestPacket("auSE", Buffer.from("00c21f4200020002", "hex")), true);

    // 3. Real auSS payload with 0x1771->0x271a (6001->10010) and 0x1770->0x271a (6000->10010) substitutions
    const auSsBuf = Buffer.alloc(6 + 4 * 4);
    auSsBuf.writeUInt8(0x00, 0);        // leadMe = 0
    auSsBuf.writeUInt8(0xc3, 1);        // unk
    auSsBuf.writeUInt16BE(8001, 2);     // AUX 1 (0x1f41)
    auSsBuf.writeUInt16BE(4, 4);        // 4 pairs
    auSsBuf.writeUInt16BE(0x2739, 6);  auSsBuf.writeUInt16BE(0x2739, 8);  // 1:1 (ignored)
    auSsBuf.writeUInt16BE(6001, 10);   auSsBuf.writeUInt16BE(10010, 12);  // SS2 -> ME1 PGM
    auSsBuf.writeUInt16BE(6000, 14);   auSsBuf.writeUInt16BE(10010, 16);  // SS1 -> ME1 PGM
    auSsBuf.writeUInt16BE(40, 18);     auSsBuf.writeUInt16BE(40, 20);     // 1:1 (ignored)
    assert.strictEqual(store.ingestPacket("auSS", auSsBuf), true);

    // 4. Enable meSE 0->1 and add meSS substitution
    assert.strictEqual(store.ingestPacket("meSE", Buffer.from("00010100", "hex")), true);
    const meSsBuf = Buffer.alloc(4 + 2 * 4);
    meSsBuf.writeUInt8(0, 0); meSsBuf.writeUInt8(1, 1); meSsBuf.writeUInt16BE(2, 2);
    meSsBuf.writeUInt16BE(1, 4); meSsBuf.writeUInt16BE(1, 6);
    meSsBuf.writeUInt16BE(5, 8); meSsBuf.writeUInt16BE(6, 10);
    assert.strictEqual(store.ingestPacket("meSS", meSsBuf), true);

    const rules = store.serialize();
    assert.strictEqual(rules.length, 2, "Only active/populated Bus Mapping rules emitted (unused 100+ slots filtered out)");
    const aux1Rule = rules.find(r => r.targetType === "aux" && r.targetIndex === 1);
    assert(aux1Rule && aux1Rule.enabled === true && aux1Rule.leadMeIndex === 0);
    assert.deepStrictEqual(aux1Rule.substitutions, { "6000": "10010", "6001": "10010" });
    const me1Rule = rules.find(r => r.targetType === "me" && r.targetIndex === 1);
    assert(me1Rule && me1Rule.enabled === true && me1Rule.substitutions["5"] === "6");

    store.clear();
    assert.strictEqual(store.serialize().length, 0);
    console.log("  [PASS] ATEM 10.2 Bus Mapping binary parser (meSE/meSS/auSE/auSS) verified against hardware captures\n");

    const { runBridgeTests } = require(path.join(ROOT, "tests", "bridge.test.js"));
    await runBridgeTests();
    process.exit(0);
})();
