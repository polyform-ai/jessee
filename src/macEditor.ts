import { Editor, Node as TiptapNode, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import "./macEditor.css";

type AnnotationKind = "highlight" | "redaction";

interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StoryStep {
  id: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  narrative: string;
  narrativeHTML?: string;
  transcript: string;
  imageFilename?: string;
  imageAnnotations: Annotation[];
}

interface Story {
  title: string;
  summary: string;
  summaryHTML?: string;
  keyPoints: Array<{ id: string; text: string }>;
  steps: StoryStep[];
}

interface Frame {
  filename: string;
  seconds: number;
}

interface EditorPayload {
  story: Story;
  frames: Frame[];
}

interface BridgeMessage {
  type: "save" | "saveAndOpenPDF";
  story: Story;
}

declare global {
  interface Window {
    __JESSEE_EDITOR__: EditorPayload;
    jesseeDidSave?: (success: boolean, message: string) => void;
    webkit?: {
      messageHandlers?: {
        storyEditor?: { postMessage: (message: BridgeMessage) => void };
      };
    };
  }
}

const payload = window.__JESSEE_EDITOR__;
const app = document.querySelector<HTMLElement>("#app")!;
if (!app || !payload) throw new Error("JesSee editor payload is missing.");

const StoryDocument = TiptapNode.create({
  name: "doc",
  topNode: true,
  content: "storyOverview storyStep+"
});

const StoryOverview = TiptapNode.create({
  name: "storyOverview",
  group: "block",
  content: "storyTitle storySummary bulletList?",
  isolating: true,
  parseHTML: () => [{ tag: "section[data-story-overview]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-story-overview": "" }), 0]
});

const StoryTitle = TiptapNode.create({
  name: "storyTitle",
  content: "inline*",
  marks: "bold italic",
  parseHTML: () => [{ tag: "h1[data-story-title]" }],
  renderHTML: ({ HTMLAttributes }) => ["h1", mergeAttributes(HTMLAttributes, { "data-story-title": "" }), 0]
});

const StorySummary = TiptapNode.create({
  name: "storySummary",
  content: "(paragraph | bulletList | orderedList | blockquote)+",
  parseHTML: () => [{ tag: "div[data-story-summary]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-story-summary": "" }), 0]
});

const StoryStepNode = TiptapNode.create({
  name: "storyStep",
  group: "block",
  content: "heading (paragraph | bulletList | orderedList | blockquote)+ storyImage",
  isolating: true,
  addAttributes() {
    return {
      id: { default: "" },
      startSeconds: { default: 0 },
      endSeconds: { default: 0 },
      transcript: { default: "" },
      stepIndex: { default: 0 },
      stepLabel: { default: "Step 1" },
      stepMeta: { default: "" }
    };
  },
  parseHTML: () => [{ tag: "section[data-story-step]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-story-step": "" }), 0]
});

let editor: Editor;
let activeStepIndex: number | undefined;
let candidates: Frame[] = [];
let candidateIndex = 0;
let showAllFrames = false;
let drawingMode: AnnotationKind | undefined;
let draftAnnotations: Annotation[] = [];
let dragStart: { x: number; y: number } | undefined;

const StoryImage = TiptapNode.create({
  name: "storyImage",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      stepIndex: { default: 0 },
      filename: { default: "" },
      annotations: { default: "[]" }
    };
  },
  parseHTML: () => [{ tag: "figure[data-story-image]" }],
  renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { "data-story-image": "" })],
  addNodeView() {
    return ({ node }) => {
      let currentNode = node;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "story-image";
      button.contentEditable = "false";

      const render = () => {
        const filename = String(currentNode.attrs.filename || "");
        const annotations = parseAnnotations(currentNode.attrs.annotations);
        button.replaceChildren();
        button.setAttribute("aria-label", filename ? "Change or mark up this screenshot" : "Choose a screenshot");

        const stage = document.createElement("span");
        stage.className = `story-image-stage${filename ? "" : " empty"}`;
        if (filename) {
          const image = document.createElement("img");
          image.src = filename;
          image.alt = "Selected screenshot";
          stage.append(image);
          for (const annotation of annotations) stage.append(annotationElement(annotation));
        } else {
          const empty = document.createElement("strong");
          empty.textContent = "Choose the visual that makes this step clear";
          stage.append(empty);
        }
        const action = document.createElement("span");
        action.className = "story-image-action";
        action.textContent = filename ? "Change image or add markup" : "Choose an image";
        stage.append(action);
        button.append(stage);
      };

      const open = () => openImagePicker(Number(currentNode.attrs.stepIndex));
      button.addEventListener("click", open);
      render();
      return {
        dom: button,
        update: (nextNode) => {
          if (nextNode.type.name !== "storyImage") return false;
          currentNode = nextNode;
          render();
          return true;
        },
        stopEvent: () => true,
        destroy: () => button.removeEventListener("click", open)
      };
    };
  }
});

renderShell();
editor = new Editor({
  element: mustFind("#storyEditor"),
  extensions: [
    StarterKit.configure({ document: false, heading: { levels: [2] } }),
    StoryDocument,
    StoryOverview,
    StoryTitle,
    StorySummary,
    StoryStepNode,
    StoryImage
  ],
  content: initialDocument(payload.story),
  editorProps: { attributes: { class: "story-content", "aria-label": "Edit visual story" } },
  onUpdate: markDirty,
  onSelectionUpdate: updateToolbar,
  onTransaction: updateToolbar
});
bindShellEvents();
updateToolbar();

window.jesseeDidSave = (success, message) => {
  setStatus(message, !success);
  if (success) document.body.classList.remove("is-dirty");
};

function renderShell(): void {
  app.innerHTML = `
    <div class="editor-app">
      <header class="editor-header">
        <div><p class="kicker">Visual story editor</p><h1>Shape the story before you share it</h1><p>Edit like a document, then choose and mark up the strongest screenshot for each step.</p></div>
        <div class="header-actions"><span id="saveStatus">Saved</span><button class="button secondary" id="saveStory">Save</button><button class="button primary" id="openPDF">Save & open PDF</button></div>
      </header>
      <nav class="editor-toolbar" aria-label="Text formatting">
        ${tool("paragraph", "Text", true)}${tool("bold", "<strong>B</strong>")}${tool("italic", "<em>I</em>")}${tool("bulletList", "• Bullets", true)}${tool("orderedList", "1. List", true)}${tool("blockquote", "Callout", true)}<span class="divider"></span>${tool("undo", "↶")}${tool("redo", "↷")}<span class="toolbar-tip">Click anywhere to write · select text to format</span>
      </nav>
      <section class="paper" id="storyEditor"></section>
      <footer><span>The PDF follows this same order and keeps every divider, image, list, and callout.</span><button class="button secondary" id="addStep">+ Add another step</button></footer>
    </div>
    <dialog id="imagePicker" class="image-picker"><div class="picker-card" id="pickerCard"></div></dialog>`;
}

function bindShellEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => runAction(button.dataset.action || ""));
  });
  mustFind<HTMLButtonElement>("#saveStory").addEventListener("click", () => send("save"));
  mustFind<HTMLButtonElement>("#openPDF").addEventListener("click", () => send("saveAndOpenPDF"));
  mustFind<HTMLButtonElement>("#addStep").addEventListener("click", addStep);
  mustFind<HTMLDialogElement>("#imagePicker").addEventListener("cancel", (event) => {
    event.preventDefault();
    closePicker();
  });
}

function tool(action: string, content: string, wide = false): string {
  const label = toolLabel(action);
  return `<button type="button" class="tool${wide ? " wide" : ""}" data-action="${action}" aria-label="${label}" title="${label}" aria-pressed="false">${content}</button>`;
}

function toolLabel(action: string): string {
  const labels: Record<string, string> = {
    paragraph: "Paragraph",
    bold: "Bold",
    italic: "Italic",
    bulletList: "Bulleted list",
    orderedList: "Numbered list",
    blockquote: "Callout",
    undo: "Undo text edit",
    redo: "Redo text edit"
  };
  return labels[action] || action;
}

function runAction(action: string): void {
  const chain = editor.chain().focus();
  if (action === "paragraph") chain.setParagraph().run();
  else if (action === "bold") chain.toggleBold().run();
  else if (action === "italic") chain.toggleItalic().run();
  else if (action === "bulletList") chain.toggleBulletList().run();
  else if (action === "orderedList") chain.toggleOrderedList().run();
  else if (action === "blockquote") chain.toggleBlockquote().run();
  else if (action === "undo") chain.undo().run();
  else if (action === "redo") chain.redo().run();
}

function updateToolbar(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    const action = button.dataset.action || "";
    if (["undo", "redo"].includes(action)) return;
    const nodeName = action === "blockquote" ? "blockquote" : action;
    button.setAttribute("aria-pressed", String(editor?.isActive(nodeName) ?? false));
  });
}

function markDirty(): void {
  document.body.classList.add("is-dirty");
  setStatus("Unsaved changes");
}

function send(type: BridgeMessage["type"]): void {
  setStatus(type === "save" ? "Saving…" : "Updating PDF…");
  const message: BridgeMessage = { type, story: serializeStory() };
  const bridge = window.webkit?.messageHandlers?.storyEditor;
  if (bridge) bridge.postMessage(message);
  else window.jesseeDidSave?.(true, "Preview saved");
}

function setStatus(message: string, error = false): void {
  const status = mustFind<HTMLElement>("#saveStatus");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function addStep(): void {
  const steps = serializeStory().steps;
  const previous = steps.at(-1);
  const step: StoryStep = {
    id: crypto.randomUUID(),
    startSeconds: previous?.endSeconds ?? 0,
    endSeconds: previous?.endSeconds ?? 0,
    title: "New step",
    narrative: "Add the next part of the explanation.",
    transcript: "",
    imageFilename: previous?.imageFilename,
    imageAnnotations: []
  };
  editor.chain().focus("end").insertContent(stepNode(step, steps.length)).run();
  requestAnimationFrame(() => document.querySelector(`[data-step-index="${steps.length}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function initialDocument(story: Story): JSONContent {
  const steps = story.steps.length ? story.steps : [{
    id: crypto.randomUUID(), startSeconds: 0, endSeconds: 0, title: "First step",
    narrative: "Add the first part of the explanation.", transcript: "", imageAnnotations: []
  }];
  return {
    type: "doc",
    content: [
      {
        type: "storyOverview",
        content: [
          textNode("storyTitle", story.title),
          { type: "storySummary", content: htmlBlocks(story.summaryHTML || narrativeHTML(story.summary)) },
          ...(story.keyPoints.length ? [{
            type: "bulletList",
            content: story.keyPoints.map((point) => ({ type: "listItem", content: [textNode("paragraph", point.text)] }))
          }] : [])
        ]
      },
      ...steps.map(stepNode)
    ]
  };
}

function stepNode(step: StoryStep, index: number): JSONContent {
  return {
    type: "storyStep",
    attrs: {
      id: step.id,
      startSeconds: step.startSeconds,
      endSeconds: step.endSeconds,
      transcript: step.transcript,
      stepIndex: index,
      stepLabel: `Step ${index + 1}`,
      stepMeta: formatRange(step.startSeconds, step.endSeconds)
    },
    content: [
      { type: "heading", attrs: { level: 2 }, content: textContent(step.title) },
      ...htmlBlocks(step.narrativeHTML || narrativeHTML(step.narrative)),
      {
        type: "storyImage",
        attrs: { stepIndex: index, filename: step.imageFilename || "", annotations: JSON.stringify(step.imageAnnotations || []) }
      }
    ]
  };
}

function serializeStory(): Story {
  const json = editor.getJSON();
  const overview = children(json).find((node) => node.type === "storyOverview");
  const title = textOf(children(overview).find((node) => node.type === "storyTitle"));
  const summaryNode = children(overview).find((node) => node.type === "storySummary");
  const summaryHTML = renderBlocks(children(summaryNode));
  const summary = htmlText(summaryHTML);
  const points = children(overview).find((node) => node.type === "bulletList");
  const keyPoints = children(points).map((item, index) => ({
    id: payload.story.keyPoints[index]?.id || crypto.randomUUID(),
    text: textOf(item)
  })).filter((point) => point.text);
  const steps = children(json).filter((node) => node.type === "storyStep").map((node, index) => {
    const body = children(node).filter((child) => ["paragraph", "bulletList", "orderedList", "blockquote"].includes(child.type || ""));
    const narrativeHTML = renderBlocks(body);
    const image = children(node).find((child) => child.type === "storyImage");
    return {
      id: String(node.attrs?.id || crypto.randomUUID()),
      startSeconds: Number(node.attrs?.startSeconds || 0),
      endSeconds: Number(node.attrs?.endSeconds || 0),
      title: textOf(children(node).find((child) => child.type === "heading")) || `Step ${index + 1}`,
      narrative: htmlText(narrativeHTML),
      narrativeHTML,
      transcript: String(node.attrs?.transcript || ""),
      imageFilename: String(image?.attrs?.filename || "") || undefined,
      imageAnnotations: parseAnnotations(image?.attrs?.annotations)
    } satisfies StoryStep;
  });
  return { title: title || "Untitled story", summary, summaryHTML, keyPoints, steps };
}

function openImagePicker(stepIndex: number): void {
  activeStepIndex = stepIndex;
  showAllFrames = false;
  drawingMode = undefined;
  const step = serializeStory().steps[stepIndex];
  candidates = rankedFrames(step);
  candidateIndex = Math.max(0, candidates.findIndex((frame) => frame.filename === step.imageFilename));
  if (candidateIndex < 0) candidateIndex = 0;
  syncDraftAnnotations();
  renderPicker();
  mustFind<HTMLDialogElement>("#imagePicker").showModal();
}

function renderPicker(): void {
  if (activeStepIndex === undefined) return;
  const step = serializeStory().steps[activeStepIndex];
  const frame = candidates[candidateIndex];
  const card = mustFind<HTMLElement>("#pickerCard");
  card.innerHTML = `
    <header><div><p class="kicker">Step ${activeStepIndex + 1} visual</p><h2>Choose it, then make the important part obvious</h2><p>${escapeHTML(step.title)}</p></div><button class="icon" id="closePicker" aria-label="Close image picker" title="Close image picker">×</button></header>
    <div class="picker-toolbar">
      <div class="segmented"><button id="bestFrames" class="${showAllFrames ? "" : "active"}">Best matches</button><button id="allFrames" class="${showAllFrames ? "active" : ""}">All images</button></div>
      <div class="markup-tools"><button id="highlightMode" class="${drawingMode === "highlight" ? "active" : ""}">Highlight</button><button id="redactMode" class="${drawingMode === "redaction" ? "active" : ""}">Redact</button><button id="undoMarkup" ${draftAnnotations.length ? "" : "disabled"}>Undo</button><button id="clearMarkup" ${draftAnnotations.length ? "" : "disabled"}>Clear</button></div>
      <span>${frame ? `${candidateIndex + 1} of ${candidates.length}` : "No images"}</span>
    </div>
    ${frame ? `<div class="picker-stage-row"><button class="arrow" id="previousFrame" aria-label="Previous screenshot" title="Previous screenshot" ${candidateIndex === 0 ? "disabled" : ""}>←</button><figure><div class="markup-stage ${drawingMode ? "drawing" : ""}" id="markupStage"><img src="${escapeAttribute(frame.filename)}" alt="Screenshot ${candidateIndex + 1}" />${draftAnnotations.map((annotation) => annotationElement(annotation).outerHTML).join("")}</div><figcaption><strong>${escapeHTML(frame.filename.split("/").at(-1) || frame.filename)}</strong><span>${formatSeconds(frame.seconds)} · ${Math.abs(frame.seconds - step.endSeconds) < 1 ? "Best timing" : "Nearby moment"}</span></figcaption></figure><button class="arrow" id="nextFrame" aria-label="Next screenshot" title="Next screenshot" ${candidateIndex === candidates.length - 1 ? "disabled" : ""}>→</button></div>` : `<div class="empty-picker">No screenshots are available for this recording.</div>`}
    <div class="picker-actions"><button class="button secondary" id="textOnly">Use text only</button><span>${drawingMode ? "Drag on the screenshot to add markup." : "Select Highlight or Redact, then drag on the screenshot."}</span><button class="button primary" id="useFrame" ${frame ? "" : "disabled"}>Use this image</button></div>
    <div class="filmstrip">${candidates.map((item, index) => `<button data-frame-index="${index}" class="${index === candidateIndex ? "active" : ""}" aria-label="Choose screenshot ${index + 1}" title="Choose screenshot ${index + 1}"><img src="${escapeAttribute(item.filename)}" alt="" /><span>${String(index + 1).padStart(2, "0")}</span></button>`).join("")}</div>`;

  mustFind<HTMLButtonElement>("#closePicker").onclick = closePicker;
  mustFind<HTMLButtonElement>("#bestFrames").onclick = () => changeFrameCollection(false);
  mustFind<HTMLButtonElement>("#allFrames").onclick = () => changeFrameCollection(true);
  mustFind<HTMLButtonElement>("#highlightMode").onclick = () => toggleDrawing("highlight");
  mustFind<HTMLButtonElement>("#redactMode").onclick = () => toggleDrawing("redaction");
  mustFind<HTMLButtonElement>("#undoMarkup").onclick = () => { draftAnnotations.pop(); renderPicker(); };
  mustFind<HTMLButtonElement>("#clearMarkup").onclick = () => { draftAnnotations = []; renderPicker(); };
  const previousFrame = document.querySelector<HTMLButtonElement>("#previousFrame");
  const nextFrame = document.querySelector<HTMLButtonElement>("#nextFrame");
  if (previousFrame) previousFrame.onclick = () => moveFrame(-1);
  if (nextFrame) nextFrame.onclick = () => moveFrame(1);
  mustFind<HTMLButtonElement>("#textOnly").onclick = () => applyImage(undefined, []);
  mustFind<HTMLButtonElement>("#useFrame").onclick = () => applyImage(frame, draftAnnotations);
  document.querySelectorAll<HTMLButtonElement>("[data-frame-index]").forEach((button) => {
    button.onclick = () => { candidateIndex = Number(button.dataset.frameIndex || 0); syncDraftAnnotations(); renderPicker(); };
  });
  const stage = document.querySelector<HTMLElement>("#markupStage");
  stage?.addEventListener("pointerdown", startMarkup);
  stage?.addEventListener("pointerup", finishMarkup);
}

function changeFrameCollection(showAll: boolean): void {
  const current = candidates[candidateIndex]?.filename;
  showAllFrames = showAll;
  const step = serializeStory().steps[activeStepIndex || 0];
  candidates = rankedFrames(step);
  candidateIndex = Math.max(0, candidates.findIndex((frame) => frame.filename === current));
  syncDraftAnnotations();
  renderPicker();
}

function rankedFrames(step: StoryStep): Frame[] {
  const all = [...payload.frames].sort((a, b) => Math.abs(a.seconds - step.endSeconds) - Math.abs(b.seconds - step.endSeconds));
  if (showAllFrames) return [...payload.frames].sort((a, b) => a.seconds - b.seconds);
  const best = all.slice(0, 8);
  const selected = payload.frames.find((frame) => frame.filename === step.imageFilename);
  if (selected && !best.some((frame) => frame.filename === selected.filename)) best[best.length - 1] = selected;
  return best;
}

function toggleDrawing(mode: AnnotationKind): void {
  drawingMode = drawingMode === mode ? undefined : mode;
  renderPicker();
}

function startMarkup(event: PointerEvent): void {
  if (!drawingMode) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dragStart = { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function finishMarkup(event: PointerEvent): void {
  if (!drawingMode || !dragStart) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const end = { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  const annotation: Annotation = {
    id: crypto.randomUUID(), kind: drawingMode,
    x: Math.min(dragStart.x, end.x), y: Math.min(dragStart.y, end.y),
    width: Math.abs(end.x - dragStart.x), height: Math.abs(end.y - dragStart.y)
  };
  dragStart = undefined;
  if (annotation.width > 0.012 && annotation.height > 0.012) draftAnnotations.push(annotation);
  renderPicker();
}

function moveFrame(offset: number): void {
  candidateIndex = Math.max(0, Math.min(candidates.length - 1, candidateIndex + offset));
  syncDraftAnnotations();
  renderPicker();
}

function syncDraftAnnotations(): void {
  if (activeStepIndex === undefined) return;
  const step = serializeStory().steps[activeStepIndex];
  draftAnnotations = candidates[candidateIndex]?.filename === step.imageFilename ? [...step.imageAnnotations] : [];
}

function applyImage(frame: Frame | undefined, annotations: Annotation[]): void {
  if (activeStepIndex === undefined) return;
  const transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "storyImage" && Number(node.attrs.stepIndex) === activeStepIndex) {
      transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        filename: frame?.filename || "",
        annotations: JSON.stringify(annotations)
      });
    }
  });
  editor.view.dispatch(transaction);
  closePicker();
}

function closePicker(): void {
  mustFind<HTMLDialogElement>("#imagePicker").close();
  activeStepIndex = undefined;
  candidates = [];
  drawingMode = undefined;
}

function annotationElement(annotation: Annotation): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = `annotation ${annotation.kind}`;
  element.style.left = `${clamp(annotation.x) * 100}%`;
  element.style.top = `${clamp(annotation.y) * 100}%`;
  element.style.width = `${clamp(annotation.width) * 100}%`;
  element.style.height = `${clamp(annotation.height) * 100}%`;
  return element;
}

function parseAnnotations(value: unknown): Annotation[] {
  if (Array.isArray(value)) return value as Annotation[];
  try { return JSON.parse(String(value || "[]")) as Annotation[]; } catch { return []; }
}

function htmlBlocks(html: string): JSONContent[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks: JSONContent[] = [];
  for (const child of [...template.content.children]) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      blocks.push({
        type: child.tagName === "UL" ? "bulletList" : "orderedList",
        content: [...child.children].map((item) => ({
          type: "listItem",
          content: [...item.children].length
            ? [...item.children].map(blockFromElement)
            : [{ type: "paragraph", content: inlineContent(item) }]
        }))
      });
    } else if (child.tagName === "BLOCKQUOTE") {
      blocks.push({
        type: "blockquote",
        content: [...child.children].length
          ? [...child.children].map(blockFromElement)
          : [{ type: "paragraph", content: inlineContent(child) }]
      });
    } else {
      blocks.push({ type: "paragraph", content: inlineContent(child) });
    }
  }
  return blocks.length ? blocks : [textNode("paragraph", "")];
}

function blockFromElement(element: Element): JSONContent {
  return { type: "paragraph", content: inlineContent(element) };
}

function inlineContent(element: Element): JSONContent[] {
  const content: JSONContent[] = [];
  const visit = (node: Node, marks: JSONContent["marks"] = []) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) content.push({ type: "text", text: node.textContent, marks });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === "BR") {
      content.push({ type: "hardBreak" });
      return;
    }
    const nextMarks = [...(marks || [])];
    if (["STRONG", "B"].includes(node.tagName)) nextMarks.push({ type: "bold" });
    if (["EM", "I"].includes(node.tagName)) nextMarks.push({ type: "italic" });
    node.childNodes.forEach((child) => visit(child, nextMarks));
  };
  element.childNodes.forEach((child) => visit(child));
  return content;
}

function narrativeHTML(value: string): string {
  const paragraphs = value.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
  return (paragraphs.length ? paragraphs : [""]).map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
}

function renderBlocks(blocks: JSONContent[]): string {
  return blocks.map(renderBlock).join("");
}

function renderBlock(node: JSONContent): string {
  if (node.type === "paragraph") return `<p>${renderInline(node.content || []) || "<br>"}</p>`;
  if (node.type === "heading") return `<h2>${renderInline(node.content || [])}</h2>`;
  if (node.type === "blockquote") return `<blockquote>${renderBlocks(node.content || [])}</blockquote>`;
  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "bulletList" ? "ul" : "ol";
    return `<${tag}>${(node.content || []).map((item) => `<li>${renderBlocks(item.content || [])}</li>`).join("")}</${tag}>`;
  }
  return "";
}

function renderInline(content: JSONContent[]): string {
  return content.map((node) => {
    if (node.type === "hardBreak") return "<br>";
    let text = escapeHTML(node.text || "");
    for (const mark of node.marks || []) {
      if (mark.type === "bold") text = `<strong>${text}</strong>`;
      if (mark.type === "italic") text = `<em>${text}</em>`;
    }
    return text;
  }).join("");
}

function textNode(type: string, text: string): JSONContent {
  return { type, content: textContent(text) };
}

function textContent(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

function textOf(node?: JSONContent): string {
  if (!node) return "";
  return [node.text || "", ...children(node).map(textOf)].join("").trim();
}

function children(node?: JSONContent): JSONContent[] {
  return (node?.content || []) as JSONContent[];
}

function htmlText(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
}

function formatRange(start: number, end: number): string {
  return `${formatSeconds(start)}–${formatSeconds(end)}`;
}

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHTML(value).replaceAll("'", "&#39;");
}

function mustFind<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
