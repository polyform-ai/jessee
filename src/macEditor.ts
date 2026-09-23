import { Editor, Node as TiptapNode, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import "./macEditor.css";
import {
  containedContentBounds,
  normalizePointInBounds,
  pointIsInsideBounds,
  type RectangleBounds
} from "./annotationCoordinates";
import { htmlBlocks, htmlText, narrativeHTML, renderBlocks } from "./richTextHTML";
import {
  imagePublicationState,
  serializedImagePublicationState,
  type PublishedImageState
} from "./imagePublicationState";
import { normalizeSourceURL } from "./storyURL";

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
  sourceURL?: string;
  documentType?: string;
  entryLabel?: string;
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
  fallbackImageFilename: string;
  publicImageURL?: string;
  publicImagePublicationState?: PublishedImageState;
  publicImageIsCurrent: boolean;
  publicPDFURL?: string;
  canPublishImage: boolean;
  canCopyImage: boolean;
  canCopyPDF: boolean;
}

interface BridgeMessage {
  type:
    | "save"
    | "saveAndOpenPDF"
    | "saveAndPublishImage"
    | "saveAndPublishPDF"
    | "saveAndCopyImage"
    | "saveAndCopyPDF"
    | "saveAndCopyPublicImageURL";
  story: Story;
}

declare global {
  interface Window {
    __JESSEE_EDITOR__: EditorPayload;
    jesseeDidSave?: (success: boolean, message: string, publicURL?: string) => void;
    jesseeDidUpdatePublicationState?: (update: {
      publicImageURL?: string;
      publicImagePublicationState?: PublishedImageState;
      publicPDFURL?: string;
    }) => void;
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

const sectionLabel = normalizeLabel(payload.story.entryLabel, "Step");
const sectionLabelLower = sectionLabel.toLocaleLowerCase();

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
let editRevision = 0;
let publishedImageState = serializedImagePublicationState(payload.publicImagePublicationState);
let pendingSaveRevision: number | undefined;
let pendingImageState: string | undefined;
let pendingAction: BridgeMessage["type"] | undefined;
let markupResizeObserver: ResizeObserver | undefined;

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
if (payload.publicPDFURL) showPublicLink(payload.publicPDFURL);
if (payload.publicImageURL) showPublicLink(payload.publicImageURL);

window.jesseeDidSave = (success, message, publicURL) => {
  const savedRevision = pendingSaveRevision;
  const savedImageState = pendingImageState;
  const completedAction = pendingAction;
  pendingSaveRevision = undefined;
  pendingImageState = undefined;
  pendingAction = undefined;
  setActionPending();
  const hasNewerEdits = savedRevision !== undefined && savedRevision !== editRevision;
  if (success && completedAction === "saveAndPublishImage") {
    publishedImageState = savedImageState;
  }
  setStatus(
    success && hasNewerEdits
      ? isPublishAction(completedAction)
        ? "Link copied · New edits not saved"
        : "Earlier version saved · New edits not saved"
      : message,
    !success
  );
  if (success && !hasNewerEdits) document.body.classList.remove("is-dirty");
  if (success && publicURL) showPublicLink(publicURL, "Copied");
  updateScreenshotURLAction();
};

window.jesseeDidUpdatePublicationState = (update) => {
  payload.publicImageURL = update.publicImageURL;
  payload.publicImagePublicationState = update.publicImagePublicationState;
  payload.publicPDFURL = update.publicPDFURL;
  publishedImageState = serializedImagePublicationState(update.publicImagePublicationState);
  updateScreenshotURLAction();
  updatePublicPDFLink();
};

function renderShell(): void {
  const copyActions = [
    payload.canCopyImage
      ? `<button class="header-icon" id="copyImage" data-tooltip="Save and copy annotated image" title="Save and copy annotated image" aria-label="Save and copy annotated image">▣</button>`
      : "",
    payload.canCopyPDF
      ? `<button class="header-icon pdf-icon" id="copyPDF" data-tooltip="Save and copy PDF" title="Save and copy PDF" aria-label="Save and copy PDF">PDF</button>`
      : ""
  ].join("");
  const standardActions = payload.canPublishImage ? "" : `<button class="button primary" id="openPDF">Save & open PDF</button><button class="button secondary" id="getLink" data-tooltip="Generate public link" title="Generate public link">Get link</button>`;
  const screenshotOptions = payload.canPublishImage ? `
      <section class="share-options" aria-labelledby="shareOptionsTitle">
        <div class="share-options-heading"><p class="kicker">Ready to share</p><h2 id="shareOptionsTitle">Choose the format you need</h2><p id="screenshotShareGuidance">${payload.publicImageURL && payload.publicImageIsCurrent ? "Your screenshot URL was copied automatically after capture. Copy it again here, or use the PDF version." : payload.publicImageURL ? "Your screenshot changed. Update its URL before sharing, or use the PDF version." : "Create and copy a screenshot URL here, or use the PDF version."}</p></div>
        <div class="share-option-grid">
          <article class="share-option featured">
            <div class="share-option-icon" aria-hidden="true">↗</div>
            <div class="share-option-copy"><p class="share-option-label">Option 1</p><h3>Screenshot URL</h3><p>Share the screenshot as a public link.</p><p class="share-option-value" id="screenshotPublicURL">${payload.publicImageURL && payload.publicImageIsCurrent ? escapeHTML(payload.publicImageURL) : payload.publicImageURL ? "Update the URL to match this screenshot." : "Create a public URL when you are ready."}</p></div>
            <button class="button primary" id="screenshotURLAction">${payload.publicImageURL && payload.publicImageIsCurrent ? "Copy URL" : payload.publicImageURL ? "Update & copy URL" : "Create & copy URL"}</button>
          </article>
          <article class="share-option">
            <div class="share-option-icon pdf-mark" aria-hidden="true">PDF</div>
            <div class="share-option-copy"><p class="share-option-label">Option 2</p><h3>PDF version</h3><p>Open the finished page or copy the PDF file.</p></div>
            <div class="share-option-actions"><button class="button secondary" id="openPDF">Open PDF</button><button class="button secondary" id="copyPDF">Copy PDF</button></div>
          </article>
        </div>
      </section>` : "";
  app.innerHTML = `
    <div class="editor-app">
      <header class="editor-header">
        <div><p class="kicker">Visual story editor</p><h1>Shape the story before you share it</h1><p>Edit like a document, then choose and mark up the strongest screenshot for each ${escapeHTML(sectionLabelLower)}.</p></div>
        <div class="header-sharing">
          <div class="header-actions"><span id="saveStatus">Saved</span>${payload.canPublishImage ? "" : copyActions}<button class="button secondary" id="saveStory">Save</button>${standardActions}</div>
          <div class="public-link-row" id="publicLinkRow" hidden><span class="public-link-value" id="publicLink"></span><span id="publicLinkStatus"></span></div>
        </div>
      </header>
      ${screenshotOptions}
      <nav class="editor-toolbar" aria-label="Text formatting">
        ${tool("paragraph", "Text", true)}${tool("bold", "<strong>B</strong>")}${tool("italic", "<em>I</em>")}${tool("bulletList", "• Bullets", true)}${tool("orderedList", "1. List", true)}${tool("blockquote", "Callout", true)}<span class="divider"></span>${tool("undo", "↶")}${tool("redo", "↷")}<span class="toolbar-tip">Click anywhere to write · select text to format</span>
      </nav>
      <label class="source-field"><span>Source URL</span><input id="sourceURL" type="url" value="${escapeAttribute(payload.story.sourceURL || "")}" placeholder="https://example.com/page" aria-label="Source URL" /></label>
      <section class="paper" id="storyEditor"></section>
      <footer><span>The PDF follows this same order and keeps every divider, image, list, and callout.</span><button class="button secondary" id="addStep">+ Add another ${escapeHTML(sectionLabelLower)}</button></footer>
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
  document.querySelector<HTMLButtonElement>("#getLink")
    ?.addEventListener("click", () => send("saveAndPublishPDF"));
  document.querySelector<HTMLButtonElement>("#screenshotURLAction")
    ?.addEventListener("click", () =>
      send(payload.publicImageURL && screenshotImageIsPublished()
        ? "saveAndCopyPublicImageURL" : "saveAndPublishImage")
    );
  document.querySelector<HTMLButtonElement>("#copyImage")
    ?.addEventListener("click", () => send("saveAndCopyImage"));
  document.querySelector<HTMLButtonElement>("#copyPDF")
    ?.addEventListener("click", () => send("saveAndCopyPDF"));
  mustFind<HTMLButtonElement>("#addStep").addEventListener("click", addStep);
  mustFind<HTMLInputElement>("#sourceURL").addEventListener("input", (event) => {
    (event.currentTarget as HTMLInputElement).setCustomValidity("");
    markDirty();
  });
  mustFind<HTMLDialogElement>("#imagePicker").addEventListener("cancel", (event) => {
    event.preventDefault();
    closePicker();
  });
}

function tool(action: string, content: string, wide = false): string {
  const label = toolLabel(action);
  return `<button type="button" class="tool${wide ? " wide" : ""}" data-action="${action}" data-tooltip="${label}" aria-label="${label}" title="${label}" aria-pressed="false">${content}</button>`;
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
  editRevision += 1;
  document.body.classList.add("is-dirty");
  setStatus("Unsaved changes");
  updateScreenshotURLAction();
}

function send(type: BridgeMessage["type"]): void {
  if (pendingAction) return;
  const sourceInput = mustFind<HTMLInputElement>("#sourceURL");
  const sourceValue = sourceInput.value.trim();
  const sourceURL = normalizeSourceURL(sourceValue);
  if (sourceValue && !sourceURL) {
    sourceInput.setCustomValidity("Enter a valid HTTP or HTTPS web address.");
    sourceInput.reportValidity();
    setStatus("Check the source URL", true);
    return;
  }
  sourceInput.setCustomValidity("");
  if (sourceURL) sourceInput.value = sourceURL;
  setStatus(
    type === "save"
      ? "Saving…"
      : type === "saveAndOpenPDF"
        ? "Updating PDF…"
        : type === "saveAndCopyImage"
          ? "Saving and copying image…"
        : type === "saveAndCopyPDF"
          ? "Saving and copying PDF…"
          : type === "saveAndCopyPublicImageURL"
            ? "Saving and copying screenshot URL…"
            : "Generating public link…"
  );
  pendingSaveRevision = editRevision;
  pendingAction = type;
  setActionPending(type);
  const story = serializeStory();
  pendingImageState = imagePublicationState(story, payload.fallbackImageFilename);
  const message: BridgeMessage = { type, story };
  const bridge = window.webkit?.messageHandlers?.storyEditor;
  if (bridge) bridge.postMessage(message);
  else window.jesseeDidSave?.(
    true,
    isPublishAction(type) ? "Copied" : "Preview saved",
    isPublishAction(type) ? "https://example.com/jessee-preview" : undefined
  );
}

function setStatus(message: string, error = false): void {
  const status = mustFind<HTMLElement>("#saveStatus");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function setActionPending(action?: BridgeMessage["type"]): void {
  for (const id of ["saveStory", "openPDF", "getLink", "copyImage", "copyPDF", "screenshotURLAction"]) {
    document.querySelector<HTMLButtonElement>(`#${id}`)
      ?.toggleAttribute("disabled", action !== undefined);
  }
  const getLink = document.querySelector<HTMLButtonElement>("#getLink");
  if (getLink) getLink.textContent = isPublishAction(action) ? "Generating…" : "Get link";
  const screenshotURLAction = document.querySelector<HTMLButtonElement>("#screenshotURLAction");
  if (screenshotURLAction) {
    screenshotURLAction.textContent = action === "saveAndPublishImage"
      ? "Creating…"
      : action === "saveAndCopyPublicImageURL"
        ? "Copying…"
        : screenshotURLActionLabel();
  }
}

function updateScreenshotURLAction(): void {
  if (pendingAction) return;
  const isCurrent = screenshotImageIsPublished();
  const action = document.querySelector<HTMLButtonElement>("#screenshotURLAction");
  if (action) action.textContent = screenshotURLActionLabel();
  const value = document.querySelector<HTMLElement>("#screenshotPublicURL");
  if (value) {
    value.textContent = payload.publicImageURL && isCurrent
      ? payload.publicImageURL
      : payload.publicImageURL
        ? "Update the URL to match this screenshot."
        : "Create a public URL when you are ready.";
  }
  const guidance = document.querySelector<HTMLElement>("#screenshotShareGuidance");
  if (guidance) {
    guidance.textContent = payload.publicImageURL && isCurrent
      ? "Your screenshot URL was copied automatically after capture. Copy it again here, or use the PDF version."
      : payload.publicImageURL
        ? "Your screenshot changed. Update its URL before sharing, or use the PDF version."
        : "Create and copy a screenshot URL here, or use the PDF version.";
  }
}

function screenshotURLActionLabel(): string {
  if (!payload.publicImageURL) return "Create & copy URL";
  return screenshotImageIsPublished() ? "Copy URL" : "Update & copy URL";
}

function screenshotImageIsPublished(): boolean {
  return publishedImageState !== undefined
    && publishedImageState
      === imagePublicationState(serializeStory(), payload.fallbackImageFilename);
}

function isPublishAction(action?: BridgeMessage["type"]): boolean {
  return action === "saveAndPublishImage" || action === "saveAndPublishPDF"
    || action === "saveAndCopyPublicImageURL";
}

function showPublicLink(publicURL: string, status = ""): void {
  if (payload.canPublishImage) {
    payload.publicImageURL = publicURL;
    updateScreenshotURLAction();
    const action = document.querySelector<HTMLButtonElement>("#screenshotURLAction");
    if (action) action.textContent = status ? `${status} · Copy again` : screenshotURLActionLabel();
    return;
  }
  const row = mustFind<HTMLElement>("#publicLinkRow");
  const link = mustFind<HTMLElement>("#publicLink");
  link.textContent = publicURL;
  mustFind<HTMLElement>("#publicLinkStatus").textContent = status;
  row.hidden = false;
}

function updatePublicPDFLink(): void {
  if (payload.canPublishImage) return;
  const row = mustFind<HTMLElement>("#publicLinkRow");
  const link = mustFind<HTMLElement>("#publicLink");
  const status = mustFind<HTMLElement>("#publicLinkStatus");
  link.textContent = payload.publicPDFURL || "";
  status.textContent = "";
  row.hidden = !payload.publicPDFURL;
}

function addStep(): void {
  const steps = serializeStory().steps;
  const previous = steps.at(-1);
  const step: StoryStep = {
    id: crypto.randomUUID(),
    startSeconds: previous?.endSeconds ?? 0,
    endSeconds: previous?.endSeconds ?? 0,
    title: `New ${sectionLabelLower}`,
    narrative: "Add the next part of the document.",
    transcript: "",
    imageFilename: previous?.imageFilename,
    imageAnnotations: []
  };
  editor.chain().focus("end").insertContent(stepNode(step, steps.length)).run();
  requestAnimationFrame(() => document.querySelector(`[data-step-index="${steps.length}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function initialDocument(story: Story): JSONContent {
  const steps = story.steps.length ? story.steps : [{
    id: crypto.randomUUID(), startSeconds: 0, endSeconds: 0, title: `First ${sectionLabelLower}`,
    narrative: "Add the first part of the document.", transcript: "", imageAnnotations: []
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
      stepLabel: `${sectionLabel} ${index + 1}`,
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
      title: textOf(children(node).find((child) => child.type === "heading")) || `${sectionLabel} ${index + 1}`,
      narrative: htmlText(narrativeHTML),
      narrativeHTML,
      transcript: String(node.attrs?.transcript || ""),
      imageFilename: String(image?.attrs?.filename || "") || undefined,
      imageAnnotations: parseAnnotations(image?.attrs?.annotations)
    } satisfies StoryStep;
  });
  const sourceURL = normalizeSourceURL(mustFind<HTMLInputElement>("#sourceURL").value);
  return {
    title: title || "Untitled story", sourceURL,
    documentType: payload.story.documentType, entryLabel: payload.story.entryLabel,
    summary, summaryHTML, keyPoints, steps
  };
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
  markupResizeObserver?.disconnect();
  markupResizeObserver = undefined;
  const step = serializeStory().steps[activeStepIndex];
  const frame = candidates[candidateIndex];
  const card = mustFind<HTMLElement>("#pickerCard");
  card.innerHTML = `
    <header><div><p class="kicker">${escapeHTML(sectionLabel)} ${activeStepIndex + 1} visual</p><h2>Choose it, then make the important part obvious</h2><p>${escapeHTML(step.title)}</p></div><button class="icon" id="closePicker" data-tooltip="Close image picker" aria-label="Close image picker" title="Close image picker">×</button></header>
    <div class="picker-toolbar">
      <div class="segmented"><button id="bestFrames" class="${showAllFrames ? "" : "active"}">Best matches</button><button id="allFrames" class="${showAllFrames ? "active" : ""}">All images</button></div>
      <div class="markup-tools"><button id="highlightMode" class="${drawingMode === "highlight" ? "active" : ""}">Highlight</button><button id="redactMode" class="${drawingMode === "redaction" ? "active" : ""}">Redact</button><button id="undoMarkup" ${draftAnnotations.length ? "" : "disabled"}>Undo</button><button id="clearMarkup" ${draftAnnotations.length ? "" : "disabled"}>Clear</button></div>
      <span>${frame ? `${candidateIndex + 1} of ${candidates.length}` : "No images"}</span>
    </div>
    ${frame ? `<div class="picker-stage-row"><button class="arrow" id="previousFrame" data-tooltip="Previous screenshot" aria-label="Previous screenshot" title="Previous screenshot" ${candidateIndex === 0 ? "disabled" : ""}>←</button><figure><div class="markup-stage ${drawingMode ? "drawing" : ""}" id="markupStage"><img src="${escapeAttribute(frame.filename)}" alt="Screenshot ${candidateIndex + 1}" />${draftAnnotations.map((annotation) => markupAnnotationElement(annotation).outerHTML).join("")}</div><figcaption><strong>${escapeHTML(frame.filename.split("/").at(-1) || frame.filename)}</strong><span>${formatSeconds(frame.seconds)} · ${Math.abs(frame.seconds - step.endSeconds) < 1 ? "Best timing" : "Nearby moment"}</span></figcaption></figure><button class="arrow" id="nextFrame" data-tooltip="Next screenshot" aria-label="Next screenshot" title="Next screenshot" ${candidateIndex === candidates.length - 1 ? "disabled" : ""}>→</button></div>` : `<div class="empty-picker">No screenshots are available for this recording.</div>`}
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
  const image = stage?.querySelector<HTMLImageElement>("img");
  stage?.addEventListener("pointerdown", startMarkup);
  stage?.addEventListener("pointerup", finishMarkup);
  if (stage && image) {
    const layout = () => layoutMarkupAnnotations(stage, image);
    image.addEventListener("load", layout, { once: true });
    markupResizeObserver = new ResizeObserver(layout);
    markupResizeObserver.observe(stage);
    markupResizeObserver.observe(image);
    requestAnimationFrame(layout);
  }
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
  const target = event.currentTarget as HTMLElement;
  const rect = displayedImageBounds(target.querySelector("img"));
  if (!rect || !pointIsInsideBounds(event.clientX, event.clientY, rect)) return;
  dragStart = normalizePointInBounds(event.clientX, event.clientY, rect);
  if (!dragStart) return;
  target.setPointerCapture(event.pointerId);
}

function finishMarkup(event: PointerEvent): void {
  if (!drawingMode || !dragStart) return;
  const rect = displayedImageBounds((event.currentTarget as HTMLElement).querySelector("img"));
  if (!rect) {
    dragStart = undefined;
    return;
  }
  const end = normalizePointInBounds(event.clientX, event.clientY, rect);
  if (!end) {
    dragStart = undefined;
    return;
  }
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
  markupResizeObserver?.disconnect();
  markupResizeObserver = undefined;
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

function markupAnnotationElement(annotation: Annotation): HTMLSpanElement {
  const element = annotationElement(annotation);
  element.dataset.x = String(annotation.x);
  element.dataset.y = String(annotation.y);
  element.dataset.width = String(annotation.width);
  element.dataset.height = String(annotation.height);
  element.style.visibility = "hidden";
  return element;
}

function layoutMarkupAnnotations(stage: HTMLElement, image: HTMLImageElement): void {
  const stageBounds = stage.getBoundingClientRect();
  const imageBounds = displayedImageBounds(image);
  if (!imageBounds) return;
  for (const element of stage.querySelectorAll<HTMLElement>(".annotation")) {
    const x = clamp(Number(element.dataset.x));
    const y = clamp(Number(element.dataset.y));
    const width = clamp(Number(element.dataset.width));
    const height = clamp(Number(element.dataset.height));
    element.style.left = `${imageBounds.left - stageBounds.left + x * imageBounds.width}px`;
    element.style.top = `${imageBounds.top - stageBounds.top + y * imageBounds.height}px`;
    element.style.width = `${width * imageBounds.width}px`;
    element.style.height = `${height * imageBounds.height}px`;
    element.style.visibility = "visible";
  }
}

function displayedImageBounds(image: HTMLImageElement | null): RectangleBounds | undefined {
  if (!image) return undefined;
  return containedContentBounds(image.getBoundingClientRect(), image.naturalWidth, image.naturalHeight);
}

function parseAnnotations(value: unknown): Annotation[] {
  if (Array.isArray(value)) return value as Annotation[];
  try { return JSON.parse(String(value || "[]")) as Annotation[]; } catch { return []; }
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

function normalizeLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\s+/g, " ").slice(0, 48) || "";
  return normalized || fallback;
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
