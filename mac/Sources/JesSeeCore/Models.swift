import Foundation

public enum CaptureSource: String, Codable, Sendable, CaseIterable {
  case recording
  case importedVideo = "imported_video"

  public var label: String {
    switch self {
    case .recording: "Recorded"
    case .importedVideo: "Imported"
    }
  }
}

public enum CaptureStage: String, Codable, Sendable, CaseIterable {
  case saved
  case preparingAudio = "preparing_audio"
  case transcribing
  case choosingImages = "choosing_images"
  case creatingStory = "creating_story"
  case ready
  case failed

  public var label: String {
    switch self {
    case .saved: "Saved"
    case .preparingAudio: "Preparing audio"
    case .transcribing: "Transcribing"
    case .choosingImages: "Choosing images"
    case .creatingStory: "Creating story"
    case .ready: "Ready to review"
    case .failed: "Needs attention"
    }
  }

  public var isProcessing: Bool {
    switch self {
    case .preparingAudio, .transcribing, .choosingImages, .creatingStory: true
    default: false
    }
  }
}

public struct TranscriptSegment: Codable, Sendable, Equatable, Identifiable {
  public var id: Int
  public var start: Double
  public var end: Double
  public var text: String

  public init(id: Int, start: Double, end: Double, text: String) {
    self.id = id
    self.start = start
    self.end = end
    self.text = text
  }
}

public struct TranscriptWord: Codable, Sendable, Equatable {
  public var word: String
  public var start: Double
  public var end: Double

  public init(word: String, start: Double, end: Double) {
    self.word = word
    self.start = start
    self.end = end
  }
}

public struct TranscriptDocument: Codable, Sendable, Equatable {
  public var text: String
  public var language: String?
  public var duration: Double?
  public var segments: [TranscriptSegment]
  public var words: [TranscriptWord]
  public var provider: String
  public var model: String

  public init(
    text: String,
    language: String? = nil,
    duration: Double? = nil,
    segments: [TranscriptSegment] = [],
    words: [TranscriptWord] = [],
    provider: String = "OpenAI",
    model: String = "whisper-1"
  ) {
    self.text = text
    self.language = language
    self.duration = duration
    self.segments = segments
    self.words = words
    self.provider = provider
    self.model = model
  }
}

public struct StoryStep: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var startSeconds: Double
  public var endSeconds: Double
  public var title: String
  public var narrative: String
  public var transcript: String
  public var imageFilename: String?

  public init(
    id: String = UUID().uuidString.lowercased(),
    startSeconds: Double,
    endSeconds: Double,
    title: String,
    narrative: String,
    transcript: String,
    imageFilename: String? = nil
  ) {
    self.id = id
    self.startSeconds = startSeconds
    self.endSeconds = endSeconds
    self.title = title
    self.narrative = narrative
    self.transcript = transcript
    self.imageFilename = imageFilename
  }
}

public struct StoryKeyPoint: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var text: String

  public init(id: String = UUID().uuidString.lowercased(), text: String) {
    self.id = id
    self.text = text
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case text
  }

  public init(from decoder: any Decoder) throws {
    if let legacy = try? decoder.singleValueContainer().decode(String.self) {
      self.init(text: legacy)
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      id: try container.decodeIfPresent(String.self, forKey: .id)
        ?? UUID().uuidString.lowercased(),
      text: try container.decode(String.self, forKey: .text)
    )
  }
}

public struct StoryDocument: Codable, Sendable, Equatable {
  public var title: String
  public var summary: String
  public var keyPoints: [StoryKeyPoint]
  public var steps: [StoryStep]

  public init(title: String, summary: String, keyPoints: [String], steps: [StoryStep]) {
    self.title = title
    self.summary = summary
    self.keyPoints = keyPoints.map { StoryKeyPoint(text: $0) }
    self.steps = steps
  }
}

public struct CaptureRecord: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var createdAt: Date
  public var updatedAt: Date
  public var title: String
  public var source: CaptureSource
  public var stage: CaptureStage
  public var duration: Double?
  public var mediaFilename: String
  public var transcriptFilename: String?
  public var storyFilename: String?
  public var htmlFilename: String?
  public var pdfFilename: String?
  public var imageFilenames: [String]
  public var error: String?

  public init(
    id: String = UUID().uuidString.lowercased(),
    createdAt: Date = Date(),
    updatedAt: Date = Date(),
    title: String,
    source: CaptureSource,
    stage: CaptureStage = .saved,
    duration: Double? = nil,
    mediaFilename: String,
    transcriptFilename: String? = nil,
    storyFilename: String? = nil,
    htmlFilename: String? = nil,
    pdfFilename: String? = nil,
    imageFilenames: [String] = [],
    error: String? = nil
  ) {
    self.id = id
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.title = title
    self.source = source
    self.stage = stage
    self.duration = duration
    self.mediaFilename = mediaFilename
    self.transcriptFilename = transcriptFilename
    self.storyFilename = storyFilename
    self.htmlFilename = htmlFilename
    self.pdfFilename = pdfFilename
    self.imageFilenames = imageFilenames
    self.error = error
  }
}

public struct JesSeeConfiguration: Codable, Sendable, Equatable {
  public var email: String
  public var outputFolderPath: String
  public var setupCompleted: Bool
  public var shareScreenshotsWithOpenAI: Bool

  public init(
    email: String = "", outputFolderPath: String = "", setupCompleted: Bool = false,
    shareScreenshotsWithOpenAI: Bool = true
  ) {
    self.email = email
    self.outputFolderPath = outputFolderPath
    self.setupCompleted = setupCompleted
    self.shareScreenshotsWithOpenAI = shareScreenshotsWithOpenAI
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
    outputFolderPath = try container.decodeIfPresent(String.self, forKey: .outputFolderPath) ?? ""
    setupCompleted = try container.decodeIfPresent(Bool.self, forKey: .setupCompleted) ?? false
    shareScreenshotsWithOpenAI =
      try container.decodeIfPresent(Bool.self, forKey: .shareScreenshotsWithOpenAI) ?? true
  }
}

public enum JesSeeError: LocalizedError, Equatable {
  case missingAPIKey
  case invalidAPIKey
  case keychainUnavailable(String)
  case openAIPermission(String)
  case openAIUnavailable(String)
  case outputFolderUnavailable
  case sourceUnavailable(String)
  case mediaHasNoAudio
  case audioTooLarge
  case invalidResponse(String)
  case recordingFailed(String)

  public var errorDescription: String? {
    switch self {
    case .missingAPIKey: "Add your OpenAI API key in Settings first."
    case .invalidAPIKey: "The OpenAI API key is not valid."
    case .keychainUnavailable(let detail):
      "OpenAI connected, but macOS could not save the key in Keychain. \(detail)"
    case .openAIPermission(let detail):
      "The key connected, but it cannot access a model JesSee needs. \(detail)"
    case .openAIUnavailable(let detail): "JesSee could not reach OpenAI. \(detail)"
    case .outputFolderUnavailable: "Choose an output folder before recording or importing."
    case .sourceUnavailable(let path): "The source video is no longer available at \(path)."
    case .mediaHasNoAudio: "This video does not contain an audio track to transcribe."
    case .audioTooLarge: "The prepared audio is too large to transcribe in one request."
    case .invalidResponse(let message): message
    case .recordingFailed(let message): "Recording failed: \(message)"
    }
  }
}

public enum JesSeeJSON {
  public static func encoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  public static func decoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }
}
