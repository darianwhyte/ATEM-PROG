// =========================================================================
// VIEW 5: MEDIA — STILLS, VIDEO CLIPS, MEDIA PLAYERS & COLOR GENERATORS
// (js/ui/view-media.js)
// Supports both Still Images (PNG/JPG/WebP) AND Video Clips (MP4/WebM/MOV)
// with live Media Player playback, loop toggles & IndexedDB persistence.
// =========================================================================

const ViewMedia = (() => {
    let selectedMediaId = null;

    function fmtDuration(sec) {
        if (!Number.isFinite(sec) || sec <= 0) return "";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, "0")}`;
    }

    function nextSlotId() {
        const usedIds = new Set(state.media.map(m => m.id));
        let id = 0;
        while (usedIds.has(id)) id++;
        return id;
    }

    function ingestFiles(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
        if (!files.length) return;
        const maxSlots = Math.max(20, (getProfile()?.mediaPoolStills || 20) + 4);

        files.forEach(file => {
            if (state.media.length >= maxSlots) {
                AppUI.toast(`Media Pool full (${maxSlots} slots max).`, "err");
                return;
            }
            const id = nextSlotId();
            const url = URL.createObjectURL(file);

            if (file.type.startsWith("video/")) {
                const vid = document.createElement("video");
                vid.muted = true;
                vid.playsInline = true;
                vid.preload = "auto";
                vid.src = url;
                vid.addEventListener("loadeddata", () => {
                    const vw = vid.videoWidth || 1920;
                    const vh = vid.videoHeight || 1080;
                    // Capture poster thumbnail for Media Pool card
                    let posterUrl = null;
                    try {
                        const c = document.createElement("canvas");
                        c.width = 480;
                        c.height = 270;
                        c.getContext("2d").drawImage(vid, 0, 0, 480, 270);
                        posterUrl = c.toDataURL("image/jpeg", 0.8);
                    } catch {}

                    const item = {
                        id,
                        name: file.name,
                        kind: "video",
                        duration: vid.duration || 0,
                        loop: true,
                        playing: true,
                        posterUrl,
                        url,
                        nativeWidth: vw,
                        nativeHeight: vh,
                        scaleX: vw / state.canvas.width,
                        scaleY: vh / state.canvas.height
                    };
                    state.media.push(item);
                    state.media.sort((a, b) => a.id - b.id);
                    selectedMediaId = item.id;
                    if (typeof StateStorage !== "undefined") {
                        StateStorage.saveMediaAsset(item, file);
                        StateStorage.scheduleSave();
                    }
                    buildSources();
                    AppUI.refresh("mediaAdded");
                    AppUI.toast(`Imported video clip "${file.name}" into Slot ${id + 1}`, "ok");
                }, { once: true });
                return;
            }

            const img = new Image();
            img.onload = () => {
                const item = {
                    id,
                    name: file.name,
                    kind: "still",
                    url,
                    nativeWidth: img.naturalWidth || 1920,
                    nativeHeight: img.naturalHeight || 1080,
                    scaleX: (img.naturalWidth || 1920) / state.canvas.width,
                    scaleY: (img.naturalHeight || 1080) / state.canvas.height
                };
                state.media.push(item);
                state.media.sort((a, b) => a.id - b.id);
                selectedMediaId = item.id;
                if (typeof StateStorage !== "undefined") {
                    StateStorage.saveMediaAsset(item, file);
                    StateStorage.scheduleSave();
                }
                buildSources();
                AppUI.refresh("mediaAdded");
                AppUI.toast(`Imported still "${file.name}" into Slot ${id + 1}`, "ok");
            };
            img.src = url;
        });
    }

    function render(container) {
        const esc = AppUI.esc;
        const profile = getProfile() || {};
        const assets = getAvailableStills();
        const mpCount = profile.mediaPlayers || 1;
        const stillCount = assets.filter(a => a.kind !== "video").length;
        const clipCount = assets.filter(a => a.kind === "video").length;

        container.innerHTML = `
            <div class="routing-view">
                <div class="subbar">
                    <div class="field-row">
                        <span class="section-label">Media Pool · ${stillCount} Still${stillCount === 1 ? "" : "s"} · ${clipCount} Video Clip${clipCount === 1 ? "" : "s"}</span>
                    </div>
                    <div class="field-row">
                        <button class="btn btn-sm btn-primary" id="btnMediaUpload">+ Import Stills / Clips</button>
                        <input type="file" id="inpMediaFiles" accept="image/*,video/*" multiple style="display:none;">
                    </div>
                </div>

                <div class="split-2col" style="grid-template-columns:1fr 340px;">
                    <div class="pane pane-dark">
                        <div class="pane-body">
                            <div class="dropzone" id="mediaDropzone">
                                Drop <strong>Still Images</strong> (PNG / JPG / WebP) or <strong>Video Clips</strong> (MP4 / WebM / MOV) here — or click to browse
                            </div>
                            <div class="media-grid">
                                ${assets.map(st => {
                                    const isVid = st.kind === "video";
                                    const thumbSrc = isVid ? (st.posterUrl || "") : (st.url || "");
                                    return `
                                        <div class="media-card ${st.id === selectedMediaId ? "selected" : ""}" data-mid="${st.id}">
                                            <div class="media-thumb-box" style="position:relative;">
                                                ${thumbSrc
                                                    ? `<img src="${esc(thumbSrc)}" alt="${esc(st.name)}">`
                                                    : (isVid ? `<span class="badge cyan">🎬 VIDEO CLIP</span>` : `<span class="muted" style="font-size:11px;">Placeholder</span>`)}
                                                <span class="badge ${isVid ? "amber" : ""}" style="position:absolute; top:6px; left:6px;">
                                                    ${isVid ? `CLIP ${fmtDuration(st.duration)}` : "STILL"}
                                                </span>
                                            </div>
                                            <div class="media-card-meta">
                                                <div class="field-row" style="justify-content:space-between;">
                                                    <span class="badge">Slot ${st.id + 1}</span>
                                                    <div class="field-row" style="gap:3px;">
                                                        ${isVid ? `
                                                            <button class="btn btn-xs ${st.playing !== false ? "btn-pvw" : ""}" data-vplay="${st.id}" title="Play / Pause Clip">${st.playing !== false ? "⏸" : "▶"}</button>
                                                            <button class="btn btn-xs ${st.loop !== false ? "btn-accent-soft" : ""}" data-vloop="${st.id}" title="Toggle Loop">🔁</button>
                                                        ` : ""}
                                                        <button class="btn btn-xs btn-danger-text" data-mdel="${st.id}" title="Delete asset">✕</button>
                                                    </div>
                                                </div>
                                                <div style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(st.name)}">
                                                    ${esc(st.name)}
                                                </div>
                                                <div class="field-row" style="gap:4px; flex-wrap:wrap;">
                                                    ${Array.from({ length: mpCount }, (_, m) => `
                                                        <button class="btn btn-xs ${state.mediaPlayers?.[m]?.mediaId === st.id ? "btn-accent-soft" : ""}" data-assign-mp="${m}" data-assign-id="${st.id}">
                                                            → MP${m + 1}
                                                        </button>
                                                    `).join("")}
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join("") || `<div class="muted" style="font-size:12px;">No stills or video clips imported yet.</div>`}
                            </div>
                        </div>
                    </div>

                    <div class="pane">
                        <div class="pane-head"><span class="section-label">Media Players & Color Generators</span></div>
                        <div class="pane-body">
                            ${Array.from({ length: mpCount }, (_, m) => {
                                const mp = state.mediaPlayers[m] || { id: m + 1, mediaId: null };
                                const asset = assets.find(s => s.id === mp.mediaId);
                                const isVid = asset?.kind === "video";
                                return `
                                    <div class="card" style="padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
                                        <div class="field-row" style="justify-content:space-between;">
                                            <strong>Media Player ${m + 1}</strong>
                                            <span class="badge ${asset ? (isVid ? "amber" : "cyan") : ""}">
                                                ${asset ? `${isVid ? "CLIP" : "STILL"} #${asset.id + 1}` : "Empty"}
                                            </span>
                                        </div>
                                        <select data-mp-sel="${m}">
                                            <option value="">Empty (Placeholder Graphic)</option>
                                            ${assets.map(s => `<option value="${s.id}" ${mp.mediaId === s.id ? "selected" : ""}>[${s.kind === "video" ? "CLIP" : "STILL"}] Slot ${s.id + 1} — ${esc(s.name)}</option>`).join("")}
                                        </select>
                                        ${isVid ? `
                                            <div class="field-row" style="gap:6px;">
                                                <button class="btn btn-xs ${asset.playing !== false ? "btn-pvw solid" : ""}" data-vplay="${asset.id}" style="flex:1;">
                                                    ${asset.playing !== false ? "⏸ Pause Clip" : "▶ Play Clip"}
                                                </button>
                                                <button class="btn btn-xs ${asset.loop !== false ? "btn-accent-soft" : ""}" data-vloop="${asset.id}">
                                                    ${asset.loop !== false ? "🔁 Loop On" : "Loop Off"}
                                                </button>
                                                <button class="btn btn-xs" data-vrew="${asset.id}" title="Restart from 0:00">⏮</button>
                                            </div>
                                        ` : ""}
                                    </div>
                                `;
                            }).join("")}

                            <div style="padding-top:12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:10px;">
                                <span class="section-label">Color Generators</span>
                                <div class="field-row" style="justify-content:space-between; padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                    <span>Color Generator 1</span>
                                    <input type="color" id="medColor1" value="${esc(state.generators?.color1 || "#ffffff")}">
                                </div>
                                <div class="field-row" style="justify-content:space-between; padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                    <span>Color Generator 2</span>
                                    <input type="color" id="medColor2" value="${esc(state.generators?.color2 || "#00ff00")}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const fileIn = container.querySelector("#inpMediaFiles");
        container.querySelector("#btnMediaUpload")?.addEventListener("click", () => fileIn.click());
        fileIn?.addEventListener("change", (e) => ingestFiles(e.target.files));

        const dz = container.querySelector("#mediaDropzone");
        dz?.addEventListener("click", () => fileIn.click());
        dz?.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
        dz?.addEventListener("dragleave", () => dz.classList.remove("dragover"));
        dz?.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("dragover"); ingestFiles(e.dataTransfer.files); });

        container.querySelectorAll("[data-mid]").forEach(card => {
            card.addEventListener("click", () => { selectedMediaId = Number(card.dataset.mid); render(container); });
        });
        container.querySelectorAll("[data-vplay]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const item = state.media.find(m => m.id === Number(btn.dataset.vplay));
                if (!item) return;
                item.playing = item.playing === false;
                if (item._video) {
                    if (item.playing) item._video.play().catch(() => {});
                    else item._video.pause();
                }
                AppUI.renderLiveTick();
                render(container);
            });
        });
        container.querySelectorAll("[data-vloop]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const item = state.media.find(m => m.id === Number(btn.dataset.vloop));
                if (!item) return;
                item.loop = item.loop === false;
                if (item._video) item._video.loop = item.loop;
                render(container);
            });
        });
        container.querySelectorAll("[data-vrew]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const item = state.media.find(m => m.id === Number(btn.dataset.vrew));
                if (item?._video) { item._video.currentTime = 0; AppUI.renderLiveTick(); }
            });
        });
        container.querySelectorAll("[data-mdel]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.mdel);
                const idx = state.media.findIndex(m => m.id === id);
                if (idx >= 0) {
                    if (state.media[idx]._video) { try { state.media[idx]._video.pause(); } catch {} }
                    if (state.media[idx].url?.startsWith("blob:")) URL.revokeObjectURL(state.media[idx].url);
                    state.media.splice(idx, 1);
                    state.mediaPlayers.forEach(mp => { if (mp.mediaId === id) mp.mediaId = null; });
                    StateStorage.deleteMediaAsset(id);
                    StateStorage.scheduleSave();
                    buildSources();
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-assign-mp]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                SwitcherEngine.setMediaPlayerSlot(Number(btn.dataset.assignMp), Number(btn.dataset.assignId));
                render(container);
            });
        });
        container.querySelectorAll("[data-mp-sel]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const val = e.target.value === "" ? null : Number(e.target.value);
                SwitcherEngine.setMediaPlayerSlot(Number(sel.dataset.mpSel), val);
                render(container);
            });
        });
        container.querySelector("#medColor1")?.addEventListener("input", (e) => SwitcherEngine.setGeneratorColor("color1", e.target.value));
        container.querySelector("#medColor2")?.addEventListener("input", (e) => SwitcherEngine.setGeneratorColor("color2", e.target.value));
    }

    return { render };
})();
