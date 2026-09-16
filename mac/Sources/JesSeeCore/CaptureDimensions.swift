import Foundation

public struct CaptureDimensions: Equatable, Sendable {
  public let width: Int
  public let height: Int

  public init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }

  public static func fitted(
    pointWidth: Double,
    pointHeight: Double,
    pointPixelScale: Double,
    maximumWidth: Double = 2560,
    maximumHeight: Double = 1440
  ) -> CaptureDimensions {
    let sourceWidth = max(2, pointWidth * max(1, pointPixelScale))
    let sourceHeight = max(2, pointHeight * max(1, pointPixelScale))
    let scale = min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight)

    return CaptureDimensions(
      width: evenPixelCount(sourceWidth * scale),
      height: evenPixelCount(sourceHeight * scale)
    )
  }

  private static func evenPixelCount(_ value: Double) -> Int {
    max(2, Int(value.rounded(.down)) / 2 * 2)
  }
}
