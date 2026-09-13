import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const version = process.env.JESSEE_RELEASE_VERSION ?? packageMetadata.version;
const releaseDirectory = resolve("release-dist");

const packages = [
  {
    browser: "Chrome",
    path: resolve(releaseDirectory, `JesSee-Chrome-v${version}.zip`),
    validateManifest(manifest) {
      requireValue(manifest.background?.service_worker, "Chrome package must use a background service worker.");
      requireValue(manifest.side_panel?.default_path, "Chrome package must include its side panel.");
      requirePermission(manifest, "downloads");
      requirePermission(manifest, "sidePanel");
    }
  },
  {
    browser: "Safari",
    path: resolve(releaseDirectory, `JesSee-Safari-v${version}.zip`),
    validateManifest(manifest) {
      if (manifest.action?.default_popup !== "controls.html") {
        throw new Error("Safari package must open controls.html from its toolbar action.");
      }
      if (manifest.side_panel) throw new Error("Safari package cannot include Chrome's side_panel declaration.");
      if (!manifest.background?.scripts?.length) throw new Error("Safari package must include background scripts.");
      if ((manifest.permissions ?? []).some((permission) => ["downloads", "sidePanel"].includes(permission))) {
        throw new Error("Safari package contains a Chrome-only permission.");
      }
      const minimumVersion = Number.parseFloat(manifest.browser_specific_settings?.safari?.strict_min_version);
      if (!Number.isFinite(minimumVersion) || minimumVersion < 16.4) {
        throw new Error("Safari package must require Safari 16.4 or newer for module background scripts.");
      }
    }
  }
];

for (const browserPackage of packages) {
  if (!existsSync(browserPackage.path)) throw new Error(`Missing ${browserPackage.browser} release package: ${browserPackage.path}`);
  const entries = zipEntries(browserPackage.path);
  if (!entries.has("manifest.json")) throw new Error(`${browserPackage.browser} package must contain manifest.json at the ZIP root.`);
  if (!entries.has("INSTALL.txt")) throw new Error(`${browserPackage.browser} package must contain INSTALL.txt at the ZIP root.`);

  const manifest = JSON.parse(readZipEntry(browserPackage.path, "manifest.json"));
  if (manifest.manifest_version !== 3) throw new Error(`${browserPackage.browser} package must use Manifest V3.`);
  validateDeclaredVersion(manifest, version, browserPackage.browser);
  browserPackage.validateManifest(manifest);

  const referencedResources = collectManifestResources(manifest);
  referencedResources.add("history.html");
  const missing = [...referencedResources].filter((resource) => !zipContains(entries, resource));
  if (missing.length) {
    throw new Error(`${browserPackage.browser} package is missing manifest resources: ${missing.join(", ")}`);
  }

  console.log(`Validated ${browserPackage.browser} release ZIP with ${referencedResources.size} manifest resources.`);
}

validateChecksums(packages.map(({ path }) => path));

function zipEntries(archivePath) {
  return new Set(
    execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
      .split("\n")
      .map((entry) => entry.replace(/^\.\//, ""))
      .filter(Boolean)
  );
}

function readZipEntry(archivePath, entry) {
  return execFileSync("unzip", ["-p", archivePath, entry], { encoding: "utf8" });
}

function collectManifestResources(manifest) {
  const resources = new Set();
  const add = (resource) => {
    if (typeof resource !== "string" || !resource) return;
    const normalized = resource.replace(/^\.\//, "").split(/[?#]/, 1)[0];
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`Manifest contains an unsafe resource path: ${resource}`);
    }
    resources.add(normalized);
  };

  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.side_panel?.default_path);
  add(manifest.background?.service_worker);
  for (const resource of manifest.background?.scripts ?? []) add(resource);
  for (const resource of Object.values(manifest.icons ?? {})) add(resource);
  for (const resource of Object.values(manifest.action?.default_icon ?? {})) add(resource);
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const resource of contentScript.js ?? []) add(resource);
    for (const resource of contentScript.css ?? []) add(resource);
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry.resources ?? []) add(resource);
  }
  return resources;
}

function zipContains(entries, resource) {
  const wildcardIndex = resource.search(/[?*]/);
  if (wildcardIndex === -1) return entries.has(resource);
  const prefix = resource.slice(0, wildcardIndex).replace(/\/+$/, "");
  return [...entries].some((entry) => entry === prefix || entry.startsWith(`${prefix}/`));
}

function requireValue(value, message) {
  if (typeof value !== "string" || !value) throw new Error(message);
}

function requirePermission(manifest, permission) {
  if (!(manifest.permissions ?? []).includes(permission)) throw new Error(`Chrome package must include the ${permission} permission.`);
}

function validateDeclaredVersion(manifest, releaseVersion, browser) {
  const match = releaseVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/);
  if (!match) throw new Error(`Unsupported release version format: ${releaseVersion}`);
  const [, major, minor, patch, alpha] = match;
  const expectedVersion = [major, minor, patch, alpha].filter((part) => part !== undefined).join(".");
  const expectedVersionName = alpha ? `${major}.${minor}.${patch} alpha ${alpha}` : `${major}.${minor}.${patch}`;
  if (manifest.version !== expectedVersion || manifest.version_name !== expectedVersionName) {
    throw new Error(
      `${browser} package declares ${manifest.version} (${manifest.version_name ?? "no version_name"}) but release ${releaseVersion} requires ${expectedVersion} (${expectedVersionName}).`
    );
  }
}

function validateChecksums(packagePaths) {
  const checksumPath = resolve(releaseDirectory, "SHA256SUMS.txt");
  if (!existsSync(checksumPath)) throw new Error(`Missing checksum file: ${checksumPath}`);
  const declaredChecksums = new Map(
    readFileSync(checksumPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (!match) throw new Error(`Invalid checksum line: ${line}`);
        return [match[2], match[1]];
      })
  );

  for (const packagePath of packagePaths) {
    const filename = packagePath.split("/").at(-1);
    const actual = createHash("sha256").update(readFileSync(packagePath)).digest("hex");
    if (declaredChecksums.get(filename) !== actual) throw new Error(`Checksum mismatch for ${filename}.`);
  }
  console.log(`Validated checksums for ${packagePaths.length} release ZIPs.`);
}
