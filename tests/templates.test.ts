import { describe, expect, it } from "vitest";
import { getSelectedTemplate, getTemplates, hasTemplateOverride, planRequiresRefresh, templateSignature } from "../src/templates";
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

it("requires a replan before a ready capture can reuse a changed template", () => {
  const original = { id: "debug-ticket", name: "Debug Ticket", instructions: "Original" };
  const changed = { ...original, instructions: "Changed" };
  const session = {
    status: "ready" as const,
    timeline: [],
    screenshots: [],
    captureAnalysis: { userGoal: "", bestDelivery: "", breakingPoints: [], helpfulImageMoments: [], story: "" },
    captureAnalysisTemplateSignature: templateSignature(original),
    ticket: { title: "Old PDF", summary: "", environment: [], reproductionSteps: [], expectedBehavior: "", actualBehavior: "", evidence: [], openQuestions: [] }
  };

  expect(planRequiresRefresh(session, changed)).toBe(true);
  expect(planRequiresRefresh(session, original)).toBe(false);
});
