import type { ProviderToolDef } from '#/lib/ai-providers/types'
import {
  NOTE,
  adminCard,
  fail,
  onOff,
} from '#/lib/assistant-admin-cards.server'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { findModel } from '#/lib/assistant-labwork.server'
import type { ProposalChange } from '#/lib/assistant-proposals'
import { pick } from '#/lib/assistant-upkeep.server'
import type { Lookup } from '#/lib/assistant-upkeep.server'
import { fetchModelFields } from '#/lib/model-fields'
import { searchOntologyTerms } from '#/lib/ontology/ols'

import type { FeatureProposalOutcome } from '../define.server'
import {
  ONTOLOGY_LINK_TOOL,
  ONTOLOGY_UNLINK_TOOL,
  OPEN_DATA_PROPOSE_TOOL_NAMES,
  PUBLICATION_DISCARD_TOOL,
  PUBLICATION_RETRY_TOOL,
  PUBLICATION_TARGET_DELETE_TOOL,
  PUBLICATION_TARGET_SAVE_TOOL,
  proposeOntologyLinkSchema,
  proposeOntologyUnlinkSchema,
  proposePublicationStateSchema,
  proposePublicationTargetDeleteSchema,
  proposePublicationTargetSaveSchema,
} from './cards'
import type { OpenDataProposeToolName } from './cards'

/**
 * The ontology and publishing cards (see `cards.ts`). Each builder finds what
 * the model named under the signed-in person's own access and returns a card
 * that says exactly what will change. Nothing is written here.
 */

const HREF = '/settings/workspace/open-data'

export function isOpenDataProposalTool(
  name: string,
): name is OpenDataProposeToolName {
  return OPEN_DATA_PROPOSE_TOOL_NAMES.includes(name)
}

export function openDataProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      ONTOLOGY_LINK_TOOL,
      `Propose linking a model field to an ontology term (OBI, ChEBI, Cell Ontology and so on), so the field says what it means. The term is searched for by its words. ${NOTE}`,
      proposeOntologyLinkSchema,
    ),
    toolDef(
      ONTOLOGY_UNLINK_TOOL,
      `Propose removing a link between a field and an ontology term. ${NOTE}`,
      proposeOntologyUnlinkSchema,
    ),
    toolDef(
      PUBLICATION_TARGET_SAVE_TOOL,
      `Propose adding a publishing repository (Zenodo, InvenioRDM, Figshare, Dataverse) or changing one by its name. Its access token is never set here: the person adds it at the settings page. ${NOTE}`,
      proposePublicationTargetSaveSchema,
    ),
    toolDef(
      PUBLICATION_TARGET_DELETE_TOOL,
      `Propose removing a publishing repository. ${NOTE}`,
      proposePublicationTargetDeleteSchema,
    ),
    toolDef(
      PUBLICATION_DISCARD_TOOL,
      `Propose discarding a publication that is queued, a draft or failed, so it is never sent. ${NOTE}`,
      proposePublicationStateSchema,
    ),
    toolDef(
      PUBLICATION_RETRY_TOOL,
      `Propose trying a failed publication again. ${NOTE}`,
      proposePublicationStateSchema,
    ),
  ]
}

interface TargetRow {
  id: string
  kind: string
  name: string
  base_url: string
  collection: string | null
  license: string
  enabled: boolean
}

async function findTarget(
  context: LabToolContext,
  text: string,
): Promise<Lookup<TargetRow>> {
  const rows = await context.client.list<TargetRow>(
    'publication_targets',
    `?name=ilike.${likeValue(text)}&select=id,kind,name,base_url,collection,license,enabled&order=name.asc&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  return pick(
    rows,
    text,
    'repository',
    (row) => row.name,
    (row) => row.name.toLowerCase() === lower,
  )
}

export async function buildOpenDataProposal(
  name: OpenDataProposeToolName,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw external tool arguments; parsed with the tool's schema before any field is read.
  args: unknown,
  context: LabToolContext,
  search: typeof searchOntologyTerms = searchOntologyTerms,
): Promise<FeatureProposalOutcome> {
  const { client, workspaceId } = context

  switch (name) {
    case ONTOLOGY_LINK_TOOL: {
      const parsed = proposeOntologyLinkSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const settings = await client.rpc<{
        enabled: boolean
        ontologies: string[]
      }>('ontology_settings', { p_workspace_id: workspaceId })

      if (!settings.enabled) {
        return fail(
          'Ontology lookup is off. Propose turning it on first (an admin can also do it in Settings > Open data).',
        )
      }

      const model = await findModel(client, input.model)

      if (!model.ok) return fail(model.message)
      const fields = await fetchModelFields(client, model.value.key)
      const wanted = input.field.trim().toLowerCase()

      const field = pick(
        fields.filter(
          (def) =>
            def.label.toLowerCase().includes(wanted) ||
            def.fieldName.toLowerCase().includes(wanted),
        ),
        input.field,
        `field of ${model.value.name}`,
        (def) => def.label,
        (def) =>
          def.label.toLowerCase() === wanted ||
          def.fieldName.toLowerCase() === wanted,
      )

      if (!field.ok) return fail(field.message)

      const allowed = input.ontology
        ? settings.ontologies.filter(
            (id) => id === input.ontology?.toLowerCase(),
          )
        : settings.ontologies

      if (allowed.length === 0) {
        return fail(
          `${input.ontology} is not one of the ontologies lookup searches (${settings.ontologies.join(', ')}).`,
        )
      }

      let terms: Awaited<ReturnType<typeof searchOntologyTerms>>

      try {
        terms = await search(input.term, allowed)
      } catch (error) {
        return fail(
          error instanceof Error
            ? error.message
            : 'The ontology service did not answer.',
        )
      }

      const termWanted = input.term.trim().toLowerCase()

      const term = pick(
        terms.slice(0, 6),
        input.term,
        'ontology term',
        (hit) =>
          `${hit.label} (${hit.ontology}${hit.shortForm ? `, ${hit.shortForm}` : ''})`,
        (hit) => hit.label.toLowerCase() === termWanted,
      )

      if (!term.ok) return fail(term.message)

      return adminCard(input, {
        tool: name,
        target: `${model.value.name} · ${field.value.label}`,
        deepLink: '/models',
        changes: [
          {
            label: 'Means',
            before: null,
            after: `${term.value.label} (${term.value.ontology.toUpperCase()})`,
          },
        ],
        action: {
          kind: 'open_data.link_term',
          params: {
            p_workspace_id: workspaceId,
            p_target_kind: 'model_field',
            p_target_id: field.value.id,
            p_ontology: term.value.ontology,
            p_iri: term.value.iri,
            p_label: term.value.label,
            p_short_form: term.value.shortForm ?? null,
          },
          openHref: '/models',
        },
      })
    }

    case ONTOLOGY_UNLINK_TOOL: {
      const parsed = proposeOntologyUnlinkSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const like = likeValue(input.term)

      const rows = await client.list<{
        id: string
        label: string
        ontology: string
        short_form: string | null
        target_kind: string
      }>(
        'ontology_annotations',
        `?or=(label.ilike.${like},short_form.ilike.${like})&select=id,label,ontology,short_form,target_kind&order=label.asc&limit=6`,
      )

      const lower = input.term.trim().toLowerCase()

      const found = pick(
        rows,
        input.term,
        'linked term',
        (row) => `${row.label} (${row.ontology})`,
        (row) =>
          row.label.toLowerCase() === lower ||
          row.short_form?.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: `${found.value.label} (${found.value.ontology.toUpperCase()})`,
        deepLink: '/models',
        changes: [
          { label: found.value.label, before: 'Linked', after: 'Unlinked' },
        ],
        action: {
          kind: 'open_data.unlink_term',
          params: { p_annotation_id: found.value.id },
          openHref: '/models',
        },
      })
    }

    case PUBLICATION_TARGET_SAVE_TOOL: {
      const parsed = proposePublicationTargetSaveSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data

      const existing = await context.client.list<TargetRow>(
        'publication_targets',
        `?name=eq.${encodeURIComponent(input.name.trim())}&select=id,kind,name,base_url,collection,license,enabled&limit=1`,
      )

      const current = existing.at(0)
      const kind = input.kind ?? current?.kind
      const baseUrl = input.baseUrl ?? current?.base_url

      if (!kind || !baseUrl) {
        return fail(
          'A new repository needs its kind (zenodo, invenio, figshare or dataverse) and its web address.',
        )
      }

      const next = {
        collection:
          input.collection === undefined
            ? (current?.collection ?? null)
            : input.collection,
        license: input.license ?? current?.license ?? 'cc-by-4.0',
        enabled: input.enabled ?? current?.enabled ?? true,
      }

      const changes: ProposalChange[] = current
        ? (
            [
              ['Kind', current.kind, kind],
              ['Address', current.base_url, baseUrl],
              ['Collection', current.collection ?? '', next.collection ?? ''],
              ['Licence', current.license, next.license],
              ['Enabled', onOff(current.enabled), onOff(next.enabled)],
            ] as const
          ).flatMap(([label, before, after]) =>
            before === after ? [] : [{ label, before, after: after ?? '' }],
          )
        : [
            {
              label: 'Repository',
              before: null,
              after: `${input.name.trim()} (${kind})`,
            },
            { label: 'Address', before: null, after: baseUrl },
            { label: 'Licence', before: null, after: next.license },
          ]

      if (changes.length === 0) {
        return fail(`${input.name.trim()} already is set up that way.`)
      }

      return adminCard(input, {
        tool: name,
        target: input.name.trim(),
        deepLink: HREF,
        changes,
        action: {
          kind: 'open_data.save_target',
          params: {
            p_workspace_id: workspaceId,
            p_id: current?.id ?? null,
            p_kind: kind,
            p_name: input.name.trim(),
            p_base_url: baseUrl,
            p_collection: next.collection,
            p_license: next.license,
            p_enabled: next.enabled,
          },
          openHref: HREF,
        },
      })
    }

    case PUBLICATION_TARGET_DELETE_TOOL: {
      const parsed = proposePublicationTargetDeleteSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const target = await findTarget(context, input.name)

      if (!target.ok) return fail(target.message)

      return adminCard(input, {
        tool: name,
        target: target.value.name,
        deepLink: HREF,
        changes: [
          {
            label: target.value.name,
            before: `${target.value.kind} · ${target.value.base_url}`,
            after: 'Removed',
          },
        ],
        action: {
          kind: 'open_data.delete_target',
          params: { p_id: target.value.id },
          openHref: HREF,
        },
      })
    }

    case PUBLICATION_DISCARD_TOOL:
    case PUBLICATION_RETRY_TOOL: {
      const parsed = proposePublicationStateSchema.safeParse(args)

      if (!parsed.success) return fail(invalid(parsed.error))
      const input = parsed.data
      const retrying = name === PUBLICATION_RETRY_TOOL

      const rows = await client.list<{
        id: string
        title: string
        status: string
        last_error: string | null
      }>(
        'publications',
        `?title=ilike.${likeValue(input.publication)}&status=in.(${retrying ? 'failed' : 'queued,draft,failed'})&select=id,title,status,last_error&order=created_at.desc&limit=6`,
      )

      const lower = input.publication.trim().toLowerCase()

      const found = pick(
        rows,
        input.publication,
        retrying ? 'failed publication' : 'publication you can discard',
        (row) => `${row.title} (${row.status})`,
        (row) => row.title.toLowerCase() === lower,
      )

      if (!found.ok) return fail(found.message)

      return adminCard(input, {
        tool: name,
        target: found.value.title,
        deepLink: HREF,
        changes: [
          {
            label: found.value.title,
            before: found.value.status,
            after: retrying ? 'Try again' : 'Discarded',
          },
        ],
        action: {
          kind: retrying ? 'open_data.retry' : 'open_data.discard',
          params: { p_id: found.value.id },
          openHref: HREF,
        },
      })
    }
  }
}
