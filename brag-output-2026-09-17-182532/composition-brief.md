# Hyperframes Composition Brief: JesSee

## Objective
Create a short launch-style brag video for JesSee.

## Output
- Composition directory: `brag-output-2026-09-17-182532/composition/`
- Rendered video: `brag-output-2026-09-17-182532/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 22.4 seconds

## Source Material
- Project root: `/Users/ahmedelsamadisi/Documents/development/WORKING/jessee-launch-video-20260917`
- Primary files read: `website/index.html`, `website/styles.css`, `README.md`, `package.json`, and real product screenshots under `website/assets/`
- Product name: JesSee
- Tagline / strongest claim: “Help AI see what you see.”
- Key UI or visual moment to recreate: the current native image picker showing ranked screenshots, highlight/redact controls, and the selected evidence
- Copy that must appear verbatim:
  - “Show it once. Send the useful version.”
  - “JesSee”

## Creative Direction
- Tone preset: app-store
- Creative direction: warm, editorial Mac product film with real screenshots and restrained physical motion
- Interpretation: use large readable copy, smooth slides and camera moves, and enough hold time for the actual interface to be understood.
- Angle: video is easy to create but difficult to reuse; JesSee preserves the natural walkthrough while turning it into selected evidence, editable structure, and a durable PDF.
- Hook: “A screen recording is easy to make. Awful to use.”
- Outro / punchline: “Show it once. Send the useful version.”
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Claims about managed Polyform AI, auth, transcription workflows, or public PDF links

## Visual Identity
- Background: #f7f5ef
- Text: #18181b
- Accent: #5653e8
- Display font: Manrope with system sans fallback
- Body font: Manrope with system sans fallback; Newsreader/Georgia for editorial emphasis
- Visual references from the project: warm paper texture, violet/coral signal colors, rounded Mac windows, current native menu-bar app, image picker, Library/editor, and JesSee icon

## Storyboard
Use the storyboard in `brag-output-2026-09-17-182532/brag-plan.md` as the creative contract.

Scene summary:
1. The video problem — 4.4s — 18:42 timeline and the hook.
2. Show what matters — 4.4s — native menu-bar app, cursor click, capture guide.
3. Keep the final say — 5.2s — native image picker, ranked evidence, real highlight.
4. A story that travels — 4.6s — PDF and native Library/editor resolve.
5. Brand close — 3.8s — JesSee lockup and jessee.ai.

## Audio
- Audio role: sparse professional accents
- Audio arc: one warm problem impact, two precise product interactions, a two-part document resolve, and a soft brand payoff
- Music: none; public redistribution rights for the bundled tracks are not documented and the catalog provider is unavailable
- Music treatment: none
- Music cue guidance: visual timings may borrow the bundled vol-12 beat grid as silent pacing guidance only
- Audio-reactive treatment: none because there is no music bed
- Audio-coupled moments:
  - Scene 2 annotation — cursor click and soft confirmation
  - Scene 3 evidence selection — precise click and reveal
  - Scene 4 PDF/Library — two soft placement cues
  - Scene 5 logo — restrained bell payoff
- SFX selection guidance: use CC0 low-risk clicks and soft impacts from the Brag library; keep every cue quiet and isolated
- SFX analysis guidance: `/Users/ahmedelsamadisi/.codex/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: use `interface/click_003.ogg`, `impact/impactSoft_medium_001.ogg`, and `impact/impactBell_heavy_000.ogg`
- Audio files: copy selected SFX into `brag-output-2026-09-17-182532/composition/assets/`

## Hyperframes Instructions
Use the loaded Hyperframes domain guidance: core for composition timing, animation for choreography, creative for brand and scene direction, keyframes for camera moves, registry components for the cursor/camera primitives, and CLI for lint/check/preview/render.

Requirements:
- Show the real capture, editor, Library, PDF, and JesSee icon assets from the source project.
- Keep all text readable in the final render.
- Keep the video within 15–25 seconds.
- Use only locally copied assets at render time.
- Let the image picker remain visible long enough to understand the ranked alternatives, selection, and highlight.
- Keep the final lockup fully settled for at least 1.8 seconds.
- Run `hyperframes check` before preview.
