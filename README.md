# JesSee

### Help AI see what you see.

AI is bad at processing video. A walkthrough contains the full story, but sending every frame consumes enormous context, a folder of screenshots loses the sequence, and rewriting the recording as a prompt means doing the work twice.

JesSee is a native Mac app that records how you explain work, connects the narration to the important screen states, and turns the result into an editable visual story and one continuous PDF.

Use it for:

- Product specs and bug reports for AI agents
- Tutorials, playbooks, and support guidance
- Detailed asynchronous handoffs
- Turning an existing video into structured context

## What the Mac app includes

- A guided choice between Polyform Covered and Bring Your Own Key, plus output folder and microphone access
- Menu-bar recording for any selected window, app, or display
- Mac-style screenshot capture: drag to select an area or press Space for a window, then copy its public URL
- Automatic source webpage URLs for recordings started from supported browsers on macOS 15.2+
- A live timer, microphone meter, drawing and highlighting controls
- Global recording shortcuts, including `⌥S` to stop and process
- Video import for existing walkthroughs
- Background transcription and story creation with timestamp-aligned screenshots
- A local library with processing state, retry, replay, and editable history
- A Tiptap-based visual editor for headings, paragraphs, lists, callouts, image choice, and image markup
- One continuous PDF plus an HTML copy, captions, transcript, screenshots, narration, and original video in a folder you control
- Authenticated Polyform workflows for covered AI processing and public PDF links
- Signed updates through Sparkle

JesSee requires macOS 15 or newer. **Polyform Covered** lets you sign in by email while Polyform covers transcription and AI costs. **Bring Your Own Key** stores your OpenAI API key in the Mac Keychain and sends narration and selected screenshots directly to OpenAI. Recordings, generated story screenshots, generated files, and PDFs remain in the output folder you choose. Public screenshot and PDF links use the same optional Polyform sign-in; only an image or PDF you explicitly choose to publish is uploaded publicly.

Anonymous feature-usage sharing is on by default and can be turned off in **Settings → Privacy**. JesSee sends completed feature names, app version, counts, and a random installation ID directly to GA4. It never includes media, narration, story text, filenames, email, or API keys. See [Feature usage events](docs/FEATURE_USAGE_EVENTS.md) for the exact contract.

## Install

Download the latest signed and notarized installer from [jessee.ai](https://jessee.ai) or the [latest GitHub release](https://github.com/polyform-ai/jessee/releases/latest).

1. Open `JesSee.dmg`.
2. Drag JesSee to Applications.
3. Open JesSee from Applications and complete the four-step setup.
4. Look for the JesSee viewfinder icon at the top-right of your Mac. JesSee stays in the menu bar for recording, screenshots, imports, and updates, even when the Library window is closed.

The browser extensions have been retired. The native app records Safari, Chrome, and other Mac apps without an extension.

## Recording controls

The floating recording bar shows the elapsed time and microphone activity. Hover any control to see its purpose and shortcut.

| Action | Shortcut |
| --- | --- |
| Start a recording | `⌥⇧S` |
| Capture an area or window and copy its URL | `⌥⇧C` |
| Draw | `⌥D` |
| Highlight | `⌥H` |
| Undo | `⌥Z` |
| Clear marks | `⌥C` |
| Redo take | `⌥R` |
| Stop and process | `⌥S` |

Select an active drawing tool again to return to normal interaction with the recorded app.

## Build and test

```bash
npm install
npm run check
open mac/build/JesSee.app
```

`npm run check` builds the embedded story editor, runs the Swift test suite, creates the local app bundle, and verifies its signature.

The public release workflow creates a universal Developer ID-signed app, submits the app and DMG to Apple for notarization, and generates the signed Sparkle update feed. See [Signed Mac releases and automatic updates](docs/AUTOMATIC_UPDATES.md).

Polyform Covered workflow contracts and release secrets are documented in [Polyform setup for JesSee](docs/POLYFORM_SETUP.md).

## Website

The product site lives in `website/` and is hosted at [jessee.ai](https://jessee.ai) on Cloudflare Pages.

```bash
npm run site:preview
npm run deploy:cloudflare:preview
```

Publishing production remains an explicit release step: `npm run deploy:cloudflare`.

## Open source

JesSee is MIT licensed. Found a bug or confusing workflow? [Open an issue](https://github.com/polyform-ai/jessee/issues). Want to improve it? Fork the project and [open a pull request](https://github.com/polyform-ai/jessee/pulls).

Good first contributions include visual-story improvements, accessibility, capture quality, document output, and tests that make the native recording flow more reliable.
