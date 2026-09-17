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
  public var narrativeHTML: String?
  public var transcript: String
  public var imageFilename: String?
  public var imageAnnotations: [StoryAnnotation]

  public init(
    id: String = UUID().uuidString.lowercased(),
    startSeconds: Double,
    endSeconds: Double,
    title: String,
    narrative: String,
    narrativeHTML: String? = nil,
    transcript: String,
    imageFilename: String? = nil,
    imageAnnotations: [StoryAnnotation] = []
  ) {
    self.id = id
    self.startSeconds = startSeconds
    self.endSeconds = endSeconds
    self.title = title
    self.narrative = narrative
    self.narrativeHTML = narrativeHTML
    self.transcript = transcript
    self.imageFilename = imageFilename
    self.imageAnnotations = imageAnnotations
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case startSeconds
    case endSeconds
    case title
    case narrative
    case narrativeHTML
    case transcript
    case imageFilename
    case imageAnnotations
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      id: try container.decodeIfPresent(String.self, forKey: .id)
        ?? UUID().uuidString.lowercased(),
      startSeconds: try container.decode(Double.self, forKey: .startSeconds),
      endSeconds: try container.decode(Double.self, forKey: .endSeconds),
      title: try container.decode(String.self, forKey: .title),
      narrative: try container.decode(String.self, forKey: .narrative),
      narrativeHTML: try container.decodeIfPresent(String.self, forKey: .narrativeHTML),
      transcript: try container.decode(String.self, forKey: .transcript),
      imageFilename: try container.decodeIfPresent(String.self, forKey: .imageFilename),
      imageAnnotations: try container.decodeIfPresent(
        [StoryAnnotation].self, forKey: .imageAnnotations) ?? []
    )
  }
}

public enum StoryAnnotationKind: String, Codable, Sendable, Equatable {
  case highlight
  case redaction
}

public struct StoryAnnotation: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var kind: StoryAnnotationKind
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(
    id: String = UUID().uuidString.lowercased(), kind: StoryAnnotationKind, x: Double, y: Double,
    width: Double, height: Double
  ) {
    self.id = id
    self.kind = kind
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

public enum RecordingMarkupKind: String, Codable, Sendable, Equatable {
  case pen
  case highlight
}

public struct RecordingMarkupPoint: Codable, Sendable, Equatable {
  public var x: Double
  public var y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct RecordingMarkupStroke: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var kind: RecordingMarkupKind
  public var points: [RecordingMarkupPoint]
  public var createdAtSeconds: Double
  public var removedAtSeconds: Double?

  public init(
    id: String = UUID().uuidString.lowercased(),
    kind: RecordingMarkupKind,
    points: [RecordingMarkupPoint],
    createdAtSeconds: Double,
    removedAtSeconds: Double? = nil
  ) {
    self.id = id
    self.kind = kind
    self.points = points
    self.createdAtSeconds = createdAtSeconds
    self.removedAtSeconds = removedAtSeconds
  }

  public func isVisible(at seconds: Double) -> Bool {
    createdAtSeconds <= seconds && (removedAtSeconds.map { seconds < $0 } ?? true)
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
  public var summaryHTML: String?
  public var keyPoints: [StoryKeyPoint]
  public var steps: [StoryStep]

  public init(
    title: String, summary: String, summaryHTML: String? = nil, keyPoints: [String],
    steps: [StoryStep]
  ) {
    self.title = title
    self.summary = summary
    self.summaryHTML = summaryHTML
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
  public var imageTimes: [String: Double]?
  public var recordingMarkups: [RecordingMarkupStroke]?
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
    imageTimes: [String: Double]? = nil,
    recordingMarkups: [RecordingMarkupStroke]? = nil,
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
    self.imageTimes = imageTimes
    self.recordingMarkups = recordingMarkups
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

  public func pendingSetupStep(hasAPIKey: Bool) -> Int {
    if !hasAPIKey { return 0 }
    if email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return 1 }
    if outputFolderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return 2 }
    return 3
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
