// =========================================================================
// UNIFIED OVERLAYS COORDINATOR (js/ui/overlays.js)
// - Thin ES Module facade delegating drawers and modals to js/overlays/*.js
// =========================================================================

import { renderStreamRecDrawer } from "../overlays/stream-rec-drawer.js";
import { renderConnectionsDrawer } from "../overlays/bridge-drawer.js";
import { renderCaptureDrawer } from "../overlays/capture-drawer.js";
import { openProjectModal as openProjectModalImpl, openExportModal as openExportModalImpl, openImportModal as openImportModalImpl } from "../overlays/project-modals.js";
import { openMacroCreateModal as openMacroCreateModalImpl } from "../overlays/macro-modal.js";

const OverlaysUI = (() => {
    let activeOverlay = null; // null | "connections" | "capture" | "streamRec" | "project" | "import" | "export" | "macroCreate"
    let captureDevices = [];

    function ensureBackdrop() {
        let el = document.getElementById("appOverlayRoot");
        if (!el) {
            el = document.createElement("div");
            el.id = "appOverlayRoot";
            document.body.appendChild(el);
        }
        return el;
    }

    function close() {
        activeOverlay = null;
        const el = document.getElementById("appOverlayRoot");
        if (el) el.innerHTML = "";
    }

    function isOpen() {
        return activeOverlay !== null;
    }

    const baseCtx = {
        ensureBackdrop,
        close,
        setActiveOverlay: (v) => { activeOverlay = v; },
        getCaptureDevices: () => captureDevices,
        setCaptureDevices: (list) => { captureDevices = Array.isArray(list) ? list : []; },
        openConnectionsDrawer: (tab) => openConnectionsDrawer(tab),
        openCaptureDrawer: () => openCaptureDrawer()
    };

    async function openConnectionsDrawer(tab = "bridge") {
        if (tab === "capture") return openCaptureDrawer();
        activeOverlay = "connections";
        renderConnectionsDrawer(baseCtx);
    }

    async function openCaptureDrawer() {
        activeOverlay = "capture";
        if (typeof LiveVideoManager !== "undefined") {
            captureDevices = await LiveVideoManager.listVideoDevices().catch(() => []);
        }
        renderCaptureDrawer(baseCtx);
    }

    function openStreamRecDrawer() {
        activeOverlay = "streamRec";
        renderStreamRecDrawer(baseCtx);
    }

    function openProjectModal() {
        openProjectModalImpl(baseCtx);
    }

    function openExportModal() {
        openExportModalImpl(baseCtx);
    }

    function openImportModal(autoTrigger = null) {
        openImportModalImpl(baseCtx, autoTrigger);
    }

    function openMacroCreateModal(mode = "snapshot") {
        openMacroCreateModalImpl(baseCtx, mode);
    }

    function syncStatus() {
        const ae = document.activeElement;
        const root = document.getElementById("appOverlayRoot");
        const isEditingField = !!(ae && root?.contains(ae) && ["INPUT", "SELECT"].includes(ae.tagName));
        if (isEditingField) return;
        if (activeOverlay === "connections") {
            renderConnectionsDrawer(baseCtx);
        } else if (activeOverlay === "capture") {
            renderCaptureDrawer(baseCtx);
        } else if (activeOverlay === "streamRec") {
            renderStreamRecDrawer(baseCtx);
        }
    }

    return {
        openConnectionsDrawer,
        openCaptureDrawer,
        openStreamRecDrawer,
        openProjectModal,
        openExportModal,
        openImportModal,
        openMacroCreateModal,
        close,
        isOpen,
        syncStatus
    };
})();

export { OverlaysUI };
export default OverlaysUI;
if (typeof window !== "undefined") {
    window.OverlaysUI = OverlaysUI;
}
