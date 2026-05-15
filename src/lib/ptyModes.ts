/**
 * Per-PTY terminal mode state mirrored from ghostty. Drives wheel encoding,
 * pointer shape, paste wrapping, and focus-event emission.
 */
export type PtyTermModes = {
    mouseTracking: boolean;
    bracketedPaste: boolean;
    focusEvent: boolean;
};

const DEFAULT_MODES: PtyTermModes = {
    mouseTracking: false,
    bracketedPaste: false,
    focusEvent: false,
};

const modesByRid = new Map<number, PtyTermModes>();
const modeListeners = new Map<number, (m: PtyTermModes) => void>();

function clone(m: PtyTermModes): PtyTermModes {
    return {
        mouseTracking: m.mouseTracking,
        bracketedPaste: m.bracketedPaste,
        focusEvent: m.focusEvent,
    };
}

export function setPtyModes(rid: number, modes: PtyTermModes): void {
    const prev = modesByRid.get(rid);
    if (
        prev &&
        prev.mouseTracking === modes.mouseTracking &&
        prev.bracketedPaste === modes.bracketedPaste &&
        prev.focusEvent === modes.focusEvent
    ) {
        return;
    }
    // Clone on store so callers can't mutate our internal state later,
    // and clone again when handing off to the listener for the same reason.
    const stored = clone(modes);
    modesByRid.set(rid, stored);
    modeListeners.get(rid)?.(clone(stored));
}

export function getPtyModes(rid: number): PtyTermModes {
    return clone(modesByRid.get(rid) ?? DEFAULT_MODES);
}

export function clearPtyModes(rid: number): void {
    modesByRid.delete(rid);
    modeListeners.delete(rid);
}

/**
 * Subscribe to mode changes for one rid. Callback fires only on actual
 * state transitions.
 */
export function onPtyModesChange(rid: number, cb: (m: PtyTermModes) => void): () => void {
    modeListeners.set(rid, cb);
    return () => {
        if (modeListeners.get(rid) === cb) modeListeners.delete(rid);
    };
}
