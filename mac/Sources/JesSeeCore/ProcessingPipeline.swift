import Foundation

public enum StoryProcessingService: Sendable {
  case polyform(client: PolyformClient, accessToken: String)
  case openAI(client: DirectOpenAIClient, apiKey: String)

  func transcribe(audioURL: URL) async throws -> TranscriptDocument {
    switch self {
    case .polyform(let client, let accessToken):
      try await client.transcribe(audioURL: audioURL, accessToken: accessToken)
    case .openAI(let client, let apiKey):
      try await client.transcribe(audioURL: audioURL, apiKey: apiKey)
    }
  }

  func createStory(
    transcript: TranscriptDocument, frames: [CapturedFrame], captureDirectory: URL,
    includeScreenshotPixels: Bool
  ) async throws -> StoryDocument {
    switch self {
    case .polyform(let client, let accessToken):
      try await client.createStory(
        transcript: transcript, frames: frames, captureDirectory: captureDirectory,
        accessToken: accessToken, includeScreenshotPixels: includeScreenshotPixels)
    case .openAI(let client, let apiKey):
      try await client.createStory(
        transcript: transcript, frames: frames, captureDirectory: captureDirectory,
        apiKey: apiKey, includeScreenshotPixels: includeScreenshotPixels)
    }
  }

  func refineStory(
    _ story: StoryDocument, transcript: TranscriptDocument, frames: [CapturedFrame],
    captureDirectory: URL, round: Int
  ) async throws -> StoryDocument {
    switch self {
    case .polyform(let client, let accessToken):
      try await client.refineStory(
        story, transcript: transcript, frames: frames, captureDirectory: captureDirectory,
        round: round, accessToken: accessToken)
    case .openAI(let client, let apiKey):
      try await client.refineStory(
        story, transcript: transcript, frames: frames, captureDirectory: captureDirectory,
        round: round, apiKey: apiKey)
    }
  }
}

public struct CaptureProcessor: Sendable {
  public typealias ProgressHandler = @Sendable (CaptureRecord) async -> Void

  private let workspace: CaptureWorkspace
  private let service: StoryProcessingService

  public init(workspace: CaptureWorkspace, service: StoryProcessingService) {
    self.workspace = workspace
    self.service = service
  }

  public func process(
    recordID: String, includeScreenshotPixels: Bool = true,
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

      let transcript = try await service.transcribe(audioURL: audioURL)
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

      var story = try await service.createStory(
        transcript: transcript,
        frames: frames,
        captureDirectory: directory,
        includeScreenshotPixels: includeScreenshotPixels
      )
      if includeScreenshotPixels {
        var selectionFrames = frames
        for round in 1...StoryRefinement.maximumRounds {
          let selectedFrames = StoryRefinement.selectedFrames(for: story, in: selectionFrames)
          let candidateTimes = StoryRefinement.candidateTimes(
            for: story, frames: selectionFrames, duration: details.duration
          ).filter { candidate in
            !selectedFrames.contains(where: { abs($0.seconds - candidate) < 0.35 })
          }
          guard !candidateTimes.isEmpty || !selectedFrames.isEmpty else { break }
          do {
            let nearbyFrames = try await MediaTools.extractFrames(
              from: mediaURL,
              times: candidateTimes,
              to: directory.appendingPathComponent("screenshots", isDirectory: true),
              recordingMarkups: record.recordingMarkups ?? [],
              filenamePrefix: "refine-\(round)"
            )
            record.imageFilenames.append(contentsOf: nearbyFrames.map(\.filename))
            var imageTimes = record.imageTimes ?? [:]
            for frame in nearbyFrames { imageTimes[frame.filename] = frame.seconds }
            record.imageTimes = imageTimes
            let refinementFrames = (selectedFrames + nearbyFrames).sorted { $0.seconds < $1.seconds }
            story = try await service.refineStory(
              story,
              transcript: transcript,
              frames: refinementFrames,
              captureDirectory: directory,
              round: round)
            selectionFrames = refinementFrames
          } catch is CancellationError {
            throw CancellationError()
          } catch {
            break
          }
        }
      }
      if let capturedSourceURL = PolyformClient.normalizedWebURL(record.sourceURL) {
        story.sourceURL = capturedSourceURL
      }
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
      // AppStore owns retry classification and persists the failed-attempt count, recovery
      // requirement, and visible error together. Leaving the latest processing stage here also
      // makes an interruption before that atomic update safely resumable on the next launch.
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
