// =========================================================================
// TRANSITION COMPOSITOR (js/renderer/transitions.js)
// Mix, Dip, Wipe (18 ATEM patterns) & DVE transitions between PGM & PVW.
// =========================================================================

export function compositeTransition(targetCanvas, pgmCanvas, pvwCanvas, progress, style = "Mix", params = {}, deps = {}) {
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    const p = Math.max(0, Math.min(1, progress));
    const ctx = targetCanvas.getContext("2d");

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    switch (style) {
        case "Dip": {
            // Render actual configured Dip Source (Color 1/2, Black, Media, Input, etc.)
            const dipId = params?.dipSource ?? "";
            const dipSrc = dipId ? getSourceById(dipId) : null;
            const { acquireCanvas, releaseCanvas, renderSourceRaster } = deps;
            if (dipSrc && acquireCanvas && releaseCanvas && renderSourceRaster) {
                const dipEntry = acquireCanvas(w, h, false);
                try {
                    renderSourceRaster(dipSrc, dipEntry.canvas, []);
                    ctx.drawImage(dipEntry.canvas, 0, 0, w, h);
                } finally {
                    releaseCanvas(dipEntry);
                }
            } else {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, w, h);
            }

            if (p < 0.5) {
                ctx.globalAlpha = 1 - (p * 2);
                ctx.drawImage(pgmCanvas, 0, 0, w, h);
            } else {
                ctx.globalAlpha = (p - 0.5) * 2;
                ctx.drawImage(pvwCanvas, 0, 0, w, h);
            }
            break;
        }
        case "Wipe": {
            const pattern = params?.wipePattern || "LeftToRightBar";
            const rev = !!params?.wipeReverse;
            const prog = rev ? (1 - p) : p;
            const baseImg = rev ? pvwCanvas : pgmCanvas;
            const revealImg = rev ? pgmCanvas : pvwCanvas;

            ctx.drawImage(baseImg, 0, 0, w, h);
            if (prog > 0) {
                ctx.beginPath();
                if (pattern === "TopToBottomBar") {
                    ctx.rect(0, 0, w, Math.round(h * prog));
                } else if (pattern === "HorizontalBarnDoor") {
                    const rw = w * prog;
                    ctx.rect((w - rw) / 2, 0, rw, h);
                } else if (pattern === "VerticalBarnDoor") {
                    const rh = h * prog;
                    ctx.rect(0, (h - rh) / 2, w, rh);
                } else if (pattern === "CornersInFourBox") {
                    const bw = (w / 2) * prog;
                    const bh = (h / 2) * prog;
                    ctx.rect(0, 0, bw, bh);
                    ctx.rect(w - bw, 0, bw, bh);
                    ctx.rect(0, h - bh, bw, bh);
                    ctx.rect(w - bw, h - bh, bw, bh);
                } else if (pattern === "RectangleIris") {
                    const rw = w * prog;
                    const rh = h * prog;
                    ctx.rect((w - rw) / 2, (h - rh) / 2, rw, rh);
                } else if (pattern === "DiamondIris") {
                    const rx = w * prog;
                    const ry = h * prog;
                    ctx.moveTo(w / 2, h / 2 - ry);
                    ctx.lineTo(w / 2 + rx, h / 2);
                    ctx.lineTo(w / 2, h / 2 + ry);
                    ctx.lineTo(w / 2 - rx, h / 2);
                    ctx.closePath();
                } else if (pattern === "CircleIris") {
                    const maxR = Math.hypot(w / 2, h / 2);
                    ctx.arc(w / 2, h / 2, maxR * prog, 0, Math.PI * 2);
                } else if (pattern === "TopLeftBox") {
                    ctx.rect(0, 0, w * prog, h * prog);
                } else if (pattern === "TopRightBox") {
                    const bw = w * prog;
                    ctx.rect(w - bw, 0, bw, h * prog);
                } else if (pattern === "BottomRightBox") {
                    const bw = w * prog, bh = h * prog;
                    ctx.rect(w - bw, h - bh, bw, bh);
                } else if (pattern === "BottomLeftBox") {
                    const bh = h * prog;
                    ctx.rect(0, h - bh, w * prog, bh);
                } else if (pattern === "TopCentreBox") {
                    const bw = w * prog;
                    ctx.rect((w - bw) / 2, 0, bw, h * prog);
                } else if (pattern === "RightCentreBox") {
                    const bw = w * prog, bh = h * prog;
                    ctx.rect(w - bw, (h - bh) / 2, bw, bh);
                } else if (pattern === "BottomCentreBox") {
                    const bw = w * prog, bh = h * prog;
                    ctx.rect((w - bw) / 2, h - bh, bw, bh);
                } else if (pattern === "LeftCentreBox") {
                    const bh = h * prog;
                    ctx.rect(0, (h - bh) / 2, w * prog, bh);
                } else if (pattern === "TopLeftDiagonal") {
                    const d = (w + h) * prog;
                    ctx.moveTo(0, 0);
                    ctx.lineTo(d, 0);
                    ctx.lineTo(0, d);
                    ctx.closePath();
                } else if (pattern === "TopRightDiagonal") {
                    const d = (w + h) * prog;
                    ctx.moveTo(w, 0);
                    ctx.lineTo(w, d);
                    ctx.lineTo(w - d, 0);
                    ctx.closePath();
                } else {
                    ctx.rect(0, 0, Math.round(w * prog), h);
                }
                ctx.clip();
                ctx.drawImage(revealImg, 0, 0, w, h);
            }
            break;
        }
        case "DVE": {
            const rawEff = params?.dveEffect || "PushRight";
            const effAlias = { PushUp: "PushTop", PushDown: "PushBottom", RevealRight: "SwooshRight" };
            const effect = effAlias[rawEff] || rawEff;
            const rev = !!params?.dveReverse;
            const prog = rev ? (1 - p) : p;

            if (effect.startsWith("Push")) {
                let dx = 1, dy = 0;
                if (effect.includes("Left")) dx = -1;
                else if (effect.includes("Right")) dx = 1;
                else dx = 0;
                if (effect.includes("Top")) dy = -1;
                else if (effect.includes("Bottom")) dy = 1;
                else dy = 0;
                const ox = Math.round(w * prog * dx);
                const oy = Math.round(h * prog * dy);
                ctx.drawImage(pgmCanvas, ox, oy, w, h);
                ctx.drawImage(pvwCanvas, ox - dx * w, oy - dy * h, w, h);
            } else if (effect.startsWith("Squeeze")) {
                const remW = Math.max(0.001, effect.includes("Left") || effect.includes("Right") || effect.includes("Corner") || /Top|Bottom/.test(effect) ? w * (1 - prog) : w);
                const remH = Math.max(0.001, /Top|Bottom/.test(effect) && !(effect === "SqueezeLeft" || effect === "SqueezeRight") ? h * (1 - prog) : h);
                const sx = effect.includes("Right") ? (w - remW) : 0;
                const sy = effect.includes("Bottom") ? (h - remH) : 0;
                ctx.drawImage(pvwCanvas, 0, 0, w, h);
                if (prog < 1) ctx.drawImage(pgmCanvas, sx, sy, remW, remH);
            } else if (effect.startsWith("Spin") || effect === "GraphicCWSpin" || effect === "GraphicCCWSpin") {
                ctx.drawImage(pgmCanvas, 0, 0, w, h);
                const dir = effect.includes("CCW") ? -1 : 1;
                ctx.save();
                ctx.translate(w / 2, h / 2);
                ctx.rotate(dir * (1 - prog) * Math.PI * 2);
                ctx.scale(Math.max(0.02, prog), Math.max(0.02, prog));
                ctx.drawImage(pvwCanvas, -w / 2, -h / 2, w, h);
                ctx.restore();
            } else {
                // Swoosh & Graphic wipes: slide incoming frame across outgoing frame
                let dx = 1, dy = 0;
                if (effect.includes("Left")) dx = -1;
                else if (effect.includes("Right")) dx = 1;
                else dx = 0;
                if (effect.includes("Top")) dy = -1;
                else if (effect.includes("Bottom")) dy = 1;
                const ox = Math.round(w * (1 - prog) * dx);
                const oy = Math.round(h * (1 - prog) * dy);
                ctx.drawImage(pgmCanvas, 0, 0, w, h);
                ctx.drawImage(pvwCanvas, ox, oy, w, h);
            }
            break;
        }
        case "Mix":
        default: {
            ctx.drawImage(pgmCanvas, 0, 0, w, h);
            ctx.globalAlpha = p;
            ctx.drawImage(pvwCanvas, 0, 0, w, h);
            break;
        }
    }

    ctx.restore();
}
