import Foundation

public actor CaptureWorkspace {
  public nonisolated let rootURL: URL
  private var records: [CaptureRecord] = []

  public init(rootURL: URL) {
    self.rootURL = rootURL.appendingPathComponent("JesSee Library", isDirectory: true)
  }

  public func load() throws -> [CaptureRecord] {
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    let indexURL = rootURL.appendingPathComponent("library.json")
    guard FileManager.default.fileExists(atPath: indexURL.path) else {
      records = []
      return []
    }
    records = try JesSeeJSON.decoder().decode(
      [CaptureRecord].self, from: Data(contentsOf: indexURL)
    )
    .sorted { $0.createdAt > $1.createdAt }
    return records
  }

  public func allRecords() -> [CaptureRecord] {
    records.sorted { $0.createdAt > $1.createdAt }
  }

  public func importMedia(
    from sourceURL: URL,
    source: CaptureSource,
    capturedSourceURL: String? = nil,
    processingProviderMode: AIProviderMode? = nil,
    recordingMarkups: [RecordingMarkupStroke]? = nil
  ) throws -> CaptureRecord {
    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
      throw JesSeeError.sourceUnavailable(sourceURL.path)
    }
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    let now = Date()
    let id = UUID().uuidString.lowercased()
    let date = Self.folderDate(from: now)
    let directory = rootURL.appendingPathComponent("\(date)-\(id.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let fileExtension =
      sourceURL.pathExtension.isEmpty ? "mp4" : sourceURL.pathExtension.lowercased()
    let filename = "recording.\(fileExtension)"
    let destination = directory.appendingPathComponent(filename)
    try FileManager.default.copyItem(at: sourceURL, to: destination)
    let fallbackTitle =
      source == .recording
      ? "Untitled recording" : sourceURL.deletingPathExtension().lastPathComponent
    let record = CaptureRecord(
      id: id,
      createdAt: now,
      updatedAt: now,
      title: fallbackTitle,
      source: source,
      sourceURL: PolyformClient.normalizedWebURL(capturedSourceURL),
      mediaFilename: filename,
      recordingMarkups: recordingMarkups,
      processingRetryPolicyVersion: CaptureProcessingRetryPolicy.currentVersion,
      processingProviderMode: processingProviderMode
    )
    try save(record)
    return record
  }

  public func importScreenshot(
    from sourceURL: URL,
    capturedSourceURL: String? = nil
  ) throws -> CaptureRecord {
    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
      throw JesSeeError.sourceUnavailable(sourceURL.path)
    }
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    let now = Date()
    let id = UUID().uuidString.lowercased()
    let date = Self.folderDate(from: now)
    let directory = rootURL.appendingPathComponent("\(date)-\(id.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let fileExtension = sourceURL.pathExtension.isEmpty ? "png" : sourceURL.pathExtension.lowercased()
    let filename = "screenshot.\(fileExtension)"
    try FileManager.default.copyItem(
      at: sourceURL, to: directory.appendingPathComponent(filename))

    let normalizedSourceURL = PolyformClient.normalizedWebURL(capturedSourceURL)
    let story = StoryDocument(
      title: "Screenshot",
      sourceURL: normalizedSourceURL,
      summary: "",
      keyPoints: [],
      steps: [
        StoryStep(
          startSeconds: 0,
          endSeconds: 0,
          title: "Screenshot",
          narrative: "",
          transcript: "",
          imageFilename: filename)
      ])
    let storyFilename = "story.json"
    let record = CaptureRecord(
      id: id,
      createdAt: now,
      updatedAt: now,
      title: story.title,
      source: .screenshot,
      sourceURL: normalizedSourceURL,
      stage: .ready,
      mediaFilename: filename,
      storyFilename: storyFilename,
      imageFilenames: [filename],
      imageTimes: [filename: 0])
    try write(story, filename: storyFilename, for: record)
    try save(record)
    return record
  }

  public func save(_ record: CaptureRecord) throws {
    var updated = record
    updated.updatedAt = Date()
    if let index = records.firstIndex(where: { $0.id == updated.id }) {
      records[index] = updated
    } else {
      records.append(updated)
    }
    records.sort { $0.createdAt > $1.createdAt }
    let data = try JesSeeJSON.encoder().encode(records)
    try data.write(to: rootURL.appendingPathComponent("library.json"), options: .atomic)
    let recordData = try JesSeeJSON.encoder().encode(updated)
    try recordData.write(
      to: directoryURL(for: updated).appendingPathComponent("capture.json"), options: .atomic)
  }

  public func record(id: String) -> CaptureRecord? {
    records.first { $0.id == id }
  }

  public nonisolated func directoryURL(for record: CaptureRecord) -> URL {
    let date = Self.folderDate(from: record.createdAt)
    return rootURL.appendingPathComponent("\(date)-\(record.id.prefix(8))", isDirectory: true)
  }

  public nonisolated func mediaURL(for record: CaptureRecord) -> URL {
    directoryURL(for: record).appendingPathComponent(record.mediaFilename)
  }

  public func write<T: Encodable>(_ value: T, filename: String, for record: CaptureRecord) throws {
    let data = try JesSeeJSON.encoder().encode(value)
    try data.write(to: directoryURL(for: record).appendingPathComponent(filename), options: .atomic)
  }

  public func read<T: Decodable>(_ type: T.Type, filename: String, for record: CaptureRecord) throws
    -> T
  {
    let data = try Data(contentsOf: directoryURL(for: record).appendingPathComponent(filename))
    return try JesSeeJSON.decoder().decode(type, from: data)
  }

  private nonisolated static func folderDate(from date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd-HHmmss"
    return formatter.string(from: date)
  }
}
