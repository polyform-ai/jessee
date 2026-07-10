let videoRecorder: MediaRecorder | undefined;
let audioRecorder: MediaRecorder | undefined;
let mixedStream: MediaStream | undefined;
let audioOnlyStream: MediaStream | undefined;
const videoChunks: Blob[] = [];
const audioChunks: Blob[] = [];
const port = chrome.runtime.connect({ name: "recorder" });

port.onMessage.addListener((message) => {
  if (message.type === "START_RECORDING") {
    void trace("start-message");
    start(message.streamId, message.includeMic).catch((error: unknown) => {
      void trace(`start-error:${error instanceof Error ? error.message : String(error)}`);
      port.postMessage({ type: "OFFSCREEN_ERROR", error: error instanceof Error ? error.message : String(error) });
    });
  }
  if (message.type === "PAUSE_RECORDING") {
    videoRecorder?.pause();
    audioRecorder?.pause();
    port.postMessage({ type: "OFFSCREEN_PAUSED" });
  }
  if (message.type === "RESUME_RECORDING") {
    videoRecorder?.resume();
    audioRecorder?.resume();
    port.postMessage({ type: "OFFSCREEN_RESUMED" });
  }
  if (message.type === "STOP_RECORDING") stop();
});
port.postMessage({ type: "OFFSCREEN_READY" });

async function start(streamId: string, includeMic: boolean): Promise<void> {
  await trace("start-called");
  videoChunks.length = 0;
  audioChunks.length = 0;

  await trace("before-display-media");
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    } as MediaTrackConstraints
  });
  await trace(`after-display-media:${tabStream.getVideoTracks().length}`);

  let destination: MediaStreamAudioDestinationNode | undefined;
  let micStream: MediaStream | undefined;
  if (includeMic) {
    const audioContext = new AudioContext();
    destination = audioContext.createMediaStreamDestination();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext.createMediaStreamSource(micStream).connect(destination);
    await trace("after-mic");
  }

  mixedStream = new MediaStream([...tabStream.getVideoTracks(), ...(destination?.stream.getAudioTracks() ?? [])]);
  audioOnlyStream = destination ? new MediaStream(destination.stream.getAudioTracks()) : undefined;

  videoRecorder = new MediaRecorder(mixedStream, { mimeType: pickMimeType(["video/webm;codecs=vp9,opus", "video/webm"]) });
  audioRecorder = audioOnlyStream ? new MediaRecorder(audioOnlyStream, { mimeType: pickMimeType(["audio/webm;codecs=opus", "audio/webm"]) }) : undefined;

  videoRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) videoChunks.push(event.data);
  };
  if (audioRecorder) {
    audioRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };
  }
  videoRecorder.onstop = async () => {
    const videoDataUrl = await blobToDataUrl(new Blob(videoChunks, { type: videoRecorder?.mimeType || "video/webm" }));
    const audioDataUrl = audioChunks.length
      ? await blobToDataUrl(new Blob(audioChunks, { type: audioRecorder?.mimeType || "audio/webm" }))
      : undefined;
    cleanup();
    port.postMessage({ type: "OFFSCREEN_STOPPED", videoDataUrl, audioDataUrl });
  };

  audioRecorder?.start(1000);
  videoRecorder.start(1000);
  await trace("recorders-started");
  port.postMessage({ type: "OFFSCREEN_STARTED" });
}

function stop(): void {
  if (audioRecorder?.state !== "inactive") audioRecorder?.stop();
  if (videoRecorder?.state !== "inactive") videoRecorder?.stop();
}

function cleanup(): void {
  for (const track of mixedStream?.getTracks() ?? []) track.stop();
  for (const track of audioOnlyStream?.getTracks() ?? []) track.stop();
  mixedStream = undefined;
  audioOnlyStream = undefined;
  videoRecorder = undefined;
  audioRecorder = undefined;
}

function pickMimeType(types: string[]): string {
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function trace(event: string): Promise<void> {
  port.postMessage({ type: "OFFSCREEN_TRACE", event });
}
