import AppKit
import Foundation

@MainActor
public enum DocumentRenderer {
  public static func render(story: StoryDocument, in directory: URL) throws -> (
    html: String, pdf: String
  ) {
    let htmlFilename = "JesSee Story.html"
    let pdfFilename = "JesSee Story.pdf"
    try html(story).write(
      to: directory.appendingPathComponent(htmlFilename),
      atomically: true,
      encoding: .utf8
    )

    let view = StoryPDFView(story: story, directory: directory)
    let pdf = view.dataWithPDF(inside: view.bounds)
    try pdf.write(to: directory.appendingPathComponent(pdfFilename), options: .atomic)
    return (htmlFilename, pdfFilename)
  }

  private static func html(_ story: StoryDocument) -> String {
    let keyPoints = story.keyPoints.map { "<li>\(escape($0.text))</li>" }.joined()
    let steps = story.steps.enumerated().map { index, step in
      let image =
        step.imageFilename.map {
          "<img src=\"\(escapeAttribute($0))\" alt=\"Screenshot for \(escapeAttribute(step.title))\">"
        } ?? ""
      return """
        <section class="step">
          <p class="eyebrow">STEP \(index + 1)</p>
          <h2>\(escape(step.title))</h2>
          <p>\(escape(step.narrative))</p>
          \(image)
        </section>
        """
    }.joined(separator: "\n")
    return """
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>\(escape(story.title))</title><style>
      :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17171b;background:#fff}body{max-width:900px;margin:0 auto;padding:64px 40px;line-height:1.55}h1{font-size:46px;line-height:1.05;letter-spacing:-.03em;margin:0 0 20px}h2{font-size:28px;line-height:1.15;margin:6px 0 10px}.summary{font-size:21px;color:#5b5b68}.points{padding:22px 28px;background:#f3f2ff;border-radius:18px;margin:32px 0}.points li{margin:8px 0}.step{border-top:1px solid #dedde8;padding:38px 0}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.12em;color:#5a52ff;margin:0}.step>p:not(.eyebrow){font-size:17px}.step img{display:block;width:100%;height:auto;margin-top:20px;border-radius:14px;border:1px solid #dedde8}.footer{border-top:1px solid #dedde8;padding-top:20px;color:#777;font-size:13px}
      </style></head><body><header><p class="eyebrow">JESSEE VISUAL STORY</p><h1>\(escape(story.title))</h1><p class="summary">\(escape(story.summary))</p></header><div class="points"><strong>Key points</strong><ul>\(keyPoints)</ul></div>\(steps)<p class="footer">Created with JesSee · Turn a walkthrough into a story AI can use.</p></body></html>
      """
  }

  private static func escape(_ value: String) -> String {
    value.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\n", with: "<br>")
  }

  private static func escapeAttribute(_ value: String) -> String {
    escape(value).replacingOccurrences(of: "\"", with: "&quot;")
  }
}

@MainActor
private final class StoryPDFView: NSView {
  private struct StepLayout {
    var index: Int
    var step: StoryStep
    var y: CGFloat
    var titleHeight: CGFloat
    var narrativeHeight: CGFloat
    var image: NSImage?
    var imageWidth: CGFloat
    var imageHeight: CGFloat
    var totalHeight: CGFloat
  }

  private let story: StoryDocument
  private let directory: URL
  private let pageWidth: CGFloat = 792
  private let margin: CGFloat = 64
  private var layouts: [StepLayout] = []
  private var titleHeight: CGFloat = 0
  private var summaryHeight: CGFloat = 0
  private var pointsHeight: CGFloat = 0

  override var isFlipped: Bool { true }

  init(story: StoryDocument, directory: URL) {
    self.story = story
    self.directory = directory
    super.init(frame: .zero)
    buildLayout()
  }

  required init?(coder: NSCoder) { nil }

  private var contentWidth: CGFloat { pageWidth - margin * 2 }

  private func buildLayout() {
    titleHeight = textHeight(
      story.title, font: .systemFont(ofSize: 36, weight: .bold), width: contentWidth)
    summaryHeight = textHeight(story.summary, font: .systemFont(ofSize: 18), width: contentWidth)
    pointsHeight = story.keyPoints.reduce(CGFloat(44)) { partial, point in
      partial + textHeight(
        "•  \(point.text)", font: .systemFont(ofSize: 13), width: contentWidth - 40)
        + 7
    }
    var y = pointsY + pointsHeight + 38
    layouts = story.steps.enumerated().map { index, step in
      let titleHeight = textHeight(
        step.title, font: .systemFont(ofSize: 22, weight: .semibold), width: contentWidth)
      let narrativeHeight = textHeight(
        step.narrative, font: .systemFont(ofSize: 14), width: contentWidth)
      let image = step.imageFilename.flatMap {
        NSImage(contentsOf: directory.appendingPathComponent($0))
      }
      let imageWidth: CGFloat
      let imageHeight: CGFloat
      if let image, image.size.width > 0, image.size.height > 0 {
        let scale = min(contentWidth / image.size.width, 430 / image.size.height)
        imageWidth = image.size.width * scale
        imageHeight = image.size.height * scale
      } else {
        imageWidth = 0
        imageHeight = 0
      }
      let total =
        1 + 28 + titleHeight + 12 + narrativeHeight + (image == nil ? 0 : 22 + imageHeight) + 42
      defer { y += total }
      return StepLayout(
        index: index, step: step, y: y, titleHeight: titleHeight, narrativeHeight: narrativeHeight,
        image: image, imageWidth: imageWidth, imageHeight: imageHeight, totalHeight: total)
    }
    frame = NSRect(
      x: 0, y: 0, width: pageWidth,
      height: max(1_024, (layouts.last.map { $0.y + $0.totalHeight } ?? y) + 70))
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.white.setFill()
    bounds.fill()
    let x = margin
    let purple = NSColor(red: 0.35, green: 0.32, blue: 1, alpha: 1)

    drawText(
      "JESSEE VISUAL STORY", in: NSRect(x: x, y: margin, width: contentWidth, height: 22),
      font: .systemFont(ofSize: 10, weight: .bold), color: purple)
    drawText(
      story.title, in: NSRect(x: x, y: margin + 30, width: contentWidth, height: titleHeight),
      font: .systemFont(ofSize: 36, weight: .bold), color: ink)
    drawText(
      story.summary, in: NSRect(x: x, y: summaryY, width: contentWidth, height: summaryHeight),
      font: .systemFont(ofSize: 18), color: secondaryInk)

    NSColor(red: 0.96, green: 0.95, blue: 1, alpha: 1).setFill()
    NSBezierPath(
      roundedRect: NSRect(x: x, y: pointsY, width: contentWidth, height: pointsHeight), xRadius: 12,
      yRadius: 12
    ).fill()
    drawText(
      "KEY POINTS", in: NSRect(x: x + 20, y: pointsY + 15, width: contentWidth - 40, height: 18),
      font: .systemFont(ofSize: 10, weight: .bold), color: purple)
    var pointY = pointsY + 40
    for point in story.keyPoints {
      let height = textHeight(
        "•  \(point.text)", font: .systemFont(ofSize: 13), width: contentWidth - 40)
      drawText(
        "•  \(point.text)",
        in: NSRect(x: x + 20, y: pointY, width: contentWidth - 40, height: height),
        font: .systemFont(ofSize: 13), color: ink)
      pointY += height + 7
    }

    for layout in layouts {
      lineColor.setFill()
      NSRect(x: x, y: layout.y, width: contentWidth, height: 1).fill()
      drawText(
        "STEP \(layout.index + 1)",
        in: NSRect(x: x, y: layout.y + 20, width: contentWidth, height: 18),
        font: .systemFont(ofSize: 10, weight: .bold), color: purple)
      let titleY = layout.y + 47
      drawText(
        layout.step.title,
        in: NSRect(x: x, y: titleY, width: contentWidth, height: layout.titleHeight),
        font: .systemFont(ofSize: 22, weight: .semibold), color: ink)
      let narrativeY = titleY + layout.titleHeight + 12
      drawText(
        layout.step.narrative,
        in: NSRect(x: x, y: narrativeY, width: contentWidth, height: layout.narrativeHeight),
        font: .systemFont(ofSize: 14), color: ink)
      if let image = layout.image {
        let imageRect = NSRect(
          x: x + (contentWidth - layout.imageWidth) / 2,
          y: narrativeY + layout.narrativeHeight + 22, width: layout.imageWidth,
          height: layout.imageHeight)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(
          in: imageRect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true,
          hints: nil)
        lineColor.setStroke()
        NSBezierPath(roundedRect: imageRect, xRadius: 8, yRadius: 8).stroke()
      }
    }
  }

  private var ink: NSColor { NSColor(calibratedWhite: 0.09, alpha: 1) }
  private var secondaryInk: NSColor { NSColor(calibratedWhite: 0.36, alpha: 1) }
  private var lineColor: NSColor { NSColor(calibratedWhite: 0.86, alpha: 1) }
  private var summaryY: CGFloat { margin + 30 + titleHeight + 16 }
  private var pointsY: CGFloat { summaryY + summaryHeight + 30 }

  private func textHeight(_ text: String, font: NSFont, width: CGFloat) -> CGFloat {
    ceil(
      (text as NSString).boundingRect(
        with: NSSize(width: width, height: .greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: [.font: font]
      ).height)
  }

  private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor) {
    (text as NSString).draw(
      with: rect,
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: [.font: font, .foregroundColor: color]
    )
  }
}
