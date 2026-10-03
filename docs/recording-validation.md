# Recording audio and annotation validation

Run `npm run mac:check` for editor type checks, editor tests, Swift regressions, and app assembly.

The Swift tests cover silent tracks, late quiet audio in the second channel, 16/24/32-bit integer and 32/64-bit float PCM input (including packed, big-endian, and aligned 24-bit USB formats), microphone warning timing and recovery, missing-input selection, saved configuration, old captures without geometry metadata, AppKit pointer coordinates near the menu bar, window resizing, and annotated-image pixels with Retina video padding.

For a fresh native ScreenCaptureKit check, use an unlocked desktop with screen-capture permission:

```sh
JESSEE_NATIVE_CAPTURE_QA=1 JESSEE_QA_OUTPUT=/tmp/jessee-native-qa swift test --filter nativeCaptureMetadata
```

This optional test captures only its own test window. It verifies the capture metadata against a visible blue marker, moves/resizes the window, and verifies the exported red annotation pixels over the same marker. It saves two inspection PNGs when an output folder is provided. It is disabled in ordinary/headless CI and while the screen is locked. A locked desktop returns suspended capture frames and cannot validate a live recording.

Before claiming a complete interactive recording check, also exercise the installed app: select a microphone, speak and inspect the level meter, leave input silent for eight seconds, disconnect an active input, switch microphones during a take, draw near the top edge, move/resize the captured window, stop, and inspect exported images. Verify a silent take remains saved with an error and never produces a guessed document. Automated component tests do not substitute for this device-routing and gesture check.
