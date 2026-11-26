// =========================================================================
// PRINTABLE ENGINEERING PATCH SHEET & CSV MANIFEST (js/patch-sheet.js)
// Zero-dependency offline broadcast patch sheet (HTML print/PDF + CSV).
// =========================================================================

const PatchSheetExporter = (() => {
    function escHtml(val) {
        return String(val ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function csvCell(val) {
        const s = String(val ?? "");
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    function srcLabel(srcId) {
        if (!srcId) return "Black";
        return getSourceDisplayName(srcId) || srcId;
    }

    function buildPatchHtml(projectName = state.projectName || "ATEM Show Patch") {
        const profile = getProfile() || {};
        const isSdi = /SDI|Constellation|Television Studio/i.test(state.deviceProfile || "");
        const portType = isSdi ? "SDI" : "HDMI";
        const nowStr = new Date().toLocaleString();
        const safeTitle = escHtml(projectName || "ATEM Engineering Patch Sheet");

        // 1. Input Patch Rows
        const inputRows = [];
        for (let ch = 1; ch <= (profile.inputs || 4); ch++) {
            const inp = state.inputs?.[ch] || {};
            const shortN = getSourceShortName(`input${ch}`);
            const longN = inp.label || `Camera ${ch}`;
            const thumbHtml = inp.thumbnail
                ? `<img src="${escHtml(inp.thumbnail)}" class="thumb" alt=""/>`
                : `<span class="muted">—</span>`;
            inputRows.push(`
                <tr>
                    <td class="mono bold">IN ${ch}</td>
                    <td class="mono"><span class="pill">${escHtml(shortN)}</span></td>
                    <td><strong>${escHtml(longN)}</strong></td>
                    <td class="mono">${portType}</td>
                    <td>${thumbHtml}</td>
                    <td>${escHtml(inp.notes || "")}</td>
                </tr>
            `);
        }

        // 2. Output / Aux + Bus Follow Rows
        const outputRows = [];
        for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
            const outData = getOutputData(a);
            const shortN = getSourceShortName(`output${a}`);
            const followRule = SwitcherEngine.getBusFollowerForTarget("aux", a);
            let routeHtml = `<strong>${escHtml(srcLabel(outData.source))}</strong>`;
            let subHtml = `<span class="muted">Manual</span>`;

            if (followRule?.enabled) {
                const subEntries = Object.entries(followRule.substitutions || {});
                routeHtml = `<span class="pill pill-cyan">⇄ Follows M/E ${followRule.leadMeIndex + 1}</span> <span class="muted">(Now: ${escHtml(srcLabel(outData.source))})</span>`;
                subHtml = subEntries.length
                    ? subEntries.map(([fromId, toId]) => `${escHtml(srcLabel(fromId))} → <strong>${escHtml(srcLabel(toId))}</strong>`).join("<br/>")
                    : `<span class="muted">1:1 Mirror</span>`;
            }

            outputRows.push(`
                <tr>
                    <td class="mono bold">AUX ${a}</td>
                    <td class="mono"><span class="pill">${escHtml(shortN)}</span></td>
                    <td>${escHtml(outData.label || `Output ${a}`)}</td>
                    <td>${routeHtml}</td>
                    <td class="small">${subHtml}</td>
                    <td>${escHtml(outData.notes || "")}</td>
                </tr>
            `);
        }

        // 3. Mix Effects, Keyers & DSK Summary
        const meCards = [];
        const maxUsks = getUpstreamKeyersPerME(profile);
        state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w)).forEach(me => {
            const d = me.data;
            const followRule = SwitcherEngine.getBusFollowerForTarget("me", me.resourceId);
            const followTag = followRule?.enabled ? ` <span class="pill pill-cyan">⇄ Follows M/E ${followRule.leadMeIndex + 1}</span>` : "";
            const uskList = (d.usk || []).slice(0, maxUsks).map((u, idx) => {
                const kf = (u.keyframeA || u.keyframeB) ? ` [KF: ${u.keyframeA ? "A" : ""}${u.keyframeB ? "B" : ""}]` : "";
                return `<li><strong>USK ${idx + 1}</strong> (${escHtml(u.keyType.toUpperCase())}): Fill=<code>${escHtml(srcLabel(u.source))}</code> · ${u.enabled ? `<span class="tag-red">ON AIR</span>` : "Off"}${kf}</li>`;
            }).join("");

            meCards.push(`
                <div class="card">
                    <h4>${escHtml(me.name)}${followTag}</h4>
                    <div class="kv">
                        <span>PGM: <strong class="tag-red">${escHtml(srcLabel(d.source))}</strong></span>
                        <span>PVW: <strong class="tag-green">${escHtml(srcLabel(d.previewSource))}</strong></span>
                        <span>Trans: <strong>${escHtml(d.transitionStyle)} (${d.transitionRate}f)</strong></span>
                        <span>FTB: <strong>${d.ftb?.enabled ? "BLACK" : "Live"} (${d.ftb?.rate || 25}f)</strong></span>
                    </div>
                    <ul class="compact-list">${uskList}</ul>
                </div>
            `);
        });

        const dskRows = getAvailableDSKs().map(dsk => `
            <tr>
                <td class="mono bold">DSK ${dsk.id + 1}</td>
                <td>${escHtml(srcLabel(dsk.source))}</td>
                <td>${escHtml(srcLabel(dsk.keySource || dsk.source))}</td>
                <td class="mono">${dsk.rate || 25}f</td>
                <td>${dsk.tie ? `<span class="pill pill-amber">TIE</span>` : "—"}</td>
                <td>${dsk.enabled ? `<span class="tag-red">ON AIR</span>` : "Off"}</td>
            </tr>
        `).join("");

        // 4. SuperSources
        const ssCards = state.workspaces
            .filter(w => w.type === "superSource" && isWorkspaceAvailable(w))
            .map(ss => {
                const boxRows = (ss.data.boxes || []).map((b, i) => `
                    <tr>
                        <td class="mono">Box ${i + 1}</td>
                        <td>${b.enabled ? "On" : "Off"}</td>
                        <td>${escHtml(srcLabel(b.source))}</td>
                        <td class="mono">X:${(b.x ?? 0).toFixed(2)} Y:${(b.y ?? 0).toFixed(2)} S:${(b.size ?? 0.5).toFixed(2)}</td>
                        <td>${b.cropEnabled ? "Cropped" : "—"}</td>
                    </tr>
                `).join("");
                return `
                    <div class="card">
                        <h4>${escHtml(ss.name)} · Art (${escHtml(ss.data.artPlace || "Background")}): ${escHtml(srcLabel(ss.data.artSource))}</h4>
                        <table><thead><tr><th>Box</th><th>State</th><th>Source</th><th>Transform</th><th>Crop</th></tr></thead><tbody>${boxRows}</tbody></table>
                    </div>
                `;
            }).join("");

        // 5. Media Pool & Media Players
        const stills = getAvailableStills();
        const mpSummary = [];
        for (let m = 0; m < (profile.mediaPlayers || 1); m++) {
            const p = state.mediaPlayers?.[m];
            const asset = stills.find(s => s.id === p?.mediaId);
            mpSummary.push(`<span><strong>MP ${m + 1}:</strong> ${asset ? `Slot ${asset.id + 1} (${escHtml(asset.name)})` : "Empty"}</span>`);
        }
        const stillRows = stills.map(st => `
            <tr>
                <td class="mono">Slot ${st.id + 1}</td>
                <td>${escHtml(st.name)}</td>
                <td class="mono">${st.nativeWidth || 1920}×${st.nativeHeight || 1080}</td>
            </tr>
        `).join("");

        // 6. Multi-Views
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(profile) : 1;
        const mvCards = [];
        for (let mvIdx = 0; mvIdx < mvCount; mvIdx++) {
            const mv = getMultiView(mvIdx);
            const boxCount = PopoutManager.getMvBoxCount(mv.layout);
            const items = [];
            for (let w = 0; w < boxCount; w++) {
                items.push(`<span><strong>W${w + 1}:</strong> ${escHtml(PopoutManager.getMvSourceLabel(mv.windows[w] || ""))}</span>`);
            }
            mvCards.push(`
                <div class="card">
                    <h4>Multi-View ${mvIdx + 1} · ${escHtml(mv.layout)}${mv.swapPvwPgm ? " (Swapped PVW/PGM)" : ""}</h4>
                    <div class="mv-grid-list">${items.join("")}</div>
                </div>
            `);
        }

        // 7. Macro Directory & Hotkeys
        MacroEngine.ensureMacroPool();
        const macroRows = [];
        state.macros.forEach((m, idx) => {
            if (!m) return;
            const dur = MacroEngine.getMacroDurationInfo(m);
            const buses = MacroEngine.getTouchedBuses(m).join(", ") || "—";
            const bankSlot = idx % 10;
            const defaultKey = `Alt+${bankSlot === 9 ? "0" : bankSlot + 1} (B${Math.floor(idx / 10) + 1})`;
            macroRows.push(`
                <tr>
                    <td class="mono bold">#${idx + 1}</td>
                    <td><strong>${escHtml(m.name)}</strong></td>
                    <td class="mono"><span class="pill">${escHtml(m.hotkey || defaultKey)}</span></td>
                    <td class="mono">${dur.activeCount} ops · ${dur.totalFrames}f (${dur.totalSeconds.toFixed(2)}s)</td>
                    <td class="small">${escHtml(buses)}</td>
                    <td class="small">${escHtml(m.description || "")}</td>
                </tr>
            `);
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${safeTitle} — ATEM Engineering Patch Sheet</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 20px; font-size: 12px; line-height: 1.4; }
  .sheet { max-width: 1080px; margin: 0 auto; background: #fff; padding: 24px 28px; border: 1px solid #cbd5e1; border-radius: 6px; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin: 0 auto 14px; max-width: 1080px; }
  .toolbar button { background: #0f172a; color: #fff; border: none; border-radius: 5px; padding: 7px 14px; font-weight: 600; font-size: 12px; cursor: pointer; margin-left: 8px; }
  .toolbar button.secondary { background: #e2e8f0; color: #0f172a; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 16px; }
  .doc-header h1 { margin: 0; font-size: 20px; letter-spacing: 0.02em; }
  .doc-meta { text-align: right; font-size: 11px; color: #475569; font-family: monospace; }
  .specs-bar { display: flex; flex-wrap: wrap; gap: 14px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 12px; margin-bottom: 18px; font-size: 11px; font-family: monospace; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 20px 0 8px; page-break-after: avoid; }
  h4 { margin: 0 0 6px; font-size: 12px; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; vertical-align: middle; }
  th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .bold { font-weight: 700; }
  .small { font-size: 11px; }
  .muted { color: #64748b; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 3px; background: #e2e8f0; color: #0f172a; font-weight: 700; font-size: 10px; }
  .pill-cyan { background: #cffafe; color: #0e7490; }
  .pill-amber { background: #fef3c7; color: #92400e; }
  .tag-red { color: #dc2626; font-weight: 700; }
  .tag-green { color: #15803d; font-weight: 700; }
  .thumb { width: 56px; height: 32px; object-fit: cover; border-radius: 2px; border: 1px solid #cbd5e1; display: block; }
  .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
  .card { border: 1px solid #cbd5e1; border-radius: 5px; padding: 10px; background: #fff; page-break-inside: avoid; }
  .kv { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; margin-bottom: 6px; }
  .compact-list { margin: 4px 0 0; padding-left: 16px; font-size: 11px; }
  .mv-grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 10px; font-size: 11px; font-family: monospace; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .sheet { border: none; padding: 0; max-width: none; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span style="font-weight:700; color:#334155;">ATEM-PROG Engineering Patch Sheet Preview</span>
    <div>
      <button class="secondary" onclick="window.close()">Close</button>
      <button onclick="window.print()">🖨 Print / Save as PDF</button>
    </div>
  </div>
  <div class="sheet">
    <div class="doc-header">
      <div>
        <h1>${safeTitle}</h1>
        <div style="color:#475569; margin-top:2px;">Broadcast Switcher Engineering Patch &amp; Show Manifest</div>
      </div>
      <div class="doc-meta">
        <div><strong>${escHtml(state.deviceProfile)}</strong></div>
        <div>${state.canvas.width}×${state.canvas.height} @ ${state.canvas.frameRate}fps</div>
        <div>Generated: ${escHtml(nowStr)}</div>
      </div>
    </div>

    <div class="specs-bar">
      <span>Inputs: <strong>${profile.inputs}</strong></span>
      <span>M/Es: <strong>${profile.me}</strong></span>
      <span>USKs/ME: <strong>${maxUsks}</strong></span>
      <span>DSKs: <strong>${profile.downstreamKeyers}</strong></span>
      <span>SuperSources: <strong>${profile.superSource}</strong></span>
      <span>Aux Outputs: <strong>${profile.assignableOutputs}</strong></span>
      <span>Multi-Views: <strong>${mvCount}</strong></span>
      <span>Media Players: <strong>${profile.mediaPlayers}</strong></span>
    </div>

    <h2>1. Input Patch List</h2>
    <table>
      <thead><tr><th style="width:54px;">Ch</th><th style="width:64px;">Short</th><th>Long Name</th><th style="width:54px;">Port</th><th style="width:70px;">Ref</th><th>Engineering Notes</th></tr></thead>
      <tbody>${inputRows.join("")}</tbody>
    </table>

    ${outputRows.length ? `
    <h2>2. Assignable Outputs &amp; Bus Follow / Source Substitutions</h2>
    <table>
      <thead><tr><th style="width:64px;">Out</th><th style="width:64px;">Short</th><th>Label</th><th>Routing / Follow</th><th>Substitutions</th><th>Notes</th></tr></thead>
      <tbody>${outputRows.join("")}</tbody>
    </table>` : ""}

    <h2>3. Mix Effects, Keyers &amp; DSKs</h2>
    <div class="cards-grid">${meCards.join("")}</div>
    <table style="margin-top:10px;">
      <thead><tr><th>DSK</th><th>Fill Source</th><th>Key Source</th><th>Rate</th><th>Tie</th><th>Status</th></tr></thead>
      <tbody>${dskRows}</tbody>
    </table>

    ${ssCards ? `<h2>4. SuperSource Layouts</h2><div class="cards-grid">${ssCards}</div>` : ""}

    <h2>5. Media Players &amp; Media Pool</h2>
    <div class="specs-bar">${mpSummary.join("")}</div>
    ${stillRows ? `<table><thead><tr><th>Slot</th><th>Filename</th><th>Resolution</th></tr></thead><tbody>${stillRows}</tbody></table>` : `<p class="muted">No stills loaded in Media Pool.</p>`}

    <h2>6. Multi-View Configurations</h2>
    <div class="cards-grid">${mvCards.join("")}</div>

    <h2>7. Macro Directory &amp; Hotkey Sheet</h2>
    ${macroRows.length
        ? `<table><thead><tr><th style="width:48px;">Slot</th><th>Macro Name</th><th style="width:120px;">Hotkey</th><th style="width:150px;">Runtime</th><th>Buses</th><th>Description</th></tr></thead><tbody>${macroRows.join("")}</tbody></table>`
        : `<p class="muted">No macros configured.</p>`}
  </div>
</body>
</html>`;
    }

    function openPrintablePatchSheet(projectName) {
        const legacyName = typeof elements !== "undefined" ? elements.txtProjectName?.value : "";
        const name = (projectName || state.projectName || legacyName || "ATEM Show Patch").trim();
        const html = buildPatchHtml(name);
        const win = window.open("", "_blank", "width=1140,height=860");
        if (!win) {
            // Fallback: download as standalone HTML if pop-ups are blocked
            const blob = new Blob([html], { type: "text/html;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}_patch_sheet.html`;
            a.click();
            URL.revokeObjectURL(url);
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    }

    function exportPatchCsv(projectName) {
        const profile = getProfile() || {};
        const legacyName = typeof elements !== "undefined" ? elements.txtProjectName?.value : "";
        const name = (projectName || state.projectName || legacyName || "atem_patch").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
        const lines = [];
        lines.push(["Section", "ID", "Short Name", "Long Name", "Assignment / Follow", "Substitutions / Meta", "Notes"].map(csvCell).join(","));

        for (let ch = 1; ch <= (profile.inputs || 4); ch++) {
            const inp = state.inputs?.[ch] || {};
            lines.push(["Input", `IN ${ch}`, getSourceShortName(`input${ch}`), inp.label || `Camera ${ch}`, "", "", inp.notes || ""].map(csvCell).join(","));
        }

        for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
            const outData = getOutputData(a);
            const rule = SwitcherEngine.getBusFollowerForTarget("aux", a);
            const assign = rule?.enabled ? `Follows M/E ${rule.leadMeIndex + 1}` : srcLabel(outData.source);
            const subs = rule?.enabled
                ? Object.entries(rule.substitutions || {}).map(([f, t]) => `${srcLabel(f)}->${srcLabel(t)}`).join("; ") || "1:1"
                : "";
            lines.push(["Aux Output", `AUX ${a}`, getSourceShortName(`output${a}`), outData.label || `Output ${a}`, assign, subs, outData.notes || ""].map(csvCell).join(","));
        }

        MacroEngine.ensureMacroPool();
        state.macros.forEach((m, idx) => {
            if (!m) return;
            const dur = MacroEngine.getMacroDurationInfo(m);
            const bankSlot = idx % 10;
            const hk = m.hotkey || `Alt+${bankSlot === 9 ? "0" : bankSlot + 1} (Bank ${Math.floor(idx / 10) + 1})`;
            lines.push(["Macro", `#${idx + 1}`, hk, m.name, `${dur.activeCount} ops / ${dur.totalSeconds.toFixed(2)}s`, MacroEngine.getTouchedBuses(m).join("; "), m.description || ""].map(csvCell).join(","));
        });

        const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}_patch_sheet.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        openPrintablePatchSheet,
        exportPatchCsv,
        downloadPatchCsv: exportPatchCsv,
        buildPatchHtml
    };
})();
