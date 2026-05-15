import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getConfig } from "@/ipc/commands";
import { applyTheme } from "@/lib/theme";
import { applyAccent } from "@/stores/accent";

type PaletteMode = "files" | "commands";

const FILES_DEMO = ["src/App.tsx", "src/main.tsx", "package.json"];

export default function CommandPalette() {
    const { t } = useTranslation();
    const [mode, setMode] = useState<PaletteMode | null>(null);
    const close = () => setMode(null);

    useHotkey("Mod+P", () => {
        setMode((m) => (m === "files" ? null : "files"));
    });

    useHotkey("Mod+Shift+P", () => {
        setMode((m) => (m === "commands" ? null : "commands"));
    });

    return (
        <Command.Dialog
            open={mode !== null}
            onOpenChange={(o) => {
                if (!o) close();
            }}
            label={t(mode === "files" ? "palette.filesLabel" : "palette.commandsLabel")}
            overlayClassName="fixed inset-0 z-40"
            contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-[90vw] flex flex-col text-foreground glass border border-border rounded-xl overflow-hidden shadow-lg"
        >
            <Command.Input
                autoFocus
                placeholder={t(
                    mode === "files" ? "palette.filesPlaceholder" : "palette.commandsPlaceholder",
                )}
                className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-foreground/40"
            />
            <Command.List className="max-h-[320px] overflow-y-auto p-1">
                <Command.Empty className="py-6 text-center text-sm text-foreground/60">
                    {t("palette.empty")}
                </Command.Empty>
                {mode === "commands" && (
                    <Command.Item
                        onSelect={async () => {
                            const cfg = await getConfig();
                            await Promise.all([applyTheme(cfg.theme), applyAccent()]);
                            close();
                        }}
                        className="cursor-pointer rounded px-3 py-2 text-sm aria-selected:bg-accent/30"
                    >
                        {t("palette.reloadTheme")}
                    </Command.Item>
                )}
                {mode === "files" &&
                    FILES_DEMO.map((f) => (
                        <Command.Item
                            key={f}
                            onSelect={() => {
                                console.log("[palette] open file:", f);
                                close();
                            }}
                            className="cursor-pointer rounded px-3 py-2 text-sm aria-selected:bg-accent/30"
                        >
                            {f}
                        </Command.Item>
                    ))}
            </Command.List>
        </Command.Dialog>
    );
}
