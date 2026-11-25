// =========================================================================
// ATEM-PROG LOCAL HTTP + WEBSOCKET <-> ATEM ETHERNET BRIDGE (bridge/server.js)
// - Serves ATEM-PROG.html cleanly on http://127.0.0.1:8993/ (path-sandboxed)
// - Hosts WebSocket bridge on ws://127.0.0.1:8993 (works from file:// or http://)
// - Bridges commands & Ethernet still downloads to Blackmagic ATEM (UDP 9910)
// =========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dgram = require("dgram");
const { WebSocketServer } = require("ws");
const { Atem } = require("atem-connection");

const HOST = process.env.ATEM_BRIDGE_HOST || "0.0.0.0";
const PORT = parseInt(process.env.ATEM_BRIDGE_PORT || "8993", 10);
const APP_ROOT = path.resolve(__dirname, "..");
const STARTED_AT = Date.now();
const serviceLogs = [];

function addLog(msg) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    serviceLogs.push(entry);
    if (serviceLogs.length > 60) serviceLogs.shift();
    console.log(entry);
}

function getLanIPv4Addresses() {
    const nets = os.networkInterfaces();
    const out = [];
    Object.entries(nets).forEach(([iface, addrs]) => {
        (addrs || []).forEach(a => {
            if (a.family === "IPv4" && !a.internal) {
                out.push({ iface, address: a.address });
            }
        });
    });
    return out;
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

// =========================================================================
// LOCAL + LAN STATIC HTTP SERVER & LAUNCHER API (Path-traversal protected)
// =========================================================================
let latestStudioState = null;

const server = http.createServer((req, res) => {
    try {
        const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);

        // Launcher Status API
        if (reqPath === "/api/status") {
            const lanIps = getLanIPv4Addresses();
            const payload = {
                ok: true,
                host: HOST,
                port: PORT,
                lanEnabled: HOST === "0.0.0.0",
                uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
                clients: wss.clients.size,
                atem: {
                    connected: isConnected,
                    ip: currentIp || "",
                    product: isConnected ? (atem.state?.info?.productIdentifier || "ATEM Switcher") : ""
                },
                urls: {
                    local: `http://127.0.0.1:${PORT}/`,
                    launcher: `http://127.0.0.1:${PORT}/launcher.html`,
                    remoteLocal: `http://127.0.0.1:${PORT}/remote.html`,
                    tests: `http://127.0.0.1:${PORT}/tests.html`,
                    lan: lanIps.map(item => ({
                        iface: item.iface,
                        ip: item.address,
                        studio: `http://${item.address}:${PORT}/`,
                        remote: `http://${item.address}:${PORT}/remote.html`
                    }))
                },
                logs: serviceLogs.slice(-30)
            };
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify(payload));
            return;
        }

        // Clean Shutdown API (Restricted strictly to localhost callers!)
        if (reqPath === "/api/shutdown" && req.method === "POST") {
            const remoteAddr = req.socket?.remoteAddress || "";
            if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddr)) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            addLog("Shutdown requested from Launcher.");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            setTimeout(() => process.exit(0), 250);
            return;
        }

        const relPath = reqPath === "/" ? "ATEM-PROG.html" : reqPath.replace(/^\/+/, "");
        const resolved = path.resolve(APP_ROOT, relPath);

        // Strictly prevent escaping APP_ROOT or serving bridge/node_modules
        if (!resolved.startsWith(APP_ROOT + path.sep) || resolved.includes(`${path.sep}bridge${path.sep}`)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        fs.stat(resolved, (err, stat) => {
            if (err || !stat.isFile()) {
                res.writeHead(404);
                res.end("Not Found");
                return;
            }
            const ext = path.extname(resolved).toLowerCase();
            res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
            fs.createReadStream(resolved).pipe(res);
        });
    } catch {
        res.writeHead(400);
        res.end("Bad Request");
    }
});

const wss = new WebSocketServer({ server });
const atem = new Atem();

let currentIp = null;
let isConnected = false;

// =========================================================================
// ZERO-DEPENDENCY RGBA -> 32-BIT BMP ENCODER (For Still/Thumbnail Downloads)
// =========================================================================
function rgbaToBmpDataUrl(rgbaBuffer, width, height) {
    const pixelBytes = width * height * 4;
    const fileSize = 54 + pixelBytes;
    const out = Buffer.alloc(fileSize);

    out.write("BM", 0, 2, "ascii");
    out.writeUInt32LE(fileSize, 2);
    out.writeUInt32LE(0, 6);
    out.writeUInt32LE(54, 10);

    out.writeUInt32LE(40, 14);
    out.writeInt32LE(width, 18);
    out.writeInt32LE(-height, 22);
    out.writeUInt16LE(1, 26);
    out.writeUInt16LE(32, 28);
    out.writeUInt32LE(0, 30);
    out.writeUInt32LE(pixelBytes, 34);

    for (let i = 0; i < pixelBytes; i += 4) {
        out[54 + i]     = rgbaBuffer[i + 2];
        out[54 + i + 1] = rgbaBuffer[i + 1];
        out[54 + i + 2] = rgbaBuffer[i];
        out[54 + i + 3] = rgbaBuffer[i + 3];
    }

    return `data:image/bmp;base64,${out.toString("base64")}`;
}

function getVideoDimensions(videoMode) {
    const modeMap = {
        0: [720, 576], 1: [720, 486], 2: [720, 576], 3: [720, 486],
        4: [1280, 720], 5: [1280, 720],
        6: [1920, 1080], 7: [1920, 1080], 8: [1920, 1080], 9: [1920, 1080],
        10: [1920, 1080], 11: [1920, 1080], 12: [1920, 1080], 13: [1920, 1080],
        14: [3840, 2160], 15: [3840, 2160], 16: [3840, 2160], 17: [3840, 2160],
        18: [3840, 2160], 19: [3840, 2160], 20: [3840, 2160], 21: [3840, 2160]
    };
    return modeMap[videoMode] || [1920, 1080];
}

function broadcast(payload) {
    const raw = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(raw);
    });
}

function buildCompactHardwareSnapshot() {
    const s = atem.state || {};
    const meList = (s.video?.mixEffects || []).map((me, idx) => ({
        index: idx,
        programInput: me?.programInput ?? 0,
        previewInput: me?.previewInput ?? 0,
        transitionStyle: me?.transitionProperties?.style ?? 0,
        ftbFullyBlack: !!(me?.fadeToBlack?.isFullyBlack),
        usks: (me?.upstreamKeyers || []).map((u, ui) => ({
            index: ui,
            onAir: !!(u?.onAir),
            fillSource: u?.fillSource ?? 0
        }))
    }));

    const auxList = (s.video?.auxilliaries || []).map((src, idx) => ({
        index: idx,
        source: src ?? 0
    }));

    const dskList = (s.video?.downstreamKeyers || []).map((d, idx) => ({
        index: idx,
        onAir: !!(d?.onAir),
        tie: !!(d?.properties?.tie),
        rate: d?.properties?.rate ?? 25,
        fillSource: d?.sources?.fillSource ?? 0,
        keySource: d?.sources?.keySource ?? 0
    }));

    const superSources = (s.video?.superSources || []).map((ss, idx) => ({
        index: idx,
        artFillSource: ss?.properties?.artFillSource ?? 0,
        artCutSource: ss?.properties?.artCutSource ?? 0,
        artOption: ss?.properties?.artOption ?? 0,
        boxes: (ss?.boxes || []).map((b, bi) => ({
            index: bi,
            enabled: !!(b?.enabled),
            source: b?.source ?? 0,
            x: (b?.x ?? 0) / 100,
            y: (b?.y ?? 0) / 100,
            size: (b?.size ?? 500) / 1000,
            cropped: !!(b?.cropped),
            cropTop: b?.cropTop ?? 0,
            cropBottom: b?.cropBottom ?? 0,
            cropLeft: b?.cropLeft ?? 0,
            cropRight: b?.cropRight ?? 0
        }))
    }));

    const multiViewers = (s.settings?.multiViewers || []).map((mv, idx) => ({
        index: idx,
        windows: Object.entries(mv?.windows || {}).map(([wIdx, w]) => ({
            index: Number(wIdx),
            source: w?.source ?? 0
        }))
    }));

    const inputs = {};
    Object.entries(s.inputs || {}).forEach(([id, inp]) => {
        if (!inp) return;
        inputs[id] = { longName: inp.longName || "", shortName: inp.shortName || "" };
    });

    const stills = (s.media?.stillPool || []).map((st, idx) => ({
        index: idx,
        isUsed: !!(st?.isUsed),
        fileName: st?.fileName || ""
    }));

    return {
        product: s.info?.productIdentifier || "",
        videoMode: s.settings?.videoMode ?? 13,
        mixEffects: meList,
        auxilliaries: auxList,
        downstreamKeyers: dskList,
        superSources,
        multiViewers,
        inputs,
        stills
    };
}

// =========================================================================
// ZERO-DEPENDENCY mDNS / BONJOUR DISCOVERY (_blackmagic._tcp.local)
// =========================================================================
function encodeDnsName(name) {
    const parts = name.split(".").filter(Boolean);
    const bufs = parts.map(p => {
        const b = Buffer.from(p, "utf8");
        return Buffer.concat([Buffer.from([b.length]), b]);
    });
    bufs.push(Buffer.from([0]));
    return Buffer.concat(bufs);
}

function readDnsName(buf, offset) {
    const labels = [];
    let pos = offset;
    let jumped = false;
    let nextPos = offset;
    let guard = 0;

    while (pos < buf.length && guard++ < 64) {
        const len = buf[pos];
        if (len === 0) {
            if (!jumped) nextPos = pos + 1;
            break;
        }
        if ((len & 0xc0) === 0xc0) {
            if (!jumped) nextPos = pos + 2;
            pos = ((len & 0x3f) << 8) | buf[pos + 1];
            jumped = true;
            continue;
        }
        pos += 1;
        labels.push(buf.slice(pos, pos + len).toString("utf8"));
        pos += len;
    }
    return { name: labels.join("."), nextOffset: nextPos };
}

function parseMdnsPacket(buf) {
    if (!buf || buf.length < 12) return [];
    const qdCount = buf.readUInt16BE(4);
    const anCount = buf.readUInt16BE(6);
    const nsCount = buf.readUInt16BE(8);
    const arCount = buf.readUInt16BE(10);
    let pos = 12;

    for (let i = 0; i < qdCount && pos < buf.length; i++) {
        pos = readDnsName(buf, pos).nextOffset + 4;
    }

    const records = [];
    const total = anCount + nsCount + arCount;
    for (let i = 0; i < total && pos + 10 <= buf.length; i++) {
        const { name, nextOffset } = readDnsName(buf, pos);
        pos = nextOffset;
        if (pos + 10 > buf.length) break;
        const type = buf.readUInt16BE(pos);
        const rdLength = buf.readUInt16BE(pos + 8);
        pos += 10;
        const rdataStart = pos;
        if (rdataStart + rdLength > buf.length) break;

        let data = null;
        if (type === 1 && rdLength === 4) { // A (IPv4)
            data = `${buf[rdataStart]}.${buf[rdataStart + 1]}.${buf[rdataStart + 2]}.${buf[rdataStart + 3]}`;
        } else if (type === 12) { // PTR
            data = readDnsName(buf, rdataStart).name;
        } else if (type === 33 && rdLength >= 6) { // SRV
            data = {
                port: buf.readUInt16BE(rdataStart + 4),
                target: readDnsName(buf, rdataStart + 6).name
            };
        } else if (type === 16) { // TXT
            const kv = {};
            let tpos = rdataStart;
            while (tpos < rdataStart + rdLength) {
                const tlen = buf[tpos++];
                const entry = buf.slice(tpos, tpos + tlen).toString("utf8");
                tpos += tlen;
                const eq = entry.indexOf("=");
                if (eq > 0) kv[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
            }
            data = kv;
        }
        records.push({ name, type, data });
        pos = rdataStart + rdLength;
    }
    return records;
}

function discoverBlackmagicDevices(timeoutMs = 2200) {
    return new Promise((resolve) => {
        const services = new Map(); // instanceName -> { name, host, ip, port, model, cls }
        const hostIps = new Map();  // hostName -> ip
        const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

        const finish = () => {
            try { sock.close(); } catch {}
            const list = [];
            const seenIps = new Set();
            services.forEach(svc => {
                const ip = svc.ip || (svc.host ? hostIps.get(svc.host.toLowerCase()) : "");
                const isAtem = /atem/i.test(`${svc.cls || ""} ${svc.name || ""} ${svc.model || ""}`);
                if (!ip || seenIps.has(ip)) return;
                if (!isAtem && svc.cls && !/switcher/i.test(svc.cls)) return;
                seenIps.add(ip);
                list.push({
                    name: svc.name || svc.model || "ATEM Switcher",
                    model: svc.model || svc.name || "ATEM Switcher",
                    ip,
                    port: svc.port || 9910
                });
            });
            resolve(list);
        };

        const timer = setTimeout(finish, timeoutMs);

        sock.on("error", () => {
            clearTimeout(timer);
            finish();
        });

        sock.on("message", (msg, rinfo) => {
            try {
                const recs = parseMdnsPacket(msg);
                recs.forEach(r => {
                    if (r.type === 1 && r.data) {
                        hostIps.set(r.name.toLowerCase(), r.data);
                    }
                });
                recs.forEach(r => {
                    if (r.type === 12 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const inst = r.data;
                        const entry = services.get(inst) || { name: inst.split(".")[0], ip: rinfo.address };
                        services.set(inst, entry);
                    } else if (r.type === 33 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const entry = services.get(r.name) || { name: r.name.split(".")[0] };
                        entry.host = r.data.target;
                        entry.port = r.data.port;
                        entry.ip = hostIps.get((r.data.target || "").toLowerCase()) || entry.ip || rinfo.address;
                        services.set(r.name, entry);
                    } else if (r.type === 16 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const entry = services.get(r.name) || { name: r.name.split(".")[0] };
                        if (r.data.name) entry.name = r.data.name;
                        if (r.data.class) entry.cls = r.data.class;
                        if (r.data.model) entry.model = r.data.model;
                        services.set(r.name, entry);
                    }
                });
            } catch {}
        });

        sock.bind(0, () => {
            try {
                // Standard mDNS PTR query for _blackmagic._tcp.local
                const header = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
                const qName = encodeDnsName("_blackmagic._tcp.local");
                const qMeta = Buffer.from([0x00, 0x0c, 0x00, 0x01]); // PTR, IN
                const query = Buffer.concat([header, qName, qMeta]);
                sock.send(query, 0, query.length, 5353, "224.0.0.251");
                setTimeout(() => {
                    try { sock.send(query, 0, query.length, 5353, "224.0.0.251"); } catch {}
                }, 450);
            } catch {
                clearTimeout(timer);
                finish();
            }
        });
    });
}

// =========================================================================
// ATEM EVENTS
// =========================================================================
atem.on("connected", () => {
    isConnected = true;
    console.log(`[ATEM Bridge] Connected to ${currentIp} (${atem.state?.info?.productIdentifier || "ATEM"})`);
    broadcast({
        type: "status",
        connected: true,
        ip: currentIp,
        product: atem.state?.info?.productIdentifier || "ATEM Switcher"
    });
    broadcast({ type: "state", snapshot: buildCompactHardwareSnapshot() });
});

atem.on("disconnected", () => {
    isConnected = false;
    console.log("[ATEM Bridge] Disconnected from ATEM.");
    broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
});

atem.on("error", (err) => {
    console.error("[ATEM Bridge] Error:", err);
    broadcast({ type: "error", message: String(err?.message || err) });
});

let stateThrottleTimer = null;
atem.on("stateChanged", () => {
    if (stateThrottleTimer) return;
    stateThrottleTimer = setTimeout(() => {
        stateThrottleTimer = null;
        if (isConnected) broadcast({ type: "state", snapshot: buildCompactHardwareSnapshot() });
    }, 60);
});

// =========================================================================
// WEBSOCKET COMMAND HANDLER
// =========================================================================
async function handleCommand(ws, msg) {
    const cmd = msg?.cmd;
    if (!cmd) return;

    if (cmd === "discover") {
        addLog("Scanning LAN for Blackmagic ATEM switchers via mDNS...");
        const devices = await discoverBlackmagicDevices(Number(msg.timeoutMs) || 2200);
        addLog(`mDNS scan complete: ${devices.length} device(s) found.`);
        ws.send(JSON.stringify({ type: "discovered", devices }));
        return;
    }

    if (cmd === "publishStudioState" && msg.studio) {
        latestStudioState = msg.studio;
        const raw = JSON.stringify({ type: "studioState", studio: latestStudioState });
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) client.send(raw);
        });
        return;
    }

    if (cmd === "remoteAction" && msg.action) {
        const raw = JSON.stringify({ type: "remoteAction", action: msg.action });
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) client.send(raw);
        });
        return;
    }

    if (cmd === "connect") {
        const ip = String(msg.ip || "").trim();
        if (!ip) return ws.send(JSON.stringify({ type: "error", message: "Missing ATEM IP address." }));
        currentIp = ip;
        try {
            await atem.disconnect().catch(() => {});
            await atem.connect(ip);
        } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Connect failed: ${err.message}` }));
        }
        return;
    }

    if (cmd === "disconnect") {
        await atem.disconnect().catch(() => {});
        isConnected = false;
        broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
        return;
    }

    if (!isConnected) {
        ws.send(JSON.stringify({ type: "error", message: "Not connected to an ATEM switcher." }));
        return;
    }

    try {
        switch (cmd) {
            case "setProgram":
                await atem.changeProgramInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "setPreview":
                await atem.changePreviewInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "cut":
                await atem.cut(Number(msg.me) || 0);
                break;
            case "auto":
                await atem.autoTransition(Number(msg.me) || 0);
                break;
            case "ftb":
                await atem.fadeToBlack(Number(msg.me) || 0);
                break;
            case "setAux":
                await atem.setAuxSource(Number(msg.input) || 0, Number(msg.aux) || 0);
                break;
            case "setDSKOnAir":
                await atem.setDownstreamKeyOnAir(!!msg.onAir, Number(msg.dsk) || 0);
                break;
            case "setDSKTie":
                await atem.setDownstreamKeyTie(!!msg.tie, Number(msg.dsk) || 0);
                break;
            case "autoDSK":
                await atem.autoDownstreamKey(Number(msg.dsk) || 0);
                break;
            case "setUSKOnAir":
                await atem.setUpstreamKeyerOnAir(!!msg.onAir, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKFill":
                await atem.setUpstreamKeyerFillSource(Number(msg.input) || 0, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setSSBox":
                await atem.setSuperSourceBoxSettings(
                    {
                        ...(msg.source !== undefined ? { source: Number(msg.source) || 0 } : {}),
                        ...(msg.enabled !== undefined ? { enabled: !!msg.enabled } : {})
                    },
                    Number(msg.box) || 0,
                    Number(msg.ss) || 0
                );
                break;
            case "pullConfig":
                ws.send(JSON.stringify({ type: "fullConfig", snapshot: buildCompactHardwareSnapshot() }));
                break;
            case "pushConfig": {
                const cfg = msg.config || {};
                let pushed = 0;
                if (Array.isArray(cfg.inputs)) {
                    for (const inp of cfg.inputs) {
                        try {
                            await atem.setInputSettings(
                                { longName: String(inp.longName || "").slice(0, 20), shortName: String(inp.shortName || "").slice(0, 4) },
                                Number(inp.id)
                            );
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.auxOutputs)) {
                    for (const aux of cfg.auxOutputs) {
                        try {
                            await atem.setAuxSource(Number(aux.source) || 0, Number(aux.index) || 0);
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.mixEffects)) {
                    for (const me of cfg.mixEffects) {
                        try {
                            await atem.changeProgramInput(Number(me.programInput) || 0, Number(me.index) || 0);
                            await atem.changePreviewInput(Number(me.previewInput) || 0, Number(me.index) || 0);
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.superSources)) {
                    for (const ss of cfg.superSources) {
                        for (const b of (ss.boxes || [])) {
                            try {
                                await atem.setSuperSourceBoxSettings({
                                    enabled: !!b.enabled,
                                    source: Number(b.source) || 0,
                                    x: Math.round((Number(b.x) || 0) * 100),
                                    y: Math.round((Number(b.y) || 0) * 100),
                                    size: Math.round((Number(b.size) || 0.5) * 1000)
                                }, Number(b.index) || 0, Number(ss.index) || 0);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                if (Array.isArray(cfg.multiViewers)) {
                    for (const mv of cfg.multiViewers) {
                        for (const w of (mv.windows || [])) {
                            try {
                                await atem.setMultiViewerWindowSource(Number(w.source) || 0, Number(mv.index) || 0, Number(w.index) || 0);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                ws.send(JSON.stringify({ type: "pushComplete", count: pushed }));
                break;
            }
            case "runMacro":
                await atem.macroRun(Number(msg.index) || 0);
                break;
            case "captureStill": {
                await atem.captureStill();
                await new Promise(r => setTimeout(r, 450));
                const stills = atem.state?.media?.stillPool || [];
                let targetSlot = Number.isInteger(msg.slot) ? msg.slot : -1;
                if (targetSlot < 0) {
                    for (let i = stills.length - 1; i >= 0; i--) {
                        if (stills[i]?.isUsed) { targetSlot = i; break; }
                    }
                    if (targetSlot < 0) targetSlot = 0;
                }
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(targetSlot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "thumbnail",
                    targetInput: msg.targetInput || 1,
                    slot: targetSlot,
                    width: w,
                    height: h,
                    fileName: stills[targetSlot]?.fileName || `Still_${targetSlot + 1}.bmp`,
                    dataUrl
                }));
                break;
            }
            case "downloadStill": {
                const slot = Math.max(0, Number(msg.slot) || 0);
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(slot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                const stillMeta = atem.state?.media?.stillPool?.[slot];
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "mediaPool",
                    targetInput: msg.targetInput || 1,
                    slot,
                    width: w,
                    height: h,
                    fileName: stillMeta?.fileName || `Still_${slot + 1}.bmp`,
                    dataUrl
                }));
                break;
            }
        }
    } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `${cmd} failed: ${err.message}` }));
    }
}

wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
        type: "status",
        bridgeReady: true,
        connected: isConnected,
        ip: currentIp || "",
        product: isConnected ? (atem.state?.info?.productIdentifier || "ATEM Switcher") : ""
    }));
    if (isConnected) {
        ws.send(JSON.stringify({ type: "state", snapshot: buildCompactHardwareSnapshot() }));
    }
    if (latestStudioState) {
        ws.send(JSON.stringify({ type: "studioState", studio: latestStudioState }));
    }

    ws.on("message", (raw) => {
        try {
            handleCommand(ws, JSON.parse(raw.toString()));
        } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Invalid JSON: ${err.message}` }));
        }
    });
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.log(`[ATEM Bridge] Already running on http://${HOST}:${PORT}`);
        process.exit(0);
    }
    console.error("[ATEM Bridge] Server error:", err);
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    addLog(`ATEM-PROG Service online at http://127.0.0.1:${PORT}/ (Launcher: /launcher.html · Remote: /remote.html)`);
    getLanIPv4Addresses().forEach(item => {
        addLog(`LAN access (${item.iface}): http://${item.address}:${PORT}/remote.html`);
    });
});
