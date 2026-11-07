import { describe, expect, it } from 'vitest'

import { olsSearchUrl, parseOlsResponse, searchOntologyTerms } from './ols'

const body = {
  response: {
    docs: [
      {
        iri: 'http://purl.obolibrary.org/obo/CHEBI_15377',
        label: 'water',
        ontology_name: 'CHEBI',
        short_form: 'CHEBI_15377',
        description: ['A oxygen hydride.'],
      },
      {
        iri: 'http://purl.obolibrary.org/obo/CHEBI_15377',
        label: 'water',
        ontology_name: 'chebi',
      },
      { iri: 'javascript:alert(1)', label: 'bad', ontology_name: 'x' },
      { label: 'no iri', ontology_name: 'x' },
    ],
  },
}

describe('ontology search', () => {
  it('builds a search limited to the allowed ontologies', () => {
    const url = new URL(olsSearchUrl('water', ['chebi', 'obi']))
    expect(url.searchParams.get('ontology')).toBe('chebi,obi')
    expect(url.searchParams.get('q')).toBe('water')
    expect(url.searchParams.get('obsoletes')).toBe('false')
  })

  it('keeps only http terms, once each, in lowercase ontology ids', () => {
    expect(parseOlsResponse(body)).toEqual([
      {
        iri: 'http://purl.obolibrary.org/obo/CHEBI_15377',
        label: 'water',
        ontology: 'chebi',
        shortForm: 'CHEBI_15377',
        description: 'A oxygen hydride.',
      },
    ])
    expect(parseOlsResponse(null)).toEqual([])
  })

  it('does not call the service for a one-letter query', async () => {
    let called = false
    const terms = await searchOntologyTerms('a', ['obi'], {
      fetch: async () => {
        called = true
        return { ok: true, status: 200, json: async () => body }
      },
    })
    expect(terms).toEqual([])
    expect(called).toBe(false)
  })

  it('reports a failing service', async () => {
    await expect(
      searchOntologyTerms('water', ['obi'], {
        fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      }),
    ).rejects.toThrow(/503/)
  })
})
