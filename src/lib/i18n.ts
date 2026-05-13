import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import de from "@/locales/de.json";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import zh from "@/locales/zh.json";

const SUPPORTED = ["en", "de", "ja", "zh"] as const;
type Supported = (typeof SUPPORTED)[number];

export function pickLanguage(tag: string | null): Supported {
    if (!tag) return "en";
    const base = tag.toLowerCase().split(/[-_]/)[0];
    return (SUPPORTED as readonly string[]).includes(base) ? (base as Supported) : "en";
}

export function initI18n(tag: string | null): Promise<unknown> {
    return i18next.use(initReactI18next).init({
        resources: {
            en: { translation: en },
            de: { translation: de },
            ja: { translation: ja },
            zh: { translation: zh },
        },
        lng: pickLanguage(tag),
        fallbackLng: "en",
        interpolation: { escapeValue: false },
    });
}

export { i18next };
