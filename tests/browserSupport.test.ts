import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCompatibleMediaRecorder,
  mediaFileExtension,
  supportsDirectoryPicker
} from "../src/browserSupport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Safari media compatibility", () => {
  it("uses Safari MP4 when WebM is unavailable", () => {
    const recorder = vi.fn();
    vi.stubGlobal("MediaRecorder", Object.assign(recorder, {
      isTypeSupported: (type: string) => type === "video/mp4"
    }));
    const stream = {} as MediaStream;

    createCompatibleMediaRecorder(stream, ["video/webm", "video/mp4"]);

    expect(recorder).toHaveBeenCalledWith(stream, { mimeType: "video/mp4" });
  });

  it("lets the browser choose defaults when no requested MIME type is supported", () => {
    const recorder = vi.fn();
    vi.stubGlobal("MediaRecorder", Object.assign(recorder, {
      isTypeSupported: () => false
    }));
    const stream = {} as MediaStream;

    createCompatibleMediaRecorder(stream, ["video/webm", "video/mp4"]);

    expect(recorder).toHaveBeenCalledWith(stream);
  });

  it("uses file extensions that match Safari and Chrome recorder output", () => {
    expect(mediaFileExtension("video/mp4", "webm")).toBe("mp4");
    expect(mediaFileExtension("audio/mp4", "webm")).toBe("m4a");
    expect(mediaFileExtension("video/webm;codecs=vp9", "mp4")).toBe("webm");
  });

  it("detects whether the browser supports choosing an export folder", () => {
    vi.stubGlobal("window", {});
    expect(supportsDirectoryPicker()).toBe(false);

    vi.stubGlobal("window", { showDirectoryPicker: vi.fn() });
    expect(supportsDirectoryPicker()).toBe(true);
  });
});
