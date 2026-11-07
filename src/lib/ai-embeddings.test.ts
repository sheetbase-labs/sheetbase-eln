import { describe, expect, it } from 'vitest'

import {
  CHUNK_TARGET_CHARS,
  MAX_CHUNKS_PER_OBJECT,
  chunkDocument,
  fuseRankings,
  toSemanticHit,
  vectorArg,
} from './ai-embeddings'

const doc = (body: string) => ({
  title: 'Western blot transfer',
  identifier: 'EXP-12',
  kind: 'experiment',
  body,
})

describe('chunkDocument', () => {
  it('keeps a short document in one chunk headed by its name', () => {
    const chunks = chunkDocument(doc('Transfer at 100 V for 60 minutes.'))
    expect(chunks).toEqual([
      {
        chunkNo: 0,
        text: 'EXP-12 · Western blot transfer\nTransfer at 100 V for 60 minutes.',
      },
    ])
  })

  it('makes a document with no body findable by its name', () => {
    expect(chunkDocument(doc(''))).toEqual([
      { chunkNo: 0, text: 'EXP-12 · Western blot transfer' },
    ])
  })

  it('returns nothing for a document with nothing in it', () => {
    expect(
      chunkDocument({ title: '', identifier: '', kind: '', body: '' }),
    ).toEqual([])
  })

  it('cuts long text at sentence ends with overlap and a heading on each chunk', () => {
    const sentence = 'The membrane was blocked in five percent milk. '
    const chunks = chunkDocument(doc(sentence.repeat(200)))
    expect(chunks.length).toBeGreaterThan(5)
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('EXP-12 · Western blot transfer\n')).toBe(
        true,
      )
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + 50)
    }
    expect(chunks.map((c) => c.chunkNo)).toEqual(chunks.map((_, i) => i))
  })

  it('stops at the per-object ceiling', () => {
    const chunks = chunkDocument(doc('word '.repeat(60_000)))
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_OBJECT)
  })
})

describe('fuseRankings', () => {
  const a = { type: 'record', id: 'a' }
  const b = { type: 'record', id: 'b' }
  const c = { type: 'record', id: 'c' }

  it('puts what both rankings like above what only one likes', () => {
    const fused = fuseRankings(
      [
        [a, b],
        [c, b],
      ],
      10,
    )
    expect(fused[0]!.item).toEqual(b)
    expect(fused[0]!.sources).toBe(2)
  })

  it('keeps the same id of a different type apart', () => {
    const fused = fuseRankings(
      [[{ type: 'file', id: 'a' }], [{ type: 'record', id: 'a' }]],
      10,
    )
    expect(fused).toHaveLength(2)
  })

  it('honours the limit', () => {
    expect(fuseRankings([[a, b, c]], 2)).toHaveLength(2)
  })
})

describe('toSemanticHit', () => {
  it('strips the heading from the passage and clamps similarity', () => {
    const hit = toSemanticHit({
      object_type: 'record',
      object_id: 'x',
      title: 'T',
      identifier: 'EXP-1',
      kind: 'experiment',
      status: 'draft',
      archived: false,
      deep_link: '/records/x',
      project_id: null,
      parent_type: null,
      parent_id: null,
      passage: 'EXP-1 · T\nline one\nline two',
      chunk_no: 0,
      similarity: 1.0000001,
    })
    expect(hit.passage).toBe('line one line two')
    expect(hit.similarity).toBe(1)
  })
})

describe('vectorArg', () => {
  it('rounds so the request stays small', () => {
    expect(vectorArg([0.123456789, 1])).toEqual([0.123457, 1])
  })
})
