// =========================================================================
// KEYING MATH & PIXEL FILTERS (js/renderer/keyers.js)
// Single-pass pixel alpha compositing for Luma, Linear, Chroma & Pattern keys.
// =========================================================================

export function hexToRGB(hex) {
    if (typeof hex !== "string") return { r: 0, g: 255, b: 0 };
    const clean = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 0, g: 255, b: 0 };
    return {
        r: parseInt(clean.substring(0, 2), 16),
        g: parseInt(clean.substring(2, 4), 16),
        b: parseInt(clean.substring(4, 6), 16)
    };
}

export function featherAlpha(value, limit, softness) {
    if (softness <= 0) return value <= limit ? 1 : 0;
    const featherStart = limit - softness;
    if (value <= featherStart) return 1;
    if (value >= limit) return 0;
    return (limit - value) / softness;
}

export function applyLumaKey(mediaCanvas, layer) {
    const luma = layer.keySettings.luma;
    const clip = (luma.clip ?? 50) / 100;
    const gainSafe = Math.max(0.01, 1 - ((luma.gain ?? 50) / 100));
    const invGain = 1 / gainSafe;
    const invert = !!luma.invert;

    const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, mediaCanvas.width, mediaCanvas.height);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
        const origAlpha = pixels[i + 3];
        if (origAlpha === 0) continue;
        const luminance = (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
        let alpha = (luminance - clip) * invGain;
        if (alpha < 0) alpha = 0;
        else if (alpha > 1) alpha = 1;
        if (invert) alpha = 1 - alpha;
        pixels[i + 3] = Math.round(alpha * origAlpha);
    }

    ctx.putImageData(imageData, 0, 0);
}

export function applyLinearKey(mediaCanvas, layer, renderStack = [], deps = {}) {
    const linear = layer.keySettings?.linear;
    const keySourceId = linear?.keySource || layer.keySource;
    if (!linear || !keySourceId) return;

    const source = getSourceById(keySourceId);
    if (!source) return;

    const { acquireCanvas, releaseCanvas, renderSourceRaster } = deps;
    if (!acquireCanvas || !releaseCanvas || !renderSourceRaster) return;

    const w = mediaCanvas.width, h = mediaCanvas.height;
    const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
    const fillImageData = ctx.getImageData(0, 0, w, h);
    const fillPixels = fillImageData.data;

    const keyEntry = acquireCanvas(w, h, true);
    try {
        renderSourceRaster(source, keyEntry.canvas, renderStack);
        const keyPixels = keyEntry.ctx.getImageData(0, 0, w, h).data;

        if (linear.premultiplied) {
            const invert = !!linear.invert;
            for (let i = 0; i < keyPixels.length; i += 4) {
                const keyAlpha = keyPixels[i + 3] / 255;
                const luminance = (keyPixels[i] * 0.2126 + keyPixels[i + 1] * 0.7152 + keyPixels[i + 2] * 0.0722) / 255;
                let alpha = luminance * keyAlpha;
                if (invert) alpha = 1 - alpha;
                fillPixels[i + 3] = Math.round(alpha * 255);
            }
        } else {
            const clip = (linear.clip ?? 0) / 100;
            const invGain = 1 / Math.max(0.01, 1 - ((linear.gain ?? 0) / 100));
            const invert = !!linear.invert;

            for (let i = 0; i < keyPixels.length; i += 4) {
                const keyAlpha = keyPixels[i + 3] / 255;
                const luminance = ((keyPixels[i] * 0.2126 + keyPixels[i + 1] * 0.7152 + keyPixels[i + 2] * 0.0722) / 255) * keyAlpha;
                let alpha = (luminance - clip) * invGain;
                if (alpha < 0) alpha = 0;
                else if (alpha > 1) alpha = 1;
                if (invert) alpha = 1 - alpha;
                fillPixels[i + 3] = Math.round(alpha * 255);
            }
        }
    } finally {
        releaseCanvas(keyEntry);
    }

    ctx.putImageData(fillImageData, 0, 0);
}

export function applyChromaKey(mediaCanvas, layer) {
    const chroma = layer.keySettings.chroma;
    const target = hexToRGB(chroma.sampleColor);
    const targetY = 0.299 * target.r + 0.587 * target.g + 0.114 * target.b;
    const targetCb = target.b - targetY;
    const targetCr = target.r - targetY;

    const threshold = (chroma.spill ?? 50) / 100;
    const invGain = 1 / Math.max(0.01, (chroma.correction ?? 50) / 100);

    const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, mediaCanvas.width, mediaCanvas.height);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
        const origAlpha = pixels[i + 3];
        if (origAlpha === 0) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const dcb = (b - y) - targetCb;
        const dcr = (r - y) - targetCr;

        const distance = Math.sqrt(dcb * dcb + dcr * dcr) / 255;
        let alpha = (distance - threshold) * invGain;
        if (alpha < 0) alpha = 0;
        else if (alpha > 1) alpha = 1;
        pixels[i + 3] = Math.round(alpha * origAlpha);
    }

    ctx.putImageData(imageData, 0, 0);
}

export function applyPatternKey(mediaCanvas, layer) {
    const pattern = getPatternSettings(layer);
    if (!pattern) return;

    const width = mediaCanvas.width;
    const height = mediaCanvas.height;
    const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    const size = pattern.size ?? 50;
    if (size <= 0) {
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
        ctx.putImageData(imageData, 0, 0);
        return;
    }

    const centerX = width * (0.5 + (pattern.x ?? 0) / 100);
    const centerY = height * (0.5 + (pattern.y ?? 0) / 100);
    const halfX = Math.max(0.0001, (width * (size / 100)) / 2);
    const halfY = Math.max(0.0001, (height * (size / 100)) / 2);
    const softness = Math.max(0, pattern.softness ?? 0);
    const softnessNorm = softness / 100;
    const mode = pattern.pattern;

    for (let y = 0; y < height; y++) {
        const dy = y - centerY;
        const absDy = Math.abs(dy);
        const normDy = absDy / halfY;
        const rowOffset = y * width * 4;

        for (let x = 0; x < width; x++) {
            const alphaIdx = rowOffset + (x * 4) + 3;
            const origAlpha = pixels[alphaIdx];
            if (origAlpha === 0) continue;

            const dx = x - centerX;
            let alpha = 0;

            switch (mode) {
                case "circle":
                    alpha = featherAlpha(Math.sqrt(dx * dx + dy * dy), halfX, softness);
                    break;
                case "box": {
                    const normDx = Math.abs(dx) / halfX;
                    alpha = featherAlpha(normDx > normDy ? normDx : normDy, 1, softnessNorm);
                    break;
                }
                case "diamond":
                    alpha = featherAlpha((Math.abs(dx) / halfX) + normDy, 1, softnessNorm);
                    break;
                case "horizontal":
                    alpha = featherAlpha(absDy, halfY, softness);
                    break;
                case "vertical":
                    alpha = featherAlpha(Math.abs(dx), halfX, softness);
                    break;
            }

            pixels[alphaIdx] = Math.round(alpha * origAlpha);
        }
    }

    ctx.putImageData(imageData, 0, 0);
}
