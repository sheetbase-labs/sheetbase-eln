/**
 * Drag-to-cite: drop a link from one pane onto the primary pane's notebook and
 * it is cited there. The notebook gets a linked-record block naming the object,
 * and the experiment is linked to it so it shows on its Links tab.
 */
import type { DataClient } from './data-client'
import { fetchRecord } from './notebook-data'
import { insertBlock } from './notebook-mutations'
import { isDuplicateLinkError } from './scientific-records'

/** The part of the app a link points into, and the kind of object it holds. */
const SECTIONS: Record<string, string> = {
  experiments: 'experiment',
  samples: 'sample',
  materials: 'material',
  protocols: 'protocol_template',
  datasets: 'dataset',
  instruments: 'instrument',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CitationTarget {
  kind: string
  /** The path segment naming the object: a display ID or a UUID. */
  reference: string
}

/** What an in-app address points at, or null when it is not an object page. */
export function citationTarget(href: string): CitationTarget | null {
  const [section, reference] = href.split(/[?#]/)[0].split('/').filter(Boolean)
  const kind = section ? SECTIONS[section] : undefined
  return kind && reference ? { kind, reference } : null
}

export interface ResolvedCitation {
  id: string
  kind: string
  identifier: string
  title: string
}

/** Look the target up so the citation carries its identity, not just a URL. */
export async function resolveCitation(
  client: DataClient,
  target: CitationTarget,
): Promise<ResolvedCitation | null> {
  const reference = encodeURIComponent(target.reference)
  if (target.kind === 'dataset') {
    const column = UUID.test(target.reference) ? 'id' : 'display_id'
    const [row] = await client.list<{
      id: string
      display_id: string | null
      name: string
    }>(
      'datasets',
      `?${column}=eq.${reference}&select=id,display_id,name&limit=1`,
    )
    return row
      ? {
          id: row.id,
          kind: 'dataset',
          identifier: row.display_id ?? row.name,
          title: row.name,
        }
      : null
  }
  const column = UUID.test(target.reference) ? 'id' : 'identifier'
  const [row] = await client.list<{
    id: string
    identifier: string
    kind: string
    title: string
  }>(
    'records',
    `?${column}=eq.${reference}&deleted_at=is.null&select=id,identifier,kind,title&limit=1`,
  )
  return row
    ? {
        id: row.id,
        kind: row.kind,
        identifier: row.identifier,
        title: row.title,
      }
    : null
}

export function citationLabel(cited: ResolvedCitation): string {
  return cited.title && cited.title !== cited.identifier
    ? `${cited.identifier} · ${cited.title}`
    : cited.identifier
}

function linkTypeFor(kind: string): string {
  return kind === 'protocol_template' ? 'protocol' : kind
}

/** Cite an object in a notebook. Citing the same object twice adds the block
 * again (the person asked for it) but links it only once. */
export async function citeInNotebook(
  client: DataClient,
  input: { recordId: string; cited: ResolvedCitation },
): Promise<{ blockId: string }> {
  const { cited } = input
  const record = await fetchRecord(client, input.recordId)
  const inserted = await insertBlock(client, {
    recordId: input.recordId,
    type: 'linked_record',
    payload: {
      targetKind: cited.kind,
      targetIdentifier: cited.identifier,
      targetId: cited.id,
      linkType: linkTypeFor(cited.kind),
      label: citationLabel(cited),
    },
    expectedStructureVersion: record?.structureVersion,
  })
  try {
    await client.rpc('create_record_link', {
      p_source_record_id: input.recordId,
      p_target_kind: cited.kind,
      p_target_identifier: cited.identifier,
      p_link_type: linkTypeFor(cited.kind),
      p_target_record_id: cited.kind === 'dataset' ? null : cited.id,
    })
  } catch (error) {
    if (!isDuplicateLinkError(error)) throw error
  }
  return { blockId: inserted.block.id }
}
