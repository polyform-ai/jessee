# Signed Mac releases and automatic updates

The native Mac app uses Sparkle for signed in-place updates. The first install is a signed, notarized `JesSee.dmg`; subsequent releases are delivered from the app's **Check for Updates…** button and automatic update checks.

Version 0.2.1 is the first supported native Mac release. Credentials from the retired browser previews were never stored in the Mac Keychain. Local pre-release Mac builds used development-only signing and may ask their tester to choose Polyform Covered or connect OpenAI once in the signed app; all supported releases use the same login-keychain items from that point forward.

## Native Mac app

The Mac app records Safari, Chrome, or any other selected app without requiring a browser extension.

1. Store the JesSee Sparkle EdDSA key in the release operator's Keychain under `polyform-jessee`.
2. Store Apple notarization credentials with `notarytool`, or provide App Store Connect API-key variables in CI.
3. Run `mac/Support/package-release.sh <version> <build-number>` with the Developer ID identity and Sparkle public key variables.
4. Review the notarized DMG, signed update ZIP, appcast, and release notes.
5. Publish `JesSee.dmg`, the versioned ZIP, and `appcast.xml` together in a non-prerelease GitHub Release.

The appcast URL is `https://github.com/polyform-ai/jessee/releases/latest/download/appcast.xml`. GitHub's `latest` route ignores prereleases, so production Mac releases must be published as normal releases.

## Release metadata

`npm run site:build` creates `site-dist/releases/latest.json`. It advertises the native Sparkle channel only. Production credentials or signing material are never written into this file.

Before publishing a new release:

1. Choose a semantic version and a strictly increasing numeric build number.
2. Run the **Prepare signed Mac release** GitHub Actions workflow.
3. Inspect the draft release's notarized DMG, signed update ZIP, appcast, and release notes.
4. Install the DMG on a clean Mac account, complete a short recording, and run **Check for Updates…**.
5. Publish the reviewed GitHub release. The website download and Sparkle feed then move together through GitHub's `latest` release URL.
