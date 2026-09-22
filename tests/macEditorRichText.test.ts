import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import { htmlBlocks, renderBlocks } from "../src/richTextHTML.ts";
import {
  containedContentBounds,
  normalizePointInBounds,
  pointIsInsideBounds
} from "../src/annotationCoordinates.ts";
import { imagePublicationState } from "../src/imagePublicationState.ts";
import { normalizeSourceURL } from "../src/storyURL.ts";

function installDOM(): void {
  const window = parseHTML("<html><body></body></html").window;
  Object.assign(globalThis, {
    document: window.document,
    Element: window.Element,
    Node: window.Node
  });
}

test("rich text marks survive HTML rehydration", () => {
  installDOM();
  const html = "<p>Keep <strong>bold <em>and italic</em></strong> text.</p>";
  const blocks = htmlBlocks(html);
  assert.deepEqual(blocks[0]?.content?.[1]?.marks?.map((mark) => mark.type), ["bold"]);
  assert.deepEqual(
    blocks[0]?.content?.[2]?.marks?.map((mark) => mark.type), ["bold", "italic"]);
  assert.match(renderBlocks(blocks), /<strong>/);
  assert.match(renderBlocks(blocks), /<em>/);
});

test("nested lists survive HTML rehydration", () => {
  installDOM();
  const html = "<ul><li><p>Parent</p><ol><li><p>Child</p></li></ol></li></ul>";
  assert.equal(renderBlocks(htmlBlocks(html)), html);
});

test("lists inside callouts survive HTML rehydration", () => {
  installDOM();
  const html = "<blockquote><p>Remember:</p><ul><li><p>One thing</p></li></ul></blockquote>";
  assert.equal(renderBlocks(htmlBlocks(html)), html);
});

test("source URLs are normalized before the editor saves them", () => {
  assert.equal(normalizeSourceURL("example.com/page"), "https://example.com/page");
  assert.equal(normalizeSourceURL("https://example.com/page"), "https://example.com/page");
  assert.equal(normalizeSourceURL("http://localhost:3000/page"), "http://localhost:3000/page");
  assert.equal(normalizeSourceURL("https://jira/browse/ABC"), "https://jira/browse/ABC");
  assert.equal(normalizeSourceURL("file:///tmp/private"), undefined);
  assert.equal(normalizeSourceURL("not a URL"), undefined);
});

test("markup coordinates are normalized to the displayed image bounds", () => {
  const bounds = containedContentBounds(
    { left: 40, top: 80, width: 600, height: 500 },
    400,
    1_000
  );
  assert.deepEqual(bounds, { left: 240, top: 80, width: 200, height: 500 });
  assert.ok(bounds);
  assert.deepEqual(normalizePointInBounds(290, 205, bounds), { x: 0.25, y: 0.25 });
  assert.deepEqual(normalizePointInBounds(100, 700, bounds), { x: 0, y: 1 });
  assert.equal(pointIsInsideBounds(290, 205, bounds), true);
  assert.equal(pointIsInsideBounds(200, 205, bounds), false);
  assert.equal(normalizePointInBounds(290, 205, { ...bounds, width: 0 }), undefined);
});

test("publication state changes only with the shared screenshot", () => {
  const story = {
    title: "Original title",
    steps: [{ imageFilename: "images/shot.png", imageAnnotations: [] }]
  };
  const published = imagePublicationState(story);
  assert.equal(imagePublicationState({ ...story, title: "Edited title" }), published);
  assert.notEqual(imagePublicationState({
    ...story,
    steps: [{
      imageFilename: "images/shot.png",
      imageAnnotations: [{ id: "redaction", kind: "redaction", x: 0, y: 0, width: 1, height: 1 }]
    }]
  }), published);
  assert.notEqual(imagePublicationState({
    ...story,
    steps: [{ imageFilename: "images/other.png", imageAnnotations: [] }]
  }), published);
});
