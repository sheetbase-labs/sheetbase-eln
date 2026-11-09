/**
 * Literature search against open indexes: Europe PMC, PubMed and OpenAlex.
 * Only a short search phrase leaves the server, and only when a workspace
 * owner has turned literature search on. Nothing from the workspace is sent.
 * Every call takes the fetch to use so tests never reach the network.
 */

export const LITERATURE_SOURCES = ['europepmc', 'pubmed', 'openalex'] as const

export type LiteratureSource = (typeof LITERATURE_SOURCES)[number]

export interface Paper {
  title: string
  authors: string[]
  journal: string
  year: number | null
  doi: string
  pmid: string
  abstract: string
  url: string
  source: LiteratureSource
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export interface LiteratureOptions {
  source?: LiteratureSource
  limit?: number
  fetch?: FetchLike
  /** Optional OpenAlex key and contact address; never required. */
  openAlexKey?: string | undefined
  contact?: string | undefined
}

export class LiteratureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiteratureError'
  }
}

const TIMEOUT_MS = 12_000
const DEFAULT_LIMIT = 6
const MAX_LIMIT = 15

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function yearOf(value: unknown): number | null {
  const match = /(\d{4})/.exec(
    typeof value === 'number' ? `${value}` : text(value),
  )

  return match ? Number(match[1]) : null
}

/** A DOI without its resolver prefix, lower case, or an empty string. */
export function cleanDoi(value: unknown): string {
  return text(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase()
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(value: string, max = 1500): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

export function parseEuropePmc(body: unknown): Paper[] {
  const results = list(obj(obj(body).resultList).result)

  return results
    .map((raw): Paper | null => {
      const row = obj(raw)
      const title = stripTags(text(row.title))

      if (!title) return null
      const doi = cleanDoi(row.doi)
      const pmid = text(row.pmid)
      const id = text(row.id)
      const src = text(row.source)

      return {
        title,
        authors: text(row.authorString)
          .replace(/\.$/, '')
          .split(/,\s*/)
          .filter(Boolean),
        journal: text(row.journalTitle) || text(obj(row.journalInfo).journal),
        year: yearOf(row.pubYear),
        doi,
        pmid,
        abstract: clip(stripTags(text(row.abstractText))),
        url: doi
          ? `https://doi.org/${doi}`
          : id && src
            ? `https://europepmc.org/article/${src}/${id}`
            : '',
        source: 'europepmc',
      }
    })
    .filter((p): p is Paper => p !== null)
}

export function parsePubMed(summary: unknown): Paper[] {
  const result = obj(obj(summary).result)
  const ids = list(result.uids).map(String)

  return ids
    .map((id): Paper | null => {
      const row = obj(result[id])
      const title = stripTags(text(row.title))

      if (!title) return null
      const articleIds = list(row.articleids).map(obj)

      const doi = cleanDoi(
        articleIds.find((entry) => text(entry.idtype) === 'doi')?.value,
      )

      return {
        title,
        authors: list(row.authors)
          .map((a) => text(obj(a).name))
          .filter(Boolean),
        journal: text(row.fulljournalname) || text(row.source),
        year: yearOf(row.pubdate),
        doi,
        pmid: id,
        abstract: '',
        url: doi
          ? `https://doi.org/${doi}`
          : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: 'pubmed',
      }
    })
    .filter((p): p is Paper => p !== null)
}

function openAlexAbstract(index: unknown): string {
  const words: string[] = []

  for (const [word, positions] of Object.entries(obj(index))) {
    for (const position of list(positions)) {
      if (typeof position === 'number') words[position] = word
    }
  }

  return clip(words.filter(Boolean).join(' '))
}

export function parseOpenAlex(body: unknown): Paper[] {
  return list(obj(body).results)
    .map((raw): Paper | null => {
      const row = obj(raw)
      const title = stripTags(text(row.title) || text(row.display_name))

      if (!title) return null
      const doi = cleanDoi(row.doi)
      const ids = obj(row.ids)
      const pmid = text(ids.pmid).replace(/^.*\/(\d+)\/?$/, '$1')

      return {
        title,
        authors: list(row.authorships)
          .map((a) => text(obj(obj(a).author).display_name))
          .filter(Boolean)
          .slice(0, 20),
        journal: text(obj(obj(row.primary_location).source).display_name),
        year: yearOf(row.publication_year),
        doi,
        pmid: /^\d+$/.test(pmid) ? pmid : '',
        abstract: openAlexAbstract(row.abstract_inverted_index),
        url: doi ? `https://doi.org/${doi}` : text(row.id),
        source: 'openalex',
      }
    })
    .filter((p): p is Paper => p !== null)
}

async function getJson(
  fetchFn: FetchLike,
  url: string,
  label: string,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new LiteratureError(
        `${label} did not answer (HTTP ${response.status}). Try again in a moment or choose another source.`,
      )
    }

    return await response.json()
  } catch (error) {
    if (error instanceof LiteratureError) throw error
    throw new LiteratureError(
      `${label} could not be reached. Try again in a moment or choose another source.`,
    )
  } finally {
    clearTimeout(timer)
  }
}

const LABELS: Record<LiteratureSource, string> = {
  europepmc: 'Europe PMC',
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
}

export function literatureSourceLabel(source: LiteratureSource): string {
  return LABELS[source]
}

/** Search one index for papers. The phrase is the only thing sent. */
export async function searchLiterature(
  query: string,
  options: LiteratureOptions = {},
): Promise<Paper[]> {
  const phrase = query.trim().slice(0, 300)

  if (!phrase) throw new LiteratureError('Give a few words to search for.')
  const source = options.source ?? 'europepmc'
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const fetchFn: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init))

  const q = encodeURIComponent(phrase)

  if (source === 'europepmc') {
    const body = await getJson(
      fetchFn,
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&format=json&resultType=core&pageSize=${limit}&sort=RELEVANCE`,
      LABELS[source],
    )

    return parseEuropePmc(body)
  }

  if (source === 'pubmed') {
    const found = obj(
      await getJson(
        fetchFn,
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${q}`,
        LABELS[source],
      ),
    )

    const ids = list(obj(found.esearchresult).idlist).map(String)

    if (ids.length === 0) return []

    const summary = await getJson(
      fetchFn,
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
      LABELS[source],
    )

    return parsePubMed(summary)
  }

  const extra = [
    options.openAlexKey
      ? `&api_key=${encodeURIComponent(options.openAlexKey)}`
      : '',
    options.contact ? `&mailto=${encodeURIComponent(options.contact)}` : '',
  ].join('')

  const body = await getJson(
    fetchFn,
    `https://api.openalex.org/works?search=${q}&per-page=${limit}${extra}`,
    LABELS[source],
  )

  return parseOpenAlex(body)
}

/** What the assistant and API return: a short, citable line per paper. */
export function describePaper(paper: Paper): Record<string, unknown> {
  return {
    title: paper.title,
    authors:
      paper.authors.slice(0, 6).join(', ') +
      (paper.authors.length > 6 ? ' et al.' : ''),
    journal: paper.journal,
    year: paper.year,
    doi: paper.doi,
    link: paper.url,
    abstract: paper.abstract,
    source: LABELS[paper.source],
  }
}
