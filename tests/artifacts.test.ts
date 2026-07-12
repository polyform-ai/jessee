import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { artifactRef, deleteSessionArtifacts, getArtifact, hydrateSession, putArtifact } from "../src/artifacts";
import type { RecordingSession } from "../src/types";

describe("hydrateSession", () => {
  it("does not leave unresolved artifact refs in media fields", async () => {
    const session: RecordingSession = {
      status: "stopped",
      timeline: [],
      screenshots: [
        {
          id: "shot-1",
          capturedAtMs: 0,
          url: "https://example.test",
          title: "Example",
          dataUrl: "idb:missing-shot",
          annotations: [],
          redactions: []
        }
      ],
      videoDataUrl: "idb:missing-video",
      audioDataUrl: "idb:missing-audio"
    };

    const hydrated = await hydrateSession(session);

    expect(hydrated.videoDataUrl).toBeUndefined();
    expect(hydrated.audioDataUrl).toBeUndefined();
    expect(hydrated.screenshots[0].dataUrl).toBe("");
  });
});

describe("capture-scoped media artifacts", () => {
  it("keeps recording media isolated between history entries", async () => {
    const firstVideo = await putArtifact("video:capture-one", "data:video/webm;base64,b25l");
    const secondVideo = await putArtifact("video:capture-two", "data:video/webm;base64,dHdv");
    const first = await hydrateSession({ status: "stopped", timeline: [], screenshots: [], videoDataUrl: firstVideo });
    const second = await hydrateSession({ status: "stopped", timeline: [], screenshots: [], videoDataUrl: secondVideo });

    expect(first.videoDataUrl).toBe("data:video/webm;base64,b25l");
    expect(second.videoDataUrl).toBe("data:video/webm;base64,dHdv");
    expect(artifactRef("video:capture-one")).not.toBe(artifactRef("video:capture-two"));
  });

  it("deletes every IndexedDB artifact owned by an expired session", async () => {
    const screenshot = await putArtifact("screenshot:expired", "data:image/jpeg;base64,b2xk");
    const video = await putArtifact("video:expired", "data:video/webm;base64,b2xk");
    const session: RecordingSession = {
      status: "stopped",
      timeline: [],
      screenshots: [{ id: "shot", capturedAtMs: 0, url: "", title: "", dataUrl: screenshot, annotations: [], redactions: [] }],
      videoDataUrl: video
    };

    await deleteSessionArtifacts(session);

    expect(await getArtifact(screenshot)).toBeUndefined();
    expect(await getArtifact(video)).toBeUndefined();
  });
});
