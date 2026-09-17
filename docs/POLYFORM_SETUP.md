# Polyform setup for JesSee

JesSee uses one Polyform workflow-auth group for email-approved access to transcription, story creation, and optional public PDF uploads. The Mac app uses PKCE, stores the returned bearer session in Keychain, and rotates the session through the workflow-auth refresh endpoint.

These are production configuration steps; they are not performed by the app repository.

## Workflow-auth group

Use the existing **Jessee App** workflow-auth group and **Jessee User Access** policy workflow.

- Keep the current app key and email approval flow.
- Change managed upload access from `private` to `public` after the PDF upload backend supports `application/pdf`.
- Expect changing upload access to revoke existing grants. Make the change before distributing a new release or tell existing testers to sign in again.
- Keep both AI workflows protected by this same workflow-auth group.

## Audio Transcription workflow

Configure the existing protected workflow to:

- accept the managed-upload reference in `audio.upload_id`;
- use `whisper-1` with timestamps enabled;
- return `text`, `model`, `language`, `duration_seconds`, `segments`, and `words` under `result`.

Each segment must contain `start`, `end`, and `text`; an integer `id` is optional. Each word must contain `word`, `start`, and `end`.

Keep this workflow light: set the Transcribe Audio node to `whisper-1`, turn on **Include timestamps**, and return the node output without reshaping it. JesSee accepts either the structured object directly under the API `result` or one ordinary workflow output-field layer such as `result.result`.

## Story workflow

Create a light protected AI wrapper that accepts this JSON contract:

- `attachments`: the selected screenshot attachments, with the AI block's attachment source set to `attachments`;
- `user_input`: JesSee's complete story instructions followed by the transcript and every available screenshot time;
- `output_json`: a JSON example describing the exact structured result JesSee expects.

The wrapper owns the provider and model choice. Use the current quality model with medium reasoning, pass `user_input`, `attachments`, and `output_json` into the AI call, and return the parsed structured value under `result`:

```json
{
  "title": "string",
  "source_url": "https://example.com/page or null",
  "summary": "string",
  "key_points": ["string"],
  "steps": [
    {
      "start_seconds": 0,
      "end_seconds": 5,
      "screenshot_time_seconds": 4.5,
      "title": "string",
      "narrative": "string",
      "transcript": "string"
    }
  ]
}
```

The prompt should select `screenshot_time_seconds` only from the supplied screenshot options, prefer marked-up or stable result states, avoid loading/blank transition frames, and return the visible webpage URL only when it can be read confidently.

## Release configuration

Add these repository secrets before packaging a signed JesSee release:

- `TRANSCRIPTION_WORKFLOW_URL`
- `STORY_WORKFLOW_URL`
- `GA4_MEASUREMENT_ID`
- `GA4_API_SECRET`

The workflow URLs are injected into the signed app bundle. The GA4 values are used only for direct Measurement Protocol event ingestion; they are not user identity or authorization secrets.

## Public PDFs

Public links are opt-in. JesSee uploads a PDF only after the user chooses **Create public link**, stores the returned upload ID and URL with that local capture, and replaces the prior upload after the user publishes an updated PDF.

The Polyform backend must allow `application/pdf` for workflow-auth managed uploads before enabling public upload access for the group. Do not enable this for a release until the backend change has been deployed and a signed build has completed an end-to-end upload test.

## Analytics cleanup

JesSee sends optional native product events directly to GA4. The old **JesSee App Analytics Receiver** workflow is not used by this implementation and can be retired after the new app version is distributed.
