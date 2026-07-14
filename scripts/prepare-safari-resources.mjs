import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const chromeBuild = resolve("dist");
const safariResources = resolve("safari/JesSee Extension/Resources");

rmSync(safariResources, { recursive: true, force: true });
mkdirSync(safariResources, { recursive: true });
cpSync(chromeBuild, safariResources, { recursive: true });

const manifestPath = resolve(safariResources, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
delete manifest.side_panel;
manifest.permissions = (manifest.permissions ?? []).filter(
  (permission) => !["sidePanel", "downloads", "<all_urls>"].includes(permission)
);
if (manifest.background?.service_worker) {
  manifest.background = {
    scripts: [manifest.background.service_worker],
    type: "module"
  };
}
manifest.browser_specific_settings = {
  ...(manifest.browser_specific_settings ?? {}),
  safari: {
    ...(manifest.browser_specific_settings?.safari ?? {}),
    strict_min_version: "16.0"
  }
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
