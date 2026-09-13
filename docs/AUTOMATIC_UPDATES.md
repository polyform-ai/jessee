# Automatic update path

JesSee now checks `https://jessee.ai/releases/latest.json` from Settings and tells the user whether a newer release exists. That gives developer-preview installs a clear upgrade path today without pretending an unsigned ZIP can update itself safely.

## Chrome

The trusted automatic-update channel is the Chrome Web Store.

1. Create the JesSee store item and upload the Chrome ZIP from `npm run release:package`.
2. Complete the privacy, permissions, screenshots, support, and distribution sections using `docs/chrome-web-store-listing.md`.
3. After the item is approved, set `JESSEE_CHROME_STORE_URL` when building the website. The public release metadata will switch from `developer-preview` to `chrome-web-store` and report automatic updates as available.
4. Existing unpacked developer installs cannot be converted in place. Install the store version once; Chrome will update that installation after future store releases.

`public/manifest.json` includes Google's standard update service URL. The Safari resource preparation script deliberately removes it from Safari's manifest.

## Safari

The trusted independent-distribution path is a signed and notarized macOS app containing the Safari Web Extension, with Sparkle providing the app update feed. App Store distribution is a valid alternative.

1. Add an Apple Developer team and a Developer ID Application certificate to both Xcode targets.
2. Add Sparkle to the containing macOS app, configure the appcast URL, and generate the Sparkle EdDSA signing key outside the repository.
3. Archive the Release scheme, sign it with Developer ID, notarize it, staple the ticket, and verify the signature before publication.
4. Publish the signed app archive and signed Sparkle appcast on the JesSee release host.
5. Set `JESSEE_SAFARI_SIGNED_APP_URL` when building the website. The public release metadata will switch from `developer-preview` to `sparkle` and report automatic updates as available.

Do not enable the Sparkle channel for the current temporary-extension ZIP. Safari removes temporary extensions after Safari quits or after 24 hours, and an unsigned extension cannot safely replace itself.

## Release metadata

`npm run site:build` creates `site-dist/releases/latest.json` from the package and extension versions. The defaults remain honest developer-preview links. Production credentials or signing material are never written into this file.

Before publishing a new release:

1. Bump `package.json`, `public/manifest.json`, and the Xcode build number together.
2. Run `npm run check`, `npm run build:safari:unsigned`, and `npm run release:package`.
3. Inspect both ZIPs and `release-dist/SHA256SUMS.txt`.
4. Publish the GitHub prerelease and then deploy the site so its download links never point to missing assets.
5. For store or signed-app channels, publish the browser release first and only then enable its website environment variable.
