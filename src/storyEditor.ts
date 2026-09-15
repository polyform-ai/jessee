import { Editor, Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { CaptureAnalysis, CaptureStoryStep, ScreenshotEvidence } from "./types";

export type StoryEditorAction = "paragraph" | "bold" | "italic" | "bulletList" | "orderedList" | "callout" | "undo" | "redo";

interface StoryEditorOptions {
  element: HTMLElement;
  analysis: CaptureAnalysis;
  storySteps: CaptureStoryStep[];
  screenshots: ScreenshotEvidence[];
  editable: boolean;
  onChange: () => void;
  onSelectionChange: () => void;
  onImageClick: (stepIndex: number) => void;
}

const StoryDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "storyOverview storyStep+"
});

const StoryOverview = Node.create({
  name: "storyOverview",
  group: "block",
  content: "storyTitle storySummary bulletList?",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "section[data-story-overview]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-story-overview": "" }), 0]
});

const StoryTitle = Node.create({
  name: "storyTitle",
  content: "inline*",
  marks: "bold italic",
  defining: true,
  parseHTML: () => [{ tag: "h1[data-story-title]" }],
  renderHTML: ({ HTMLAttributes }) => ["h1", mergeAttributes(HTMLAttributes, { "data-story-title": "" }), 0]
});

const StorySummary = Node.create({
  name: "storySummary",
  content: "inline*",
  marks: "bold italic",
  defining: true,
  parseHTML: () => [{ tag: "p[data-story-summary]" }],
  renderHTML: ({ HTMLAttributes }) => ["p", mergeAttributes(HTMLAttributes, { "data-story-summary": "" }), 0]
});

const StoryStep = Node.create({
  name: "storyStep",
  group: "block",
  content: "heading (paragraph | bulletList | orderedList | blockquote)+ storySource storyImage",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      startSeconds: { default: 0, rendered: false },
      endSeconds: { default: 0, rendered: false },
      transcript: { default: "", rendered: false },
      screenshotId: { default: "", rendered: false },
      pageUrl: { default: "", rendered: false },
      pageTitle: { default: "", rendered: false },
      kind: { default: "narration", rendered: false },
      stepIndex: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute("data-step-index") || 0),
        renderHTML: (attributes) => ({ "data-step-index": attributes.stepIndex })
      },
      stepLabel: {
        default: "Step 1",
        renderHTML: (attributes) => ({ "data-step-label": attributes.stepLabel })
      },
      stepMeta: {
        default: "",
        renderHTML: (attributes) => ({ "data-step-meta": attributes.stepMeta })
      }
    };
  },
  parseHTML: () => [{ tag: "section[data-story-step]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-story-step": "" }), 0]
});

function createStorySource(editable: boolean): Node {
  return Node.create({
    name: "storySource",
    group: "block",
    atom: true,
    selectable: false,
    addAttributes() {
      return {
        stepIndex: { default: 0, rendered: false },
        pageUrl: { default: "", rendered: false },
        pageTitle: { default: "", rendered: false },
        visible: { default: true, rendered: false }
      };
    },
    parseHTML: () => [{ tag: "aside[data-story-source]" }],
    renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, { "data-story-source": "" })],
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let currentNode = node;
        const container = document.createElement("aside");
        container.dataset.storySource = "";
        container.contentEditable = "false";

        const render = () => {
          const { pageUrl, pageTitle, visible, stepIndex } = currentNode.attrs;
          container.replaceChildren();
          container.className = `story-step-source${visible ? "" : " is-hidden"}${pageUrl ? "" : " is-missing"}`;
          container.hidden = !editable && !visible;

          const content = document.createElement("div");
          const label = document.createElement("span");
          label.textContent = "Source page";
          const link = document.createElement("a");
          link.textContent = pageTitle || pageUrl || "No page URL captured";
          if (typeof pageUrl === "string" && /^https?:\/\//.test(pageUrl)) {
            link.href = pageUrl;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.title = pageUrl;
          }
          const url = document.createElement("small");
          url.textContent = pageUrl || "Choose a captured image to restore its page URL.";
          content.append(label, link, url);
          container.append(content);

          if (editable) {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "story-source-toggle";
            toggle.setAttribute("role", "switch");
            toggle.setAttribute("aria-checked", String(Boolean(visible)));
            toggle.setAttribute("aria-label", `${visible ? "Hide" : "Show"} source URL for step ${Number(stepIndex) + 1}`);
            const toggleTrack = document.createElement("span");
            const toggleLabel = document.createElement("strong");
            toggleLabel.textContent = visible ? "Shown in PDF" : "Hidden from PDF";
            toggle.append(toggleTrack, toggleLabel);
            toggle.addEventListener("click", () => {
              if (typeof getPos !== "function") return;
              const position = getPos();
              if (typeof position !== "number") return;
              editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...currentNode.attrs, visible: !visible }));
            });
            container.append(toggle);
          }
        };

        render();
        return {
          dom: container,
          update: (updatedNode) => {
            if (updatedNode.type.name !== "storySource") return false;
            currentNode = updatedNode;
            render();
            return true;
          },
          stopEvent: (event) => event.target instanceof HTMLElement && Boolean(event.target.closest("button, a"))
        };
      };
    }
  });
}

function createStoryImage(onImageClick: (stepIndex: number) => void): Node {
  return Node.create({
    name: "storyImage",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        stepIndex: { default: 0, rendered: false },
        screenshotId: { default: "", rendered: false },
        src: { default: "", rendered: false },
        alt: { default: "", rendered: false },
        caption: { default: "", rendered: false },
        timestamp: { default: "", rendered: false }
      };
    },
    parseHTML: () => [{ tag: "figure[data-story-image]" }],
    renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { "data-story-image": "" })],
    addNodeView() {
      return ({ node }) => {
        let currentNode = node;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "editor-story-image";
        button.contentEditable = "false";

        const render = () => {
          const { src, alt, caption, timestamp, stepIndex } = currentNode.attrs;
          button.replaceChildren();
          button.dataset.stepIndex = String(stepIndex);
          button.setAttribute("aria-label", src ? `Change image for step ${Number(stepIndex) + 1}` : `Choose image for step ${Number(stepIndex) + 1}`);

          const frame = document.createElement("span");
          frame.className = `editor-story-image-frame${src ? "" : " empty"}`;
          if (src) {
            const image = document.createElement("img");
            image.src = src;
            image.alt = alt;
            frame.append(image);
          } else {
            const empty = document.createElement("span");
            empty.className = "editor-story-image-empty";
            empty.textContent = "Add the visual that makes this step clear";
            frame.append(empty);
          }

          const action = document.createElement("span");
          action.className = "editor-story-image-action";
          action.textContent = src ? "Click to step through images" : "Choose an image";
          frame.append(action);

          const details = document.createElement("span");
          details.className = "editor-story-image-details";
          const captionElement = document.createElement("strong");
          captionElement.textContent = caption || "Text-only step";
          const timestampElement = document.createElement("small");
          timestampElement.textContent = timestamp;
          details.append(captionElement, timestampElement);
          button.append(frame, details);
        };

        const open = () => onImageClick(Number(currentNode.attrs.stepIndex));
        button.addEventListener("click", open);
        render();
        return {
          dom: button,
          update: (updatedNode) => {
            if (updatedNode.type.name !== "storyImage") return false;
            currentNode = updatedNode;
            render();
            return true;
          },
          stopEvent: () => true,
          destroy: () => button.removeEventListener("click", open)
        };
      };
    }
  });
}

export class StoryEditor {
  private readonly editor: Editor;

  constructor(options: StoryEditorOptions) {
    this.editor = new Editor({
      element: options.element,
      extensions: [
        StarterKit.configure({ document: false, heading: { levels: [2] } }),
        StoryDocument,
        StoryOverview,
        StoryTitle,
        StorySummary,
        StoryStep,
        createStorySource(options.editable),
        createStoryImage(options.onImageClick)
      ],
      content: buildEditorDocument(options.analysis, options.storySteps, options.screenshots, options.editable),
      editable: options.editable,
      editorProps: {
        attributes: {
          class: `story-editor-content${options.editable ? " is-editable" : " is-readable"}`,
          "aria-label": options.editable ? "Edit visual story" : "Visual story preview"
        }
      },
      onUpdate: options.onChange,
      onSelectionUpdate: options.onSelectionChange,
      onTransaction: options.onSelectionChange,
      onBlur: options.onSelectionChange
    });
  }

  destroy(): void {
    this.editor.destroy();
  }

  focus(): void {
    this.editor.commands.focus();
  }

  run(action: StoryEditorAction): void {
    const chain = this.editor.chain().focus();
    if (action === "paragraph") chain.setParagraph().run();
    else if (action === "bold") chain.toggleBold().run();
    else if (action === "italic") chain.toggleItalic().run();
    else if (action === "bulletList") chain.toggleBulletList().run();
    else if (action === "orderedList") chain.toggleOrderedList().run();
    else if (action === "callout") chain.toggleBlockquote().run();
    else if (action === "undo") chain.undo().run();
    else chain.redo().run();
  }

  isActive(action: StoryEditorAction): boolean {
    if (action === "paragraph") return this.editor.isActive("paragraph");
    if (action === "bold") return this.editor.isActive("bold");
    if (action === "italic") return this.editor.isActive("italic");
    if (action === "bulletList") return this.editor.isActive("bulletList");
    if (action === "orderedList") return this.editor.isActive("orderedList");
    if (action === "callout") return this.editor.isActive("blockquote");
    return false;
  }

  canRun(action: StoryEditorAction): boolean {
    const chain = this.editor.can().chain().focus();
    if (action === "undo") return chain.undo().run();
    if (action === "redo") return chain.redo().run();
    if (action === "bold") return chain.toggleBold().run();
    if (action === "italic") return chain.toggleItalic().run();
    if (action === "bulletList") return chain.toggleBulletList().run();
    if (action === "orderedList") return chain.toggleOrderedList().run();
    if (action === "callout") return chain.toggleBlockquote().run();
    return chain.setParagraph().run();
  }

  selectionCoordinates(): { left: number; top: number } | undefined {
    const selection = this.editor.state.selection;
    if (!this.editor.isFocused || selection.empty || !selection.$from.parent.isTextblock) return undefined;
    const start = this.editor.view.coordsAtPos(selection.from);
    const end = this.editor.view.coordsAtPos(selection.to);
    return {
      left: (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2,
      top: Math.min(start.top, end.top)
    };
  }

  value(current: CaptureAnalysis): CaptureAnalysis {
    return parseEditorDocument(this.editor.getJSON(), current);
  }

  appendStep(step: CaptureStoryStep, screenshots: ScreenshotEvidence[]): void {
    const index = countStorySteps(this.editor.getJSON());
    this.editor.chain().focus("end").insertContent(storyStepContent(step, index, screenshots)).run();
  }

  updateImage(stepIndex: number, screenshot?: ScreenshotEvidence): void {
    const { state, view } = this.editor;
    const transaction = state.tr;
    state.doc.descendants((node, position) => {
      if (Number(node.attrs.stepIndex) !== stepIndex) return;
      if (node.type.name === "storyImage") {
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          screenshotId: screenshot?.id ?? "",
          src: screenshot?.dataUrl ?? "",
          alt: screenshot ? `Selected visual for step ${stepIndex + 1}: ${screenshot.title || screenshot.url || "Captured screen"}` : "",
          caption: screenshot?.title || screenshot?.url || "Text-only step",
          timestamp: screenshot ? formatMs(screenshot.capturedAtMs) : "No image selected"
        });
      }
      if (node.type.name === "storySource" && screenshot) {
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          pageUrl: screenshot.url,
          pageTitle: screenshot.title
        });
      }
    });
    view.dispatch(transaction);
  }

  scrollToStep(stepIndex: number): void {
    this.editor.view.dom.querySelector<HTMLElement>(`[data-story-step][data-step-index="${stepIndex}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function buildEditorDocument(
  analysis: CaptureAnalysis,
  storySteps: CaptureStoryStep[],
  screenshots: ScreenshotEvidence[],
  keepEmptyKeyPointList = false
): JSONContent {
  if (analysis.editorDocument?.type === "doc") {
    const saved = structuredClone(analysis.editorDocument) as JSONContent;
    const savedSteps = saved.content?.filter((node) => node.type === "storyStep") ?? [];
    if (savedSteps.length === storySteps.length) {
      savedSteps.forEach((node, index) => hydrateStoryStep(node, storySteps[index], index, screenshots));
      if (keepEmptyKeyPointList) ensureKeyPointList(saved);
      return saved;
    }
  }
  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];
  const document: JSONContent = {
    type: "doc",
    content: [
      {
        type: "storyOverview",
        content: [
          textBlock("storyTitle", analysis.userGoal),
          textBlock("storySummary", analysis.story),
          ...(keyPoints.length ? [{
            type: "bulletList",
            content: keyPoints.map((point) => ({ type: "listItem", content: [textBlock("paragraph", point)] }))
          }] : [])
        ]
      },
      ...storySteps.map((step, index) => storyStepContent(step, index, screenshots))
    ]
  };
  if (keepEmptyKeyPointList) ensureKeyPointList(document);
  return document;
}

function ensureKeyPointList(document: JSONContent): void {
  const overview = document.content?.find((node) => node.type === "storyOverview");
  if (!overview || overview.content?.some((node) => node.type === "bulletList")) return;
  overview.content ??= [];
  overview.content.push({
    type: "bulletList",
    content: [{ type: "listItem", content: [{ type: "paragraph" }] }]
  });
}

export function parseEditorDocument(document: JSONContent, current: CaptureAnalysis): CaptureAnalysis {
  const overview = document.content?.find((node) => node.type === "storyOverview");
  const titleNode = overview?.content?.find((node) => node.type === "storyTitle");
  const summaryNode = overview?.content?.find((node) => node.type === "storySummary");
  const title = titleNode ? jsonText(titleNode) : current.userGoal;
  const summary = summaryNode ? jsonText(summaryNode) : current.story;
  const keyPointList = overview?.content?.find((node) => node.type === "bulletList");
  const keyPoints = keyPointList ? storyListEntries(keyPointList) : [];
  const storySteps = (document.content ?? []).filter((node) => node.type === "storyStep").map((node) => {
    const heading = node.content?.find((child) => child.type === "heading");
    const bodyBlocks = node.content?.filter((child) => ["paragraph", "bulletList", "orderedList", "blockquote"].includes(child.type ?? "")) ?? [];
    const source = node.content?.find((child) => child.type === "storySource");
    const image = node.content?.find((child) => child.type === "storyImage");
    return {
      startSeconds: Number(node.attrs?.startSeconds ?? 0),
      endSeconds: Number(node.attrs?.endSeconds ?? 0),
      title: heading ? trimHorizontalWhitespace(jsonText(heading)) : "Untitled step",
      narrative: bodyBlocks.map(storyBodyText).filter(Boolean).join("\n\n"),
      transcript: String(node.attrs?.transcript ?? ""),
      screenshotId: String(image?.attrs?.screenshotId || node.attrs?.screenshotId || "") || undefined,
      pageUrl: String(source?.attrs?.pageUrl ?? node.attrs?.pageUrl ?? "") || undefined,
      pageTitle: String(source?.attrs?.pageTitle ?? node.attrs?.pageTitle ?? "") || undefined,
      showPageUrl: source ? source.attrs?.visible !== false : node.attrs?.showPageUrl !== false,
      kind: storyKind(node.attrs?.kind)
    } satisfies CaptureStoryStep;
  });

  return {
    ...current,
    userGoal: trimHorizontalWhitespace(title),
    story: trimHorizontalWhitespace(summary),
    keyPoints,
    storySteps,
    editorDocument: sanitizeEditorDocument(document),
    helpfulImageMoments: storySteps.filter((step) => step.screenshotId).map((step) => ({
      screenshotId: step.screenshotId,
      atSeconds: step.endSeconds,
      reason: step.narrative || step.title
    }))
  };
}

function storyBodyText(node: JSONContent): string {
  if (node.type === "bulletList") return storyListText(node, false);
  if (node.type === "orderedList") return storyListText(node, true);
  if (node.type === "blockquote") {
    return (node.content ?? [])
      .map(storyBodyText)
      .filter(Boolean)
      .flatMap((block) => block.split("\n").map((line) => `> ${line}`))
      .join("\n");
  }
  return trimHorizontalWhitespace(jsonText(node));
}

function storyListText(node: JSONContent, ordered: boolean, depth = 0): string {
  const start = ordered ? orderedListStart(node) : 1;
  return (node.content ?? [])
    .filter((item) => item.type === "listItem")
    .flatMap((item, index) => {
      const directText = storyListItemText(item);
      const marker = ordered ? `${start + index}.` : "-";
      const lines = directText ? [`${"  ".repeat(depth)}${marker} ${directText}`] : [];
      const nestedDepth = directText ? depth + 1 : depth;
      for (const nestedList of (item.content ?? []).filter((child) => child.type === "bulletList" || child.type === "orderedList")) {
        const nestedText = storyListText(nestedList, nestedList.type === "orderedList", nestedDepth);
        if (nestedText) lines.push(nestedText);
      }
      return lines;
    })
    .filter(Boolean)
    .join("\n");
}

function orderedListStart(node: JSONContent): number {
  const start = Number(node.attrs?.start ?? 1);
  return Number.isSafeInteger(start) ? start : 1;
}

function storyListEntries(node: JSONContent): string[] {
  return (node.content ?? [])
    .filter((item) => item.type === "listItem")
    .flatMap((item) => [
      storyListItemText(item),
      ...(item.content ?? []).filter((child) => child.type === "bulletList").flatMap(storyListEntries)
    ])
    .filter(Boolean);
}

function storyListItemText(item: JSONContent): string {
  return (item.content ?? [])
    .filter((child) => child.type === "paragraph")
    .map((paragraph) => trimHorizontalWhitespace(jsonText(paragraph)))
    .filter(Boolean)
    .join(" ");
}

function hydrateStoryStep(node: JSONContent, step: CaptureStoryStep, index: number, screenshots: ScreenshotEvidence[]): void {
  node.attrs = {
    ...node.attrs,
    startSeconds: step.startSeconds,
    endSeconds: step.endSeconds,
    transcript: step.transcript,
    screenshotId: step.screenshotId ?? "",
    pageUrl: step.pageUrl ?? "",
    pageTitle: step.pageTitle ?? "",
    showPageUrl: step.showPageUrl !== false,
    kind: step.kind ?? "narration",
    stepIndex: index,
    stepLabel: `Step ${index + 1}`,
    stepMeta: `${storyKindLabel(step)} · ${formatTimeRange(step.startSeconds, step.endSeconds)}`
  };
  let source = node.content?.find((child) => child.type === "storySource");
  if (!source) {
    source = { type: "storySource" };
    const imageIndex = node.content?.findIndex((child) => child.type === "storyImage") ?? -1;
    if (!node.content) node.content = [];
    if (imageIndex >= 0) node.content.splice(imageIndex, 0, source);
    else node.content.push(source);
  }
  source.attrs = {
    stepIndex: index,
    pageUrl: step.pageUrl ?? "",
    pageTitle: step.pageTitle ?? "",
    visible: step.showPageUrl !== false
  };
  const image = node.content?.find((child) => child.type === "storyImage");
  if (!image) return;
  const screenshot = screenshots.find((shot) => shot.id === step.screenshotId);
  image.attrs = {
    stepIndex: index,
    screenshotId: screenshot?.id ?? "",
    src: screenshot?.dataUrl ?? "",
    alt: screenshot ? `Selected visual for step ${index + 1}: ${screenshot.title || screenshot.url || "Captured screen"}` : "",
    caption: screenshot?.title || screenshot?.url || "Text-only step",
    timestamp: screenshot ? formatMs(screenshot.capturedAtMs) : "No image selected"
  };
}

function sanitizeEditorDocument(document: JSONContent): JSONContent {
  const copy = structuredClone(document);
  const visit = (node: JSONContent) => {
    if (node.type === "storyImage") {
      node.attrs = {
        stepIndex: node.attrs?.stepIndex ?? 0,
        screenshotId: node.attrs?.screenshotId ?? ""
      };
    }
    node.content?.forEach(visit);
  };
  visit(copy);
  return copy;
}

function storyStepContent(step: CaptureStoryStep, index: number, screenshots: ScreenshotEvidence[]): JSONContent {
  const screenshot = screenshots.find((shot) => shot.id === step.screenshotId);
  return {
    type: "storyStep",
    attrs: {
      startSeconds: step.startSeconds,
      endSeconds: step.endSeconds,
      transcript: step.transcript,
      screenshotId: step.screenshotId ?? "",
      pageUrl: step.pageUrl ?? "",
      pageTitle: step.pageTitle ?? "",
      showPageUrl: step.showPageUrl !== false,
      kind: step.kind ?? "narration",
      stepIndex: index,
      stepLabel: `Step ${index + 1}`,
      stepMeta: `${storyKindLabel(step)} · ${formatTimeRange(step.startSeconds, step.endSeconds)}`
    },
    content: [
      { type: "heading", attrs: { level: 2 }, content: textContent(step.title) },
      ...narrativeParagraphs(step.narrative),
      {
        type: "storySource",
        attrs: {
          stepIndex: index,
          pageUrl: step.pageUrl ?? "",
          pageTitle: step.pageTitle ?? "",
          visible: step.showPageUrl !== false
        }
      },
      {
        type: "storyImage",
        attrs: {
          stepIndex: index,
          screenshotId: screenshot?.id ?? "",
          src: screenshot?.dataUrl ?? "",
          alt: screenshot ? `Selected visual for step ${index + 1}: ${screenshot.title || screenshot.url || "Captured screen"}` : "",
          caption: screenshot?.title || screenshot?.url || "Text-only step",
          timestamp: screenshot ? formatMs(screenshot.capturedAtMs) : "No image selected"
        }
      }
    ]
  };
}

function narrativeParagraphs(narrative: string): JSONContent[] {
  const paragraphs = narrative.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (paragraphs.length ? paragraphs : [""]).map((paragraph) => textBlock("paragraph", paragraph));
}

function textBlock(type: string, value: string): JSONContent {
  return { type, content: textContent(value) };
}

function textContent(value: string): JSONContent[] | undefined {
  return value ? [{ type: "text", text: value }] : undefined;
}

function countStorySteps(document: JSONContent): number {
  return document.content?.filter((node) => node.type === "storyStep").length ?? 0;
}

function jsonText(node?: JSONContent): string {
  if (!node) return "";
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  return node.content?.map(jsonText).join("") ?? "";
}

function trimHorizontalWhitespace(value: string): string {
  return value.replace(/^[\t ]+|[\t ]+$/g, "");
}

function storyKind(value: unknown): CaptureStoryStep["kind"] {
  return value === "page-change" || value === "action" || value === "manual" ? value : "narration";
}

function storyKindLabel(step: CaptureStoryStep): string {
  if (step.kind === "page-change") return "Page change";
  if (step.kind === "manual") return "Added step";
  if (step.kind === "action") return "Action";
  return "Narrated step";
}

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatTimeRange(startSeconds: number, endSeconds: number): string {
  const start = formatMs(startSeconds * 1000);
  const end = formatMs(endSeconds * 1000);
  return start === end ? start : `${start}-${end}`;
}
