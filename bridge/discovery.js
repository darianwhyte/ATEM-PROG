// =========================================================================
// ZERO-DEPENDENCY mDNS / BONJOUR DISCOVERY (_blackmagic._tcp.local)
// =========================================================================

const dgram = require("dgram");

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

module.exports = {
    encodeDnsName,
    readDnsName,
    parseMdnsPacket,
    discoverBlackmagicDevices
};
