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

- A guided setup for OpenAI, email, output folder, and microphone access
- Menu-bar recording for any selected window, app, or display
- A live timer, microphone meter, drawing and highlighting controls
- Global recording shortcuts, including `⌥S` to stop and process
- Video import for existing walkthroughs
- Background transcription and story creation with timestamp-aligned screenshots
- A local library with processing state, retry, replay, and editable history
- A Tiptap-based visual editor for headings, paragraphs, lists, callouts, image choice, and image markup
- One continuous PDF plus an HTML copy, captions, transcript, screenshots, narration, and original video in a folder you control
- Signed updates through Sparkle

JesSee requires macOS 15 or newer and your own OpenAI API key. Recordings and generated files remain in the output folder you choose. Creating a story sends the narration and selected screenshots to OpenAI through that key.

## Install

Download the latest signed and notarized installer from [jessee.ai](https://jessee.ai) or the [latest GitHub release](https://github.com/polyform-ai/jessee/releases/latest).

1. Open `JesSee.dmg`.
2. Drag JesSee to Applications.
3. Open JesSee from Applications and complete the four-step setup.
4. Use the menu-bar icon to record, import video, open the library, or check for updates.

The browser extensions have been retired. The native app records Safari, Chrome, and other Mac apps without an extension.

## Recording controls

The floating recording bar shows the elapsed time and microphone activity. Hover any control to see its purpose and shortcut.

| Action | Shortcut |
| --- | --- |
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
