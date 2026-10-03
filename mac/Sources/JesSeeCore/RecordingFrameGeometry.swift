import Foundation

/// The captured content's top-left normalized rectangle in the encoded video surface.
/// Keep a timeline because the surface remains fixed while a captured window can resize.
public struct RecordingFrameGeometry: Codable, Sendable, Equatable {
  public var seconds: Double
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(seconds: Double, contentRect: CGRect, scaleFactor: Double, surfaceSize: CGSize) {
    self.seconds = seconds
    // ScreenCaptureKit reports padding origins in surface pixels, but sizes in points.
    x = contentRect.minX / surfaceSize.width
    y = contentRect.minY / surfaceSize.height
    width = contentRect.width * scaleFactor / surfaceSize.width
    height = contentRect.height * scaleFactor / surfaceSize.height
  }

  public static func contentRect(at seconds: Double, in frames: [Self]) -> CGRect {
    let frame = frames.last { $0.seconds <= seconds + 0.001 }
    guard let frame else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
    return CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
  }
}
