import { error } from "@tauri-apps/plugin-log";
import { platform } from "@tauri-apps/plugin-os";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { setQuitDialogStrings } from "@/ipc/commands";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import ja from "@/locales/ja.json";
import zh from "@/locales/zh.json";

const SUPPORTED = ["en", "de", "fr", "ja", "zh"] as const;
type Supported = (typeof SUPPORTED)[number];

export function pickLanguage(tag: string | null): Supported {
    if (!tag) return "en";
    const base = tag.toLowerCase().split(/[-_]/)[0];
    return (SUPPORTED as readonly string[]).includes(base) ? (base as Supported) : "en";
}

function pushQuitStrings(): Promise<void> {
    return setQuitDialogStrings({
        title: i18next.t("dialogs.quit.title"),
        body: i18next.t("dialogs.quit.body"),
        ok: i18next.t("dialogs.quit.ok"),
        cancel: i18next.t("dialogs.quit.cancel"),
    }).catch((e: unknown) => {
        // Quit dialog is macOS-only; on failure, applicationShouldTerminate
        // sees empty strings and quits silently — log so we notice.
        error(`push quit strings failed: ${e}`);
    });
}

export async function initI18n(tag: string | null): Promise<unknown> {
    const ret = await i18next.use(initReactI18next).init({
        resources: {
            en: { translation: en },
            de: { translation: de },
            fr: { translation: fr },
            ja: { translation: ja },
            zh: { translation: zh },
        },
        lng: pickLanguage(tag),
        fallbackLng: "en",
        interpolation: { escapeValue: false },
    });
    if (platform() === "macos") {
        await pushQuitStrings();
        i18next.on("languageChanged", () => void pushQuitStrings());
    }
    return ret;
}

export { i18next };
