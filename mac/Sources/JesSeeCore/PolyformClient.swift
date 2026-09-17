import CryptoKit
import Foundation

public struct PolyformServiceConfiguration: Sendable, Equatable {
  public static let apiBaseInfoKey = "PFWorkflowAPIBase"
  public static let appKeyInfoKey = "PFWorkflowAuthAppKey"
  public static let transcriptionURLInfoKey = "PFTranscriptionWorkflowURL"
  public static let storyURLInfoKey = "PFStoryWorkflowURL"
  public static let managedAIEnabledInfoKey = "PFManagedAIEnabled"

  public var apiBase: URL
  public var appKey: String
  public var transcriptionWorkflowURL: URL?
  public var storyWorkflowURL: URL?

  public init(
    apiBase: URL, appKey: String, transcriptionWorkflowURL: URL? = nil,
    storyWorkflowURL: URL? = nil
  ) {
    self.apiBase = apiBase
    self.appKey = appKey
    self.transcriptionWorkflowURL = transcriptionWorkflowURL
    self.storyWorkflowURL = storyWorkflowURL
  }

  public static func configured(bundle: Bundle = .main) -> Self? {
    guard
      bundle.object(forInfoDictionaryKey: managedAIEnabledInfoKey) as? Bool == true,
      let apiBaseValue = bundle.object(forInfoDictionaryKey: apiBaseInfoKey) as? String,
      let apiBase = URL(string: apiBaseValue), apiBase.scheme == "https",
      let appKey = bundle.object(forInfoDictionaryKey: appKeyInfoKey) as? String,
      !appKey.isEmpty
    else { return nil }
    return Self(
      apiBase: apiBase, appKey: appKey,
      transcriptionWorkflowURL: optionalHTTPSURL(
        bundle.object(forInfoDictionaryKey: transcriptionURLInfoKey)),
      storyWorkflowURL: optionalHTTPSURL(bundle.object(forInfoDictionaryKey: storyURLInfoKey)))
  }

  public func authURL(_ action: String) -> URL {
    apiBase.appending(path: "workflow-auth/\(appKey)/\(action)")
  }

  private static func optionalHTTPSURL(_ value: Any?) -> URL? {
    guard let value = value as? String, let url = URL(string: value), url.scheme == "https"
    else { return nil }
    return url
  }
}

public enum PolyformClientError: LocalizedError, Equatable {
  case approvalPending
  case refreshTooEarly
  case authenticationRequired(String)
  case requestFailed(Int, String)
  case invalidResponse(String)

  public var errorDescription: String? {
    switch self {
    case .approvalPending: "Waiting for you to approve the sign-in email."
    case .refreshTooEarly: "Your current sign-in is still valid."
    case .authenticationRequired(let detail): detail
    case .requestFailed(_, let detail), .invalidResponse(let detail): detail
    }
  }
}

public struct PKCECredentials: Sendable, Equatable {
  public var verifier: String
  public var challenge: String

  public static func generate() -> Self {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<32).map { _ in UInt8.random(in: 0...255, using: &generator) }
    let verifier = Data(bytes).base64URLEncodedString()
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    return Self(verifier: verifier, challenge: challenge)
  }
}

public struct WorkflowAuthAttempt: Sendable, Equatable {
  public var id: String
  public var expiresIn: TimeInterval
}

public struct ManagedUpload: Sendable, Equatable {
  public var id: String
  public var publicURL: URL?
}

public struct PolyformClient: Sendable {
  private let configuration: PolyformServiceConfiguration
  private let session: URLSession
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder

  public init(configuration: PolyformServiceConfiguration, session: URLSession = .shared) {
    self.configuration = configuration
    self.session = session
    decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
  }

  public func requestSignIn(email: String, challenge: String) async throws
    -> WorkflowAuthAttempt
  {
    let response: AuthRequestResponse = try await post(
      configuration.authURL("request"),
      body: AuthRequestBody(
        email: email, codeChallenge: challenge, codeChallengeMethod: "S256"))
    guard let attemptID = response.attemptID else {
      throw PolyformClientError.invalidResponse(
        "Polyform accepted the request but did not return a sign-in attempt.")
    }
    return WorkflowAuthAttempt(id: attemptID, expiresIn: response.expiresIn)
  }

  public func exchangeSignIn(attemptID: String, verifier: String) async throws
    -> WorkflowAuthSession
  {
    let response: AuthTokenResponse = try await post(
      configuration.authURL("exchange"),
      body: AuthExchangeBody(attemptID: attemptID, codeVerifier: verifier),
      pendingStatus: 409)
    return response.session
  }

  public func refresh(_ current: WorkflowAuthSession) async throws -> WorkflowAuthSession {
    let request = try authorizedRequest(
      url: configuration.authURL("refresh"), accessToken: current.accessToken, method: "POST")
    let response: AuthTokenResponse = try await data(for: request, refreshStatus: 409)
    return response.session
  }

  public func transcribe(audioURL: URL, accessToken: String) async throws -> TranscriptDocument {
    guard let transcriptionWorkflowURL = configuration.transcriptionWorkflowURL else {
      throw PolyformClientError.invalidResponse(
        "This JesSee build is not connected to the Polyform transcription workflow.")
    }
    let upload = try await upload(
      fileURL: audioURL, contentType: "audio/mp4", visibility: "private",
      accessToken: accessToken)
    let transcript: TranscriptDocument
    do {
      let response: WorkflowResponse<TranscriptionResult> = try await post(
        transcriptionWorkflowURL,
        body: TranscriptionRequest(audio: UploadReference(uploadID: upload.id)),
        accessToken: accessToken)
      let value = response.result
      transcript = TranscriptDocument(
        text: value.text, language: value.language, duration: value.durationSeconds,
        segments: value.segments.enumerated().map { index, segment in
          TranscriptSegment(
            id: segment.id ?? index, start: segment.start, end: segment.end, text: segment.text)
        },
        words: value.words.map { TranscriptWord(word: $0.word, start: $0.start, end: $0.end) },
        provider: "Polyform", model: value.model)
    } catch {
      try? await deleteUpload(id: upload.id, accessToken: accessToken)
      throw error
    }
    try await deleteUpload(id: upload.id, accessToken: accessToken)
    return transcript
  }

  public func createStory(
    transcript: TranscriptDocument,
    frames: [CapturedFrame],
    captureDirectory: URL,
    accessToken: String,
    includeScreenshotPixels: Bool = true
  ) async throws -> StoryDocument {
    guard let storyWorkflowURL = configuration.storyWorkflowURL else {
      throw PolyformClientError.invalidResponse(
        "This JesSee build is waiting for the Polyform story workflow.")
    }
    let imageFrames = includeScreenshotPixels ? Self.planningFrames(frames) : []
    let imageAttachments = imageFrames.compactMap { frame -> (CapturedFrame, WorkflowAttachment)? in
      let url = captureDirectory.appendingPathComponent(frame.filename)
      guard let data = try? Data(contentsOf: url) else { return nil }
      return (
        frame,
        WorkflowAttachment(
          filename: frame.filename, contentType: "image/jpeg",
          fileData: "data:image/jpeg;base64,\(data.base64EncodedString())"))
    }
    let attachedFrames = imageAttachments.map(\.0)
    let filenames = Set(attachedFrames.map(\.filename))
    let context = StoryContext(
      transcript: transcript,
      availableScreenshots: frames.map {
        StoryScreenshot(
          timeSeconds: $0.seconds, filename: $0.filename,
          hasVisibleMarkup: $0.hasVisibleMarkup,
          imageAttached: filenames.contains($0.filename))
      })
    let attachments = imageAttachments.map(\.1)
    let contextJSON = String(
      decoding: try encoder.encode(context), as: UTF8.self)
    let response: WorkflowResponse<StoryDraft> = try await post(
      storyWorkflowURL,
      body: StoryRequest(
        attachments: attachments, userInput: contextJSON,
        prompt: DirectOpenAIClient.storyPrompt,
        outputJSON: DirectOpenAIClient.storyOutputJSON),
      accessToken: accessToken)
    let draft = response.result
    let eligibleFrames = attachedFrames.isEmpty ? frames : attachedFrames
    return StoryDocument(
      title: draft.title,
      sourceURL: Self.normalizedWebURL(draft.sourceURL),
      summary: draft.summary,
      keyPoints: draft.keyPoints,
      steps: draft.steps.map { step in
        let frame = Self.selectedFrame(
          requestedSeconds: step.screenshotTimeSeconds,
          stepEndSeconds: step.endSeconds,
          frames: eligibleFrames)
        return StoryStep(
          startSeconds: step.startSeconds, endSeconds: step.endSeconds,
          title: step.title, narrative: step.narrative, transcript: step.transcript,
          imageFilename: frame?.filename)
      })
  }

  public func publishPDF(at fileURL: URL, accessToken: String) async throws -> ManagedUpload {
    let uploaded = try await upload(
      fileURL: fileURL, contentType: "application/pdf", visibility: "public",
      accessToken: accessToken)
    guard uploaded.publicURL != nil else {
      throw PolyformClientError.invalidResponse(
        "Polyform uploaded the PDF but did not return its public link.")
    }
    return uploaded
  }

  public func upload(
    fileURL: URL, contentType: String, visibility: String, accessToken: String
  ) async throws -> ManagedUpload {
    let data = try Data(contentsOf: fileURL)
    let created: UploadResponse = try await post(
      configuration.authURL("uploads"),
      body: UploadRequest(
        filename: fileURL.lastPathComponent, contentType: contentType,
        byteCount: data.count, visibility: visibility),
      accessToken: accessToken)
    guard let uploadURLValue = created.uploadURL, let uploadURL = URL(string: uploadURLValue) else {
      throw PolyformClientError.invalidResponse("Polyform returned an invalid upload session.")
    }
    var put = URLRequest(url: uploadURL)
    put.httpMethod = "PUT"
    put.setValue(contentType, forHTTPHeaderField: "Content-Type")
    put.httpBody = data
    _ = try await checkedData(for: put)
    let completed: UploadResponse = try await post(
      configuration.authURL("uploads/\(created.uploadID)/complete"),
      body: EmptyBody(), accessToken: accessToken)
    return ManagedUpload(
      id: completed.uploadID,
      publicURL: completed.publicURL.flatMap(URL.init(string:)))
  }

  public func deleteUpload(id: String, accessToken: String) async throws {
    let request = try authorizedRequest(
      url: configuration.authURL("uploads/\(id)"), accessToken: accessToken,
      method: "DELETE")
    _ = try await checkedData(for: request, recognizesAuthenticationFailure: true)
  }

  static func selectedFrame(
    requestedSeconds: Double?, stepEndSeconds: Double, frames: [CapturedFrame]
  ) -> CapturedFrame? {
    guard let requestedSeconds, requestedSeconds.isFinite,
      let requested = MediaTools.nearestFrame(to: requestedSeconds, frames: frames),
      abs(requested.seconds - requestedSeconds) <= 0.6
    else { return MediaTools.nearestFrame(to: stepEndSeconds, frames: frames) }
    return requested
  }

  static func normalizedWebURL(_ candidate: String?) -> String? {
    guard var value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty
    else { return nil }
    if !value.contains("://") { value = "https://\(value)" }
    guard let components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
      let host = components.host, !host.isEmpty, !host.contains(" ")
    else { return nil }
    return components.url?.absoluteString
  }

  static func planningFrames(_ frames: [CapturedFrame], maximum: Int = 12)
    -> [CapturedFrame]
  {
    guard frames.count > maximum, maximum > 1 else { return frames }
    let marked = frames.filter(\.hasVisibleMarkup)
    let markedLimit = max(1, maximum * 2 / 3)
    let selectedMarked = evenlySampled(marked, count: min(marked.count, markedLimit))
    let selectedFilenames = Set(selectedMarked.map(\.filename))
    let timelineCandidates = frames.filter { !selectedFilenames.contains($0.filename) }
    return (
      selectedMarked
        + evenlySampled(timelineCandidates, count: maximum - selectedMarked.count)
    )
      .sorted { $0.seconds < $1.seconds }
  }

  private static func evenlySampled(_ frames: [CapturedFrame], count: Int) -> [CapturedFrame] {
    guard count > 0, frames.count > count else { return count > 0 ? frames : [] }
    guard count > 1 else { return [frames[frames.count / 2]] }
    return (0..<count).map { index in
      let position = Double(index) * Double(frames.count - 1) / Double(count - 1)
      return frames[Int(position.rounded())]
    }
  }

  private func post<Response: Decodable, Body: Encodable>(
    _ url: URL, body: Body, accessToken: String? = nil, pendingStatus: Int? = nil
  ) async throws -> Response {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let accessToken {
      request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    }
    request.httpBody = try encoder.encode(body)
    return try await data(for: request, pendingStatus: pendingStatus)
  }

  private func data<Response: Decodable>(
    for request: URLRequest, pendingStatus: Int? = nil, refreshStatus: Int? = nil
  ) async throws -> Response {
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch {
      throw PolyformClientError.requestFailed(0, error.localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw PolyformClientError.invalidResponse("Polyform returned an unreadable response.")
    }
    if http.statusCode == pendingStatus { throw PolyformClientError.approvalPending }
    if http.statusCode == refreshStatus { throw PolyformClientError.refreshTooEarly }
    guard (200..<300).contains(http.statusCode) else {
      let detail = Self.errorDetail(from: data)
      if http.statusCode == 401 || http.statusCode == 403 {
        throw PolyformClientError.authenticationRequired(detail)
      }
      throw PolyformClientError.requestFailed(http.statusCode, detail)
    }
    do { return try decoder.decode(Response.self, from: data) } catch {
      throw PolyformClientError.invalidResponse("Polyform returned incomplete data.")
    }
  }

  private func checkedData(
    for request: URLRequest, recognizesAuthenticationFailure: Bool = false
  ) async throws -> Data {
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch {
      throw PolyformClientError.requestFailed(0, error.localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw PolyformClientError.invalidResponse("Polyform returned an unreadable response.")
    }
    guard (200..<300).contains(http.statusCode) else {
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if recognizesAuthenticationFailure, status == 401 || status == 403 {
        throw PolyformClientError.authenticationRequired(Self.errorDetail(from: data))
      }
      throw PolyformClientError.requestFailed(status, Self.errorDetail(from: data))
    }
    return data
  }

  private func authorizedRequest(url: URL, accessToken: String, method: String) throws
    -> URLRequest
  {
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    return request
  }

  private static func errorDetail(from data: Data) -> String {
    if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
      return envelope.detail
    }
    return String(String(decoding: data, as: UTF8.self).prefix(280))
  }
}

private struct AuthRequestBody: Encodable {
  var email: String
  var codeChallenge: String
  var codeChallengeMethod: String

  private enum CodingKeys: String, CodingKey {
    case email
    case codeChallenge
    case codeChallengeMethod
  }
}

private struct AuthRequestResponse: Decodable {
  var attemptID: String?
  var expiresIn: TimeInterval

  private enum CodingKeys: String, CodingKey {
    case attemptID = "attemptId"
    case expiresIn
  }
}

private struct AuthExchangeBody: Encodable {
  var attemptID: String
  var codeVerifier: String

  private enum CodingKeys: String, CodingKey {
    case attemptID = "attemptId"
    case codeVerifier
  }
}

private struct AuthTokenResponse: Decodable {
  var accessToken: String
  var expiresIn: TimeInterval
  var email: String
  var grantID: String

  private enum CodingKeys: String, CodingKey {
    case accessToken
    case expiresIn
    case email
    case grantID = "grantId"
  }

  var session: WorkflowAuthSession {
    WorkflowAuthSession(
      accessToken: accessToken, email: email, grantID: grantID,
      expiresAt: Date().addingTimeInterval(expiresIn))
  }
}

private struct UploadRequest: Encodable {
  var filename: String
  var contentType: String
  var byteCount: Int
  var visibility: String

  private enum CodingKeys: String, CodingKey {
    case filename
    case contentType
    case byteCount
    case visibility
  }
}

private struct UploadResponse: Decodable {
  var uploadID: String
  var uploadURL: String?
  var publicURL: String?

  private enum CodingKeys: String, CodingKey {
    case uploadID = "uploadId"
    case uploadURL = "uploadUrl"
    case publicURL = "publicUrl"
  }
}

private struct EmptyBody: Encodable {}
private struct UploadReference: Encodable {
  var uploadID: String

  private enum CodingKeys: String, CodingKey { case uploadID = "uploadId" }
}
private struct TranscriptionRequest: Encodable { var audio: UploadReference }

struct WorkflowResponse<Result: Decodable>: Decodable {
  var success: Bool
  var result: Result

  private enum CodingKeys: String, CodingKey {
    case success
    case result
  }

  private struct NestedResult: Decodable {
    var result: Result

    private enum CodingKeys: String, CodingKey { case result }
  }

  private struct NestedTextResult: Decodable {
    var result: String

    private enum CodingKeys: String, CodingKey { case result }
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    success = try container.decode(Bool.self, forKey: .success)
    if let direct = try? container.decode(Result.self, forKey: .result) {
      result = direct
    } else if let nested = try? container.decode(NestedResult.self, forKey: .result) {
      result = nested.result
    } else if let text = try? container.decode(String.self, forKey: .result) {
      result = try Self.decodeJSONText(text, codingPath: container.codingPath)
    } else if let nested = try? container.decode(NestedTextResult.self, forKey: .result) {
      result = try Self.decodeJSONText(nested.result, codingPath: container.codingPath)
    } else {
      result = try container.decode(NestedResult.self, forKey: .result).result
    }
  }

  private static func decodeJSONText(_ text: String, codingPath: [CodingKey]) throws -> Result {
    guard let data = DirectOpenAIClient.jsonData(from: text) else {
      throw DecodingError.dataCorrupted(
        .init(codingPath: codingPath, debugDescription: "Workflow result did not contain JSON."))
    }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(Result.self, from: data)
  }
}

private struct TranscriptionResult: Decodable {
  struct Segment: Decodable {
    var id: Int?
    var start: Double
    var end: Double
    var text: String
  }
  struct Word: Decodable {
    var word: String
    var start: Double
    var end: Double
  }
  var text: String
  var model: String
  var language: String?
  var durationSeconds: Double?
  var segments: [Segment]
  var words: [Word]

  private enum CodingKeys: String, CodingKey {
    case text
    case model
    case language
    case durationSeconds
    case segments
    case words
  }
}

private struct StoryScreenshot: Encodable {
  var timeSeconds: Double
  var filename: String
  var hasVisibleMarkup: Bool
  var imageAttached: Bool

  private enum CodingKeys: String, CodingKey {
    case timeSeconds
    case filename
    case hasVisibleMarkup
    case imageAttached
  }
}

private struct StoryContext: Encodable {
  var transcript: TranscriptDocument
  var availableScreenshots: [StoryScreenshot]
}

private struct WorkflowAttachment: Encodable {
  var type = "input_file"
  var filename: String
  var contentType: String
  var fileData: String

  private enum CodingKeys: String, CodingKey {
    case type
    case filename
    case contentType
    case fileData
  }
}

private struct StoryRequest: Encodable {
  var attachments: [WorkflowAttachment]
  var userInput: String
  var prompt: String
  var outputJSON: String

  private enum CodingKeys: String, CodingKey {
    case attachments
    case userInput
    case prompt
    case outputJSON = "outputJson"
  }
}

private struct StoryDraft: Decodable {
  struct Step: Decodable {
    var startSeconds: Double
    var endSeconds: Double
    var screenshotTimeSeconds: Double?
    var title: String
    var narrative: String
    var transcript: String

    private enum CodingKeys: String, CodingKey {
      case startSeconds
      case endSeconds
      case screenshotTimeSeconds
      case title
      case narrative
      case transcript
    }
  }
  var title: String
  var sourceURL: String?
  var summary: String
  var keyPoints: [String]
  var steps: [Step]

  private enum CodingKeys: String, CodingKey {
    case title
    case sourceURL
    case sourceUrl
    case summary
    case keyPoints
    case steps
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    title = try container.decode(String.self, forKey: .title)
    sourceURL =
      try container.decodeIfPresent(String.self, forKey: .sourceURL)
      ?? container.decodeIfPresent(String.self, forKey: .sourceUrl)
    summary = try container.decode(String.self, forKey: .summary)
    keyPoints = try container.decode([String].self, forKey: .keyPoints)
    steps = try container.decode([Step].self, forKey: .steps)
  }
}

private struct ErrorEnvelope: Decodable { var detail: String }

extension Data {
  fileprivate func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
