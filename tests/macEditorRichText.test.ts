import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import { htmlBlocks, renderBlocks } from "../src/richTextHTML.ts";

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
