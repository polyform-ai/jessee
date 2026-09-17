# Feature usage events

JesSee can share a small product-analytics event contract so the team can understand which core workflows are completed in GA4 and BigQuery. Sharing is off by default and can be changed in **Settings → Privacy**.

## Event contract

Every event contains a random event ID, timestamp, GA4-compatible random client ID, product, app version, feature, and completion status. Some events also contain a fixed source or item count. When a user has saved an email and opted in, JesSee sends the first-party Polyform collector an `identify` payload that maps the normalized email to a random opaque user ID. Feature events carry that user ID. The collector must keep the email in first-party identity storage and send only the opaque `user_id` to GA4. Events sent to Google never contain email addresses.

The Polyform HTTPS collector may receive routine transport metadata such as the source IP address. Events never contain recordings, screenshots, narration, story text, filenames, API keys, or project identifiers. The client ID is created only after consent and is removed when sharing is turned off.

| Activity | Recorded after | Feature |
| --- | --- | --- |
| `capture_added` | A screen recording or imported video is safely added to the local library | `screen_recording` or `video_import` |
| `story_created` | Background processing finishes and the visual story is ready | `story_creation` |
| `story_edited` | An edited story and PDF are saved | `story_editor` |
| `pdf_opened` | The finished PDF is opened from JesSee | `pdf_review` |

The app appends feature events (but not identify payloads or emails) to `~/Library/Application Support/jessee/feature-usage.jsonl` so they can be inspected locally. Distribution builds receive the HTTPS Polyform collection endpoint through the `FEATURE_USAGE_ENDPOINT` GitHub Actions secret; this avoids committing environment-specific configuration, but the endpoint is embedded in the release and must be treated as public rather than as authentication. The collector validates the event contract, translates feature events to GA4 Measurement Protocol, and retains the first-party identity mapping separately. Failed network delivery never blocks the product workflow.
