import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const websiteSource = resolve("website");
const websiteBuild = resolve("site-dist");
const showcasePdf = resolve("output/pdf/jessee-explains-jessee.pdf");
const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const extensionManifest = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));

rmSync(websiteBuild, { recursive: true, force: true });
cpSync(websiteSource, websiteBuild, { recursive: true });

if (!existsSync(showcasePdf)) {
  throw new Error("Missing output/pdf/jessee-explains-jessee.pdf. Run the visual showcase test before building the website.");
}

mkdirSync(resolve(websiteBuild, "assets"), { recursive: true });
cpSync(showcasePdf, resolve(websiteBuild, "assets/jessee-explains-jessee.pdf"));

const version = packageMetadata.version;
const releaseTag = `v${version}`;
const releaseBaseUrl = `https://github.com/polyform-ai/jessee/releases/download/${releaseTag}`;
const releaseTagToken = "__JESSEE_RELEASE_TAG__";
const websiteIndex = resolve(websiteBuild, "index.html");
const websiteIndexTemplate = readFileSync(websiteIndex, "utf8");
if (!websiteIndexTemplate.includes(releaseTagToken)) {
  throw new Error(`Missing ${releaseTagToken} from website/index.html.`);
}
writeFileSync(websiteIndex, websiteIndexTemplate.replaceAll(releaseTagToken, releaseTag));
const chromeStoreUrl = process.env.JESSEE_CHROME_STORE_URL;
const safariSignedAppUrl = process.env.JESSEE_SAFARI_SIGNED_APP_URL;
const releaseMetadata = {
  schemaVersion: 1,
  version,
  browserVersion: extensionManifest.version,
  publishedAt: new Date().toISOString(),
  notes: "On-page recording controls, a clearer click cursor, richer story editing, and a continuous PDF that mirrors the editor.",
  chrome: {
    channel: chromeStoreUrl ? "chrome-web-store" : "developer-preview",
    automaticUpdates: Boolean(chromeStoreUrl),
    installUrl: chromeStoreUrl ?? `${releaseBaseUrl}/JesSee-Chrome-v${version}.zip`
  },
  safari: {
    channel: safariSignedAppUrl ? "sparkle" : "developer-preview",
    automaticUpdates: Boolean(safariSignedAppUrl),
    installUrl: safariSignedAppUrl ?? `${releaseBaseUrl}/JesSee-Safari-v${version}.zip`
  }
};
mkdirSync(resolve(websiteBuild, "releases"), { recursive: true });
writeFileSync(resolve(websiteBuild, "releases/latest.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
