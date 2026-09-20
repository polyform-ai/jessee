import Foundation

public enum CaptureSource: String, Codable, Sendable, CaseIterable {
  case recording
  case importedVideo = "imported_video"
  case screenshot

  public var label: String {
    switch self {
    case .recording: "Recorded"
    case .importedVideo: "Imported"
    case .screenshot: "Screenshot"
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

public enum CaptureProcessingRecovery: String, Codable, Sendable, Equatable {
  case polyformSignIn = "polyform_sign_in"
  case openAIKey = "openai_key"
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
  public var sourceURL: String?
  public var summary: String
  public var summaryHTML: String?
  public var keyPoints: [StoryKeyPoint]
  public var steps: [StoryStep]

  public init(
    title: String, sourceURL: String? = nil, summary: String, summaryHTML: String? = nil,
    keyPoints: [String],
    steps: [StoryStep]
  ) {
    self.title = title
    self.sourceURL = sourceURL
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
  public var sourceURL: String?
  public var stage: CaptureStage
  public var duration: Double?
  public var mediaFilename: String
  public var transcriptFilename: String?
  public var storyFilename: String?
  public var htmlFilename: String?
  public var pdfFilename: String?
  public var publicPDFUploadID: String?
  public var publicPDFURL: String?
  public var publicPDFCleanupUploadIDs: [String]?
  public var imageFilenames: [String]
  public var imageTimes: [String: Double]?
  public var recordingMarkups: [RecordingMarkupStroke]?
  public var automaticProcessingAttempts: Int?
  public var automaticProcessingRetryAt: Date?
  public var processingRetryPolicyVersion: Int?
  public var processingProviderMode: AIProviderMode?
  public var processingRecovery: CaptureProcessingRecovery?
  public var error: String?

  public init(
    id: String = UUID().uuidString.lowercased(),
    createdAt: Date = Date(),
    updatedAt: Date = Date(),
    title: String,
    source: CaptureSource,
    sourceURL: String? = nil,
    stage: CaptureStage = .saved,
    duration: Double? = nil,
    mediaFilename: String,
    transcriptFilename: String? = nil,
    storyFilename: String? = nil,
    htmlFilename: String? = nil,
    pdfFilename: String? = nil,
    publicPDFUploadID: String? = nil,
    publicPDFURL: String? = nil,
    publicPDFCleanupUploadIDs: [String]? = nil,
    imageFilenames: [String] = [],
    imageTimes: [String: Double]? = nil,
    recordingMarkups: [RecordingMarkupStroke]? = nil,
    automaticProcessingAttempts: Int? = nil,
    automaticProcessingRetryAt: Date? = nil,
    processingRetryPolicyVersion: Int? = nil,
    processingProviderMode: AIProviderMode? = nil,
    processingRecovery: CaptureProcessingRecovery? = nil,
    error: String? = nil
  ) {
    self.id = id
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.title = title
    self.source = source
    self.sourceURL = sourceURL
    self.stage = stage
    self.duration = duration
    self.mediaFilename = mediaFilename
    self.transcriptFilename = transcriptFilename
    self.storyFilename = storyFilename
    self.htmlFilename = htmlFilename
    self.pdfFilename = pdfFilename
    self.publicPDFUploadID = publicPDFUploadID
    self.publicPDFURL = publicPDFURL
    self.publicPDFCleanupUploadIDs = publicPDFCleanupUploadIDs
    self.imageFilenames = imageFilenames
    self.imageTimes = imageTimes
    self.recordingMarkups = recordingMarkups
    self.automaticProcessingAttempts = automaticProcessingAttempts
    self.automaticProcessingRetryAt = automaticProcessingRetryAt
    self.processingRetryPolicyVersion = processingRetryPolicyVersion
    self.processingProviderMode = processingProviderMode
    self.processingRecovery = processingRecovery
    self.error = error
  }
}

public enum CaptureProcessingRetryPolicy {
  public static let currentVersion = 2
  public static let maximumAttempts = 6
  public static let legacyMaximumAttempts = 3

  public static func shouldRetry(_ error: Error) -> Bool {
    if error is CancellationError { return false }
    if let error = error as? PolyformClientError {
      switch error {
      case .requestFailed(let status, _):
        return status == 0 || status == 408 || status == 425 || status == 429
          || (500...599).contains(status)
      case .invalidResponse: return true
      case .approvalPending, .refreshTooEarly, .authenticationRequired: return false
      }
    }
    if let error = error as? JesSeeError {
      switch error {
      case .requestFailed(let status, _):
        return status == 408 || status == 425 || status == 429 || (500...599).contains(status)
      case .serviceUnavailable, .invalidResponse: return true
      default: return false
      }
    }
    if let error = error as? URLError {
      return [
        .cannotConnectToHost, .cannotFindHost, .dataNotAllowed, .dnsLookupFailed,
        .internationalRoamingOff, .networkConnectionLost, .notConnectedToInternet,
        .resourceUnavailable, .secureConnectionFailed, .timedOut,
      ].contains(error.code)
    }
    return false
  }

  public static func shouldClassifyFailure(_ error: Error, taskIsCancelled: Bool) -> Bool {
    !taskIsCancelled && !(error is CancellationError)
  }

  public static func shouldStartProcessing(_ record: CaptureRecord) -> Bool {
    record.stage == .saved || record.stage.isProcessing
      || (record.stage == .failed && record.automaticProcessingAttempts == nil)
      || shouldResumeLegacyExhausted(record)
  }

  public static func delaySecondsAfterFailedAttempt(_ attempt: Int) -> TimeInterval {
    switch attempt {
    case ...1: 2
    case 2: 5
    case 3: 60
    case 4: 5 * 60
    default: 30 * 60
    }
  }

  public static func shouldResumeLegacyExhausted(_ record: CaptureRecord) -> Bool {
    record.stage == .failed && record.processingRecovery == nil
      && record.processingRetryPolicyVersion == nil
      && record.automaticProcessingAttempts == legacyMaximumAttempts
  }

  public static func shouldResume(
    _ record: CaptureRecord, after recovery: CaptureProcessingRecovery
  ) -> Bool {
    record.stage == .failed && record.processingRecovery == recovery
  }

  public static func recovery(for mode: AIProviderMode?) -> CaptureProcessingRecovery? {
    switch mode {
    case .polyformCovered: .polyformSignIn
    case .bringYourOwnKey: .openAIKey
    case nil: nil
    }
  }
}

public enum AIProviderMode: String, Codable, Sendable, Equatable, CaseIterable {
  case polyformCovered = "polyform_covered"
  case bringYourOwnKey = "bring_your_own_key"
}

public struct JesSeeConfiguration: Codable, Sendable, Equatable {
  public var email: String
  public var outputFolderPath: String
  public var setupCompleted: Bool
  public var aiProviderMode: AIProviderMode?
  public var shareScreenshotsForStory: Bool
  public var shareAnonymousFeatureUsage: Bool

  public init(
    email: String = "", outputFolderPath: String = "", setupCompleted: Bool = false,
    aiProviderMode: AIProviderMode? = nil,
    shareScreenshotsForStory: Bool = true,
    shareAnonymousFeatureUsage: Bool = true
  ) {
    self.email = email
    self.outputFolderPath = outputFolderPath
    self.setupCompleted = setupCompleted
    self.aiProviderMode = aiProviderMode
    self.shareScreenshotsForStory = shareScreenshotsForStory
    self.shareAnonymousFeatureUsage = shareAnonymousFeatureUsage
  }

  private enum CodingKeys: String, CodingKey {
    case email
    case outputFolderPath
    case setupCompleted
    case aiProviderMode
    case shareScreenshotsForStory
    case shareScreenshotsWithOpenAI
    case shareAnonymousFeatureUsage
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
    outputFolderPath = try container.decodeIfPresent(String.self, forKey: .outputFolderPath) ?? ""
    setupCompleted = try container.decodeIfPresent(Bool.self, forKey: .setupCompleted) ?? false
    aiProviderMode = try container.decodeIfPresent(AIProviderMode.self, forKey: .aiProviderMode)
    if aiProviderMode == nil, setupCompleted { aiProviderMode = .bringYourOwnKey }
    shareScreenshotsForStory =
      try container.decodeIfPresent(Bool.self, forKey: .shareScreenshotsForStory)
      ?? container.decodeIfPresent(Bool.self, forKey: .shareScreenshotsWithOpenAI)
      ?? true
    shareAnonymousFeatureUsage =
      try container.decodeIfPresent(Bool.self, forKey: .shareAnonymousFeatureUsage) ?? true
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(email, forKey: .email)
    try container.encode(outputFolderPath, forKey: .outputFolderPath)
    try container.encode(setupCompleted, forKey: .setupCompleted)
    try container.encodeIfPresent(aiProviderMode, forKey: .aiProviderMode)
    try container.encode(shareScreenshotsForStory, forKey: .shareScreenshotsForStory)
    try container.encode(shareAnonymousFeatureUsage, forKey: .shareAnonymousFeatureUsage)
  }

  public func pendingSetupStep(hasPolyformSession: Bool, hasAPIKey: Bool) -> Int {
    guard let aiProviderMode else { return 0 }
    switch aiProviderMode {
    case .polyformCovered where !hasPolyformSession: return 1
    case .bringYourOwnKey where !hasAPIKey: return 1
    default: break
    }
    if outputFolderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return 2 }
    return 3
  }
}

public struct WorkflowAuthSession: Codable, Sendable, Equatable {
  public var accessToken: String
  public var email: String
  public var grantID: String
  public var expiresAt: Date

  public init(accessToken: String, email: String, grantID: String, expiresAt: Date) {
    self.accessToken = accessToken
    self.email = email
    self.grantID = grantID
    self.expiresAt = expiresAt
  }
}

public enum JesSeeError: LocalizedError, Equatable {
  case missingAPIKey
  case invalidAPIKey
  case keychainUnavailable(String)
  case signInRequired
  case serviceNotConfigured
  case authenticationFailed(String)
  case serviceUnavailable(String)
  case outputFolderUnavailable
  case sourceUnavailable(String)
  case mediaHasNoAudio
  case audioTooLarge
  case requestFailed(Int, String)
  case invalidResponse(String)
  case recordingFailed(String)

  public var errorDescription: String? {
    switch self {
    case .missingAPIKey: "Add your OpenAI API key in Settings first."
    case .invalidAPIKey: "The OpenAI API key is not valid."
    case .keychainUnavailable(let detail):
      "JesSee could not save your sign-in securely in Keychain. \(detail)"
    case .signInRequired: "Sign in to JesSee before creating or publishing a story."
    case .serviceNotConfigured: "This JesSee build is not connected to the Polyform service."
    case .authenticationFailed(let detail): "JesSee could not sign you in. \(detail)"
    case .serviceUnavailable(let detail): "JesSee could not reach the AI service. \(detail)"
    case .outputFolderUnavailable: "Choose an output folder before recording or importing."
    case .sourceUnavailable(let path): "The source video is no longer available at \(path)."
    case .mediaHasNoAudio: "This video does not contain an audio track to transcribe."
    case .audioTooLarge: "The prepared audio is too large to transcribe in one request."
    case .requestFailed(let status, let detail):
      "The AI service rejected the request (\(status)). \(detail)"
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
