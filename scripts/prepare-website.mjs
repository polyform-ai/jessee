import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const websiteSource = resolve("website");
const websiteBuild = resolve("site-dist");
const showcasePdf = resolve("output/pdf/jessee-explains-jessee.pdf");
const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

rmSync(websiteBuild, { recursive: true, force: true });
cpSync(websiteSource, websiteBuild, { recursive: true });

const builtStyles = readFileSync(resolve(websiteBuild, "styles.css"));
const styleVersion = createHash("sha256").update(builtStyles).digest("hex").slice(0, 12);
const builtIndexPath = resolve(websiteBuild, "index.html");
const builtIndex = readFileSync(builtIndexPath, "utf8");
const stylesheetReference = 'href="styles.css"';
if (!builtIndex.includes(stylesheetReference)) {
  throw new Error("Missing unversioned stylesheet reference in website/index.html.");
}
writeFileSync(
  builtIndexPath,
  builtIndex.replace(stylesheetReference, `href="styles.css?v=${styleVersion}"`)
);

if (!existsSync(showcasePdf)) {
  throw new Error("Missing output/pdf/jessee-explains-jessee.pdf. Run the visual showcase test before building the website.");
}

mkdirSync(resolve(websiteBuild, "assets"), { recursive: true });
cpSync(showcasePdf, resolve(websiteBuild, "assets/jessee-explains-jessee.pdf"));

const version = packageMetadata.version;
const macInstallUrl = "https://github.com/polyform-ai/jessee/releases/latest/download/JesSee.dmg";
const releaseMetadata = {
  schemaVersion: 1,
  version,
  publishedAt: new Date().toISOString(),
  notes: "JesSee turns narrated recordings into AI-structured visual documents, with menu-bar capture, a local library, and automatic updates.",
  mac: {
    channel: "sparkle",
    automaticUpdates: true,
    installUrl: macInstallUrl
  }
};
mkdirSync(resolve(websiteBuild, "releases"), { recursive: true });
writeFileSync(resolve(websiteBuild, "releases/latest.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
