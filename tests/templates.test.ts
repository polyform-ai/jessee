import { describe, expect, it } from "vitest";
import { getSelectedTemplate, getTemplates, hasTemplateOverride } from "../src/templates";
import type { Settings } from "../src/types";

describe("templates", () => {
  it("lets local edits override a built-in template", () => {
    const settings: Settings = {
      selectedTemplateId: "debug-ticket",
      customTemplates: [
        {
          id: "debug-ticket",
          name: "Debug Ticket Edited",
          instructions: "Use the edited local structure.",
          builtIn: false
        }
      ]
    };

    expect(hasTemplateOverride(settings, "debug-ticket")).toBe(true);
    expect(getSelectedTemplate(settings).name).toBe("Debug Ticket Edited");
    expect(getTemplates(settings).filter((template) => template.id === "debug-ticket")).toHaveLength(1);
  });
});
