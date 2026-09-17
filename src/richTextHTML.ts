import type { JSONContent } from "@tiptap/core";

export function htmlBlocks(html: string): JSONContent[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks = [...template.content.children].map(blockFromElement);
  return blocks.length ? blocks : [textNode("paragraph", "")];
}

export function narrativeHTML(value: string): string {
  const paragraphs = value.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
  return (paragraphs.length ? paragraphs : [""])
    .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
}

export function renderBlocks(blocks: JSONContent[]): string {
  return blocks.map(renderBlock).join("");
}

export function htmlText(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
}

function blockFromElement(element: Element): JSONContent {
  if (element.tagName === "UL" || element.tagName === "OL") {
    return {
      type: element.tagName === "UL" ? "bulletList" : "orderedList",
      content: [...element.children]
        .filter((item) => item.tagName === "LI")
        .map((item) => ({ type: "listItem", content: listItemBlocks(item) }))
    };
  }
  if (element.tagName === "BLOCKQUOTE") {
    const content = childBlocks(element);
    return {
      type: "blockquote",
      content: content.length ? content : [{ type: "paragraph", content: inlineContent(element) }]
    };
  }
  return { type: "paragraph", content: inlineContent(element) };
}

function listItemBlocks(item: Element): JSONContent[] {
  const content = childBlocks(item);
  return content.length ? content : [{ type: "paragraph", content: inlineContent(item) }];
}

function childBlocks(element: Element): JSONContent[] {
  const content: JSONContent[] = [];
  const inlineNodes: ChildNode[] = [];
  const flushInline = () => {
    if (!inlineNodes.length) return;
    const inline = inlineContentFromNodes(inlineNodes.splice(0));
    if (inline.length) content.push({ type: "paragraph", content: inline });
  };
  for (const child of element.childNodes) {
    if (child instanceof Element && ["P", "UL", "OL", "BLOCKQUOTE"].includes(child.tagName)) {
      flushInline();
      content.push(blockFromElement(child));
    } else {
      inlineNodes.push(child);
    }
  }
  flushInline();
  return content;
}

function inlineContent(element: Element): JSONContent[] {
  return inlineContentFromNodes([...element.childNodes]);
}

function inlineContentFromNodes(nodes: ChildNode[]): JSONContent[] {
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
  nodes.forEach((child) => visit(child));
  return content;
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
  return { type, content: text ? [{ type: "text", text }] : [] };
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
