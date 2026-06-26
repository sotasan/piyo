import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightRosePine from "starlight-theme-rose-pine";

// https://astro.build/config
export default defineConfig({
    srcDir: "docs",
    integrations: [
        starlight({
            plugins: [starlightRosePine()],
            title: "My Docs",
            social: [
                { icon: "github", label: "GitHub", href: "https://github.com/withastro/starlight" },
            ],
            sidebar: [
                {
                    label: "Guides",
                    items: [
                        // Each item here is one entry in the navigation menu.
                        { label: "Example Guide", slug: "guides/example" },
                    ],
                },
                {
                    label: "Reference",
                    items: [{ autogenerate: { directory: "reference" } }],
                },
            ],
        }),
    ],
});
