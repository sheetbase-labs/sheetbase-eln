import { z } from 'zod'

import type { RpcCardAction } from '#/lib/assistant-admin-cards'

/**
 * Ontology links and publishing from the assistant. Each is a card that says
 * what will change and does nothing until the person presses it. The button
 * calls the ordinary RPC as them. A repository's access token is never
 * handled here: it is set at the settings page.
 */

export const ONTOLOGY_LINK_TOOL = 'sheetbase.ontology.link'
export const ONTOLOGY_UNLINK_TOOL = 'sheetbase.ontology.unlink'
export const PUBLICATION_TARGET_SAVE_TOOL = 'sheetbase.publication.save_target'

export const PUBLICATION_TARGET_DELETE_TOOL =
  'sheetbase.publication.delete_target'

export const PUBLICATION_DISCARD_TOOL = 'sheetbase.publication.discard'
export const PUBLICATION_RETRY_TOOL = 'sheetbase.publication.retry'

export const OPEN_DATA_PROPOSE_TOOL_NAMES: readonly string[] = [
  ONTOLOGY_LINK_TOOL,
  ONTOLOGY_UNLINK_TOOL,
  PUBLICATION_TARGET_SAVE_TOOL,
  PUBLICATION_TARGET_DELETE_TOOL,
  PUBLICATION_DISCARD_TOOL,
  PUBLICATION_RETRY_TOOL,
]

export type OpenDataProposeToolName =
  | typeof ONTOLOGY_LINK_TOOL
  | typeof ONTOLOGY_UNLINK_TOOL
  | typeof PUBLICATION_TARGET_SAVE_TOOL
  | typeof PUBLICATION_TARGET_DELETE_TOOL
  | typeof PUBLICATION_DISCARD_TOOL
  | typeof PUBLICATION_RETRY_TOOL

/** The RPC each card runs. */
export const OPEN_DATA_RPC = {
  'open_data.link_term': 'link_ontology_term',
  'open_data.unlink_term': 'unlink_ontology_term',
  'open_data.save_target': 'save_publication_target',
  'open_data.delete_target': 'delete_publication_target',
  'open_data.discard': 'discard_publication',
  'open_data.retry': 'retry_publication',
} as const

export type OpenDataAction = RpcCardAction<keyof typeof OPEN_DATA_RPC>

const ACTIONS: ReadonlySet<string> = new Set(Object.keys(OPEN_DATA_RPC))

export function isOpenDataAction(action: {
  kind: string
}): action is OpenDataAction {
  return ACTIONS.has(action.kind)
}

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeOntologyLinkSchema = z.strictObject({
  title,
  summary,
  model: z
    .string()
    .min(1)
    .max(200)
    .describe('The record type the field belongs to, by name or key.'),
  field: z.string().min(1).max(200).describe('The field, by its label.'),
  term: z
    .string()
    .min(2)
    .max(200)
    .describe('What the field means, searched for in the ontologies.'),
  ontology: z
    .string()
    .max(40)
    .optional()
    .describe('Limit the search to one ontology, by id (obi, chebi, cl).'),
})

export const proposeOntologyUnlinkSchema = z.strictObject({
  title,
  summary,
  term: z
    .string()
    .min(1)
    .max(200)
    .describe('The linked term to remove, by its label or short id.'),
})

export const REPOSITORY_KINDS = [
  'zenodo',
  'invenio',
  'figshare',
  'dataverse',
] as const

export const proposePublicationTargetSaveSchema = z.strictObject({
  title,
  summary,
  name: z
    .string()
    .min(1)
    .max(80)
    .describe(
      'A name people recognise. An existing repository with this name is changed.',
    ),
  kind: z.enum(REPOSITORY_KINDS).optional(),
  baseUrl: z
    .string()
    .regex(/^https?:\/\/\S+$/)
    .max(300)
    .optional()
    .describe('The repository’s web address.'),
  collection: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe('Dataverse alias or InvenioRDM community.'),
  license: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.+-]{0,39}$/)
    .optional()
    .describe('Default licence id, for example cc-by-4.0.'),
  enabled: z.boolean().optional(),
})

export const proposePublicationTargetDeleteSchema = z.strictObject({
  title,
  summary,
  name: z.string().min(1).max(80).describe('The repository, by name.'),
})

export const proposePublicationStateSchema = z.strictObject({
  title,
  summary,
  publication: z
    .string()
    .min(1)
    .max(200)
    .describe('The publication, by its title.'),
})
