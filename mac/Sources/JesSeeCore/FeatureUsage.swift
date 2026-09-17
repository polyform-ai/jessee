import Foundation

public enum FeatureUsageActivity: String, Sendable {
  case captureAdded = "capture_added"
  case storyCreated = "story_created"
  case storyEdited = "story_edited"
  case pdfOpened = "pdf_opened"
}

public struct FeatureUsageEvent: Codable, Equatable, Sendable {
  public let activityID: String
  public let occurredAt: Date
  public let activity: String
  public let anonymousCustomerID: String
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
    case anonymousCustomerID = "anonymous_customer_id"
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
  public static let endpointInfoKey = "PFFeatureUsageEndpoint"

  private let product: String
  private let appVersion: String
  private let eventFileURL: URL
  private let endpoint: URL?
  private let installationID: String
  private let session: URLSession

  public init(
    product: String,
    appVersion: String? = nil,
    applicationSupportURL: URL? = nil,
    endpoint: URL? = nil,
    session: URLSession = .shared
  ) {
    self.product = product
    self.appVersion = appVersion
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
      ?? "development"
    let supportRoot = applicationSupportURL
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let directory = supportRoot.appendingPathComponent(product, isDirectory: true)
    eventFileURL = directory.appendingPathComponent("feature-usage.jsonl")
    installationID = Self.loadInstallationID(in: directory)
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
    let event = FeatureUsageEvent(
      activityID: UUID().uuidString.lowercased(),
      occurredAt: Date(),
      activity: activity.rawValue,
      anonymousCustomerID: installationID,
      product: product,
      appVersion: appVersion,
      feature: feature,
      status: "completed",
      source: source,
      mode: mode,
      itemCount: itemCount)
    guard let data = Self.encode(event) else { return event }
    Self.append(data, to: eventFileURL)
    await send(data)
    return event
  }

  private func send(_ eventData: Data) async {
    guard let endpoint else { return }
    let body = Data("{\"event\":".utf8) + eventData + Data("}".utf8)
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    guard let (_, response) = try? await session.data(for: request),
      let httpResponse = response as? HTTPURLResponse,
      (200..<300).contains(httpResponse.statusCode)
    else { return }
  }

  private static func configuredEndpoint() -> URL? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: endpointInfoKey) as? String,
      let url = URL(string: value), url.scheme == "https"
    else { return nil }
    return url
  }

  private static func loadInstallationID(in directory: URL) -> String {
    let fileURL = directory.appendingPathComponent("feature-usage-installation-id")
    if let value = try? String(contentsOf: fileURL, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines),
      UUID(uuidString: value) != nil
    {
      return value.lowercased()
    }
    let value = UUID().uuidString.lowercased()
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? Data("\(value)\n".utf8).write(to: fileURL, options: .atomic)
    return value
  }

  private static func encode(_ event: FeatureUsageEvent) -> Data? {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try? encoder.encode(event)
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
