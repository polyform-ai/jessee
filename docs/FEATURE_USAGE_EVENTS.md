# Feature usage events

JesSee can share a small product-analytics event contract directly with Google Analytics 4. Sharing is off by default and can be changed in **Settings → Privacy**. The app does not use a Polyform analytics workflow or collector.

## Event contract

Every event contains a random event ID, a GA4-compatible random client ID, product, app version, feature, and completion status. Some events also contain a fixed source, mode, or item count. Events never contain email addresses, recordings, screenshots, narration, story text, filenames, API keys, workflow tokens, or project identifiers. The client ID is created only after consent and is removed when sharing is turned off.

| Activity | Recorded after | Feature |
| --- | --- | --- |
| `capture_added` | A screen recording or imported video is safely added to the local library | `screen_recording` or `video_import` |
| `story_created` | Background processing finishes and the visual story is ready | `story_creation` |
| `story_edited` | An edited story and PDF are saved | `story_editor` |
| `pdf_opened` | The finished PDF is opened from JesSee | `pdf_review` |
| `pdf_published` | The user explicitly creates or updates a public PDF link | `public_pdf` |
| `screenshot_published` | The user explicitly captures and creates a public screenshot link | `public_screenshot` |

The app appends the same feature events to `~/Library/Application Support/jessee/feature-usage.jsonl` so they can be inspected locally. Distribution builds receive the GA4 measurement ID and Measurement Protocol API secret through the `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` GitHub Actions secrets. These values are embedded in the app bundle and must be treated as public ingestion credentials, not as authentication or authorization. Failed analytics delivery never blocks the product workflow.
