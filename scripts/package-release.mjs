import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.env.JESSEE_RELEASE_VERSION ?? "0.1.0-alpha.1";
const outputDirectory = resolve("release-dist");
const stagingDirectory = resolve(outputDirectory, "staging");
const chromeDirectory = resolve(stagingDirectory, "chrome");
const safariDirectory = resolve(stagingDirectory, "safari");

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(chromeDirectory, { recursive: true });
mkdirSync(safariDirectory, { recursive: true });

cpSync(resolve("dist"), chromeDirectory, { recursive: true });
cpSync(resolve("safari/JesSee Extension/Resources"), safariDirectory, { recursive: true });

writeFileSync(resolve(chromeDirectory, "INSTALL.txt"), `JesSee for Chrome - developer preview

1. Unzip this archive.
2. Open chrome://extensions in Chrome.
3. Turn on Developer mode.
4. Choose Load unpacked and select this folder.

This build is open source and is not yet Chrome Web Store reviewed or signed.
Source: https://github.com/polyform-ai/jessee
`);

writeFileSync(resolve(safariDirectory, "INSTALL.txt"), `JesSee for Safari - temporary developer preview

Safari 17 or newer:
1. Safari > Settings > Advanced: enable Show features for web developers.
2. Safari > Settings > Developer: enable Allow unsigned extensions.
3. Choose Add Temporary Extension and select this ZIP file.

Safari removes a temporary extension when Safari quits or after 24 hours. The source repository contains an Xcode project for persistent local development on Safari 16.4 or newer. This preview is not App Store reviewed, Developer ID signed, or notarized.
Source: https://github.com/polyform-ai/jessee
`);

const archives = [
  { directory: chromeDirectory, name: `JesSee-Chrome-v${version}.zip` },
  { directory: safariDirectory, name: `JesSee-Safari-v${version}.zip` }
];

for (const archive of archives) {
  execFileSync("zip", ["-qr", resolve(outputDirectory, archive.name), "."], { cwd: archive.directory });
}

const checksums = archives.map(({ name }) => {
  const digest = createHash("sha256").update(readFileSync(resolve(outputDirectory, name))).digest("hex");
  return `${digest}  ${name}`;
});
writeFileSync(resolve(outputDirectory, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
rmSync(stagingDirectory, { recursive: true, force: true });

console.log(`Packaged JesSee v${version} in ${outputDirectory}`);
