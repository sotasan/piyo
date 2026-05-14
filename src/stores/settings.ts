import { create } from "zustand";

const STORAGE_KEY = "piyo.settings";

type Persisted = {
    nativeTabs: boolean;
};

const defaults: Persisted = {
    nativeTabs: false,
};

function load(): Persisted {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        return { ...defaults, ...parsed };
    } catch {
        return defaults;
    }
}

function save(state: Persisted) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore quota / disabled storage
    }
}

interface SettingsStore extends Persisted {
    setNativeTabs: (enabled: boolean) => void;
    toggleNativeTabs: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
    ...load(),

    setNativeTabs: (enabled) => {
        set({ nativeTabs: enabled });
        save({ nativeTabs: get().nativeTabs });
    },

    toggleNativeTabs: () => {
        set((s) => ({ nativeTabs: !s.nativeTabs }));
        save({ nativeTabs: get().nativeTabs });
    },
}));
