const GRID = 0.1;

function snap(value) {
    return Number((Math.round(value / GRID) * GRID).toFixed(2));
}

function atemToCanvas(box) {


    const width = box.size * 100;
    const height = width;

    const centerX = ((box.x + 16) / 32) * 100;
    const centerY = ((9 - box.y) / 18) * 100;

    return {
        left: centerX - width / 2,
        top: centerY - height / 2,
        width,
        height
    };
}

function canvasToAtem(left, top, width) {

    const centerX = left + width / 2;
    const centerY = top + width / 2;

    return {
        x: ((centerX / 100) * 32) - 16,
        y: 9 - ((centerY / 100) * 18),
        size: width / 100
    };
}

function mediaToCanvas(media) {
    return {
        widthPercent:
            (media.nativeWidth /
            state.canvas.width) * 100,

        heightPercent:
            (media.nativeHeight /
            state.canvas.height) * 100
    };

}

function initialiseFrameBuffer(
    canvas
) {

    if (
        canvas.width !== state.canvas.width ||
        canvas.height !== state.canvas.height
    ) {

        canvas.width =
            state.canvas.width;

        canvas.height =
            state.canvas.height;
    }

}

function ensureFrameBuffer(canvas) {

    const width =
        state.canvas.width;

    const height =
        state.canvas.height;

    if (
        canvas.width !== width ||
        canvas.height !== height
    ) {

        canvas.width = width;
        canvas.height = height;
    }

}
