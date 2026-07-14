# JesSee

### Help AI see what you see.

Communication today is surprisingly inefficient.

We write long tickets. We take screenshots. We jump on calls. We record videos. Then someone, whether it's another person or an AI, has to watch everything, understand the context, and turn it into action.

JesSee is built around a simple idea:

**The best way to explain something is to show it.**

Record your screen, talk through what you're thinking, and let AI transform that explanation into structured knowledge.

A single recording can become:

- A bug report
- A feature ticket
- A PRD
- A construction guide
- A support article
- A knowledge base document
- A step by step tutorial
- Or anything else the recipient needs

The recording is simply the source of truth. The output is tailored to the purpose.

## Beyond Documentation

JesSee isn't about creating videos.

It's about creating understanding.

Instead of asking people or AI to consume a 15 minute recording, JesSee extracts the important moments, organizes them into logical sections, identifies key decisions, captures screenshots where they matter, and produces clean, structured documents that are easy to consume.

Think of it as turning communication into structured context.

## Why I Built It

I originally built JesSee because I realized I naturally explain work by showing it.

When I file bugs or describe new features, I almost never want to write a long ticket. I open a screen recorder, walk through the product, explain my thoughts out loud, and then hand that recording to AI.

The AI writes a much better ticket than I would have.

It's faster.

It's more accurate.

And it preserves context that would otherwise be lost.

That simple workflow has become one of the most valuable tools I use every day.

## Where This Goes

Today JesSee can turn a recording into a polished document.

Tomorrow it becomes much more.

Imagine every recording becoming structured context that can be explored by both humans and AI.

The same recording could generate multiple outputs:

- Engineering tickets
- Product requirements
- QA test plans
- Customer facing documentation
- Executive summaries
- Onboarding guides

Instead of replaying a video over and over, anyone could ask questions directly against the captured context.

> Create three engineering tickets.

> Summarize this for product.

> Turn this into onboarding documentation.

> What changed compared to the previous walkthrough?

> Which parts of this workflow seem confusing?

The recording becomes a living source of knowledge rather than a static video.

## Open Source

JesSee is an open source project because I believe communication with AI is still in its infancy.

There is a huge opportunity to rethink how humans express ideas to machines.

Today we mostly type prompts.

Tomorrow we'll show, explain, sketch, annotate, and collaborate naturally.

JesSee is an experiment in building that future.

JesSee improves fastest when people share the real communication problems they run into.

- Found a bug, a confusing workflow, or an idea for a new document type? [Open an issue](https://github.com/polyform-ai/jessee/issues).
- Want to build an improvement? Fork the project and [open a pull request](https://github.com/polyform-ai/jessee/pulls).
- Interested in collaborating or working on JesSee part time? Email Ahmed at [ahmed@polyform.ai](mailto:ahmed@polyform.ai).

Good first contributions include better document templates, accessibility improvements, capture-quality work, integrations, and tests that make the recording flow more reliable.

## The Vision

Long term, I'd love to work with engineers, designers, and AI researchers who are excited about improving how humans communicate with AI.

The current project is intentionally simple, but there are many directions to explore:

- Rich sharing and collaboration
- Uploading existing videos for AI understanding
- Multiple document outputs from the same recording
- Timeline based context exploration
- Interactive conversations with captured walkthroughs
- Better screenshot extraction and annotation
- AI generated follow up questions when context is missing
- Integration with products like Polyform for deeper workflow automation

Ultimately, I don't think we're building a better screen recorder.

We're building a better way to communicate.

## Current Chrome Extension

JesSee currently ships as a Chrome MV3 extension that captures screen context, microphone narration, cursor movement, and timestamped screenshots. It prepares an editable AI plan, lets you review the goal, story, and selected screenshots, then turns the walkthrough into a clean PDF through OpenAI.

### What JesSee captures and sends

JesSee only captures a tab, window, or screen after you explicitly choose it in Chrome's share picker. Microphone narration is enabled separately in Settings and is required before a capture can begin.

Captures, screenshots, recordings, and PDFs stay on your computer. When you choose **Create Plan** or **Generate PDF**, JesSee sends the selected capture evidence and narration to OpenAI using the API key you provide so it can prepare the document. The public source has no analytics endpoint configured.

## Local Use

1. Build the extension:

   ```bash
   npm run build
   ```

2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select:

   ```text
   path/to/jessee/dist
   ```

6. Open the extension, add your email, a fresh OpenAI API key, and choose a local output folder.
7. Click **Start Capture**, choose the tab/window/screen in Chrome's picker, explain the flow, then click **Close Capture**.
8. While recording, hold **B** and drag to draw an outline box, or hold **R** and drag to blur/redact an area. The marked frame is captured automatically.
9. Create the plan to open the visual plan editor. Edits save automatically; use the screenshot dropdown or Previous/Next controls to inspect and change the exact evidence used in the PDF.
10. Generate and download the PDF from the plan editor or the recorder.

Mic narration and cursor highlighting are always enabled. JesSee captures timestamped screenshots automatically and pairs them with the timestamped transcript.

## Development

Install dependencies:

```bash
npm install
```

Run a production build:

```bash
npm run build
```

Run the full local check:

```bash
npm run check
```

Telemetry/webhook posting is disabled in the public source. If you are experimenting locally, keep private endpoints out of commits.

## Validation

```bash
npm run check
```

This runs TypeScript, builds the extension, runs unit tests, and loads the extension settings page in Playwright Chromium.
