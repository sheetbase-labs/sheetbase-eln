import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findProject } from '#/lib/assistant-labwork.server'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import type { DataClient } from '#/lib/data-client'

import type { FeatureProposalOutcome } from '../define.server'
import {
  proposeTemplateUpgradeSchema,
  proposeTemplateUseSchema,
  TEMPLATE_UPGRADE_TOOL,
  TEMPLATE_USE_TOOL,
  TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES,
} from './cards'
import type { TemplateVersionsProposeToolName } from './cards'

const NOTE =
  'The person sees a card and presses a button to do it; nothing changes until they do.'

export function isTemplateVersionsProposalTool(
  name: string,
): name is TemplateVersionsProposeToolName {
  return TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES.includes(name)
}

export function templateVersionsProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      TEMPLATE_USE_TOOL,
      `Propose starting a notebook from the newest published version of a notebook template (a TPL number), in a project. A template made a moment ago is a draft: publish it first, with the template publish tool, as an earlier step of the plan. A template that asks for inputs is refused here; the person fills those in on the Templates page. ${NOTE}`,
      proposeTemplateUseSchema,
    ),
    toolDef(
      TEMPLATE_UPGRADE_TOOL,
      `Propose bringing a notebook up to the newest published version of the template it was made from. Only when nothing needs deciding and the notebook is not signed. ${NOTE}`,
      proposeTemplateUpgradeSchema,
    ),
  ]
}

const fail = (message: string): FeatureProposalOutcome => ({
  ok: false,
  message,
})

interface VersionRow {
  id: string
  template_id: string
  version: number
  configuration: {
    parameters?: Array<{ required?: boolean; defaultValue?: unknown }>
  }
}

async function latestPublished(
  client: DataClient,
  templateId: string,
): Promise<VersionRow | null> {
  const rows = await client.list<VersionRow>(
    'notebook_template_versions',
    `?template_id=eq.${templateId}&lifecycle=eq.published&order=version.desc&select=id,template_id,version,configuration&limit=1`,
  )

  return rows.at(0) ?? null
}

export async function buildTemplateVersionsProposal(
  name: TemplateVersionsProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
): Promise<FeatureProposalOutcome> {
  const { client } = context

  switch (name) {
    case TEMPLATE_USE_TOOL: {
      const parsed = proposeTemplateUseSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.template)

      const rows = await client.list<{
        id: string
        name: string
        key: string
        display_id: string | null
      }>(
        'notebook_templates',
        `?or=(name.ilike.${like},key.ilike.${like},display_id.ilike.${like})&select=id,name,key,display_id&limit=6`,
      )

      const lower = input.template.trim().toLowerCase()

      const template: Lookup<(typeof rows)[number]> = pick(
        rows,
        input.template,
        'notebook template',
        (row) => `${row.display_id ?? row.key} ${row.name}`,
        (row) =>
          row.name.toLowerCase() === lower ||
          row.key.toLowerCase() === lower ||
          row.display_id?.toLowerCase() === lower,
      )

      if (!template.ok) return fail(template.message)
      const version = await latestPublished(client, template.value.id)

      if (!version) {
        return fail(
          `${template.value.name} has no published version yet, so nothing can be started from it. Put a template publish step for it before this one in the plan, or publish it first.`,
        )
      }

      const needsInput = (version.configuration.parameters ?? []).some(
        (parameter) =>
          parameter.required === true && parameter.defaultValue === undefined,
      )

      if (needsInput) {
        return fail(
          `${template.value.name} asks for inputs when it is used. Tell the person to start it from the Templates page.`,
        )
      }

      const project = await findProject(client, input.project)

      if (!project.ok) return fail(project.message)

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${template.value.name} · Version ${version.version}`,
          deepLink: '/templates',
          changes: [
            { label: 'Project', before: null, after: project.value.title },
            ...(input.name
              ? [{ label: 'Title', before: null, after: input.name.trim() }]
              : []),
          ],
          action: {
            kind: 'template.use',
            versionId: version.id,
            projectId: project.value.id,
            title: input.name?.trim() || null,
            idempotencyKey: crypto.randomUUID(),
          },
        },
      }
    }

    case TEMPLATE_UPGRADE_TOOL: {
      const parsed = proposeTemplateUpgradeSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.notebook)

      const rows = await client.list<{
        id: string
        identifier: string
        title: string
        locked_at: string | null
        source_notebook_template_version_id: string | null
      }>(
        'records',
        `?kind=eq.experiment&deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title,locked_at,source_notebook_template_version_id&order=updated_at.desc&limit=6`,
      )

      const lower = input.notebook.trim().toLowerCase()

      const notebook = pick(
        rows,
        input.notebook,
        'notebook',
        (row) => `${row.identifier} ${row.title}`,
        (row) => row.identifier.toLowerCase() === lower,
      )

      if (!notebook.ok) return fail(notebook.message)
      const row = notebook.value

      if (row.locked_at) {
        return fail(
          `${row.identifier} is signed. It has to be amended before it can be updated.`,
        )
      }

      if (!row.source_notebook_template_version_id) {
        return fail(`${row.identifier} was not made from a template.`)
      }

      const current = await client.list<{
        template_id: string
        version: number
      }>(
        'notebook_template_versions',
        `?id=eq.${row.source_notebook_template_version_id}&select=template_id,version&limit=1`,
      )

      const source = current.at(0)

      if (!source) return fail('Its template version could not be found.')
      const latest = await latestPublished(client, source.template_id)

      if (!latest || latest.version <= source.version) {
        return fail(`${row.identifier} is already on the newest version.`)
      }

      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: `${row.identifier} · ${row.title}`,
          deepLink: `/records/${row.id}`,
          changes: [
            {
              label: 'Template version',
              before: String(source.version),
              after: String(latest.version),
            },
          ],
          action: {
            kind: 'template.upgrade_notebook',
            recordId: row.id,
            targetVersionId: latest.id,
          },
        },
      }
    }
  }
}
