import { z } from 'zod'

export const TEMPLATE_USE_TOOL = 'sheetbase.template.use'
export const TEMPLATE_UPGRADE_TOOL = 'sheetbase.template.upgrade_notebook'

export const TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES: readonly string[] = [
  TEMPLATE_USE_TOOL,
  TEMPLATE_UPGRADE_TOOL,
]

export type TemplateVersionsProposeToolName =
  typeof TEMPLATE_USE_TOOL | typeof TEMPLATE_UPGRADE_TOOL

const shared = {
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
}

export const proposeTemplateUseSchema = z.strictObject({
  ...shared,
  template: z
    .string()
    .min(1)
    .max(200)
    .describe('The notebook template, by name, key or ID (TPL-0004).'),
  project: z
    .string()
    .min(1)
    .max(200)
    .describe('The project it goes in, by name, key or ID (PRJ-0008).'),
  name: z.string().max(200).optional().describe('The new notebook’s title.'),
})

export const proposeTemplateUpgradeSchema = z.strictObject({
  ...shared,
  notebook: z
    .string()
    .min(1)
    .max(200)
    .describe('The notebook, by ID (EXP-0042) or title.'),
})

/** What a card does when its button is pressed. */
export type TemplateVersionsAction =
  | {
      kind: 'template.use'
      versionId: string
      projectId: string
      title: string | null
      idempotencyKey: string
    }
  | {
      kind: 'template.upgrade_notebook'
      recordId: string
      targetVersionId: string
    }

export function isTemplateVersionsAction(action: {
  kind: string
}): action is TemplateVersionsAction {
  return (
    action.kind === 'template.use' ||
    action.kind === 'template.upgrade_notebook'
  )
}
