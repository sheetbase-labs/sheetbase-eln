import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { context } from '#/lib/assistant-admin-cards.fixture'

import {
  ONTOLOGY_LINK_TOOL,
  ONTOLOGY_UNLINK_TOOL,
  OPEN_DATA_PROPOSE_TOOL_NAMES,
  PUBLICATION_DISCARD_TOOL,
  PUBLICATION_RETRY_TOOL,
  PUBLICATION_TARGET_DELETE_TOOL,
  PUBLICATION_TARGET_SAVE_TOOL,
} from './cards'
import { buildOpenDataProposal, openDataProposalDefs } from './cards.server'

/** Stands in for the ontology service: one hit, always water. */
const search = () =>
  Promise.resolve([
    {
      iri: 'http://purl.obolibrary.org/obo/CHEBI_15377',
      label: 'water',
      ontology: 'chebi',
      shortForm: 'CHEBI_15377',
      description: null,
    },
  ])

const base = { title: 'T', summary: 'S' }

describe('the ontology and publishing cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      openDataProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...OPEN_DATA_PROPOSE_TOOL_NAMES])

    for (const name of OPEN_DATA_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('will not link a term while lookup is off', async () => {
    const result = await buildOpenDataProposal(
      ONTOLOGY_LINK_TOOL,
      { ...base, model: 'Buffer', field: 'Solvent', term: 'water' },
      context({ ontology_settings: { enabled: false, ontologies: [] } }),
    )

    expect(result.ok).toBe(false)
  })

  it('links a model field to the term it found', async () => {
    const result = await buildOpenDataProposal(
      ONTOLOGY_LINK_TOOL,
      { ...base, model: 'Buffer', field: 'Solvent', term: 'water' },
      context({
        ontology_settings: { enabled: true, ontologies: ['chebi'] },
        record_models: [{ id: 'm1', key: 'buffer', name: 'Buffer' }],
        record_model_versions: [
          {
            id: 'v1',
            definition: {
              fields: [
                {
                  id: 'f1',
                  kind: 'buffer',
                  field_name: 'solvent',
                  label: 'Solvent',
                  display_order: 1,
                  logical_type: 'text',
                  nullable: true,
                  validation: {},
                  cardinality: 'single',
                  lifecycle: 'active',
                },
              ],
            },
          },
        ],
      }),
      search,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'open_data.link_term',
      params: {
        p_target_kind: 'model_field',
        p_target_id: 'f1',
        p_iri: 'http://purl.obolibrary.org/obo/CHEBI_15377',
        p_ontology: 'chebi',
      },
    })
  })

  it('unlinks a term found by its label', async () => {
    const result = await buildOpenDataProposal(
      ONTOLOGY_UNLINK_TOOL,
      { ...base, term: 'water' },
      context({
        ontology_annotations: [
          {
            id: 'a1',
            label: 'water',
            ontology: 'chebi',
            short_form: 'CHEBI_15377',
            target_kind: 'model_field',
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'open_data.unlink_term',
      params: { p_annotation_id: 'a1' },
    })
  })

  it('adds a repository, and asks for what a new one needs', async () => {
    const missing = await buildOpenDataProposal(
      PUBLICATION_TARGET_SAVE_TOOL,
      { ...base, name: 'Lab Zenodo' },
      context({}),
    )

    expect(missing.ok).toBe(false)

    const added = await buildOpenDataProposal(
      PUBLICATION_TARGET_SAVE_TOOL,
      {
        ...base,
        name: 'Lab Zenodo',
        kind: 'zenodo',
        baseUrl: 'https://zenodo.org',
      },
      context({}),
    )

    if (!added.ok) throw new Error(added.message)
    expect(added.proposal.action).toMatchObject({
      params: {
        p_id: null,
        p_kind: 'zenodo',
        p_base_url: 'https://zenodo.org',
        p_license: 'cc-by-4.0',
        p_enabled: true,
      },
    })
  })

  it('changes an existing repository by name and shows only what differs', async () => {
    const result = await buildOpenDataProposal(
      PUBLICATION_TARGET_SAVE_TOOL,
      { ...base, name: 'Lab Zenodo', enabled: false },
      context({
        publication_targets: [
          {
            id: 't1',
            kind: 'zenodo',
            name: 'Lab Zenodo',
            base_url: 'https://zenodo.org',
            collection: null,
            license: 'cc-by-4.0',
            enabled: true,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.changes).toEqual([
      { label: 'Enabled', before: 'On', after: 'Off' },
    ])
    expect(result.proposal.action).toMatchObject({ params: { p_id: 't1' } })
  })

  it('removes a repository found by name', async () => {
    const result = await buildOpenDataProposal(
      PUBLICATION_TARGET_DELETE_TOOL,
      { ...base, name: 'Lab Zenodo' },
      context({
        publication_targets: [
          {
            id: 't1',
            kind: 'zenodo',
            name: 'Lab Zenodo',
            base_url: 'https://zenodo.org',
            collection: null,
            license: 'cc-by-4.0',
            enabled: true,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'open_data.delete_target',
      params: { p_id: 't1' },
    })
  })

  it('discards and retries a publication found by its title', async () => {
    const tables = {
      publications: [
        { id: 'p1', title: 'Assay data', status: 'failed', last_error: 'x' },
      ],
    }

    const discard = await buildOpenDataProposal(
      PUBLICATION_DISCARD_TOOL,
      { ...base, publication: 'Assay data' },
      context(tables),
    )

    const retry = await buildOpenDataProposal(
      PUBLICATION_RETRY_TOOL,
      { ...base, publication: 'Assay data' },
      context(tables),
    )

    if (!discard.ok || !retry.ok) throw new Error('not found')
    expect(discard.proposal.action).toMatchObject({
      kind: 'open_data.discard',
      params: { p_id: 'p1' },
    })
    expect(retry.proposal.action).toMatchObject({
      kind: 'open_data.retry',
      params: { p_id: 'p1' },
    })
  })
})
