import Foundation

public struct StoryEfficiencyMetrics: Codable, Sendable, Equatable {
  public static let visualVideoTokensPerSecond = 300.0
  public static let imageTokens = 1_100
  public static let inputCostPerMillionTokens = 2.0

  public var videoMinutes: Double
  public var documentTokens: Int
  public var videoTokens: Int
  public var tokensSaved: Int
  public var percentSaved: Int
  public var estimatedCostSaved: Double

  public static func estimate(
    story: StoryDocument,
    duration: Double?
  ) -> StoryEfficiencyMetrics {
    let videoSeconds = max(0, duration ?? 0)
    let storyText = ([
      story.title,
      story.sourceURL ?? "",
      story.documentType ?? "",
      story.summary,
    ] + story.keyPoints.map(\.text) + story.steps.flatMap { [$0.title, $0.narrative] })
      .joined(separator: "\n")
    let textTokens = Int(ceil(Double(storyText.count) / 4.0))
    let selectedImages = Set(story.steps.compactMap(\.imageFilename)).count
    let documentTokens = max(1, textTokens + (selectedImages * imageTokens))
    let videoTokens = max(1, Int(ceil(videoSeconds * visualVideoTokensPerSecond)))
    let tokensSaved = max(0, videoTokens - documentTokens)
    let percentSaved = videoTokens > 0
      ? Int((Double(tokensSaved) / Double(videoTokens) * 100).rounded())
      : 0

    return StoryEfficiencyMetrics(
      videoMinutes: videoSeconds / 60,
      documentTokens: documentTokens,
      videoTokens: videoTokens,
      tokensSaved: tokensSaved,
      percentSaved: percentSaved,
      estimatedCostSaved: Double(tokensSaved) / 1_000_000 * inputCostPerMillionTokens)
  }
}
