import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const resourceDirectories = [
  resolve("safari/build/Build/Products/Debug/JesSee Extension.appex/Contents/Resources"),
  resolve("safari/build/Build/Products/Debug/JesSee.app/Contents/PlugIns/JesSee Extension.appex/Contents/Resources")
];

for (const resourcesDirectory of resourceDirectories) {
  const manifestPath = resolve(resourcesDirectory, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing built Safari manifest: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const referencedResources = new Set();
  const addResource = (resource) => {
    if (typeof resource === "string" && resource.length > 0) referencedResources.add(resource);
  };

  addResource(manifest.action?.default_popup);
  addResource(manifest.options_page);
  addResource(manifest.background?.service_worker);
  for (const resource of manifest.background?.scripts ?? []) addResource(resource);
  for (const icon of Object.values(manifest.icons ?? {})) addResource(icon);
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) addResource(icon);
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const resource of contentScript.js ?? []) addResource(resource);
    for (const resource of contentScript.css ?? []) addResource(resource);
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry.resources ?? []) addResource(resource);
  }

  const missing = [...referencedResources].filter((resource) => {
    const wildcardIndex = resource.search(/[?*]/);
    const requiredPath = wildcardIndex === -1
      ? resolve(resourcesDirectory, resource)
      : resolve(resourcesDirectory, resource.slice(0, wildcardIndex).replace(/\/+$/, ""));
    return !existsSync(requiredPath);
  });

  if (missing.length > 0) {
    throw new Error(`Safari app bundle is missing manifest resources: ${missing.join(", ")}`);
  }

  console.log(`Validated ${referencedResources.size} Safari manifest resources in ${resourcesDirectory}.`);
}
