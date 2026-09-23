import Foundation

public struct DirectOpenAIClient: Sendable {
  public static let transcriptionModel = "whisper-1"
  public static let storyModel = "gpt-5.6-sol"
  static let storyOutputJSON = """
    {"title":"string","sourceURL":"string or null","documentType":"string","entryLabel":"singular string","summary":"string","keyPoints":["string"],"entries":[{"startSeconds":0,"endSeconds":5,"screenshotTimeSeconds":4.5,"title":"string","narrative":"string","transcript":"string"}]}
    """
  static let storyPrompt = """
    Turn a narrated screen recording into a polished visual document that can replace watching the video.
    Write in the speaker's direct, reader-facing voice. Never say "the user said", "the narrator", or "this recording shows".
    Preserve the speaker's goal, important decisions, concrete details, chronological actions, and every distinct idea or request that matters. Titles and narratives must make sense on their own.
    Return only valid JSON matching this example shape:
    \(storyOutputJSON)
    Infer the best document structure from the speaker's actual purpose. Choose documentType and entryLabel freely; they are open-ended labels, not an enum. Tutorial, issue report, review notes, decision log, and their entry labels are examples only, not a fixed list.
    Do not force the recording into sequential steps. If it teaches a process, use ordered instructional entries. If it collects issues, feedback, findings, requests, decisions, examples, or other items, give every distinct item its own entry even when related or mentioned briefly. For thematic explanations, create the clearest standalone sections. Before returning JSON, audit the full transcript so no meaningful item is merged away or dropped.
    Use the transcript timestamps. Keep each entry focused and choose boundaries that make a useful screenshot possible.
    For every entry, choose screenshotTimeSeconds from the exact available screenshot times. When imageAttached is true for any screenshot, choose only among those attached images. Choose the image that best proves the point, not merely the image nearest the end of the entry. Prefer a clearly marked-up image or a stable resulting state. Avoid loading skeletons, blank transitions, and incidental clicks unless the missing or empty state is itself the issue. If the narration contrasts two materially different states, make separate entries so each state has its own visual evidence.
    If a browser address is clearly visible, set sourceURL to the most specific readable HTTP or HTTPS URL. A clearly readable host may be normalized to https://host. Otherwise return null. Never infer a URL from unrelated page copy.
    """

  private let session: URLSession
  private let baseURL = URL(string: "https://api.openai.com/v1")!

  public init(session: URLSession = .shared) { self.session = session }

  public func validate(apiKey: String) async throws {
    for model in [Self.transcriptionModel, Self.storyModel] {
      var request = URLRequest(url: baseURL.appendingPathComponent("models/\(model)"))
      request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw JesSeeError.serviceUnavailable("OpenAI returned an unreadable response.")
      }
      switch http.statusCode {
      case 200: continue
      case 401: throw JesSeeError.invalidAPIKey
      default:
        throw JesSeeError.serviceUnavailable("OpenAI returned \(http.statusCode).")
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
    let payload: DirectTranscriptionPayload = try decodeResponse(
      from: data, operation: "Transcription")
    return TranscriptDocument(
      text: payload.text, language: payload.language, duration: payload.duration,
      segments: (payload.segments ?? []).enumerated().map { index, segment in
        TranscriptSegment(
          id: segment.id ?? index, start: segment.start, end: segment.end, text: segment.text)
      },
      words: (payload.words ?? []).map {
        TranscriptWord(word: $0.word, start: $0.start, end: $0.end)
      },
      model: Self.transcriptionModel)
  }

  public func createStory(
    transcript: TranscriptDocument,
    frames: [CapturedFrame],
    captureDirectory: URL,
    apiKey: String,
    includeScreenshotPixels: Bool = true
  ) async throws -> StoryDocument {
    let imageFrames = includeScreenshotPixels ? PolyformClient.planningFrames(frames) : []
    let imageAttachments = imageFrames.compactMap { frame -> (CapturedFrame, Data)? in
      let imageURL = captureDirectory.appendingPathComponent(frame.filename)
      guard let data = try? Data(contentsOf: imageURL) else { return nil }
      return (frame, data)
    }
    let attachedFrames = imageAttachments.map(\.0)
    let includedImageFilenames = Set(attachedFrames.map(\.filename))
    var userContent: [[String: Any]] = [
      [
        "type": "input_text",
        "text": try Self.storyUserMessage(
          transcript: transcript, frames: frames,
          includedImageFilenames: includedImageFilenames),
      ]
    ]
    for (frame, data) in imageAttachments {
      userContent.append([
        "type": "input_text",
        "text":
          "Screenshot option at exactly \(frame.seconds) seconds. Return this exact value as screenshotTimeSeconds when this image best proves an entry.",
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
        ["role": "system", "content": [["type": "input_text", "text": Self.storyPrompt]]],
        ["role": "user", "content": userContent],
      ],
    ]
    var request = URLRequest(url: baseURL.appendingPathComponent("responses"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

    let data = try await checkedData(for: request, operation: "Story creation")
    let response: DirectResponsesPayload = try decodeResponse(
      from: data, operation: "Story creation")
    guard let text = response.outputText, let json = Self.jsonData(from: text) else {
      throw JesSeeError.invalidResponse("JesSee received an incomplete story from OpenAI.")
    }
    let draft: StoryDraft = try decodeResponse(from: json, operation: "Story creation")
    let eligibleFrames = attachedFrames.isEmpty ? frames : attachedFrames
    return StoryRefinement.document(from: draft, eligibleFrames: eligibleFrames)
  }

  public func refineStory(
    _ story: StoryDocument,
    transcript: TranscriptDocument,
    frames: [CapturedFrame],
    captureDirectory: URL,
    round: Int,
    apiKey: String
  ) async throws -> StoryDocument {
    let imageAttachments = frames.compactMap { frame -> (CapturedFrame, Data)? in
      let imageURL = captureDirectory.appendingPathComponent(frame.filename)
      guard let data = try? Data(contentsOf: imageURL) else { return nil }
      return (frame, data)
    }
    let attachedFrames = imageAttachments.map(\.0)
    let includedImageFilenames = Set(attachedFrames.map(\.filename))
    var userContent: [[String: Any]] = [
      [
        "type": "input_text",
        "text": try StoryRefinement.userMessage(
          story: story,
          transcript: transcript,
          frames: frames,
          includedImageFilenames: includedImageFilenames,
          round: round),
      ]
    ]
    for (frame, data) in imageAttachments {
      userContent.append([
        "type": "input_text",
        "text":
          "Nearby screenshot candidate at exactly \(frame.seconds) seconds. Return this exact value as screenshotTimeSeconds when this image best proves an entry.",
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
        [
          "role": "system",
          "content": [["type": "input_text", "text": StoryRefinement.prompt(round: round)]],
        ],
        ["role": "user", "content": userContent],
      ],
    ]
    var request = URLRequest(url: baseURL.appendingPathComponent("responses"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

    let data = try await checkedData(for: request, operation: "Story refinement")
    let response: DirectResponsesPayload = try decodeResponse(
      from: data, operation: "Story refinement")
    guard let text = response.outputText, let json = Self.jsonData(from: text) else {
      throw JesSeeError.invalidResponse("JesSee received an incomplete refined story from OpenAI.")
    }
    let draft: StoryDraft = try decodeResponse(from: json, operation: "Story refinement")
    let eligibleFrames = attachedFrames.isEmpty ? frames : attachedFrames
    return StoryRefinement.document(
      from: draft, eligibleFrames: eligibleFrames,
      defaultDocumentType: story.documentType, defaultEntryLabel: story.entryLabel)
  }

  private func checkedData(for request: URLRequest, operation: String) async throws -> Data {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw JesSeeError.serviceUnavailable("\(operation) returned an unreadable response.")
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 || http.statusCode == 403 { throw JesSeeError.invalidAPIKey }
      let message = String(data: data, encoding: .utf8) ?? "Unknown service error"
      throw JesSeeError.requestFailed(http.statusCode, String(message.prefix(280)))
    }
    return data
  }

  private func decodeResponse<Value: Decodable>(
    from data: Data, operation: String
  ) throws -> Value {
    do {
      return try JSONDecoder().decode(Value.self, from: data)
    } catch {
      throw JesSeeError.invalidResponse("\(operation) returned incomplete data.")
    }
  }

  static func storyUserMessage(
    transcript: TranscriptDocument, frames: [CapturedFrame], includedImageFilenames: Set<String>
  ) throws -> String {
    let context: [String: Any] = [
      "transcriptText": transcript.text,
      "transcriptSegments": transcript.segments.map {
        ["start": $0.start, "end": $0.end, "text": $0.text]
      },
      "availableScreenshots": frames.map {
        [
          "timeSeconds": $0.seconds, "filename": $0.filename,
          "hasVisibleMarkup": $0.hasVisibleMarkup,
          "imageAttached": includedImageFilenames.contains($0.filename),
        ] as [String: Any]
      },
    ]
    return String(
      decoding: try JSONSerialization.data(withJSONObject: context, options: [.prettyPrinted]),
      as: UTF8.self)
  }

  static func jsonData(from text: String) -> Data? {
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
}

private struct DirectTranscriptionPayload: Decodable {
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

private struct DirectResponsesPayload: Decodable {
  struct Output: Decodable {
    struct Content: Decodable {
      var type: String
      var text: String?
    }
    var content: [Content]?
  }
  var directOutputText: String?
  var output: [Output]?
  enum CodingKeys: String, CodingKey {
    case directOutputText = "output_text"
    case output
  }
  var outputText: String? {
    directOutputText
      ?? output?.flatMap { $0.content ?? [] }.first(where: { $0.type == "output_text" })?.text
  }
}

extension Data {
  fileprivate mutating func append(_ string: String) { append(Data(string.utf8)) }
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
