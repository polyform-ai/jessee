import Foundation

struct StoryDraft: Decodable {
  struct Step: Decodable {
    var startSeconds: Double
    var endSeconds: Double
    var screenshotTimeSeconds: Double?
    var title: String
    var narrative: String
    var transcript: String
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

enum StoryRefinement {
  static let maximumRounds = 2
  static let nearbyOffsets = [-2.0, 0, 2.0]

  static func prompt(round: Int) -> String {
    """
    Act as the final editor for a complete narrated visual walkthrough. This is refinement pass \(round) of \(maximumRounds).
    Read the entire current story, the full timestamped transcript, and every attached nearby screenshot before changing anything.
    Return the entire revised story as valid JSON matching this exact shape:
    \(DirectOpenAIClient.storyOutputJSON)
    Make the story coherent from beginning to end. Correct titles, summaries, steps, or visual choices that conflict with the transcript or visible evidence. Merge or remove redundant and generic navigation steps. Preserve concrete requests and the speaker's direct, reader-facing voice.
    Never invent an action, requirement, label, or completed result. When the transcript is incomplete or mistranscribed, use clearly visible screenshot evidence only to clarify what is actually on screen; otherwise state the uncertainty or omit that incomplete idea.
    For every retained step, choose screenshotTimeSeconds from the exact available screenshot times whose imageAttached value is true. Prefer the stable frame that best proves the step, including a useful annotation when present. Compare nearby before/after frames instead of automatically keeping the current image. Avoid loading, blank, transition, menu-hover, or incidental-click states unless that state is the subject of the step.
    Keep sourceURL only when it is already supported by the draft or clearly readable in the screenshots. Return JSON only.
    """
  }

  static func candidateTimes(
    for story: StoryDocument,
    frames: [CapturedFrame],
    duration: Double,
    offsets: [Double] = nearbyOffsets
  ) -> [Double] {
    guard duration > 0, !story.steps.isEmpty else { return [] }
    let timeByFilename = Dictionary(uniqueKeysWithValues: frames.map { ($0.filename, $0.seconds) })
    let lastTime = max(0, duration - 0.05)
    let anchors = story.steps.map { step in
      max(0, min(lastTime, step.imageFilename.flatMap { timeByFilename[$0] } ?? step.endSeconds))
    }

    var centers: [Double] = []
    var neighbors: [Double] = []
    for anchor in anchors { appendUnique(anchor, to: &centers) }
    for anchor in anchors {
      for offset in offsets where offset != 0 {
        let neighbor = max(0, min(lastTime, anchor + offset))
        if !centers.contains(where: { abs($0 - neighbor) < 0.35 }) {
          appendUnique(neighbor, to: &neighbors)
        }
      }
    }
    return (centers + neighbors).sorted()
  }

  static func selectedFrames(for story: StoryDocument, in frames: [CapturedFrame])
    -> [CapturedFrame]
  {
    let filenames = Set(story.steps.compactMap(\.imageFilename))
    return frames.filter { filenames.contains($0.filename) }
  }

  static func userMessage(
    story: StoryDocument,
    transcript: TranscriptDocument,
    frames: [CapturedFrame],
    includedImageFilenames: Set<String>,
    round: Int
  ) throws -> String {
    let timeByFilename = Dictionary(uniqueKeysWithValues: frames.map { ($0.filename, $0.seconds) })
    let currentStory: [String: Any] = [
      "title": story.title,
      "sourceURL": story.sourceURL.map { $0 as Any } ?? NSNull(),
      "summary": story.summary,
      "keyPoints": story.keyPoints.map(\.text),
      "steps": story.steps.map { step in
        [
          "startSeconds": step.startSeconds,
          "endSeconds": step.endSeconds,
          "selectedScreenshotTimeSeconds": step.imageFilename.flatMap { timeByFilename[$0] }
            .map { $0 as Any } ?? NSNull(),
          "title": step.title,
          "narrative": step.narrative,
          "transcript": step.transcript,
        ] as [String: Any]
      },
    ]
    let context: [String: Any] = [
      "refinementRound": round,
      "currentStory": currentStory,
      "transcriptText": transcript.text,
      "transcriptSegments": transcript.segments.map {
        ["start": $0.start, "end": $0.end, "text": $0.text]
      },
      "availableScreenshots": frames.map {
        [
          "timeSeconds": $0.seconds,
          "filename": $0.filename,
          "hasVisibleMarkup": $0.hasVisibleMarkup,
          "imageAttached": includedImageFilenames.contains($0.filename),
        ] as [String: Any]
      },
    ]
    return String(
      decoding: try JSONSerialization.data(withJSONObject: context, options: [.prettyPrinted]),
      as: UTF8.self)
  }

  static func document(from draft: StoryDraft, eligibleFrames: [CapturedFrame]) -> StoryDocument {
    StoryDocument(
      title: draft.title,
      sourceURL: PolyformClient.normalizedWebURL(draft.sourceURL),
      summary: draft.summary,
      keyPoints: draft.keyPoints,
      steps: draft.steps.map { step in
        let frame = PolyformClient.selectedFrame(
          requestedSeconds: step.screenshotTimeSeconds,
          stepEndSeconds: step.endSeconds,
          frames: eligibleFrames)
        return StoryStep(
          startSeconds: step.startSeconds,
          endSeconds: step.endSeconds,
          title: step.title,
          narrative: step.narrative,
          transcript: step.transcript,
          imageFilename: frame?.filename)
      })
  }

  private static func appendUnique(_ time: Double, to values: inout [Double]) {
    if !values.contains(where: { abs($0 - time) < 0.35 }) { values.append(time) }
  }
}
