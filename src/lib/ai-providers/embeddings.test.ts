import { describe, expect, it } from 'vitest'

import {
  EMBEDDING_DIMENSIONS,
  buildEmbeddingRequest,
  embedTexts,
  fitVector,
  parseEmbeddingResponse,
} from './embeddings'
import type { ProviderProfile } from './types'

const profile: ProviderProfile = {
  id: 'local-embed',
  label: 'Local',
  kind: 'local',
  baseUrl: 'http://localhost:11434/v1',
  model: 'chat',
  embeddingModel: 'nomic-embed-text',
  pricing: {
    inputMicrousdPerMillionTokens: 0,
    outputMicrousdPerMillionTokens: 0,
  },
}

describe('fitVector', () => {
  it('pads with zeros and scales to unit length', () => {
    const out = fitVector([3, 4], 'p')
    expect(out).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(out[0]).toBeCloseTo(0.6)
    expect(out[1]).toBeCloseTo(0.8)
    expect(out[2]).toBe(0)
  })

  it('projects a wider vector to the stored width, keeping similarity', () => {
    const base = Array.from({ length: 3072 }, (_, i) => Math.sin(i * 0.37))
    const near = base.map((v, i) => v + 0.05 * Math.cos(i))
    const far = Array.from({ length: 3072 }, (_, i) => Math.cos(i * 1.91 + 1))
    const [a, b, c] = [base, near, far].map((v) => fitVector(v, 'p'))
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS)
    const dot = (x: number[], y: number[]) =>
      x.reduce((sum, v, i) => sum + v * y[i], 0)
    expect(dot(a, a)).toBeCloseTo(1)
    expect(dot(a, b)).toBeGreaterThan(0.9)
    expect(dot(a, b)).toBeGreaterThan(dot(a, c))
    expect(fitVector(base, 'p')).toEqual(a)
  })

  it('refuses values that are not numbers', () => {
    expect(() => fitVector([1, Number.NaN], 'p')).toThrow(/not a number/)
  })
})

describe('buildEmbeddingRequest', () => {
  it('asks for the stored width from endpoints that can shorten', () => {
    expect(
      buildEmbeddingRequest({ ...profile, kind: 'openai-compatible' }, ['a']),
    ).toMatchObject({
      dimensions: EMBEDDING_DIMENSIONS,
      model: 'nomic-embed-text',
    })
    expect(buildEmbeddingRequest(profile, ['a'])).not.toHaveProperty(
      'dimensions',
    )
  })
})

describe('parseEmbeddingResponse', () => {
  it('orders vectors by index and reports usage', () => {
    const out = parseEmbeddingResponse(profile, ['a', 'b'], {
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
      usage: { total_tokens: 7 },
    })

    expect(out.vectors[0][0]).toBe(1)
    expect(out.vectors[1][1]).toBe(1)
    expect(out.tokens).toBe(7)
  })

  it('rejects a response that does not match the request', () => {
    expect(() =>
      parseEmbeddingResponse(profile, ['a', 'b'], { data: [] }),
    ).toThrow(/did not match/)
  })
})

describe('embedTexts', () => {
  it('posts to the embeddings endpoint with the key', async () => {
    let seen: { url: string; auth: string | null; body: unknown } | null = null

    const fetchImpl: typeof fetch = async (url, init) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)),
      }

      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }),
        { status: 200 },
      )
    }

    const out = await embedTexts(profile, 'secret', ['hello'], { fetchImpl })
    expect(seen).toMatchObject({
      url: 'http://localhost:11434/v1/embeddings',
      auth: 'Bearer secret',
      body: { input: ['hello'], model: 'nomic-embed-text' },
    })
    expect(out.vectors).toHaveLength(1)
  })

  it('refuses a profile without an embedding model', async () => {
    await expect(
      embedTexts({ ...profile, embeddingModel: undefined }, undefined, ['a']),
    ).rejects.toThrow(/not set up for embeddings/)
  })

  it('does not echo the provider body on an error', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('secret prompt echo', { status: 500 })

    await expect(
      embedTexts(profile, undefined, ['a'], { fetchImpl }),
    ).rejects.toThrow('Provider returned an error status')
  })
})
