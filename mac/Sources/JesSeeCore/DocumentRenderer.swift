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
          let annotations = step.imageAnnotations.map { annotation in
            "<span class=\"annotation \(annotation.kind.rawValue)\" style=\"left:\(percent(annotation.x));top:\(percent(annotation.y));width:\(percent(annotation.width));height:\(percent(annotation.height))\"></span>"
          }.joined()
          return
            "<figure class=\"step-image\"><div class=\"image-frame\"><img src=\"\(escapeAttribute($0))\" alt=\"Screenshot for \(escapeAttribute(step.title))\">\(annotations)</div></figure>"
        } ?? ""
      let narrative = step.narrativeHTML ?? "<p>\(escape(step.narrative))</p>"
      return """
        <section class="step">
          <p class="eyebrow">STEP \(index + 1)</p>
          <h2>\(escape(step.title))</h2>
          <div class="narrative">\(narrative)</div>
          \(image)
        </section>
        """
    }.joined(separator: "\n")
    let summary = story.summaryHTML ?? "<p>\(escape(story.summary))</p>"
    let source = story.sourceURL.map {
      "<p class=\"source\"><strong>Source</strong> <a href=\"\(escapeAttribute($0))\">\(escape($0))</a></p>"
    } ?? ""
    return """
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>\(escape(story.title))</title><style>
      :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17171b;background:#fff}body{max-width:900px;margin:0 auto;padding:64px 40px;line-height:1.55}h1{font-size:46px;line-height:1.05;letter-spacing:-.03em;margin:0 0 20px}h2{font-size:28px;line-height:1.15;margin:6px 0 10px}.summary{font-size:21px;color:#5b5b68}.summary p,.summary ul,.summary ol,.summary blockquote{margin:10px 0}.summary blockquote{border-left:4px solid #655cff;background:#f3f2ff;padding:12px 16px}.source{display:flex;gap:10px;align-items:baseline;margin:18px 0 0;font-size:14px;color:#696775}.source a{color:#4c43de;word-break:break-all}.points{padding:22px 28px;background:#f3f2ff;border-radius:18px;margin:32px 0}.points li{margin:8px 0}.step{border-top:1px solid #dedde8;padding:38px 0}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.12em;color:#5a52ff;margin:0}.narrative{font-size:17px}.narrative p,.narrative ul,.narrative ol,.narrative blockquote{margin:10px 0}.narrative blockquote{border-left:4px solid #655cff;background:#f3f2ff;padding:12px 16px;border-radius:0 10px 10px 0}.step-image{margin:20px 0 0}.image-frame{position:relative;overflow:hidden;border-radius:14px;border:1px solid #dedde8}.step img{display:block;width:100%;height:auto}.annotation{position:absolute;box-sizing:border-box}.annotation.highlight{border:4px solid #ffae00;background:rgba(255,192,0,.18);border-radius:8px}.annotation.redaction{background:#111;border-radius:4px}.footer{border-top:1px solid #dedde8;padding-top:20px;color:#777;font-size:13px}
      </style></head><body><header><p class="eyebrow">JESSEE VISUAL STORY</p><h1>\(escape(story.title))</h1><div class="summary">\(summary)</div>\(source)</header><div class="points"><strong>Key points</strong><ul>\(keyPoints)</ul></div>\(steps)<p class="footer">Created with JesSee · Turn a walkthrough into a story AI can use.</p></body></html>
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

  private static func percent(_ value: Double) -> String {
    String(format: "%.3f%%", max(0, min(1, value)) * 100)
  }
}

@MainActor
private final class StoryPDFView: NSView {
  private struct StepLayout {
    var index: Int
    var step: StoryStep
    var y: CGFloat
    var titleHeight: CGFloat
    var narrative: NSAttributedString
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
  private var summaryText = NSAttributedString(string: "")
  private var titleHeight: CGFloat = 0
  private var summaryHeight: CGFloat = 0
  private var sourceHeight: CGFloat = 0
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
    summaryText = richText(
      body: story.summaryHTML ?? "<p>\(Self.escapeHTML(story.summary))</p>",
      fallback: story.summary, fontSize: 18)
    summaryHeight = attributedTextHeight(summaryText, width: contentWidth)
    sourceHeight = story.sourceURL.map {
      textHeight("SOURCE  \($0)", font: .systemFont(ofSize: 12), width: contentWidth)
    } ?? 0
    pointsHeight = story.keyPoints.reduce(CGFloat(44)) { partial, point in
      partial
        + textHeight(
          "•  \(point.text)", font: .systemFont(ofSize: 13), width: contentWidth - 40)
        + 7
    }
    var y = pointsY + pointsHeight + 38
    layouts = story.steps.enumerated().map { index, step in
      let titleHeight = textHeight(
        step.title, font: .systemFont(ofSize: 22, weight: .semibold), width: contentWidth)
      let narrative = richText(for: step)
      let narrativeHeight = attributedTextHeight(narrative, width: contentWidth)
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
        index: index, step: step, y: y, titleHeight: titleHeight, narrative: narrative,
        narrativeHeight: narrativeHeight, image: image, imageWidth: imageWidth,
        imageHeight: imageHeight, totalHeight: total)
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
    summaryText.draw(
      with: NSRect(x: x, y: summaryY, width: contentWidth, height: summaryHeight),
      options: [.usesLineFragmentOrigin, .usesFontLeading])
    if let sourceURL = story.sourceURL {
      drawText(
        "SOURCE  \(sourceURL)",
        in: NSRect(x: x, y: sourceY, width: contentWidth, height: sourceHeight),
        font: .systemFont(ofSize: 12, weight: .medium), color: purple)
    }

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
      layout.narrative.draw(
        with: NSRect(x: x, y: narrativeY, width: contentWidth, height: layout.narrativeHeight),
        options: [.usesLineFragmentOrigin, .usesFontLeading])
      if let image = layout.image {
        let imageRect = NSRect(
          x: x + (contentWidth - layout.imageWidth) / 2,
          y: narrativeY + layout.narrativeHeight + 22, width: layout.imageWidth,
          height: layout.imageHeight)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(
          in: imageRect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true,
          hints: nil)
        drawAnnotations(layout.step.imageAnnotations, in: imageRect)
        lineColor.setStroke()
        NSBezierPath(roundedRect: imageRect, xRadius: 8, yRadius: 8).stroke()
      }
    }
  }

  private var ink: NSColor { NSColor(calibratedWhite: 0.09, alpha: 1) }
  private var lineColor: NSColor { NSColor(calibratedWhite: 0.86, alpha: 1) }
  private var summaryY: CGFloat { margin + 30 + titleHeight + 16 }
  private var sourceY: CGFloat { summaryY + summaryHeight + 14 }
  private var pointsY: CGFloat {
    story.sourceURL == nil ? summaryY + summaryHeight + 30 : sourceY + sourceHeight + 30
  }

  private func textHeight(_ text: String, font: NSFont, width: CGFloat) -> CGFloat {
    ceil(
      (text as NSString).boundingRect(
        with: NSSize(width: width, height: .greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: [.font: font]
      ).height)
  }

  private func attributedTextHeight(_ text: NSAttributedString, width: CGFloat) -> CGFloat {
    ceil(
      text.boundingRect(
        with: NSSize(width: width, height: .greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin, .usesFontLeading]
      ).height)
  }

  private func richText(for step: StoryStep) -> NSAttributedString {
    let body = step.narrativeHTML ?? "<p>\(Self.escapeHTML(step.narrative))</p>"
    return richText(body: body, fallback: step.narrative, fontSize: 14)
  }

  private func richText(body: String, fallback: String, fontSize: CGFloat) -> NSAttributedString {
    let html = """
      <style>
      body{font-family:-apple-system;font-size:\(fontSize)px;color:#17171b;line-height:1.48;margin:0}
      p,ul,ol,blockquote{margin:0 0 9px}ul,ol{padding-left:22px}
      blockquote{margin-left:0;border-left:4px solid #655cff;background:#f3f2ff;padding:10px 13px}
      </style><body>\(body)</body>
      """
    guard let data = html.data(using: .utf8),
      let attributed = try? NSMutableAttributedString(
        data: data,
        options: [
          .documentType: NSAttributedString.DocumentType.html,
          .characterEncoding: String.Encoding.utf8.rawValue,
        ], documentAttributes: nil)
    else {
      return NSAttributedString(
        string: fallback,
        attributes: [.font: NSFont.systemFont(ofSize: fontSize), .foregroundColor: ink])
    }
    return attributed
  }

  private func drawAnnotations(_ annotations: [StoryAnnotation], in imageRect: NSRect) {
    for annotation in annotations {
      let rect = NSRect(
        x: imageRect.minX + CGFloat(max(0, min(1, annotation.x))) * imageRect.width,
        y: imageRect.minY + CGFloat(max(0, min(1, annotation.y))) * imageRect.height,
        width: CGFloat(max(0, min(1, annotation.width))) * imageRect.width,
        height: CGFloat(max(0, min(1, annotation.height))) * imageRect.height)
      let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
      switch annotation.kind {
      case .highlight:
        NSColor.systemOrange.withAlphaComponent(0.18).setFill()
        path.fill()
        NSColor.systemOrange.setStroke()
        path.lineWidth = 3
        path.stroke()
      case .redaction:
        NSColor(calibratedWhite: 0.06, alpha: 0.98).setFill()
        path.fill()
      }
    }
  }

  private static func escapeHTML(_ value: String) -> String {
    value.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\n", with: "<br>")
  }

  private func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor) {
    (text as NSString).draw(
      with: rect,
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: [.font: font, .foregroundColor: color]
    )
  }
}
