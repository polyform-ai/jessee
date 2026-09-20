import CryptoKit
import Foundation

public enum FeatureUsageActivity: String, Sendable {
  case captureAdded = "capture_added"
  case storyCreated = "story_created"
  case storyEdited = "story_edited"
  case pdfOpened = "pdf_opened"
  case pdfPublished = "pdf_published"
  case screenshotPublished = "screenshot_published"
  case userIdentified = "login"
}

public struct FeatureUsageEvent: Codable, Equatable, Sendable {
  public let activityID: String
  public let occurredAt: Date
  public let activity: String
  public let clientID: String
  public let userID: String?
  public let product: String
  public let appVersion: String
  public let feature: String
  public let status: String
  public let source: String?
  public let mode: String?
  public let itemCount: Int?

  enum CodingKeys: String, CodingKey {
    case activityID = "activity_id"
    case occurredAt = "ts"
    case activity
    case clientID = "client_id"
    case userID = "user_id"
    case product
    case appVersion = "app_version"
    case feature
    case status
    case source
    case mode
    case itemCount = "item_count"
  }
}

public actor FeatureUsageRecorder {
  public static let measurementIDInfoKey = "PFGA4MeasurementID"
  public static let apiSecretInfoKey = "PFGA4APISecret"

  private let product: String
  private let appVersion: String
  private let eventFileURL: URL
  private let endpoint: URL?
  private var clientID: String?
  private var userID: String?
  private var hasLoadedUserID = false
  private let session: URLSession

  public init(
    product: String,
    appVersion: String? = nil,
    applicationSupportURL: URL? = nil,
    endpoint: URL? = nil,
    session: URLSession = .shared
  ) {
    self.product = product
    self.appVersion =
      appVersion
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
      ?? "development"
    let supportRoot =
      applicationSupportURL
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let directory = supportRoot.appendingPathComponent(product, isDirectory: true)
    eventFileURL = directory.appendingPathComponent("feature-usage.jsonl")
    clientID = nil
    self.endpoint = endpoint ?? Self.configuredEndpoint()
    self.session = session
  }

  @discardableResult
  public func record(
    _ activity: FeatureUsageActivity,
    feature: String,
    source: String? = nil,
    mode: String? = nil,
    itemCount: Int? = nil
  ) async -> FeatureUsageEvent {
    let event = makeEvent(
      activity, feature: feature, source: source, mode: mode, itemCount: itemCount)
    persist(event)
    await send(event)
    return event
  }

  @discardableResult
  public func identify(authenticatedID: String, emitLoginEvent: Bool = true) -> FeatureUsageEvent? {
    let value = authenticatedID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    let identity = Self.opaqueUserID(for: value)
    userID = identity
    hasLoadedUserID = true
    let fileURL = eventFileURL.deletingLastPathComponent().appendingPathComponent("ga4-user-id")
    try? FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? Data("\(identity)\n".utf8).write(to: fileURL, options: .atomic)
    guard emitLoginEvent else { return nil }
    let event = makeEvent(
      .userIdentified, feature: "polyform_auth", source: "polyform", mode: "polyform_covered")
    persist(event)
    Task { await self.send(event) }
    return event
  }

  public func clearIdentity() {
    userID = nil
    hasLoadedUserID = true
    try? FileManager.default.removeItem(
      at: eventFileURL.deletingLastPathComponent().appendingPathComponent("ga4-user-id"))
  }

  public func resetAllAnalyticsData() {
    clientID = nil
    clearIdentity()
    let directory = eventFileURL.deletingLastPathComponent()
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("ga4-client-id"))
    try? FileManager.default.removeItem(
      at: directory.appendingPathComponent("feature-usage-installation-id"))
    try? FileManager.default.removeItem(at: eventFileURL)
  }

  private func send(_ event: FeatureUsageEvent) async {
    guard let endpoint else { return }
    guard let body = Self.ga4Payload(event) else { return }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    guard let (_, response) = try? await session.data(for: request),
      let httpResponse = response as? HTTPURLResponse,
      (200..<300).contains(httpResponse.statusCode)
    else { return }
  }

  private func makeEvent(
    _ activity: FeatureUsageActivity,
    feature: String,
    source: String? = nil,
    mode: String? = nil,
    itemCount: Int? = nil
  ) -> FeatureUsageEvent {
    FeatureUsageEvent(
      activityID: UUID().uuidString.lowercased(),
      occurredAt: Date(),
      activity: activity.rawValue,
      clientID: currentClientID(),
      userID: currentUserID(),
      product: product,
      appVersion: appVersion,
      feature: feature,
      status: "completed",
      source: source,
      mode: mode,
      itemCount: itemCount)
  }

  private func persist(_ event: FeatureUsageEvent) {
    guard let data = Self.encode(event) else { return }
    Self.append(data, to: eventFileURL)
  }

  static func ga4Payload(_ event: FeatureUsageEvent) -> Data? {
    var parameters: [String: Any] = [
      "event_id": event.activityID,
      "product": event.product,
      "app_version": event.appVersion,
      "feature": event.feature,
      "status": event.status,
      "engagement_time_msec": 1,
    ]
    if let source = event.source { parameters["source"] = source }
    if let mode = event.mode { parameters["mode"] = mode }
    if let itemCount = event.itemCount { parameters["item_count"] = itemCount }
    var payload: [String: Any] = [
      "client_id": event.clientID,
      "consent": ["ad_user_data": "DENIED", "ad_personalization": "DENIED"],
      "events": [["name": event.activity, "params": parameters]],
    ]
    if let userID = event.userID { payload["user_id"] = userID }
    return try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  }

  private static func configuredEndpoint() -> URL? {
    guard
      let measurementID = Bundle.main.object(forInfoDictionaryKey: measurementIDInfoKey) as? String,
      !measurementID.isEmpty,
      let apiSecret = Bundle.main.object(forInfoDictionaryKey: apiSecretInfoKey) as? String,
      !apiSecret.isEmpty
    else { return nil }
    var components = URLComponents(string: "https://www.google-analytics.com/mp/collect")
    components?.queryItems = [
      URLQueryItem(name: "measurement_id", value: measurementID),
      URLQueryItem(name: "api_secret", value: apiSecret),
    ]
    return components?.url
  }

  private func currentClientID() -> String {
    if let clientID { return clientID }
    let value = Self.loadClientID(in: eventFileURL.deletingLastPathComponent())
    clientID = value
    return value
  }

  private func currentUserID() -> String? {
    if hasLoadedUserID { return userID }
    hasLoadedUserID = true
    let fileURL = eventFileURL.deletingLastPathComponent().appendingPathComponent("ga4-user-id")
    guard
      let value = try? String(contentsOf: fileURL, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
      value.count == 64,
      value.allSatisfy({ $0.isHexDigit })
    else { return nil }
    userID = value
    return value
  }

  static func opaqueUserID(for authenticatedID: String) -> String {
    SHA256.hash(data: Data("jessee-ga4-user-v1:\(authenticatedID)".utf8))
      .map { String(format: "%02x", $0) }
      .joined()
  }

  private static func loadClientID(in directory: URL) -> String {
    let fileURL = directory.appendingPathComponent("ga4-client-id")
    if let value = try? String(contentsOf: fileURL, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines),
      isValidClientID(value)
    {
      return value
    }
    let value = "\(UInt32.random(in: 1...UInt32.max)).\(UInt32.random(in: 1...UInt32.max))"
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? Data("\(value)\n".utf8).write(to: fileURL, options: .atomic)
    return value
  }

  private static func isValidClientID(_ value: String) -> Bool {
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    return parts.count == 2 && parts.allSatisfy { UInt32($0).map { $0 > 0 } ?? false }
  }

  private static func encode<T: Encodable>(_ value: T) -> Data? {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try? encoder.encode(value)
  }

  private static func append(_ data: Data, to fileURL: URL) {
    try? FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let line = data + Data("\n".utf8)
    if FileManager.default.fileExists(atPath: fileURL.path),
      let handle = try? FileHandle(forWritingTo: fileURL)
    {
      defer { try? handle.close() }
      do {
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
      } catch {}
    } else {
      try? line.write(to: fileURL, options: .atomic)
    }
  }
}
