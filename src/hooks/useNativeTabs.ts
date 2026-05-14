import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";

import { useSettingsStore } from "@/stores/settings";

type NativeTabs = {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    toggle: () => void;

    newTab: () => Promise<void>;
    selectNext: () => Promise<void>;
    selectPrevious: () => Promise<void>;
    mergeAll: () => Promise<void>;
    moveToNewWindow: () => Promise<void>;
};

const commands = {
    newTab: () => invoke<void>("native_tabs_new_tab"),
    selectNext: () => invoke<void>("native_tabs_select_next"),
    selectPrevious: () => invoke<void>("native_tabs_select_previous"),
    mergeAll: () => invoke<void>("native_tabs_merge_all"),
    moveToNewWindow: () => invoke<void>("native_tabs_move_to_new_window"),
};

export function useNativeTabs(): NativeTabs {
    const enabled = useSettingsStore((s) => s.nativeTabs);
    const setEnabled = useSettingsStore((s) => s.setNativeTabs);
    const toggle = useSettingsStore((s) => s.toggleNativeTabs);

    return useMemo(
        () => ({
            enabled,
            setEnabled,
            toggle,
            ...commands,
        }),
        [enabled, setEnabled, toggle],
    );
}

export const nativeTabsCommands = commands;
