# Feature usage events

JesSee can share a small, anonymous event contract so the team can understand which core workflows are completed. Sharing is off by default and can be changed in **Settings → Privacy**.

## Event contract

Every event contains a random event ID, timestamp, random installation ID, product, app version, feature, and completion status. Some events also contain a fixed source or item count. Events never contain recordings, screenshots, narration, story text, filenames, email addresses, API keys, or project identifiers.

| Activity | Recorded after | Feature |
| --- | --- | --- |
| `capture_added` | A screen recording or imported video is safely added to the local library | `screen_recording` or `video_import` |
| `story_created` | Background processing finishes and the visual story is ready | `story_creation` |
| `story_edited` | An edited story and PDF are saved | `story_editor` |
| `pdf_opened` | The finished PDF is opened from JesSee | `pdf_review` |

The app appends the same payload to `~/Library/Application Support/jessee/feature-usage.jsonl` so it can be inspected locally. Distribution builds receive the HTTPS collection endpoint through the `FEATURE_USAGE_ENDPOINT` GitHub secret; the endpoint is not committed to the repository. Failed network delivery never blocks the product workflow.
