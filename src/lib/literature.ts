/**
 * Literature search against open indexes: Europe PMC, PubMed and OpenAlex.
 * Only a short search phrase leaves the server, and only when a workspace
 * owner has turned literature search on. Nothing from the workspace is sent.
 * Every call takes the fetch to use so tests never reach the network.
 *
 * The three indexes answer untyped JSON, so each reply is decoded once by a
 * Zod schema at the boundary and the rest of the module works with the decoded
 * rows.
 */
import { z } from 'zod'

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

/** A JSON document as an index sends it, before a schema narrows it. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<JsonValue>
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

const yearField = z.union([z.string(), z.number()]).nullish()
const nameField = z.string().nullish()

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function yearOf(value: string | number | null | undefined): number | null {
  const match = /(\d{4})/.exec(String(value ?? ''))

  return match ? Number(match[1]) : null
}

/** A DOI without its resolver prefix, lower case, or an empty string. */
export function cleanDoi(value: string | null | undefined): string {
  return trimmed(value)
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

const europePmcRow = z.object({
  title: nameField,
  doi: nameField,
  pmid: nameField,
  id: nameField,
  source: nameField,
  authorString: nameField,
  journalTitle: nameField,
  journalInfo: z.object({ journal: nameField }).nullish(),
  pubYear: yearField,
  abstractText: nameField,
})

const europePmcResponse = z.object({
  resultList: z.object({ result: z.array(z.unknown()).nullish() }).nullish(),
})

export function parseEuropePmc(body: JsonValue): Paper[] {
  const payload = europePmcResponse.safeParse(body)

  if (!payload.success) return []
  const rows = payload.data.resultList?.result ?? []

  return rows
    .map((raw): Paper | null => {
      const decoded = europePmcRow.safeParse(raw)

      if (!decoded.success) return null
      const row = decoded.data
      const title = stripTags(trimmed(row.title))

      if (!title) return null
      const doi = cleanDoi(row.doi)
      const pmid = trimmed(row.pmid)
      const id = trimmed(row.id)
      const src = trimmed(row.source)

      return {
        title,
        authors: trimmed(row.authorString)
          .replace(/\.$/, '')
          .split(/,\s*/)
          .filter(Boolean),
        journal: trimmed(row.journalTitle) || trimmed(row.journalInfo?.journal),
        year: yearOf(row.pubYear),
        doi,
        pmid,
        abstract: clip(stripTags(trimmed(row.abstractText))),
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

const pubmedRow = z.object({
  title: nameField,
  articleids: z
    .array(z.object({ idtype: nameField, value: nameField }))
    .nullish(),
  authors: z.array(z.object({ name: nameField })).nullish(),
  fulljournalname: nameField,
  source: nameField,
  pubdate: yearField,
})

const pubmedResponse = z.object({
  result: z
    .looseObject({ uids: z.array(z.coerce.string()).nullish() })
    .nullish(),
})

export function parsePubMed(summary: JsonValue): Paper[] {
  const payload = pubmedResponse.safeParse(summary)

  if (!payload.success) return []
  const result = payload.data.result
  const ids = result?.uids ?? []

  return ids
    .map((id): Paper | null => {
      const decoded = pubmedRow.safeParse(result?.[id])

      if (!decoded.success) return null
      const row = decoded.data
      const title = stripTags(trimmed(row.title))

      if (!title) return null
      const articleIds = row.articleids ?? []

      const doi = cleanDoi(
        articleIds.find((entry) => trimmed(entry.idtype) === 'doi')?.value,
      )

      return {
        title,
        authors: (row.authors ?? [])
          .map((author) => trimmed(author.name))
          .filter(Boolean),
        journal: trimmed(row.fulljournalname) || trimmed(row.source),
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

const abstractIndex = z.record(z.string(), z.array(z.number()))

function openAlexAbstract(
  index: Record<string, number[]> | null | undefined,
): string {
  const words: string[] = []

  for (const [word, positions] of Object.entries(index ?? {})) {
    for (const position of positions) words[position] = word
  }

  return clip(words.filter(Boolean).join(' '))
}

const openAlexRow = z.object({
  title: nameField,
  display_name: nameField,
  doi: nameField,
  ids: z.object({ pmid: nameField }).nullish(),
  authorships: z
    .array(
      z.object({ author: z.object({ display_name: nameField }).nullish() }),
    )
    .nullish(),
  primary_location: z
    .object({ source: z.object({ display_name: nameField }).nullish() })
    .nullish(),
  publication_year: yearField,
  abstract_inverted_index: abstractIndex.nullish(),
  id: nameField,
})

const openAlexResponse = z.object({
  results: z.array(z.unknown()).nullish(),
})

export function parseOpenAlex(body: JsonValue): Paper[] {
  const payload = openAlexResponse.safeParse(body)

  if (!payload.success) return []
  const rows = payload.data.results ?? []

  return rows
    .map((raw): Paper | null => {
      const decoded = openAlexRow.safeParse(raw)

      if (!decoded.success) return null
      const row = decoded.data
      const title = stripTags(trimmed(row.title) || trimmed(row.display_name))

      if (!title) return null
      const doi = cleanDoi(row.doi)
      const pmid = trimmed(row.ids?.pmid).replace(/^.*\/(\d+)\/?$/, '$1')

      return {
        title,
        authors: (row.authorships ?? [])
          .map((authorship) => trimmed(authorship.author?.display_name))
          .filter(Boolean)
          .slice(0, 20),
        journal: trimmed(row.primary_location?.source?.display_name),
        year: yearOf(row.publication_year),
        doi,
        pmid: /^\d+$/.test(pmid) ? pmid : '',
        abstract: openAlexAbstract(row.abstract_inverted_index),
        url: doi ? `https://doi.org/${doi}` : trimmed(row.id),
        source: 'openalex',
      }
    })
    .filter((p): p is Paper => p !== null)
}

const pubmedSearch = z.object({
  esearchresult: z
    .object({ idlist: z.array(z.coerce.string()).nullish() })
    .nullish(),
})

async function getJson(
  fetchFn: FetchLike,
  url: string,
  label: string,
): Promise<JsonValue> {
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
    const found = pubmedSearch.safeParse(
      await getJson(
        fetchFn,
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${q}`,
        LABELS[source],
      ),
    )

    const ids = found.success ? (found.data.esearchresult?.idlist ?? []) : []

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
export interface PaperSummary {
  title: string
  authors: string
  journal: string
  year: number | null
  doi: string
  link: string
  abstract: string
  source: string
}

export function describePaper(paper: Paper): PaperSummary {
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
