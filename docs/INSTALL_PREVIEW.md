# Install the JesSee developer preview

JesSee is open source, but these early downloads are not yet reviewed or signed by the Chrome Web Store or Apple. Install only if you are comfortable testing code from the public repository.

## Chrome

1. Download `JesSee-Chrome-v0.1.0-alpha.1.zip` from the [GitHub prerelease](https://github.com/polyform-ai/jessee/releases/tag/v0.1.0-alpha.1).
2. Unzip the download.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select the unzipped folder.

Chrome only allows ordinary one-click installation for extensions signed and hosted by the Chrome Web Store. This ZIP is deliberately installed as an unpacked developer extension.

## Safari 17 or newer

1. Download `JesSee-Safari-v0.1.0-alpha.1.zip` from the [GitHub prerelease](https://github.com/polyform-ai/jessee/releases/tag/v0.1.0-alpha.1). Do not unzip it.
2. In Safari, open **Settings → Advanced** and enable **Show features for web developers**.
3. Open **Settings → Developer** and enable **Allow unsigned extensions**.
4. Choose **Add Temporary Extension…** and select the downloaded ZIP.
5. Open **Settings → Extensions**, enable JesSee, and approve access when Safari asks.

Safari removes temporary extensions when Safari quits or after 24 hours. The unsigned-extension setting also resets when Safari quits.

For persistent local development on Safari 16.4 or newer, clone the repository, run `npm run build:safari`, open `safari/JesSee.xcodeproj`, select a Development Team if available, and run the JesSee scheme. A normal public Safari download requires a Developer ID signature and Apple notarization, or App Store distribution.

## Verify the downloads

The prerelease includes `SHA256SUMS.txt`. Run `shasum -a 256 <downloaded-file>` and compare the result with the matching entry before installing.

Report problems through [GitHub Issues](https://github.com/polyform-ai/jessee/issues).
