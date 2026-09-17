import Foundation

public struct CaptureProcessor: Sendable {
  public typealias ProgressHandler = @Sendable (CaptureRecord) async -> Void

  private let workspace: CaptureWorkspace
  private let client: OpenAIClient

  public init(workspace: CaptureWorkspace, client: OpenAIClient = OpenAIClient()) {
    self.workspace = workspace
    self.client = client
  }

  public func process(
    recordID: String, apiKey: String, includeScreenshotPixels: Bool = true,
    onProgress: ProgressHandler? = nil
  )
    async throws -> CaptureRecord
  {
    guard var record = await workspace.record(id: recordID) else {
      throw JesSeeError.invalidResponse("This capture is no longer in the JesSee Library.")
    }
    do {
      let directory = workspace.directoryURL(for: record)
      let mediaURL = workspace.mediaURL(for: record)
      let details = try await MediaTools.inspect(mediaURL)
      record.duration = details.duration
      try await update(&record, stage: .preparingAudio, onProgress: onProgress)

      let audioURL = directory.appendingPathComponent("narration.m4a")
      try await MediaTools.extractAudio(from: mediaURL, to: audioURL)
      try await update(&record, stage: .transcribing, onProgress: onProgress)

      let transcript = try await client.transcribe(audioURL: audioURL, apiKey: apiKey)
      try await workspace.write(transcript, filename: "transcript.json", for: record)
      try MediaTools.srt(from: transcript).write(
        to: directory.appendingPathComponent("transcript.srt"), atomically: true, encoding: .utf8)
      try MediaTools.vtt(from: transcript).write(
        to: directory.appendingPathComponent("transcript.vtt"), atomically: true, encoding: .utf8)
      record.transcriptFilename = "transcript.json"
      try await update(&record, stage: .choosingImages, onProgress: onProgress)

      let times = MediaTools.frameTimes(
        duration: details.duration,
        segments: transcript.segments,
        notableTimes: record.recordingMarkups?.map(\.createdAtSeconds) ?? []
      )
      let frames = try await MediaTools.extractFrames(
        from: mediaURL,
        times: times,
        to: directory.appendingPathComponent("screenshots", isDirectory: true),
        recordingMarkups: record.recordingMarkups ?? []
      )
      record.imageFilenames = frames.map(\.filename)
      record.imageTimes = Dictionary(uniqueKeysWithValues: frames.map { ($0.filename, $0.seconds) })
      try await update(&record, stage: .creatingStory, onProgress: onProgress)

      let story = try await client.createStory(
        transcript: transcript,
        frames: frames,
        captureDirectory: directory,
        apiKey: apiKey,
        includeScreenshotPixels: includeScreenshotPixels
      )
      try await workspace.write(story, filename: "story.json", for: record)
      let rendered = try await DocumentRenderer.render(story: story, in: directory)
      record.title = story.title.isEmpty ? record.title : story.title
      record.storyFilename = "story.json"
      record.htmlFilename = rendered.html
      record.pdfFilename = rendered.pdf
      record.error = nil
      try await update(&record, stage: .ready, onProgress: onProgress)
      return record
    } catch {
      record.stage = .failed
      record.error = error.localizedDescription
      try? await workspace.save(record)
      await onProgress?(record)
      throw error
    }
  }

  private func update(
    _ record: inout CaptureRecord,
    stage: CaptureStage,
    onProgress: ProgressHandler?
  ) async throws {
    record.stage = stage
    record.error = nil
    try await workspace.save(record)
    await onProgress?(record)
  }
}
