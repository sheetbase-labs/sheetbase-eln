/**
 * Search by meaning: what gets read into vectors, how text is cut up, and how
 * the two kinds of ranking are merged. Pure functions only; the job that calls
 * the provider is `embedding-index.server.ts` and the query side is
 * `semantic-search.server.ts`.
 */

import type { SearchResultType } from './search'

/** Kinds of object whose text is embedded (matches internal.semantic_object_types). */
export const SEMANTIC_OBJECT_TYPES = [
  'record',
  'file',
  'dataset',
  'sheet',
  'template',
  'comment',
  'project',
  'analysis',
  'deviation',
] as const satisfies readonly SearchResultType[]

/** About 300 words: enough context to mean something, small enough to match one idea. */
export const CHUNK_TARGET_CHARS = 1400

/** Overlap so an idea that straddles a cut is still whole in one chunk. */
export const CHUNK_OVERLAP_CHARS = 200

/** Cost bound per object: the first ~60 000 characters. */
export const MAX_CHARS_PER_OBJECT = 60_000
export const MAX_CHUNKS_PER_OBJECT = 48

/** Below this similarity a hit is noise, not a match. */
export const MIN_SIMILARITY = 0.25

export interface TextChunk {
  chunkNo: number
  text: string
}

/** What the indexer reads of one search document. */
export interface EmbeddableDocument {
  title: string
  identifier: string
  kind: string
  body: string
}

/** The words every chunk of an object starts with, so a vector knows what it belongs to. */
export function chunkHeading(doc: EmbeddableDocument): string {
  const words: string[] = []

  for (const part of [doc.identifier, doc.title]) {
    const trimmed = part.trim()

    if (trimmed) words.push(trimmed)
  }

  return words.join(' · ')
}

/**
 * Cut a document into overlapping chunks at paragraph, sentence or word
 * boundaries. Every chunk carries the heading; a document with no body is one
 * chunk holding just its heading, so it can still be found by name.
 */
export function chunkDocument(doc: EmbeddableDocument): TextChunk[] {
  const heading = chunkHeading(doc)

  const body = doc.body
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS_PER_OBJECT)

  if (body === '') return heading === '' ? [] : [{ chunkNo: 0, text: heading }]

  const room = Math.max(200, CHUNK_TARGET_CHARS - heading.length - 2)
  const pieces: string[] = []
  let start = 0

  while (start < body.length && pieces.length < MAX_CHUNKS_PER_OBJECT) {
    let end = Math.min(body.length, start + room)

    if (end < body.length) {
      const window = body.slice(start, end)

      const cut = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('\n'),
      )

      if (cut > room * 0.5) end = start + cut + 1
      else {
        const space = window.lastIndexOf(' ')

        if (space > room * 0.5) end = start + space
      }
    }

    const piece = body.slice(start, end).trim()

    if (piece !== '') pieces.push(piece)

    if (end >= body.length) break
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1)
  }

  return pieces.map((piece, chunkNo) => ({
    chunkNo,
    text: heading === '' ? piece : `${heading}\n${piece}`,
  }))
}

/** One hit from api.semantic_search / api.similar_work. */
export interface SemanticHitWire {
  object_type: SearchResultType
  object_id: string
  title: string
  identifier: string
  kind: string
  status: string
  archived: boolean
  deep_link: string
  project_id: string | null
  parent_type: string | null
  parent_id: string | null
  passage: string
  chunk_no: number
  similarity: number
}

export interface SemanticHit {
  type: SearchResultType
  id: string
  title: string
  identifier: string
  kind: string
  status: string
  archived: boolean
  deepLink: string
  projectId: string | null
  parentType: string | null
  parentId: string | null
  /** The passage that matched, with the heading stripped. */
  passage: string
  /** 0 to 1, higher is closer. */
  similarity: number
}

export function toSemanticHit(row: SemanticHitWire): SemanticHit {
  const lines = row.passage.split('\n')

  // Chunks open with "IDENTIFIER · Title"; the passage is what follows.
  const passage = (lines.length > 1 ? lines.slice(1).join(' ') : row.passage)
    .replace(/\s+/g, ' ')
    .trim()

  return {
    type: row.object_type,
    id: row.object_id,
    title: row.title,
    identifier: row.identifier,
    kind: row.kind,
    status: row.status,
    archived: row.archived,
    deepLink: row.deep_link,
    projectId: row.project_id,
    parentType: row.parent_type,
    parentId: row.parent_id,
    passage: passage.length > 320 ? `${passage.slice(0, 317)}…` : passage,
    similarity: Math.max(0, Math.min(1, row.similarity)),
  }
}

export interface RankedKey {
  type: string
  id: string
}

const RRF_K = 60

/**
 * Reciprocal-rank fusion of any number of ranked lists. An object near the top
 * of both the word search and the meaning search beats one that tops only one;
 * ranks, not scores, are merged because the two scores are not comparable.
 */
export function fuseRankings<T extends RankedKey>(
  lists: readonly (readonly T[])[],
  limit: number,
): Array<{ item: T; score: number; sources: number }> {
  const merged = new Map<string, { item: T; score: number; sources: number }>()

  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = `${item.type}:${item.id}`
      const entry = merged.get(key) ?? { item, score: 0, sources: 0 }
      entry.score += 1 / (RRF_K + rank + 1)
      entry.sources += 1
      merged.set(key, entry)
    })
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

/** The query vector goes over the wire as a plain array. */
export function vectorArg(vector: readonly number[]): number[] {
  return vector.map((value) => Math.round(value * 1e6) / 1e6)
}

export interface SemanticSettings {
  enabled: boolean
  profile: string | null
  literatureEnabled: boolean
  indexedDocuments: number
  totalDocuments: number
}
