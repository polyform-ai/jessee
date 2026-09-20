import AppKit
import Foundation
import PDFKit
import Testing

@testable import JesSeeCore

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
  struct Stub {
    var status: Int
    var data: Data
  }

  private static let lock = NSLock()
  nonisolated(unsafe) private static var stubs: [Stub] = []
  nonisolated(unsafe) private static var capturedRequests: [URLRequest] = []
  nonisolated(unsafe) private static var capturedBodies: [Data?] = []

  static func prepare(_ values: [Stub]) {
    lock.lock()
    stubs = values
    capturedRequests = []
    capturedBodies = []
    lock.unlock()
  }

  static func requests() -> [URLRequest] {
    lock.lock()
    defer { lock.unlock() }
    return capturedRequests
  }

  static func bodies() -> [Data?] {
    lock.lock()
    defer { lock.unlock() }
    return capturedBodies
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let body = Self.readBody(from: request)
    Self.lock.lock()
    Self.capturedRequests.append(request)
    Self.capturedBodies.append(body)
    let stub = Self.stubs.removeFirst()
    Self.lock.unlock()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: stub.status, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: stub.data)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  private static func readBody(from request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      guard count > 0 else { break }
      data.append(contentsOf: buffer.prefix(count))
    }
    return data
  }
}

private struct WorkflowTestValue: Decodable, Equatable {
  var text: String
}

@Test func managedWorkflowURLsRequireHTTPSAndAHost() {
  #expect(
    PolyformServiceConfiguration.validatedHTTPSURL("https://example.test/workflow")?.host
      == "example.test")
  #expect(PolyformServiceConfiguration.validatedHTTPSURL("http://example.test/workflow") == nil)
  #expect(PolyformServiceConfiguration.validatedHTTPSURL("https:///workflow") == nil)
  #expect(PolyformServiceConfiguration.validatedHTTPSURL("https://:443/workflow") == nil)
  #expect(PolyformServiceConfiguration.validatedHTTPSURL("https://user@:443/workflow") == nil)
  #expect(PolyformServiceConfiguration.validatedHTTPSURL(nil) == nil)
}

@Test func polyformAuthConfigurationDoesNotRequireManagedAI() {
  let apiBase = URL(string: "https://api.example.test")!
  let transcription = URL(string: "https://api.example.test/transcription")!
  let story = URL(string: "https://api.example.test/story")!

  #expect(
    PolyformServiceConfiguration(apiBase: apiBase, appKey: "app-key").supportsManagedAI
      == false)
  #expect(
    PolyformServiceConfiguration(
      apiBase: apiBase, appKey: "app-key", transcriptionWorkflowURL: transcription,
      storyWorkflowURL: story, managedAIEnabled: false
    ).supportsManagedAI == false)
  #expect(
    PolyformServiceConfiguration(
      apiBase: apiBase, appKey: "app-key", transcriptionWorkflowURL: transcription,
      storyWorkflowURL: story
    ).supportsManagedAI == true)
}

@Test func automaticProcessingRetryPolicyOnlyRetriesRecoverableFailures() {
  #expect(
    CaptureProcessingRetryPolicy.shouldRetry(
      PolyformClientError.requestFailed(503, "Unavailable")))
  #expect(
    CaptureProcessingRetryPolicy.shouldRetry(
      PolyformClientError.requestFailed(429, "Slow down")))
  #expect(
    CaptureProcessingRetryPolicy.shouldRetry(
      PolyformClientError.invalidResponse("Incomplete model result")))
  #expect(
    CaptureProcessingRetryPolicy.shouldRetry(
      JesSeeError.serviceUnavailable("Temporary network issue")))
  #expect(
    CaptureProcessingRetryPolicy.shouldRetry(
      JesSeeError.requestFailed(503, "Unavailable")))
  #expect(CaptureProcessingRetryPolicy.shouldRetry(URLError(.timedOut)))

  #expect(
    !CaptureProcessingRetryPolicy.shouldRetry(
      PolyformClientError.requestFailed(400, "Bad request")))
  #expect(
    !CaptureProcessingRetryPolicy.shouldRetry(
      PolyformClientError.authenticationRequired("Sign in")))
  #expect(!CaptureProcessingRetryPolicy.shouldRetry(JesSeeError.signInRequired))
  #expect(
    !CaptureProcessingRetryPolicy.shouldRetry(
      JesSeeError.requestFailed(400, "Bad request")))
  #expect(!CaptureProcessingRetryPolicy.shouldRetry(URLError(.badURL)))
}

@Test func cancelledTasksDoNotClassifyWrappedNetworkFailures() {
  #expect(
    !CaptureProcessingRetryPolicy.shouldClassifyFailure(
      URLError(.cancelled), taskIsCancelled: true))
  #expect(
    !CaptureProcessingRetryPolicy.shouldClassifyFailure(
      PolyformClientError.requestFailed(0, "cancelled"), taskIsCancelled: true))
  #expect(
    !CaptureProcessingRetryPolicy.shouldClassifyFailure(
      CancellationError(), taskIsCancelled: false))
  #expect(
    CaptureProcessingRetryPolicy.shouldClassifyFailure(
      URLError(.timedOut), taskIsCancelled: false))
}

@Test func interruptedProcessingRemainsEligibleForAutomaticHandoff() {
  let interrupted = CaptureRecord(
    title: "Interrupted", source: .recording, stage: .transcribing,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 1)
  let complete = CaptureRecord(
    title: "Complete", source: .recording, stage: .ready,
    mediaFilename: "recording.mp4")
  let terminal = CaptureRecord(
    title: "Terminal", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 6,
    processingRetryPolicyVersion: CaptureProcessingRetryPolicy.currentVersion)

  #expect(CaptureProcessingRetryPolicy.shouldStartProcessing(interrupted))
  #expect(!CaptureProcessingRetryPolicy.shouldStartProcessing(complete))
  #expect(!CaptureProcessingRetryPolicy.shouldStartProcessing(terminal))
}

@Test func captureRecordsFromEarlierBuildsDecodeWithoutRetryState() throws {
  let original = CaptureRecord(
    title: "Earlier capture", source: .recording, mediaFilename: "recording.mp4")
  let encoded = try JesSeeJSON.encoder().encode(original)
  var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
  object.removeValue(forKey: "automaticProcessingAttempts")
  object.removeValue(forKey: "automaticProcessingRetryAt")
  object.removeValue(forKey: "processingRetryPolicyVersion")
  object.removeValue(forKey: "processingProviderMode")
  object.removeValue(forKey: "processingRecovery")
  let legacy = try JSONSerialization.data(withJSONObject: object)

  let decoded = try JesSeeJSON.decoder().decode(CaptureRecord.self, from: legacy)
  #expect(decoded.automaticProcessingAttempts == nil)
  #expect(decoded.automaticProcessingRetryAt == nil)
  #expect(decoded.processingRetryPolicyVersion == nil)
  #expect(decoded.processingProviderMode == nil)
}

@Test func captureRecordPersistsTheProviderThatOwnsProcessing() throws {
  let retryAt = Date(timeIntervalSince1970: 1_800_000_000)
  let original = CaptureRecord(
    title: "Pinned capture", source: .recording, stage: .creatingStory,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 1,
    automaticProcessingRetryAt: retryAt,
    processingRetryPolicyVersion: CaptureProcessingRetryPolicy.currentVersion,
    processingProviderMode: .polyformCovered)

  let encoded = try JesSeeJSON.encoder().encode(original)
  let decoded = try JesSeeJSON.decoder().decode(CaptureRecord.self, from: encoded)

  #expect(decoded.processingProviderMode == AIProviderMode.polyformCovered)
  #expect(decoded.automaticProcessingRetryAt == retryAt)
  #expect(
    decoded.processingRetryPolicyVersion == CaptureProcessingRetryPolicy.currentVersion)
}

@Test func credentialRecoveryOnlyResumesMatchingFailedCaptures() {
  let polyformFailure = CaptureRecord(
    title: "Needs sign-in", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 1,
    processingRecovery: .polyformSignIn)
  let keyFailure = CaptureRecord(
    title: "Needs a key", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 1,
    processingRecovery: .openAIKey)
  let permanentFailure = CaptureRecord(
    title: "Missing audio", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 1)

  #expect(
    CaptureProcessingRetryPolicy.shouldResume(polyformFailure, after: .polyformSignIn))
  #expect(!CaptureProcessingRetryPolicy.shouldResume(polyformFailure, after: .openAIKey))
  #expect(CaptureProcessingRetryPolicy.shouldResume(keyFailure, after: .openAIKey))
  #expect(!CaptureProcessingRetryPolicy.shouldResume(permanentFailure, after: .openAIKey))
  #expect(
    CaptureProcessingRetryPolicy.recovery(for: .polyformCovered) == .polyformSignIn)
  #expect(
    CaptureProcessingRetryPolicy.recovery(for: .bringYourOwnKey) == .openAIKey)
  #expect(CaptureProcessingRetryPolicy.recovery(for: nil) == nil)
}

@Test func automaticProcessingUsesBoundedImmediateAndDelayedRecovery() {
  #expect(CaptureProcessingRetryPolicy.maximumAttempts == 6)
  #expect(CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(1) == 2)
  #expect(CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(2) == 5)
  #expect(CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(3) == 60)
  #expect(CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(4) == 300)
  #expect(CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(5) == 1_800)

  let oldExhausted = CaptureRecord(
    title: "Older failure", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 3)
  let currentExhausted = CaptureRecord(
    title: "Current failure", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 6,
    processingRetryPolicyVersion: CaptureProcessingRetryPolicy.currentVersion)
  let currentThirdAttemptFailure = CaptureRecord(
    title: "Current terminal failure", source: .recording, stage: .failed,
    mediaFilename: "recording.mp4", automaticProcessingAttempts: 3,
    processingRetryPolicyVersion: CaptureProcessingRetryPolicy.currentVersion)
  #expect(CaptureProcessingRetryPolicy.shouldResumeLegacyExhausted(oldExhausted))
  #expect(!CaptureProcessingRetryPolicy.shouldResumeLegacyExhausted(currentExhausted))
  #expect(!CaptureProcessingRetryPolicy.shouldResumeLegacyExhausted(currentThirdAttemptFailure))
}

@Suite(.serialized) struct PolyformClientTests {
@Test func polyformClientUsesDocumentedSnakeCaseContracts() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key",
      transcriptionWorkflowURL: URL(string: "https://example.test/transcribe")!,
      storyWorkflowURL: URL(string: "https://example.test/story")!),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(status: 200, data: Data(#"{"attempt_id":"attempt-1","expires_in":600}"#.utf8)),
    .init(
      status: 200,
      data: Data(
        #"{"access_token":"token-1","expires_in":86400,"email":"person@example.com","grant_id":"grant-1"}"#.utf8)),
    .init(
      status: 200,
      data: Data(
        #"{"success":true,"result":{"output_json":{"title":"Story","source_url":"example.com/page","summary":"Summary","key_points":["Point"],"steps":[{"start_seconds":0,"end_seconds":1,"screenshot_time_seconds":null,"title":"Step","narrative":"Do it.","transcript":"Do it"}]}}}"#.utf8)),
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"upload-1","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 200, data: Data()),
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"upload-1","public_url":"https://files.example.test/story.pdf"}"#.utf8)),
  ])

  let attempt = try await client.requestSignIn(email: "person@example.com", challenge: "challenge")
  #expect(attempt.id == "attempt-1")
  let session = try await client.exchangeSignIn(attemptID: attempt.id, verifier: "verifier")
  #expect(session.grantID == "grant-1")
  let story = try await client.createStory(
    transcript: TranscriptDocument(
      text: "Do it", language: "en", duration: 1,
      segments: [TranscriptSegment(id: 0, start: 0, end: 1, text: "Do it")], words: [],
      provider: "Polyform", model: "whisper-1"),
    frames: [], captureDirectory: FileManager.default.temporaryDirectory,
    accessToken: session.accessToken, includeScreenshotPixels: false)
  #expect(story.sourceURL == "https://example.com/page")

  let temporaryPDF = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).pdf")
  try Data("pdf".utf8).write(to: temporaryPDF)
  defer { try? FileManager.default.removeItem(at: temporaryPDF) }
  let upload = try await client.publishPDF(at: temporaryPDF, accessToken: session.accessToken)
  #expect(upload.id == "upload-1")
  #expect(upload.publicURL?.absoluteString == "https://files.example.test/story.pdf")

  let requests = StubURLProtocol.requests()
  #expect(requests.count == 6)
  let bodies = StubURLProtocol.bodies()
  let requestBody = try #require(bodies.first ?? nil)
  let exchangeBody = try #require(bodies.dropFirst().first ?? nil)
  let storyBody = try #require(bodies[2])
  let uploadBody = try #require(bodies[3])
  let requestJSON = try #require(
    JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
  let exchangeJSON = try #require(
    JSONSerialization.jsonObject(with: exchangeBody) as? [String: Any])
  let storyJSON = try #require(JSONSerialization.jsonObject(with: storyBody) as? [String: Any])
  let uploadJSON = try #require(JSONSerialization.jsonObject(with: uploadBody) as? [String: Any])
  #expect(requestJSON["code_challenge"] as? String == "challenge")
  #expect(exchangeJSON["attempt_id"] as? String == "attempt-1")
  #expect(storyJSON["user_input"] != nil)
  #expect(storyJSON["output_json"] != nil)
  #expect(uploadJSON["content_type"] as? String == "application/pdf")
}

@Test func publicPDFWithoutUsableLinkIsDeleted() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key"),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"upload-orphan","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 200, data: Data()),
    .init(status: 200, data: Data(#"{"upload_id":"upload-orphan"}"#.utf8)),
    .init(status: 204, data: Data()),
  ])

  let temporaryPDF = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).pdf")
  try Data("pdf".utf8).write(to: temporaryPDF)
  defer { try? FileManager.default.removeItem(at: temporaryPDF) }

  var failedAsExpected = false
  do {
    _ = try await client.publishPDF(at: temporaryPDF, accessToken: "token")
  } catch {
    failedAsExpected = true
  }
  #expect(failedAsExpected)
  let requests = StubURLProtocol.requests()
  #expect(requests.count == 4)
  #expect(requests.last?.httpMethod == "DELETE")
  #expect(requests.last?.url?.path.hasSuffix("/uploads/upload-orphan") == true)
}

@Test func publicScreenshotUsesImageContentTypeAndReturnsURL() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key"),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"screenshot-1","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 200, data: Data()),
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"screenshot-1","public_url":"https://files.example.test/screenshot.png"}"#.utf8)),
  ])

  let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).png")
  try Data("png".utf8).write(to: screenshot)
  defer { try? FileManager.default.removeItem(at: screenshot) }

  let upload = try await client.publishImage(
    at: screenshot, contentType: "image/png", accessToken: "token")
  #expect(upload.id == "screenshot-1")
  #expect(upload.publicURL?.absoluteString == "https://files.example.test/screenshot.png")

  let requests = StubURLProtocol.requests()
  let bodies = StubURLProtocol.bodies()
  let uploadBody = try #require(bodies.first ?? nil)
  let uploadJSON = try #require(
    JSONSerialization.jsonObject(with: uploadBody) as? [String: Any])
  #expect(uploadJSON["content_type"] as? String == "image/png")
  #expect(uploadJSON["visibility"] as? String == "public")
  #expect(requests[1].value(forHTTPHeaderField: "Content-Type") == "image/png")
}

@Test func failedScreenshotTransferDeletesTheCreatedUpload() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key"),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"screenshot-orphan","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 503, data: Data(#"{"error":"try again"}"#.utf8)),
    .init(status: 204, data: Data()),
  ])

  let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).png")
  try Data("png".utf8).write(to: screenshot)
  defer { try? FileManager.default.removeItem(at: screenshot) }

  await #expect(throws: PolyformClientError.self) {
    _ = try await client.publishImage(
      at: screenshot, contentType: "image/png", accessToken: "token")
  }
  let requests = StubURLProtocol.requests()
  #expect(requests.count == 3)
  #expect(requests.last?.httpMethod == "DELETE")
  #expect(requests.last?.url?.path.hasSuffix("/uploads/screenshot-orphan") == true)
}

@Test func uploadCleanupFailurePreservesAuthenticationRequired() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key"),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"expired-upload","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 200, data: Data()),
    .init(status: 401, data: Data(#"{"error":"session expired"}"#.utf8)),
    .init(status: 401, data: Data(#"{"error":"session expired"}"#.utf8)),
  ])

  let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).png")
  try Data("png".utf8).write(to: screenshot)
  defer { try? FileManager.default.removeItem(at: screenshot) }

  do {
    _ = try await client.publishImage(
      at: screenshot, contentType: "image/png", accessToken: "expired-token")
    Issue.record("Expected authentication to be required")
  } catch let error as PolyformClientError {
    guard case .authenticationRequired(let detail) = error else {
      Issue.record("Expected authenticationRequired, received \(error)")
      return
    }
    #expect(detail.contains("cleanup also failed"))
  }
  let requests = StubURLProtocol.requests()
  #expect(requests.count == 4)
  #expect(requests.last?.httpMethod == "DELETE")
}

@Test func successfulTranscriptionSurvivesTemporaryUploadCleanupFailure() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key",
      transcriptionWorkflowURL: URL(string: "https://example.test/transcribe")!),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"upload_id":"audio-1","upload_url":"https://example.test/upload-target"}"#.utf8)),
    .init(status: 200, data: Data()),
    .init(status: 200, data: Data(#"{"upload_id":"audio-1"}"#.utf8)),
    .init(
      status: 200,
      data: Data(
        #"{"success":true,"result":{"text":"Done","model":"whisper-1","language":"en","duration_seconds":1,"segments":[{"id":0,"start":0,"end":1,"text":"Done"}],"words":[]}}"#.utf8)),
    .init(status: 503, data: Data(#"{"error":"try again"}"#.utf8)),
  ])

  let temporaryAudio = FileManager.default.temporaryDirectory.appendingPathComponent(
    "\(UUID().uuidString).m4a")
  try Data("audio".utf8).write(to: temporaryAudio)
  defer { try? FileManager.default.removeItem(at: temporaryAudio) }

  let transcript = try await client.transcribe(audioURL: temporaryAudio, accessToken: "token")
  #expect(transcript.text == "Done")
  #expect(StubURLProtocol.requests().last?.httpMethod == "DELETE")
}

@Test func polyformRefinementSendsTheFullDraftAndNearbyVisuals() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = PolyformClient(
    configuration: PolyformServiceConfiguration(
      apiBase: URL(string: "https://example.test")!, appKey: "app-key",
      storyWorkflowURL: URL(string: "https://example.test/story")!),
    session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: Data(
        #"{"success":true,"result":{"output_json":{"title":"Refined","source_url":null,"summary":"Clear","key_points":["Point"],"steps":[{"start_seconds":0,"end_seconds":4,"screenshot_time_seconds":8,"title":"Use the visible label","narrative":"Place View auth details inline.","transcript":"this here should be"}]}}}"#.utf8))
  ])
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(
    at: temporary.appendingPathComponent("screenshots"), withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  try Data("jpeg".utf8).write(
    to: temporary.appendingPathComponent("screenshots/nearby.jpg"))
  let frames = [CapturedFrame(seconds: 8, filename: "screenshots/nearby.jpg")]
  let current = StoryDocument(
    title: "Draft", summary: "Needs review", keyPoints: ["Old point"],
    steps: [
      StoryStep(
        startSeconds: 0, endSeconds: 4, title: "Wrong title",
        narrative: "Review the year field.", transcript: "this year should be",
        imageFilename: "screenshots/nearby.jpg")
    ])
  let transcript = TranscriptDocument(
    text: "this year should be", language: "en", duration: 4,
    segments: [TranscriptSegment(id: 0, start: 0, end: 4, text: "this year should be")],
    words: [])

  let refined = try await client.refineStory(
    current, transcript: transcript, frames: frames, captureDirectory: temporary, round: 1,
    accessToken: "token")
  #expect(refined.title == "Refined")
  #expect(refined.steps.first?.imageFilename == "screenshots/nearby.jpg")

  let body = try #require(StubURLProtocol.bodies().first ?? nil)
  let request = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
  #expect((request["prompt"] as? String)?.contains("refinement pass 1") == true)
  #expect((request["attachments"] as? [[String: Any]])?.count == 1)
  let userInput = try #require(request["user_input"] as? String)
  let context = try #require(
    JSONSerialization.jsonObject(with: Data(userInput.utf8)) as? [String: Any])
  let draft = try #require(context["currentStory"] as? [String: Any])
  #expect(draft["title"] as? String == "Draft")
  #expect((context["availableScreenshots"] as? [[String: Any]])?.first?["imageAttached"] as? Bool == true)
}

@Test func directOpenAIRefinementUsesTheSameBoundedContract() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = DirectOpenAIClient(session: URLSession(configuration: configuration))
  let modelOutput =
    #"{"title":"Final","sourceURL":null,"summary":"Clear","keyPoints":["Point"],"steps":[{"startSeconds":0,"endSeconds":4,"screenshotTimeSeconds":8,"title":"Inline auth details","narrative":"Place View auth details inline.","transcript":"this here should be"}]}"#
  StubURLProtocol.prepare([
    .init(
      status: 200,
      data: try JSONSerialization.data(withJSONObject: ["output_text": modelOutput]))
  ])
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(
    at: temporary.appendingPathComponent("screenshots"), withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  try Data("jpeg".utf8).write(
    to: temporary.appendingPathComponent("screenshots/nearby.jpg"))
  let frames = [CapturedFrame(seconds: 8, filename: "screenshots/nearby.jpg")]
  let current = StoryDocument(
    title: "Draft", summary: "Needs review", keyPoints: [],
    steps: [
      StoryStep(
        startSeconds: 0, endSeconds: 4, title: "Wrong title",
        narrative: "Review the year field.", transcript: "this year should be",
        imageFilename: "screenshots/nearby.jpg")
    ])
  let transcript = TranscriptDocument(
    text: "this year should be", language: "en", duration: 4,
    segments: [TranscriptSegment(id: 0, start: 0, end: 4, text: "this year should be")],
    words: [])

  let refined = try await client.refineStory(
    current, transcript: transcript, frames: frames, captureDirectory: temporary, round: 2,
    apiKey: "key")
  #expect(refined.title == "Final")
  #expect(refined.steps.first?.imageFilename == "screenshots/nearby.jpg")

  let body = try #require(StubURLProtocol.bodies().first ?? nil)
  let request = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
  let input = try #require(request["input"] as? [[String: Any]])
  let systemContent = try #require(input.first?["content"] as? [[String: Any]])
  #expect((systemContent.first?["text"] as? String)?.contains("refinement pass 2") == true)
  let userContent = try #require(input.last?["content"] as? [[String: Any]])
  #expect(userContent.contains(where: { $0["type"] as? String == "input_image" }))
}

@Test func directOpenAIPreservesHTTPStatusForRetryClassification() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = DirectOpenAIClient(session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([.init(status: 400, data: Data("Bad request".utf8))])
  let transcript = TranscriptDocument(text: "Explain this", segments: [], words: [])
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }

  var capturedError: Error?
  do {
    _ = try await client.createStory(
      transcript: transcript, frames: [], captureDirectory: temporary, apiKey: "key")
  } catch {
    capturedError = error
  }
  #expect(capturedError as? JesSeeError == .requestFailed(400, "Bad request"))
}

@Test func directOpenAIMalformedSuccessBecomesRetryableInvalidResponse() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [StubURLProtocol.self]
  let client = DirectOpenAIClient(session: URLSession(configuration: configuration))
  StubURLProtocol.prepare([.init(status: 200, data: Data("[]".utf8))])
  let transcript = TranscriptDocument(text: "Explain this", segments: [], words: [])
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }

  var capturedError: Error?
  do {
    _ = try await client.createStory(
      transcript: transcript, frames: [], captureDirectory: temporary, apiKey: "key")
  } catch {
    capturedError = error
  }
  #expect(
    capturedError as? JesSeeError
      == .invalidResponse("Story creation returned incomplete data."))
}
}

@Test func workflowResponsesAcceptDirectAndLightWrapperResults() throws {
  let decoder = JSONDecoder()
  let direct = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"text":"hello"}}"#.utf8))
  let wrapped = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"result":{"text":"hello"}}}"#.utf8))
  let wrappedJSONText = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(
      #"{"success":true,"result":{"result":"```json\n{\"text\":\"hello\"}\n```"}}"#.utf8))
  let outputJSON = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"output_json":{"text":"hello"}}}"#.utf8))
  let outputJSONText = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(
      #"{"success":true,"result":{"output_json":"```json\n{\"text\":\"hello\"}\n```"}}"#.utf8))
  let output = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"output":{"text":"hello"}}}"#.utf8))
  let outputText = try decoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"output":"{\"text\":\"hello\"}"}}"#.utf8))

  let productionDecoder = JSONDecoder()
  productionDecoder.keyDecodingStrategy = .convertFromSnakeCase
  let productionOutputJSON = try productionDecoder.decode(
    WorkflowResponse<WorkflowTestValue>.self,
    from: Data(#"{"success":true,"result":{"output_json":{"text":"hello"}}}"#.utf8))

  #expect(direct.result == WorkflowTestValue(text: "hello"))
  #expect(wrapped.result == direct.result)
  #expect(wrappedJSONText.result == direct.result)
  #expect(outputJSON.result == direct.result)
  #expect(outputJSONText.result == direct.result)
  #expect(output.result == direct.result)
  #expect(outputText.result == direct.result)
  #expect(productionOutputJSON.result == direct.result)
}

@Test func setupResumesAfterPersistedSteps() {
  #expect(
    JesSeeConfiguration().pendingSetupStep(hasPolyformSession: false, hasAPIKey: false) == 0)
  #expect(
    JesSeeConfiguration(aiProviderMode: .bringYourOwnKey)
      .pendingSetupStep(hasPolyformSession: false, hasAPIKey: false) == 1)
  #expect(
    JesSeeConfiguration(aiProviderMode: .bringYourOwnKey)
      .pendingSetupStep(hasPolyformSession: false, hasAPIKey: true) == 2)
  #expect(
    JesSeeConfiguration(outputFolderPath: "/tmp/JesSee", aiProviderMode: .bringYourOwnKey)
      .pendingSetupStep(hasPolyformSession: false, hasAPIKey: true) == 3)
  #expect(
    JesSeeConfiguration(aiProviderMode: .polyformCovered)
      .pendingSetupStep(hasPolyformSession: true, hasAPIKey: false) == 2)
}

@Test func keychainRoundTripPersistsAcrossCalls() throws {
  let service = "ai.polyform.jessee.tests.\(UUID().uuidString)"
  let key = "sk-test-\(UUID().uuidString)"
  defer { try? JesSeeKeychain.removeAPIKey(service: service) }

  try JesSeeKeychain.saveAPIKey(key, service: service)
  #expect(try JesSeeKeychain.loadAPIKey(service: service) == key)
  try JesSeeKeychain.removeAPIKey(service: service)
  #expect(try JesSeeKeychain.loadAPIKey(service: service) == nil)
}

@Test func workflowSessionRoundTripPersistsAcrossCalls() throws {
  let service = "ai.polyform.jessee.workflow-tests.\(UUID().uuidString)"
  let session = WorkflowAuthSession(
    accessToken: "token", email: "person@example.com", grantID: "grant",
    expiresAt: Date().addingTimeInterval(3_600))
  defer { try? JesSeeKeychain.removeWorkflowSession(service: service) }

  try JesSeeKeychain.saveWorkflowSession(session, service: service)
  let reloaded = try #require(try JesSeeKeychain.loadWorkflowSession(service: service))
  #expect(reloaded.accessToken == session.accessToken)
  #expect(reloaded.email == session.email)
  #expect(reloaded.grantID == session.grantID)
  #expect(abs(reloaded.expiresAt.timeIntervalSince(session.expiresAt)) < 1)
  try JesSeeKeychain.removeWorkflowSession(service: service)
  #expect(try JesSeeKeychain.loadWorkflowSession(service: service) == nil)
}

@Test func captureDimensionsPreserveAspectRatioWithinEncoderBounds() {
  #expect(
    CaptureDimensions.fitted(pointWidth: 960, pointHeight: 540, pointPixelScale: 2)
      == CaptureDimensions(width: 1920, height: 1080))
  #expect(
    CaptureDimensions.fitted(pointWidth: 1080, pointHeight: 1920, pointPixelScale: 1)
      == CaptureDimensions(width: 810, height: 1440))
  #expect(
    CaptureDimensions.fitted(pointWidth: 3440, pointHeight: 1440, pointPixelScale: 1)
      == CaptureDimensions(width: 2560, height: 1070))
}

@Test func frameTimesFollowTranscriptAndStayBounded() {
  let segments = (0..<30).map {
    TranscriptSegment(id: $0, start: Double($0 * 2), end: Double($0 * 2 + 1), text: "Step \($0)")
  }
  let times = MediaTools.frameTimes(duration: 60, segments: segments, maximum: 8)
  #expect(times.count == 8)
  #expect(times == times.sorted())
  #expect(times.allSatisfy { $0 >= 0 && $0 < 60 })
}

@Test func frameTimesKeepRecordingMarkupMoments() {
  let segments = (0..<30).map {
    TranscriptSegment(id: $0, start: Double($0 * 2), end: Double($0 * 2 + 1), text: "Step \($0)")
  }
  let times = MediaTools.frameTimes(
    duration: 60, segments: segments, notableTimes: [17.2], maximum: 8)
  #expect(times.count == 8)
  #expect(times.contains { abs($0 - 17.25) < 0.001 })
}

@Test func recordingMarkupsFollowTheirVisibleTimeline() {
  let stroke = RecordingMarkupStroke(
    kind: .pen,
    points: [RecordingMarkupPoint(x: 0.1, y: 0.2), RecordingMarkupPoint(x: 0.8, y: 0.7)],
    createdAtSeconds: 2,
    removedAtSeconds: 5)
  #expect(!stroke.isVisible(at: 1.9))
  #expect(stroke.isVisible(at: 2))
  #expect(stroke.isVisible(at: 4.9))
  #expect(!stroke.isVisible(at: 5))
}

@Test func recordingMarkupIsBakedIntoExtractedVisuals() throws {
  guard
    let context = CGContext(
      data: nil, width: 100, height: 100, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return }
  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
  guard let image = context.makeImage() else { return }
  let stroke = RecordingMarkupStroke(
    kind: .pen,
    points: [RecordingMarkupPoint(x: 0.2, y: 0.5), RecordingMarkupPoint(x: 0.8, y: 0.5)],
    createdAtSeconds: 1)
  let marked = MediaTools.applyMarkups([stroke], at: 2, to: image)
  let color = NSBitmapImageRep(cgImage: marked).colorAt(x: 50, y: 50)
  #expect((color?.redComponent ?? 0) > (color?.greenComponent ?? 1))
}

@Test func configurationFromOlderBuildGetsCurrentPrivacyDefaults() throws {
  let data = Data(#"{"email":"a@b.com","outputFolderPath":"/tmp","setupCompleted":true}"#.utf8)
  let configuration = try JesSeeJSON.decoder().decode(JesSeeConfiguration.self, from: data)
  #expect(configuration.shareScreenshotsForStory)
  #expect(configuration.shareAnonymousFeatureUsage)
  #expect(configuration.aiProviderMode == .bringYourOwnKey)
}

@Test func configurationPreservesExplicitAnalyticsOptOut() throws {
  let original = JesSeeConfiguration(shareAnonymousFeatureUsage: false)
  let data = try JesSeeJSON.encoder().encode(original)
  let decoded = try JesSeeJSON.decoder().decode(JesSeeConfiguration.self, from: data)
  #expect(!decoded.shareAnonymousFeatureUsage)
}

@Test func featureUsageWritesAGA4ReadyEventWithoutEmail() async throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }

  let recorder = FeatureUsageRecorder(
    product: "jessee", appVersion: "test", applicationSupportURL: temporary)
  let clientIDURL = temporary.appendingPathComponent("jessee/ga4-client-id")
  #expect(!FileManager.default.fileExists(atPath: clientIDURL.path))
  let event = await recorder.record(
    .captureAdded, feature: "video_import", source: "imported_video", itemCount: 1)
  let fileURL = temporary.appendingPathComponent("jessee/feature-usage.jsonl")
  let line = try String(contentsOf: fileURL, encoding: .utf8)

  #expect(event.product == "jessee")
  #expect(event.feature == "video_import")
  let clientIDParts = event.clientID.split(separator: ".")
  #expect(clientIDParts.count == 2)
  #expect(clientIDParts.allSatisfy { UInt32($0) != nil })
  #expect(line.contains(#""activity":"capture_added""#))
  #expect(!line.contains("email"))
  #expect(!line.contains("filename"))
  #expect(FileManager.default.fileExists(atPath: clientIDURL.path))
  await recorder.resetClientID()
  #expect(!FileManager.default.fileExists(atPath: clientIDURL.path))
  #expect(!FileManager.default.fileExists(atPath: fileURL.path))
}

@Test func featureUsageBuildsDirectGA4PayloadWithoutIdentityData() throws {
  let event = FeatureUsageEvent(
    activityID: UUID().uuidString.lowercased(), occurredAt: Date(),
    activity: FeatureUsageActivity.captureAdded.rawValue, clientID: "123.456", userID: nil,
    product: "jessee", appVersion: "test", feature: "video_import", status: "completed",
    source: nil, mode: nil, itemCount: nil)
  let data = try #require(FeatureUsageRecorder.ga4Payload(event))
  let payload = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let events = try #require(payload["events"] as? [[String: Any]])

  #expect(payload["client_id"] as? String == "123.456")
  #expect(events.first?["name"] as? String == "capture_added")
  #expect(String(decoding: data, as: UTF8.self).contains("email") == false)
  #expect(String(decoding: data, as: UTF8.self).contains("user_id") == false)
}

@Test func featureUsageIdentifiesPolyformUsersWithoutSendingEmailOrGrantID() async throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }

  let recorder = FeatureUsageRecorder(
    product: "jessee", appVersion: "test", applicationSupportURL: temporary)
  let login = try #require(await recorder.identify(authenticatedID: "grant-secret"))
  let event = await recorder.record(.captureAdded, feature: "recording")
  let payloadData = try #require(FeatureUsageRecorder.ga4Payload(event))
  let payload = try #require(
    JSONSerialization.jsonObject(with: payloadData) as? [String: Any])
  let userID = try #require(payload["user_id"] as? String)
  let log = try String(
    contentsOf: temporary.appendingPathComponent("jessee/feature-usage.jsonl"), encoding: .utf8)

  #expect(login.activity == "login")
  #expect(login.userID == userID)
  #expect(userID.count == 64)
  #expect(!log.contains("grant-secret"))
  #expect(!log.contains("email"))
  await recorder.clearIdentity()
  let reloadedRecorder = FeatureUsageRecorder(
    product: "jessee", appVersion: "test", applicationSupportURL: temporary)
  let anonymousEvent = await reloadedRecorder.record(.captureAdded, feature: "recording")
  #expect(anonymousEvent.userID == nil)
}

@Test func captionsPreserveSegmentTiming() {
  let transcript = TranscriptDocument(
    text: "Hello world",
    segments: [
      TranscriptSegment(id: 0, start: 1.25, end: 3.5, text: "Hello world")
    ])
  #expect(MediaTools.srt(from: transcript).contains("00:00:01,250 --> 00:00:03,500"))
  #expect(MediaTools.vtt(from: transcript).contains("00:00:01.250 --> 00:00:03.500"))
}

@Test func storyKeyPointsDecodeLegacyStringsWithStableIdentities() throws {
  let data = Data(
    #"{"title":"Legacy","summary":"Summary","keyPoints":["First","Second"],"steps":[]}"#.utf8)
  let story = try JesSeeJSON.decoder().decode(StoryDocument.self, from: data)
  #expect(story.keyPoints.map(\.text) == ["First", "Second"])
  #expect(Set(story.keyPoints.map(\.id)).count == 2)
}

@Test func storyStepsDecodeWithoutRichEditorFields() throws {
  let data = Data(
    #"{"title":"Legacy","summary":"Summary","keyPoints":[],"steps":[{"id":"step-1","startSeconds":0,"endSeconds":2,"title":"Open settings","narrative":"Choose Settings.","transcript":"settings"}]}"#
      .utf8)
  let story = try JesSeeJSON.decoder().decode(StoryDocument.self, from: data)
  #expect(story.steps.first?.narrativeHTML == nil)
  #expect(story.steps.first?.imageAnnotations.isEmpty == true)
}

@Test func storySummaryHTMLIsBackwardCompatibleAndRoundTrips() throws {
  let legacy = Data(#"{"title":"Legacy","summary":"Summary","keyPoints":[],"steps":[]}"#.utf8)
  #expect(try JesSeeJSON.decoder().decode(StoryDocument.self, from: legacy).summaryHTML == nil)

  let story = StoryDocument(
    title: "Rich summary", summary: "Read this first.",
    summaryHTML: "<p>Read <strong>this</strong> first.</p>", keyPoints: [], steps: [])
  let decoded = try JesSeeJSON.decoder().decode(
    StoryDocument.self, from: JesSeeJSON.encoder().encode(story))
  #expect(decoded.summaryHTML == story.summaryHTML)
}

@Test func storySourceURLIsBackwardCompatibleAndRoundTrips() throws {
  let legacy = Data(#"{"title":"Legacy","summary":"Summary","keyPoints":[],"steps":[]}"#.utf8)
  #expect(try JesSeeJSON.decoder().decode(StoryDocument.self, from: legacy).sourceURL == nil)

  let story = StoryDocument(
    title: "Web story", sourceURL: "https://example.com/page", summary: "Summary",
    keyPoints: [], steps: [])
  let decoded = try JesSeeJSON.decoder().decode(
    StoryDocument.self, from: JesSeeJSON.encoder().encode(story))
  #expect(decoded.sourceURL == "https://example.com/page")
}

@Test func modelSelectedScreenshotOverridesStepEndTiming() {
  let frames = [
    CapturedFrame(seconds: 10, filename: "first.jpg"),
    CapturedFrame(seconds: 20, filename: "second.jpg"),
    CapturedFrame(seconds: 30, filename: "third.jpg"),
  ]
  #expect(
    PolyformClient.selectedFrame(requestedSeconds: 10, stepEndSeconds: 30, frames: frames)?.filename
      == "first.jpg")
  #expect(
    PolyformClient.selectedFrame(requestedSeconds: 99, stepEndSeconds: 20, frames: frames)?.filename
      == "second.jpg")
}

@Test func refinementExploresBeforeAndAfterEverySelectedVisual() {
  let frames = [
    CapturedFrame(seconds: 10, filename: "first.jpg"),
    CapturedFrame(seconds: 30, filename: "second.jpg"),
  ]
  let story = StoryDocument(
    title: "Draft", summary: "Summary", keyPoints: [],
    steps: [
      StoryStep(
        startSeconds: 5, endSeconds: 11, title: "First", narrative: "First", transcript: "",
        imageFilename: "first.jpg"),
      StoryStep(
        startSeconds: 25, endSeconds: 31, title: "Second", narrative: "Second",
        transcript: "", imageFilename: "second.jpg"),
    ])

  #expect(
    StoryRefinement.candidateTimes(for: story, frames: frames, duration: 40)
      == [8, 10, 12, 28, 30, 32])
}

@Test func refinementFrameSearchKeepsPairedEvidenceForLongStories() {
  let frames = (0..<10).map {
    CapturedFrame(seconds: Double($0) * 10, filename: "frame-\($0).jpg")
  }
  let story = StoryDocument(
    title: "Draft", summary: "Summary", keyPoints: [],
    steps: frames.map { frame in
      StoryStep(
        startSeconds: frame.seconds, endSeconds: frame.seconds, title: frame.filename,
        narrative: "Step", transcript: "", imageFilename: frame.filename)
    })
  let candidates = StoryRefinement.candidateTimes(for: story, frames: frames, duration: 91)

  #expect(candidates.count == 29)
  #expect(candidates.allSatisfy { $0 >= 0 && $0 < 91 })
  for frame in frames {
    #expect(candidates.contains(max(0, frame.seconds - 2)))
    #expect(candidates.contains(frame.seconds))
    #expect(candidates.contains(min(90.95, frame.seconds + 2)))
  }
}

@Test func storyPlanningKeepsMarkedScreenshotsInTheVisualSet() {
  let frames = (0..<18).map { index in
    CapturedFrame(
      seconds: Double(index), filename: "frame-\(index).jpg", hasVisibleMarkup: index == 7)
  }
  let selected = PolyformClient.planningFrames(frames, maximum: 12)
  #expect(selected.count == 12)
  #expect(selected.contains(where: { $0.filename == "frame-7.jpg" }))
}

@Test func storyPlanningKeepsTimelineCoverageWhenMarkupPersists() {
  let frames = (0..<18).map { index in
    CapturedFrame(
      seconds: Double(index), filename: "frame-\(index).jpg", hasVisibleMarkup: index >= 3)
  }
  let selected = PolyformClient.planningFrames(frames, maximum: 12)
  #expect(selected.count == 12)
  #expect(selected.contains(where: { $0.filename == "frame-0.jpg" }))
  #expect(selected.contains(where: { $0.hasVisibleMarkup }))
}

@Test func storySelectionCannotUseAMetadataOnlyScreenshot() throws {
  let frames = (0..<18).map { index in
    CapturedFrame(seconds: Double(index), filename: "frame-\(index).jpg")
  }
  let attached = PolyformClient.planningFrames(frames, maximum: 12)
  let metadataOnly = try #require(frames.first { frame in
    !attached.contains(where: { $0.filename == frame.filename })
  })
  let selected = PolyformClient.selectedFrame(
    requestedSeconds: metadataOnly.seconds,
    stepEndSeconds: attached.last?.seconds ?? 0,
    frames: attached)

  #expect(selected?.filename != metadataOnly.filename)
  #expect(attached.contains(where: { $0.filename == selected?.filename }))
}

@Test func webpageURLsAreNormalizedAndUnsafeValuesAreRejected() {
  #expect(PolyformClient.normalizedWebURL("example.com/path") == "https://example.com/path")
  #expect(
    PolyformClient.normalizedWebURL("https://example.com/path") == "https://example.com/path")
  #expect(
    PolyformClient.normalizedWebURL("http://localhost:3000/page") == "http://localhost:3000/page")
  #expect(PolyformClient.normalizedWebURL("https://jira/browse/ABC") == "https://jira/browse/ABC")
  #expect(PolyformClient.normalizedWebURL("file:///tmp/private") == nil)
  #expect(PolyformClient.normalizedWebURL("not a URL") == nil)
}

@Test func pkceCredentialsUseURLSafeVerifierAndS256Challenge() {
  let credentials = PKCECredentials.generate()
  #expect(credentials.verifier.count >= 43)
  #expect(credentials.challenge.count == 43)
  #expect(credentials.verifier.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil)
  #expect(credentials.challenge.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil)
}

@Test func workspaceKeepsImportedMediaAndHistory() async throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let source = temporary.appendingPathComponent("walkthrough.mp4")
  try Data("video".utf8).write(to: source)

  let workspace = CaptureWorkspace(rootURL: temporary)
  _ = try await workspace.load()
  let record = try await workspace.importMedia(
    from: source, source: .importedVideo, capturedSourceURL: "example.com/source",
    processingProviderMode: .polyformCovered)
  #expect(FileManager.default.fileExists(atPath: workspace.mediaURL(for: record).path))
  #expect(record.processingProviderMode == .polyformCovered)
  #expect(record.sourceURL == "https://example.com/source")
  #expect(
    record.processingRetryPolicyVersion == CaptureProcessingRetryPolicy.currentVersion)

  let reloaded = CaptureWorkspace(rootURL: temporary)
  let history = try await reloaded.load()
  #expect(history.count == 1)
  #expect(history.first?.title == "walkthrough")
  #expect(history.first?.processingProviderMode == .polyformCovered)
  #expect(history.first?.sourceURL == "https://example.com/source")
}

@Test @MainActor func rendererCreatesOneLongPDFAndEditableHTML() throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let story = StoryDocument(
    title: "A clearer workflow", sourceURL: "https://example.com/workflow",
    summary: "The finished explanation stands on its own.",
    summaryHTML: "<p>The finished explanation <strong>stands</strong> on its own.</p>",
    keyPoints: ["Capture the intent", "Keep the evidence"],
    steps: [
      StoryStep(
        startSeconds: 0, endSeconds: 4, title: "Start here",
        narrative: "Explain the desired outcome directly.", transcript: "")
    ]
  )
  let output = try DocumentRenderer.render(story: story, in: temporary)
  let document = PDFDocument(url: temporary.appendingPathComponent(output.pdf))
  #expect(document?.pageCount == 1)
  #expect(
    try String(contentsOf: temporary.appendingPathComponent(output.html), encoding: .utf8).contains(
      "<strong>stands</strong>"))
  #expect(
    try String(contentsOf: temporary.appendingPathComponent(output.html), encoding: .utf8).contains(
      "https://example.com/workflow"))
}

@Test func mediaToolsReadVideoExtractAudioAndCreateFrames() async throws {
  let ffmpeg = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
  guard FileManager.default.isExecutableFile(atPath: ffmpeg.path) else { return }
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let video = temporary.appendingPathComponent("sample.mp4")
  let process = Process()
  process.executableURL = ffmpeg
  process.arguments = [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "h264", "-c:a", "aac", video.path,
  ]
  try process.run()
  process.waitUntilExit()
  #expect(process.terminationStatus == 0)

  let details = try await MediaTools.inspect(video)
  #expect(details.hasAudio)
  #expect(details.duration > 1.8)
  let audio = temporary.appendingPathComponent("audio.m4a")
  try await MediaTools.extractAudio(from: video, to: audio)
  #expect(FileManager.default.fileExists(atPath: audio.path))
  let frames = try await MediaTools.extractFrames(
    from: video, times: [0.5, 1.5], to: temporary.appendingPathComponent("frames"))
  #expect(frames.count == 2)
}
