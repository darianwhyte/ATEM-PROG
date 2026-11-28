// =========================================================================
// CANVAS COMPOSITOR & RENDER COORDINATOR (js/canvas-renderer.js)
// Core offscreen pool, source generators, USK/DSK/ME/SuperSource compositing.
// =========================================================================

import { applyLumaKey, applyLinearKey, applyChromaKey, applyPatternKey } from "./renderer/keyers.js";
import { compositeTransition as compositeTransitionRaw } from "./renderer/transitions.js";
import {
    getActiveMediaPlayerClips,
    getLiveProgramMediaClipIds,
    syncLiveMediaClips,
    controlMediaClip,
    drawMediaToCanvas,
    drawMediaKeyToCanvas
} from "./renderer/media-clips.js";

// =========================================================================
// PRIVATE OFFSCREEN CANVAS POOLS (Stack-safe for recursive M/E & SS draws)
// =========================================================================
const _canvasPool = [];

function acquireCanvas(width, height, willReadFrequently = false) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    let entry = null;

    for (let i = _canvasPool.length - 1; i >= 0; i--) {
        if (_canvasPool[i].willReadFrequently === willReadFrequently) {
            entry = _canvasPool.splice(i, 1)[0];
            break;
        }
    }

    if (!entry) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : undefined);
        entry = { canvas, ctx, willReadFrequently };
    }

    if (entry.canvas.width !== w || entry.canvas.height !== h) {
        entry.canvas.width = w;
        entry.canvas.height = h;
    } else {
        entry.ctx.clearRect(0, 0, w, h);
    }

    return entry;
}

function releaseCanvas(entry) {
    if (!entry) return;
    if (_canvasPool.length < 16) {
        _canvasPool.push(entry);
    }
}

const _rasterDeps = { acquireCanvas, releaseCanvas, renderSourceRaster };

// =========================================================================
// SOURCE GENERATORS & PLACEHOLDERS
// =========================================================================
function renderBlackSource(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderColorBars(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const topH = Math.round(h * (2 / 3));
    const midH = Math.round(h * (1 / 12));
    const botY = topH + midH;
    const botH = h - botY;

    // 1. Top 75% SMPTE Color Bars
    const topColors = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
    const barW = w / 7;
    for (let i = 0; i < 7; i++) {
        ctx.fillStyle = topColors[i];
        ctx.fillRect(Math.floor(i * barW), 0, Math.ceil(barW) + 1, topH);
    }

    // 2. Middle reverse castellated row
    const midColors = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];
    for (let i = 0; i < 7; i++) {
        ctx.fillStyle = midColors[i];
        ctx.fillRect(Math.floor(i * barW), topH, Math.ceil(barW) + 1, midH);
    }

    // 3. Bottom -I / White / +Q / Black / PLUGE strip
    const qW = w * (5 / 28);
    ctx.fillStyle = "#00214c"; ctx.fillRect(0, botY, Math.ceil(qW), botH);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.floor(qW), botY, Math.ceil(qW), botH);
    ctx.fillStyle = "#32006a"; ctx.fillRect(Math.floor(qW * 2), botY, Math.ceil(qW), botH);
    ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(qW * 3), botY, Math.ceil(qW), botH);

    const plugeX = qW * 4;
    const plugeW = (w - plugeX) / 2;
    const subW = plugeW / 3;
    ctx.fillStyle = "#090909"; ctx.fillRect(Math.floor(plugeX), botY, Math.ceil(subW), botH);
    ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(plugeX + subW), botY, Math.ceil(subW), botH);
    ctx.fillStyle = "#1d1d1d"; ctx.fillRect(Math.floor(plugeX + subW * 2), botY, Math.ceil(subW), botH);
    ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(plugeX + plugeW), botY, w - Math.floor(plugeX + plugeW), botH);
}

function renderGeneratorSource(source, canvas) {
    if (source?.id === "bars") {
        renderColorBars(canvas);
        return;
    }
    const ctx = canvas.getContext("2d");
    let color = "#000000";
    if (source) {
        if (source.id === "color1" || source.id === "color1Key") {
            color = state.generators?.color1 || state.colors?.find(c => c.id === "color1")?.color || "#ffffff";
        } else if (source.id === "color2" || source.id === "color2Key") {
            color = state.generators?.color2 || state.colors?.find(c => c.id === "color2")?.color || "#00ff00";
        }
    }
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

function renderThumbnailSource(input, canvas) {
    const ctx = canvas.getContext("2d");
    if (!input || !input.thumbnailImage) return;
    ctx.drawImage(input.thumbnailImage, 0, 0, canvas.width, canvas.height);
}

function renderExternalPlaceholder(source, canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const ch = Number(source?.resourceId) || 1;
    const hues = [205, 165, 255, 32, 340, 190, 280, 140];
    const hue = hues[(ch - 1) % hues.length];

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hue}, 34%, 18%)`);
    grad.addColorStop(1, `hsl(${hue}, 26%, 10%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle studio grid crosshairs so scaling/cropping/masking is immediately visible
    ctx.save();
    ctx.strokeStyle = `hsla(${hue}, 70%, 65%, 0.14)`;
    ctx.lineWidth = Math.max(1, Math.round(w / 640));
    const step = Math.max(40, Math.round(w / 12));
    for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    ctx.strokeStyle = `hsla(${hue}, 80%, 62%, 0.45)`;
    ctx.lineWidth = Math.max(2, Math.round(w / 320));
    ctx.strokeRect(8, 8, w - 16, h - 16);

    const shortN = typeof getSourceShortName === "function" ? getSourceShortName(source.id) : `CAM${ch}`;
    const longN = typeof getSourceDisplayName === "function" ? getSourceDisplayName(source.id) : `Input ${ch}`;
    ctx.fillStyle = "#f1f5f9";
    ctx.font = `700 ${Math.round(h * 0.12)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortN, w / 2, h * 0.45);
    ctx.fillStyle = `hsl(${hue}, 85%, 78%)`;
    ctx.font = `600 ${Math.round(h * 0.055)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(longN, w / 2, h * 0.60);
    ctx.restore();
}

function renderEmptyMediaPlayerPlaceholder(source, canvas, isKeyChannel = false) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const mpNum = Number(source?.resourceId) || 1;
    const barX = Math.round(w * 0.08);
    const barY = Math.round(h * 0.72);
    const barW = Math.round(w * 0.56);
    const barH = Math.round(h * 0.16);
    const bugSize = Math.round(h * 0.11);

    if (isKeyChannel) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillRect(w - barX - bugSize, Math.round(h * 0.08), bugSize, bugSize);
        return;
    }

    ctx.clearRect(0, 0, w, h);
    // Translucent broadcast lower-third & corner bug test graphic (visible in USK/DSK without uploading PNGs!)
    ctx.fillStyle = "#0c4a6e";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(barX, barY, Math.max(8, Math.round(w * 0.01)), barH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(barH * 0.36)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`MEDIA PLAYER ${mpNum} · LOWER THIRD`, barX + Math.round(w * 0.025), barY + barH * 0.38);
    ctx.fillStyle = "#bae6fd";
    ctx.font = `500 ${Math.round(barH * 0.24)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(`Placeholder graphic (import PNG in Media Pool to replace)`, barX + Math.round(w * 0.025), barY + barH * 0.72);

    // Top-right corner bug
    ctx.fillStyle = "#0ea5e9";
    ctx.fillRect(w - barX - bugSize, Math.round(h * 0.08), bugSize, bugSize);
    ctx.fillStyle = "#04131d";
    ctx.font = `800 ${Math.round(bugSize * 0.34)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.fillText(`MP${mpNum}`, w - barX - bugSize / 2, Math.round(h * 0.08) + bugSize / 2);
}

// =========================================================================
// KEYER, M/E & SUPERSOURCE COMPOSITING
// =========================================================================
function getCropBounds(dve) {
    return {
        left: dve.cropEnabled ? dve.cropLeft / 18000 : 0,
        right: dve.cropEnabled ? dve.cropRight / 18000 : 0,
        top: dve.cropEnabled ? dve.cropTop / 18000 : 0,
        bottom: dve.cropEnabled ? dve.cropBottom / 18000 : 0
    };
}

const USK_ACCENTS = ["#38bdf8", "#4ade80", "#a78bfa", "#f472b6"];
const DSK_ACCENTS = ["#f59e0b", "#fb7185", "#2dd4bf", "#facc15"];
const KEYER_STACK_ALPHA = 0.82;

function formatKeyerSourceInfo(srcId) {
    if (!srcId) return "BLK (Unassigned)";
    const shortN = typeof getSourceShortName === "function" ? getSourceShortName(srcId) : srcId;
    const full = typeof getSourceDisplayName === "function" ? getSourceDisplayName(srcId) : srcId;
    if (!full || full === srcId || full.toUpperCase() === shortN.toUpperCase()) return shortN;
    const parenMatch = full.match(/\(([^)]+)\)/);
    const detail = parenMatch ? parenMatch[1].trim() : full;
    if (!detail || detail.toUpperCase() === shortN.toUpperCase()) return shortN;
    return `${shortN} · ${detail}`;
}

function drawKeyerOutline(ctx, rect, accent, targetWidth, dashed = false) {
    if (!rect || rect.w <= 1 || rect.h <= 1) return;
    const lw = Math.max(2, Math.round(targetWidth / 480));
    const inset = lw / 2;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = accent;
    ctx.lineWidth = lw;
    if (dashed) ctx.setLineDash([lw * 3, lw * 2]);
    ctx.strokeRect(
        rect.x + inset,
        rect.y + inset,
        Math.max(1, rect.w - lw),
        Math.max(1, rect.h - lw)
    );
    ctx.restore();
}

function drawKeyerNamingBox(ctx, badge, targetWidth, targetHeight) {
    const { rect, title, sourceText, accent, stackSlot = 0 } = badge;
    if (!rect || rect.w <= 8 || rect.h <= 8) return;

    const scale = Math.max(0.55, targetWidth / 960);
    const fontSize = Math.max(11, Math.round(13 * scale));
    const padX = Math.round(9 * scale);
    const padY = Math.round(5 * scale);
    const accentBarW = Math.max(3, Math.round(4 * scale));
    const margin = Math.round(8 * scale);
    const gap = Math.round(5 * scale);
    const boxH = fontSize + padY * 2;
    const radius = Math.max(3, Math.round(4 * scale));

    const prefix = `${title}: `;
    let label = `${prefix}${sourceText}`;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

    const maxBoxW = Math.max(80 * scale, Math.min(rect.w - margin * 2, targetWidth * 0.46));
    const maxTextW = Math.max(40, maxBoxW - padX * 2 - accentBarW - Math.round(4 * scale));
    if (ctx.measureText(label).width > maxTextW) {
        while (label.length > prefix.length + 2 && ctx.measureText(label + "…").width > maxTextW) {
            label = label.slice(0, -1);
        }
        label += "…";
    }

    const textW = ctx.measureText(label).width;
    const boxW = Math.min(maxBoxW, textW + padX * 2 + accentBarW + Math.round(4 * scale));

    // Anchor in the top-right corner of the layer's active footprint (clamped on-screen)
    const rightEdge = Math.min(targetWidth, rect.x + rect.w);
    const topEdge = Math.max(0, rect.y);
    const bx = Math.max(margin, rightEdge - boxW - margin);
    const by = Math.min(targetHeight - boxH - margin, topEdge + margin + stackSlot * (boxH + gap));

    // Rounded dark pill background (unaffected by keyer)
    ctx.fillStyle = "rgba(9, 13, 20, 0.90)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.25, 1.5 * scale);
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.lineTo(bx + boxW - radius, by);
    ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + radius);
    ctx.lineTo(bx + boxW, by + boxH - radius);
    ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - radius, by + boxH);
    ctx.lineTo(bx + radius, by + boxH);
    ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - radius);
    ctx.lineTo(bx, by + radius);
    ctx.quadraticCurveTo(bx, by, bx + radius, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Crisp color accent strip on left edge of badge
    ctx.fillStyle = accent;
    ctx.fillRect(bx + 1, by + 1, accentBarW, boxH - 2);

    // Label text (accent-colored prefix + bright source info)
    const textX = bx + accentBarW + padX;
    const textY = by + boxH / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const prefixW = ctx.measureText(prefix).width;
    ctx.fillStyle = accent;
    ctx.fillText(prefix, textX, textY);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(label.slice(prefix.length), textX + prefixW, textY);

    ctx.restore();
}

function compositeLayerOntoContext(targetCtx, targetWidth, targetHeight, layer, source, renderStack, opts = {}) {
    const isSSBox = isBoxLayer(layer);
    const needsPixelKey = !isSSBox && !!source && (layer.keyType === "luma" || layer.keyType === "linear" || layer.keyType === "chroma" || layer.keyType === "pattern");
    const layerEntry = acquireCanvas(targetWidth, targetHeight, needsPixelKey);

    try {
        const layerCanvas = layerEntry.canvas;
        const layerCtx = layerEntry.ctx;

        if (source) {
            renderSourceRaster(source, layerCanvas, renderStack);
            if (!isSSBox) {
                if (layer.keyType === "luma") applyLumaKey(layerCanvas, layer);
                else if (layer.keyType === "linear") applyLinearKey(layerCanvas, layer, renderStack, _rasterDeps);
                else if (layer.keyType === "chroma") applyChromaKey(layerCanvas, layer);
                else if (layer.keyType === "pattern") applyPatternKey(layerCanvas, layer);
            }
        } else {
            renderBlackSource(layerCanvas);
        }

        // Compute active mask bounds (naming box & outline stay unaffected by key)
        let maskFrac = { left: 0, right: 0, top: 0, bottom: 0 };
        if (layer.maskEnabled) {
            maskFrac = {
                left: Math.max(0, Math.min(1, (layer.maskLeft || 0) / 18000)),
                right: Math.max(0, Math.min(1, (layer.maskRight || 0) / 18000)),
                top: Math.max(0, Math.min(1, (layer.maskTop || 0) / 18000)),
                bottom: Math.max(0, Math.min(1, (layer.maskBottom || 0) / 18000))
            };
            const mLeft = maskFrac.left * layerCanvas.width;
            const mRight = maskFrac.right * layerCanvas.width;
            const mTop = maskFrac.top * layerCanvas.height;
            const mBottom = maskFrac.bottom * layerCanvas.height;
            const maskW = Math.max(0, layerCanvas.width - mLeft - mRight);
            const maskH = Math.max(0, layerCanvas.height - mTop - mBottom);
            layerCtx.save();
            layerCtx.globalCompositeOperation = "destination-in";
            layerCtx.fillStyle = "#ffffff";
            layerCtx.fillRect(mLeft, mTop, maskW, maskH);
            layerCtx.restore();
        }

        const canvasPos = atemToCanvas(layer);

        const drawX = (canvasPos.left / 100) * targetWidth;
        const drawY = (canvasPos.top / 100) * targetHeight;
        const drawW = (canvasPos.width / 100) * targetWidth;
        const drawH = (canvasPos.height / 100) * targetHeight;

        const visualSettings = getVisualSettings(layer) || layer;
        const crop = getCropBounds(visualSettings);

        const croppedX = drawX + (drawW * crop.left);
        const croppedY = drawY + (drawH * crop.top);
        const croppedW = drawW * (1 - crop.left - crop.right);
        const croppedH = drawH * (1 - crop.top - crop.bottom);
        const sourceX = layerCanvas.width * crop.left;
        const sourceY = layerCanvas.height * crop.top;
        const sourceW = layerCanvas.width * (1 - crop.left - crop.right);
        const sourceH = layerCanvas.height * (1 - crop.top - crop.bottom);

        if (sourceW > 0 && sourceH > 0 && croppedW > 0 && croppedH > 0) {
            targetCtx.save();
            if (!isSSBox) {
                targetCtx.globalAlpha = source ? KEYER_STACK_ALPHA : 0.35;
            } else if (typeof layer._animAlpha === "number") {
                targetCtx.globalAlpha = Math.max(0, Math.min(1, layer._animAlpha));
            }
            targetCtx.drawImage(layerCanvas, sourceX, sourceY, sourceW, sourceH, croppedX, croppedY, croppedW, croppedH);
            targetCtx.restore();

            const allowBorder = isSSBox ? !!getProfile()?.supportsBoxBorders : true;
            if (allowBorder && visualSettings.borderEnabled && visualSettings.borderWidth > 0) {
                targetCtx.save();
                targetCtx.strokeStyle = visualSettings.borderColor || "#ffffff";
                targetCtx.lineWidth = visualSettings.borderWidth;
                targetCtx.strokeRect(croppedX, croppedY, croppedW, croppedH);
                targetCtx.restore();
            }

            // For M/E USK layers, draw a crisp layout outline and queue the top-right naming box
            if (!isSSBox) {
                const uskIdx = Number.isInteger(opts.uskIndex) ? opts.uskIndex : 0;
                const accent = USK_ACCENTS[uskIdx % USK_ACCENTS.length];
                const visRect = layer.maskEnabled
                    ? {
                        x: croppedX + croppedW * maskFrac.left,
                        y: croppedY + croppedH * maskFrac.top,
                        w: Math.max(0, croppedW * (1 - maskFrac.left - maskFrac.right)),
                        h: Math.max(0, croppedH * (1 - maskFrac.top - maskFrac.bottom))
                    }
                    : { x: croppedX, y: croppedY, w: croppedW, h: croppedH };

                drawKeyerOutline(targetCtx, visRect, accent, targetWidth, !source);
                if (Array.isArray(opts.badges)) {
                    opts.badges.push({
                        rect: visRect,
                        title: `USK ${uskIdx + 1}`,
                        sourceText: formatKeyerSourceInfo(layer.source),
                        accent
                    });
                }
            }
        }
    } finally {
        releaseCanvas(layerEntry);
    }
}

function getDSKEffectiveAlpha(dsk, isPreview = false) {
    if (!dsk) return 0;

    if (isPreview) {
        const stagedOn = dsk.enabled !== !!dsk.tie;
        return stagedOn ? 1 : 0;
    }

    const prog = dsk.transitionProgress || 0;
    if (prog > 0 && prog < 1) {
        return dsk.enabled ? (1 - prog) : prog;
    }

    return dsk.enabled ? 1 : 0;
}

function compositeDSKLayer(targetCtx, targetWidth, targetHeight, dsk, alpha, renderStack, badges = null) {
    if (!dsk || alpha <= 0) return;
    const source = getSourceById(dsk.source);
    const dskIdx = Number.isInteger(dsk.id) ? dsk.id : 0;
    const accent = DSK_ACCENTS[dskIdx % DSK_ACCENTS.length];

    const dskEntry = acquireCanvas(targetWidth, targetHeight, !!source);
    try {
        const dskCanvas = dskEntry.canvas;
        const dskCtx = dskEntry.ctx;

        if (source) {
            renderSourceRaster(source, dskCanvas, renderStack);
            const mode = getDSKMode(dsk);
            if (mode === "luma") applyLumaKey(dskCanvas, dsk);
            else if (mode === "linear") applyLinearKey(dskCanvas, dsk, renderStack, _rasterDeps);
        } else {
            renderBlackSource(dskCanvas);
        }

        let maskFrac = { left: 0, right: 0, top: 0, bottom: 0 };
        if (dsk.maskEnabled) {
            maskFrac = {
                left: Math.max(0, Math.min(1, (dsk.maskLeft || 0) / 18000)),
                right: Math.max(0, Math.min(1, (dsk.maskRight || 0) / 18000)),
                top: Math.max(0, Math.min(1, (dsk.maskTop || 0) / 18000)),
                bottom: Math.max(0, Math.min(1, (dsk.maskBottom || 0) / 18000))
            };
            const mLeft = maskFrac.left * dskCanvas.width;
            const mRight = maskFrac.right * dskCanvas.width;
            const mTop = maskFrac.top * dskCanvas.height;
            const mBottom = maskFrac.bottom * dskCanvas.height;
            const maskW = Math.max(0, dskCanvas.width - mLeft - mRight);
            const maskH = Math.max(0, dskCanvas.height - mTop - mBottom);
            dskCtx.save();
            dskCtx.globalCompositeOperation = "destination-in";
            dskCtx.fillStyle = "#ffffff";
            dskCtx.fillRect(mLeft, mTop, maskW, maskH);
            dskCtx.restore();
        }

        targetCtx.save();
        targetCtx.globalAlpha = alpha * (source ? KEYER_STACK_ALPHA : 0.35);
        targetCtx.drawImage(dskCanvas, 0, 0, targetWidth, targetHeight);
        targetCtx.restore();

        const visRect = dsk.maskEnabled
            ? {
                x: targetWidth * maskFrac.left,
                y: targetHeight * maskFrac.top,
                w: Math.max(0, targetWidth * (1 - maskFrac.left - maskFrac.right)),
                h: Math.max(0, targetHeight * (1 - maskFrac.top - maskFrac.bottom))
            }
            : { x: 0, y: 0, w: targetWidth, h: targetHeight };

        drawKeyerOutline(targetCtx, visRect, accent, targetWidth, !source);
        if (Array.isArray(badges)) {
            badges.push({
                rect: visRect,
                title: `DSK ${dskIdx + 1}`,
                sourceText: formatKeyerSourceInfo(dsk.source),
                accent
            });
        }
    } finally {
        releaseCanvas(dskEntry);
    }
}

function compositeDownstreamKeyers(targetCtx, targetWidth, targetHeight, isPreview = false, renderStack = [], badges = null) {
    const dsks = getAvailableDSKs();
    for (let i = 0; i < dsks.length; i++) {
        const dsk = dsks[i];
        const alpha = getDSKEffectiveAlpha(dsk, isPreview);
        if (alpha > 0) {
            compositeDSKLayer(targetCtx, targetWidth, targetHeight, dsk, alpha, renderStack, badges);
        }
    }
}

function renderMEToCanvas(source, targetCanvas, renderStack = []) {
    const meIndex = parseInt(source.id.replace("me", ""), 10) - 1;
    const workspace = state.workspaces.find(w => w.type === "me" && w.resourceId === meIndex);

    if (!workspace) {
        renderBlackSource(targetCanvas);
        return false;
    }

    const meEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, false);
    try {
        const meCanvas = meEntry.canvas;
        const meCtx = meEntry.ctx;

        const bgSource = getSourceById(workspace.data.source);

        if (bgSource) {
            if (bgSource.type === SourceTypes.GENERATOR) renderGeneratorSource(bgSource, meCanvas);
            else renderSourceRaster(bgSource, meCanvas, renderStack);
        } else {
            renderBlackSource(meCanvas);
        }

        const badges = [];
        if (workspace.data.usk) {
            const maxUsks = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
            workspace.data.usk.slice(0, maxUsks).forEach((layer, uskIdx) => {
                if (!layer.enabled) return;
                const layerSource = getSourceById(layer.source);
                compositeLayerOntoContext(meCtx, targetCanvas.width, targetCanvas.height, layer, layerSource, renderStack, {
                    uskIndex: uskIdx,
                    badges
                });
            });
        }

        // Downstream Keyers sit downstream of M/E 1 output on ATEM switchers
        if (meIndex === 0) {
            compositeDownstreamKeyers(meCtx, targetCanvas.width, targetCanvas.height, !!source._preview, renderStack, badges);
        }

        // Draw crisp top-right USK/DSK naming boxes above all layers (unaffected by keying/translucency),
        // stacking full-frame badges neatly downward so stacked layers never collide.
        let cornerStack = 0;
        badges.forEach(badge => {
            const r = badge.rect;
            const isTopRightCorner = (r.x + r.w >= targetCanvas.width * 0.92) && (r.y <= targetCanvas.height * 0.08);
            badge.stackSlot = isTopRightCorner ? cornerStack++ : 0;
            drawKeyerNamingBox(meCtx, badge, targetCanvas.width, targetCanvas.height);
        });

        // Fade to Black (FTB) sits after everything on Program output
        if (!source._preview && workspace.data.ftb) {
            const ftbAlpha = workspace.data.ftb.progress > 0
                ? workspace.data.ftb.progress
                : (workspace.data.ftb.enabled ? 1 : 0);
            if (ftbAlpha > 0) {
                meCtx.save();
                meCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, Math.max(0, ftbAlpha))})`;
                meCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
                meCtx.restore();
            }
        }

        const targetCtx = targetCanvas.getContext("2d");
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        targetCtx.drawImage(meCanvas, 0, 0);
    } finally {
        releaseCanvas(meEntry);
    }

    return true;
}

function renderSuperSourceArtLayer(data, targetCanvas, renderStack) {
    const artSource = getSourceById(data.artSource);
    if (!artSource) return false;

    const isForeground = data.artPlace === "Foreground";
    const artEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, isForeground);
    try {
        const artCanvas = artEntry.canvas;

        if (artSource.type === SourceTypes.GENERATOR) {
            renderGeneratorSource(artSource, artCanvas);
        } else {
            renderSourceRaster(artSource, artCanvas, renderStack);
        }

        if (isForeground) {
            const keySrcId = data.artKeySource || data.artSource;
            const isSelfLuma = !data.artKeySource || data.artKeySource === data.artSource;

            if (isSelfLuma) {
                applyLumaKey(artCanvas, {
                    keySettings: {
                        luma: {
                            clip: data.artClip ?? 50,
                            gain: data.artGain ?? 50,
                            invert: !!data.artInvert
                        }
                    }
                });
            } else {
                applyLinearKey(artCanvas, {
                    keySettings: {
                        linear: {
                            keySource: keySrcId,
                            premultiplied: !!data.artPremultiplied,
                            clip: data.artClip ?? 50,
                            gain: data.artGain ?? 50,
                            invert: !!data.artInvert
                        }
                    }
                }, renderStack, _rasterDeps);
            }
        }

        targetCanvas.getContext("2d").drawImage(artCanvas, 0, 0);
    } finally {
        releaseCanvas(artEntry);
    }
    return true;
}

function renderSuperSourceToCanvas(source, targetCanvas, renderStack = []) {
    const ssIndex = parseInt(source.id.replace("superSource", ""), 10) - 1;
    const workspace = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssIndex);

    if (!workspace) {
        renderBlackSource(targetCanvas);
        return false;
    }

    const ssEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, false);
    try {
        const ssCanvas = ssEntry.canvas;
        const ssCtx = ssEntry.ctx;
        renderBlackSource(ssCanvas);

        const isForegroundArt = workspace.data.artPlace === "Foreground";

        // 1. Background Art (drawn underneath Boxes 1–4)
        if (!isForegroundArt && workspace.data.artSource) {
            renderSuperSourceArtLayer(workspace.data, ssCanvas, renderStack);
        }

        // 2. Boxes 4 -> 1 (Box 4 at bottom, Box 1 topmost matching Blackmagic ATEM hardware)
        if (workspace.data.boxes) {
            for (let i = workspace.data.boxes.length - 1; i >= 0; i--) {
                const box = workspace.data.boxes[i];
                if (!box?.enabled) continue;
                const boxSource = getSourceById(box.source);
                if (!boxSource) continue;
                compositeLayerOntoContext(ssCtx, targetCanvas.width, targetCanvas.height, box, boxSource, renderStack);
            }
        }

        // 3. Foreground Art (keyed on top of Boxes 1–4)
        if (isForegroundArt && workspace.data.artSource) {
            renderSuperSourceArtLayer(workspace.data, ssCanvas, renderStack);
        }

        const targetCtx = targetCanvas.getContext("2d");
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        targetCtx.drawImage(ssCanvas, 0, 0);
    } finally {
        releaseCanvas(ssEntry);
    }
    return true;
}

function renderSourceRaster(source, targetCanvas, renderStack = []) {
    if (!source) {
        if (renderStack.length === 0) renderBlackSource(targetCanvas);
        return false;
    }

    const recursionKey = `${source.type}:${source.id}`;
    if (renderStack.includes(recursionKey)) {
        if (renderStack.length === 0) renderBlackSource(targetCanvas);
        return false;
    }

    renderStack.push(recursionKey);

    if (source.type === SourceTypes.GENERATOR) {
        renderGeneratorSource(source, targetCanvas);
        renderStack.pop();
        return true;
    }

    if (source.type === SourceTypes.EXTERNAL) {
        if (typeof LiveVideoManager !== "undefined" && LiveVideoManager.isActive) {
            if (LiveVideoManager.drawInputToCanvas(source.resourceId, targetCanvas)) {
                renderStack.pop();
                return true;
            }
        }
        const input = state.inputs[source.resourceId];
        if (input && input.thumbnail) {
            renderThumbnailSource(input, targetCanvas);
            renderStack.pop();
            return true;
        }

        renderExternalPlaceholder(source, targetCanvas);
        renderStack.pop();
        return true;
    }

    if (source.type === SourceTypes.MEDIA_PLAYER) {
        const media = getMediaPlayerAsset(source.resourceId);
        if (!media) {
            renderEmptyMediaPlayerPlaceholder(source, targetCanvas, false);
            renderStack.pop();
            return true;
        }
        drawMediaToCanvas(targetCanvas, media);
        renderStack.pop();
        return true;
    }

    if (source.type === SourceTypes.MEDIA_PLAYER_KEY) {
        const media = getMediaPlayerAsset(source.resourceId);
        if (!media) {
            renderEmptyMediaPlayerPlaceholder(source, targetCanvas, true);
            renderStack.pop();
            return true;
        }
        drawMediaKeyToCanvas(targetCanvas, media);
        renderStack.pop();
        return true;
    }

    if (source.type === SourceTypes.ME) {
        const result = renderMEToCanvas(source, targetCanvas, renderStack);
        renderStack.pop();
        return result;
    }

    if (source.type === SourceTypes.SUPER_SOURCE) {
        const result = renderSuperSourceToCanvas(source, targetCanvas, renderStack);
        renderStack.pop();
        return result;
    }

    if (source.type === SourceTypes.OUTPUT) {
        const output = getOutputData(source.resourceId);
        const routedSource = getSourceById(output.source);
        const result = renderSourceRaster(routedSource, targetCanvas, renderStack);
        renderStack.pop();
        return result;
    }

    if (renderStack.length === 1) renderBlackSource(targetCanvas);
    renderStack.pop();
    return false;
}

function renderMEOutputs(meIndex, pvwCanvas, pgmCanvas) {
    const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === Number(meIndex));
    if (!ws) return;

    const meSrc = {
        type: SourceTypes.ME,
        id: `me${ws.resourceId + 1}`,
        resourceId: ws.resourceId,
        _preview: false
    };

    const origSource = ws.data.source;
    const origUskStates = ws.data.usk?.map(u => u.enabled) || [];
    const nt = ws.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
    const transProgress = ws.data.transitionProgress || 0;
    const isPrevTrans = !!ws.data.previewTransition;

    const renderTransitionTo = (destCanvas) => {
        const pgmEntry = acquireCanvas(destCanvas.width, destCanvas.height, false);
        const pvwEntry = acquireCanvas(destCanvas.width, destCanvas.height, false);
        try {
            meSrc._preview = false;
            renderSourceRaster(meSrc, pgmEntry.canvas, []);
            if (nt.bkgd) ws.data.source = ws.data.previewSource ?? origSource;
            ws.data.usk?.forEach((usk, idx) => {
                if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
            });
            meSrc._preview = true;
            renderSourceRaster(meSrc, pvwEntry.canvas, []);
            compositeTransition(destCanvas, pgmEntry.canvas, pvwEntry.canvas, transProgress, ws.data.transitionStyle, ws.data.transitionParams);
        } finally {
            ws.data.source = origSource;
            ws.data.usk?.forEach((usk, idx) => { usk.enabled = origUskStates[idx]; });
            releaseCanvas(pgmEntry);
            releaseCanvas(pvwEntry);
        }
    };

    // 1. Render Preview (shows live transition scrub when PREV TRANS is armed)
    if (pvwCanvas) {
        const ctx = pvwCanvas.getContext("2d");
        ctx.clearRect(0, 0, pvwCanvas.width, pvwCanvas.height);
        if (isPrevTrans && transProgress > 0 && transProgress < 1) {
            renderTransitionTo(pvwCanvas);
        } else {
            try {
                if (nt.bkgd) ws.data.source = ws.data.previewSource ?? origSource;
                ws.data.usk?.forEach((usk, idx) => {
                    if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
                });
                meSrc._preview = true;
                renderSourceRaster(meSrc, pvwCanvas, []);
            } finally {
                ws.data.source = origSource;
                ws.data.usk?.forEach((usk, idx) => { usk.enabled = origUskStates[idx]; });
            }
        }
    }

    // 2. Render Program (stays clean when PREV TRANS is active; blends when live transitioning)
    if (pgmCanvas) {
        const ctx = pgmCanvas.getContext("2d");
        ctx.clearRect(0, 0, pgmCanvas.width, pgmCanvas.height);
        if (!isPrevTrans && transProgress > 0 && transProgress < 1) {
            renderTransitionTo(pgmCanvas);
        } else {
            meSrc._preview = false;
            renderSourceRaster(meSrc, pgmCanvas, []);
        }
    }
}

function renderME(ctx, ws, opts = {}) {
    if (!ctx?.canvas || !ws) return;
    const origWsData = ws.data;
    const origDsks = state.dsks;
    if (opts.overrideWsData) ws.data = opts.overrideWsData;
    if (Array.isArray(opts.overrideDsks)) state.dsks = opts.overrideDsks;

    const forceUskIdx = Number.isInteger(opts.forceShowUskIndex) ? opts.forceShowUskIndex : -1;
    const forceDskIdx = Number.isInteger(opts.forceShowDskIndex) ? opts.forceShowDskIndex : -1;
    const uskArr = ws.data?.usk || [];
    const targetUsk = forceUskIdx >= 0 ? uskArr[forceUskIdx] : null;
    const origUskEnabled = targetUsk ? targetUsk.enabled : null;
    const targetDsk = (forceDskIdx >= 0 && ws.resourceId === 0) ? getDSK(forceDskIdx) : null;
    const origDskEnabled = targetDsk ? targetDsk.enabled : null;
    const origDskTie = targetDsk ? targetDsk.tie : null;

    try {
        if (targetUsk) {
            if (opts.mode === "preview") {
                const ntFlag = !!(ws.data?.nextTransition?.usk?.[forceUskIdx]);
                targetUsk.enabled = !ntFlag;
            } else {
                targetUsk.enabled = true;
            }
        }
        if (targetDsk) {
            targetDsk.enabled = true;
            if (opts.mode === "preview") targetDsk.tie = false;
        }

        if (opts.mode === "preview") {
            renderMEOutputs(ws.resourceId, ctx.canvas, null);
        } else {
            renderMEOutputs(ws.resourceId, null, ctx.canvas);
        }
    } finally {
        if (targetUsk && origUskEnabled !== null) targetUsk.enabled = origUskEnabled;
        if (targetDsk && origDskEnabled !== null) {
            targetDsk.enabled = origDskEnabled;
            targetDsk.tie = origDskTie;
        }
        ws.data = origWsData;
        state.dsks = origDsks;
    }
}

function renderSuperSource(ctx, ws, opts = {}) {
    if (!ctx?.canvas || !ws) return;
    const origWsData = ws.data;
    if (opts.overrideData) ws.data = opts.overrideData;
    const forceBoxIdx = Number.isInteger(opts.forceShowBoxIndex) ? opts.forceShowBoxIndex : -1;
    const targetBox = forceBoxIdx >= 0 ? ws.data?.boxes?.[forceBoxIdx] : null;
    const origBoxEnabled = targetBox ? targetBox.enabled : null;

    try {
        if (targetBox) targetBox.enabled = true;
        const src = getSourceById(`superSource${ws.resourceId + 1}`) || {
            type: SourceTypes.SUPER_SOURCE,
            id: `superSource${ws.resourceId + 1}`,
            resourceId: ws.resourceId
        };
        renderSourceRaster(src, ctx.canvas, []);
    } finally {
        if (targetBox && origBoxEnabled !== null) targetBox.enabled = origBoxEnabled;
        ws.data = origWsData;
    }
}

function renderSource(ctx, sourceId) {
    if (!ctx?.canvas) return;
    const src = getSourceById(sourceId || "");
    if (src) renderSourceRaster(src, ctx.canvas, []);
    else renderBlackSource(ctx.canvas);
}

function compositeTransition(targetCanvas, pgmCanvas, pvwCanvas, progress, style = "Mix", params = {}) {
    compositeTransitionRaw(targetCanvas, pgmCanvas, pvwCanvas, progress, style, params, _rasterDeps);
}

const CanvasRenderer = {
    renderSourceRaster,
    renderMEOutputs,
    renderME,
    renderSuperSource,
    renderSource,
    compositeTransition,
    drawMediaKeyToCanvas,
    getLiveProgramMediaClipIds,
    syncLiveMediaClips,
    controlMediaClip,
    getActiveMediaPlayerClips
};

window.CanvasRenderer = CanvasRenderer;
export { CanvasRenderer };
export default CanvasRenderer;
