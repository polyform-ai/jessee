import Foundation

public struct OpenAIClient: Sendable {
  public static let transcriptionModel = "whisper-1"
  public static let storyModel = "gpt-5.6-sol"

  private let session: URLSession
  private let baseURL = URL(string: "https://api.openai.com/v1")!

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func validate(apiKey: String) async throws {
    for model in [Self.transcriptionModel, Self.storyModel] {
      var request = URLRequest(url: baseURL.appendingPathComponent("models/\(model)"))
      request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
      let data: Data
      let response: URLResponse
      do {
        (data, response) = try await session.data(for: request)
      } catch {
        throw JesSeeError.openAIUnavailable(error.localizedDescription)
      }
      guard let http = response as? HTTPURLResponse else {
        throw JesSeeError.openAIUnavailable("OpenAI returned an unreadable response.")
      }
      switch http.statusCode {
      case 200:
        continue
      case 401:
        throw JesSeeError.invalidAPIKey
      case 403, 404:
        throw JesSeeError.openAIPermission("\(model): \(Self.serviceMessage(from: data))")
      default:
        throw JesSeeError.openAIUnavailable(
          "OpenAI returned \(http.statusCode): \(Self.serviceMessage(from: data))")
      }
    }
  }

  public func transcribe(audioURL: URL, apiKey: String) async throws -> TranscriptDocument {
    let attributes = try FileManager.default.attributesOfItem(atPath: audioURL.path)
    let fileSize = (attributes[.size] as? NSNumber)?.intValue ?? 0
    guard fileSize < 24 * 1024 * 1024 else { throw JesSeeError.audioTooLarge }

    let boundary = "JesSee-\(UUID().uuidString)"
    var body = Data()
    body.appendFormField("model", value: Self.transcriptionModel, boundary: boundary)
    body.appendFormField("response_format", value: "verbose_json", boundary: boundary)
    body.appendFormField("timestamp_granularities[]", value: "segment", boundary: boundary)
    body.appendFormField("timestamp_granularities[]", value: "word", boundary: boundary)
    body.appendFileField(
      "file", filename: audioURL.lastPathComponent, mimeType: "audio/mp4",
      data: try Data(contentsOf: audioURL), boundary: boundary)
    body.append("--\(boundary)--\r\n")

    var request = URLRequest(url: baseURL.appendingPathComponent("audio/transcriptions"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue(
      "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = body

    let data = try await checkedData(for: request, operation: "Transcription")
    let payload = try JSONDecoder().decode(TranscriptionPayload.self, from: data)
    return TranscriptDocument(
      text: payload.text,
      language: payload.language,
      duration: payload.duration,
      segments: (payload.segments ?? []).enumerated().map { index, segment in
        TranscriptSegment(
          id: segment.id ?? index, start: segment.start, end: segment.end, text: segment.text)
      },
      words: (payload.words ?? []).map {
        TranscriptWord(word: $0.word, start: $0.start, end: $0.end)
      },
      model: Self.transcriptionModel
    )
  }

  public func createStory(
    transcript: TranscriptDocument,
    frames: [CapturedFrame],
    captureDirectory: URL,
    apiKey: String,
    includeScreenshotPixels: Bool = true
  ) async throws -> StoryDocument {
    let systemPrompt = """
      Turn a narrated screen recording into a polished visual walkthrough that can replace watching the video.
      Write in the speaker's direct, reader-facing voice. Never say "the user said", "the narrator", or "this recording shows".
      Preserve the speaker's goal, important decisions, concrete details, and chronological actions. Titles and narratives must make sense on their own.
      Return only valid JSON with this shape:
      {"title":string,"summary":string,"keyPoints":string[],"steps":[{"startSeconds":number,"endSeconds":number,"title":string,"narrative":string,"transcript":string}]}
      Use the transcript timestamps. Keep each step focused and choose boundaries that make a useful screenshot possible.
      """

    var userContent: [[String: Any]] = [
      [
        "type": "input_text",
        "text": try Self.transcriptContext(transcript: transcript, frames: frames),
      ]
    ]
    for frame in includeScreenshotPixels ? Self.planningFrames(frames) : [] {
      let imageURL = captureDirectory.appendingPathComponent(frame.filename)
      guard let data = try? Data(contentsOf: imageURL) else { continue }
      userContent.append([
        "type": "input_text",
        "text": "Screenshot at \(String(format: "%.1f", frame.seconds)) seconds",
      ])
      userContent.append([
        "type": "input_image", "image_url": "data:image/jpeg;base64,\(data.base64EncodedString())",
        "detail": "high",
      ])
    }

    let payload: [String: Any] = [
      "model": Self.storyModel,
      "reasoning": ["effort": "medium"],
      "input": [
        ["role": "system", "content": [["type": "input_text", "text": systemPrompt]]],
        ["role": "user", "content": userContent],
      ],
    ]
    var request = URLRequest(url: baseURL.appendingPathComponent("responses"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

    let data = try await checkedData(for: request, operation: "Story creation")
    let response = try JSONDecoder().decode(ResponsesPayload.self, from: data)
    guard let text = response.outputText, let json = Self.jsonData(from: text) else {
      throw JesSeeError.invalidResponse("JesSee received an incomplete story from OpenAI.")
    }
    let draft = try JSONDecoder().decode(StoryDraft.self, from: json)
    return StoryDocument(
      title: draft.title,
      summary: draft.summary,
      keyPoints: draft.keyPoints,
      steps: draft.steps.map { step in
        let frame = MediaTools.nearestFrame(to: step.endSeconds, frames: frames)
        return StoryStep(
          startSeconds: step.startSeconds,
          endSeconds: step.endSeconds,
          title: step.title,
          narrative: step.narrative,
          transcript: step.transcript,
          imageFilename: frame?.filename
        )
      }
    )
  }

  private func checkedData(for request: URLRequest, operation: String) async throws -> Data {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let message = String(data: data, encoding: .utf8) ?? "Unknown service error"
      throw JesSeeError.invalidResponse("\(operation) failed (\(status)): \(message.prefix(280))")
    }
    return data
  }

  private static func transcriptContext(transcript: TranscriptDocument, frames: [CapturedFrame])
    throws -> String
  {
    let context: [String: Any] = [
      "transcriptText": transcript.text,
      "transcriptSegments": transcript.segments.map {
        ["start": $0.start, "end": $0.end, "text": $0.text]
      },
      "availableScreenshotTimes": frames.map(\.seconds),
    ]
    let data = try JSONSerialization.data(withJSONObject: context, options: [.prettyPrinted])
    return String(decoding: data, as: UTF8.self)
  }

  private static func planningFrames(_ frames: [CapturedFrame], maximum: Int = 12)
    -> [CapturedFrame]
  {
    guard frames.count > maximum, maximum > 1 else { return frames }
    return (0..<maximum).map { index in
      let position = Double(index) * Double(frames.count - 1) / Double(maximum - 1)
      return frames[Int(position.rounded())]
    }
  }

  private static func jsonData(from text: String) -> Data? {
    var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("```") {
      value = value.replacingOccurrences(
        of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
      value = value.replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
    }
    guard let start = value.firstIndex(of: "{"), let end = value.lastIndex(of: "}") else {
      return nil
    }
    return String(value[start...end]).data(using: .utf8)
  }

  private static func serviceMessage(from data: Data) -> String {
    struct ErrorEnvelope: Decodable {
      struct ServiceError: Decodable { var message: String }
      var error: ServiceError?
    }
    if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data),
      let message = envelope.error?.message
    {
      return String(message.prefix(240))
    }
    return "Check this API key's project permissions and model access."
  }
}

private struct TranscriptionPayload: Decodable {
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
  var language: String?
  var duration: Double?
  var segments: [Segment]?
  var words: [Word]?
}

private struct StoryDraft: Decodable {
  struct Step: Decodable {
    var startSeconds: Double
    var endSeconds: Double
    var title: String
    var narrative: String
    var transcript: String
  }
  var title: String
  var summary: String
  var keyPoints: [String]
  var steps: [Step]
}

private struct ResponsesPayload: Decodable {
  struct Output: Decodable {
    struct Content: Decodable {
      var type: String
      var text: String?
    }
    var type: String
    var content: [Content]?
  }
  var directOutputText: String?
  var output: [Output]?

  enum CodingKeys: String, CodingKey {
    case directOutputText = "output_text"
    case output
  }

  var outputText: String? {
    if let directOutputText { return directOutputText }
    return output?.flatMap { $0.content ?? [] }.first(where: { $0.type == "output_text" })?.text
  }
}

extension Data {
  fileprivate mutating func append(_ string: String) {
    append(Data(string.utf8))
  }

  fileprivate mutating func appendFormField(_ name: String, value: String, boundary: String) {
    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
    append("\(value)\r\n")
  }

  fileprivate mutating func appendFileField(
    _ name: String, filename: String, mimeType: String, data: Data, boundary: String
  ) {
    append("--\(boundary)\r\n")
    append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
    append("Content-Type: \(mimeType)\r\n\r\n")
    append(data)
    append("\r\n")
  }
}
