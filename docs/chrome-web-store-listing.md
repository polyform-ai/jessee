# JesSee — Chrome Web Store listing

## Store details

- **Name:** JesSee
- **Category:** Productivity
- **Language:** English
- **Short description:** Turn narrated screen walkthroughs into polished, evidence-backed PDF tickets and guides.

## Detailed description

JesSee turns a narrated screen walkthrough into a document people and AI can act on.

Instead of writing a long ticket, taking disconnected screenshots, or asking someone to watch an entire video, choose what to capture, explain the workflow in your own words, and let JesSee organize the useful evidence into a polished PDF.

Use JesSee for:

- Engineering bug reports and reproduction steps
- Feature requests and product requirements
- QA walkthroughs and test evidence
- Support handoffs and troubleshooting guides
- Onboarding notes and step-by-step tutorials

### How it works

1. Enable the microphone you want JesSee to use in Settings.
2. Start a capture and choose a tab, window, or screen in Chrome's share picker.
3. Explain the workflow naturally while JesSee records your narration and timestamped visual evidence.
4. Review the AI-generated plan and selected screenshots.
5. Generate an evidence-backed PDF that is easy to read, share, and feed into another AI workflow.

JesSee captures detailed visual context while you work, then uses your narration to select the moments that matter. The result is structured context—not just another video.

## Privacy disclosure copy

JesSee captures only the tab, window, or screen you explicitly select in Chrome's share picker. Microphone narration is enabled separately in JesSee Settings.

Recordings, screenshots, and generated PDFs are stored locally on your computer. When you choose Create Plan or Generate PDF, JesSee sends the capture evidence and narration needed to create that document to OpenAI using the API key you provide. The open-source build has no analytics or telemetry endpoint configured.

## Permission justifications

- **Screen/tab capture:** Records the tab, window, or screen selected by the user and takes timestamped screenshots for document evidence.
- **Microphone:** Records the user's narration; JesSee never starts capture without an enabled microphone.
- **Side panel:** Keeps recording controls available alongside the page being explained.
- **Active tab, tabs, and scripting:** Adds the optional cursor/annotation overlay to the page being captured and records the selected page's context.
- **Downloads:** Saves the generated PDF to the user's computer.
- **Storage and offscreen:** Keeps local settings and capture artifacts, and records media reliably while the side panel remains responsive.
- **Host access:** Allows the cursor/annotation overlay to work on the site the user chooses to explain.

## Support and contributions

Need help, have an idea, or found a problem? Open an issue at https://github.com/polyform-ai/jessee/issues.

Contributions are welcome. Please open a pull request with improvements to recording quality, templates, accessibility, testing, or integrations.

For collaboration or part-time work on JesSee, contact Ahmed at ahmed@polyform.ai.
