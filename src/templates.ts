import type { Settings, TicketTemplate } from "./types";

export const DEFAULT_TEMPLATE_ID = "debug-ticket";

export const BUILT_IN_TEMPLATES: TicketTemplate[] = [
  {
    id: "feature-request",
    name: "Feature Request",
    builtIn: true,
    instructions: [
      "Write this as a product feature request for a product and engineering team.",
      "Make the summary explain the user goal, why it matters, and the desired outcome.",
      "Use environment for URLs, product area, account/workspace context, and any constraints visible in the capture.",
      "Use reproductionSteps for the current workflow, workaround, or path the user took before asking for the feature.",
      "Use expectedBehavior for the proposed experience and acceptance criteria.",
      "Use actualBehavior for the current limitation, friction, or missing capability.",
      "Evidence should cite only screenshots that clarify the request, each with a caption explaining what the team should notice.",
      "Open questions should capture product decisions, edge cases, or rollout details that are not answered by the capture."
    ].join(" ")
  },
  {
    id: "debug-ticket",
    name: "Debug Ticket",
    builtIn: true,
    instructions: [
      "Write this as an engineering debug ticket that a coding agent can act on.",
      "Make the summary state the failure, user impact, and suspected product area in plain language.",
      "Use environment for URLs, browser/app state, account/workspace context, feature flags, visible IDs, and exact error messages.",
      "Use reproductionSteps for a precise numbered path from a clean starting point to the observed issue.",
      "Use expectedBehavior for what should have happened.",
      "Use actualBehavior for what happened instead, including visible errors and confusing states.",
      "Evidence should include screenshots only when they prove a step, an error, or a state transition.",
      "Open questions should identify missing logs, uncertain preconditions, or follow-up checks needed before fixing."
    ].join(" ")
  },
  {
    id: "instructional-guide",
    name: "Instructional Guide",
    builtIn: true,
    instructions: [
      "Write this as a concise instructional guide or SOP for another person to follow.",
      "Make the summary explain the task, audience, and final outcome.",
      "Use environment for required tools, URLs, permissions, setup, and starting conditions.",
      "Use reproductionSteps as the ordered procedure, with decision points and visual checkpoints.",
      "Use expectedBehavior for the successful end state and how the reader can verify it.",
      "Use actualBehavior for caveats, common mistakes, warnings, or places the walkthrough showed confusion.",
      "Evidence should include screenshots only when they make a step easier to identify or confirm.",
      "Open questions should capture process gaps, policy decisions, or prerequisites that need clarification."
    ].join(" ")
  }
];

export function getTemplates(settings: Settings): TicketTemplate[] {
  const customTemplates = settings.customTemplates ?? [];
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((template) => template.id));
  return [
    ...BUILT_IN_TEMPLATES.map((template) => customTemplates.find((custom) => custom.id === template.id) ?? template),
    ...customTemplates.filter((template) => !builtInIds.has(template.id))
  ];
}

export function getSelectedTemplate(settings: Settings): TicketTemplate {
  const templates = getTemplates(settings);
  return templates.find((template) => template.id === settings.selectedTemplateId) ?? templates.find((template) => template.id === DEFAULT_TEMPLATE_ID) ?? templates[0];
}

export function createCustomTemplate(name: string, instructions: string): TicketTemplate {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: name.trim(),
    instructions: instructions.trim(),
    builtIn: false
  };
}

export function isBuiltInTemplateId(templateId: string): boolean {
  return BUILT_IN_TEMPLATES.some((template) => template.id === templateId);
}

export function hasTemplateOverride(settings: Settings, templateId: string): boolean {
  return (settings.customTemplates ?? []).some((template) => template.id === templateId && isBuiltInTemplateId(templateId));
}
