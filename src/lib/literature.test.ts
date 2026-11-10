import { describe, expect, it } from 'vitest'

import {
  LiteratureError,
  cleanDoi,
  describePaper,
  parseEuropePmc,
  parseOpenAlex,
  parsePubMed,
  searchLiterature,
} from './literature'
import type { FetchLike } from './literature'

function fakeFetch(
  answers: ReadonlyMap<string, unknown>,
  seen: string[] = [],
): FetchLike {
  return async (url) => {
    seen.push(url)
    const key = [...answers.keys()].find((k) => url.includes(k))

    return key === undefined
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => answers.get(key) }
  }
}

describe('literature search', () => {
  it('cleans DOIs', () => {
    expect(cleanDoi('https://doi.org/10.1000/ABC')).toBe('10.1000/abc')
    expect(cleanDoi('doi: 10.1/x')).toBe('10.1/x')
    expect(cleanDoi(undefined)).toBe('')
  })

  it('reads Europe PMC results', () => {
    const papers = parseEuropePmc({
      resultList: {
        result: [
          {
            title: 'Base <i>editing</i> in cells.',
            authorString: 'Ng A, Lee B.',
            journalTitle: 'Nature',
            pubYear: '2021',
            doi: '10.1/ABC',
            pmid: '123',
            abstractText: '<p>We show &amp; tell.</p>',
          },
          { title: '' },
        ],
      },
    })

    expect(papers).toHaveLength(1)
    expect(papers[0]).toMatchObject({
      title: 'Base editing in cells.',
      authors: ['Ng A', 'Lee B'],
      year: 2021,
      doi: '10.1/abc',
      url: 'https://doi.org/10.1/abc',
      abstract: 'We show & tell.',
    })
  })

  it('reads PubMed summaries', () => {
    const papers = parsePubMed({
      result: {
        uids: ['9'],
        '9': {
          title: 'A paper',
          authors: [{ name: 'Kim C' }],
          fulljournalname: 'Cell',
          pubdate: '2019 Mar',
          articleids: [{ idtype: 'doi', value: '10.2/z' }],
        },
      },
    })

    expect(papers[0]).toMatchObject({
      pmid: '9',
      doi: '10.2/z',
      year: 2019,
      journal: 'Cell',
    })
  })

  it('reads OpenAlex results and rebuilds the abstract', () => {
    const papers = parseOpenAlex({
      results: [
        {
          id: 'https://openalex.org/W1',
          title: 'Third',
          doi: 'https://doi.org/10.3/q',
          publication_year: 2020,
          authorships: [{ author: { display_name: 'Ola' } }],
          abstract_inverted_index: { hello: [0], world: [1] },
          ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/55' },
          primary_location: { source: { display_name: 'Science' } },
        },
      ],
    })

    expect(papers[0]).toMatchObject({
      abstract: 'hello world',
      pmid: '55',
      journal: 'Science',
      doi: '10.3/q',
    })
  })

  it('sends only the phrase and reports failures plainly', async () => {
    const seen: string[] = []

    const papers = await searchLiterature('  base editing  ', {
      fetch: fakeFetch(
        new Map([['europepmc', { resultList: { result: [] } }]]),
        seen,
      ),
    })

    expect(papers).toEqual([])
    expect(seen[0]).toContain('query=base%20editing')
    await expect(
      searchLiterature('x', {
        source: 'openalex',
        fetch: fakeFetch(new Map()),
      }),
    ).rejects.toThrow(LiteratureError)
    await expect(searchLiterature('  ')).rejects.toThrow('few words')
  })

  it('asks PubMed in two steps and skips the second for no hits', async () => {
    const seen: string[] = []

    const none = await searchLiterature('zzz', {
      source: 'pubmed',
      fetch: fakeFetch(
        new Map([['esearch', { esearchresult: { idlist: [] } }]]),
        seen,
      ),
    })

    expect(none).toEqual([])
    expect(seen).toHaveLength(1)
  })

  it('shortens long author lists', () => {
    const line = describePaper({
      title: 't',
      authors: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      journal: '',
      year: null,
      doi: '',
      pmid: '',
      abstract: '',
      url: '',
      source: 'europepmc',
    })

    expect(line.authors).toBe('a, b, c, d, e, f et al.')
  })
})
