/**
 * Ontology terms from the EBI Ontology Lookup Service (OLS4), so a field or a
 * vocabulary term can say which OBI, ChEBI, CL, UBERON, NCBITaxon or UO term it
 * means. Looking terms up is the only thing that leaves the install, and only
 * after an admin turns it on (Settings > Open data): the words typed in the
 * picker go to www.ebi.ac.uk, nothing else does.
 */
import { z } from 'zod'

export const OLS_SEARCH_URL = 'https://www.ebi.ac.uk/ols4/api/search'

/** The ontologies the picker offers when the workspace has not chosen. */
export const DEFAULT_ONTOLOGIES = [
  'obi',
  'chebi',
  'cl',
  'uberon',
  'ncbitaxon',
  'uo',
] as const

export const ONTOLOGY_NAMES = {
  obi: 'Ontology for Biomedical Investigations',
  chebi: 'Chemical Entities of Biological Interest',
  cl: 'Cell Ontology',
  uberon: 'Uberon anatomy',
  ncbitaxon: 'NCBI organisms',
  uo: 'Units of Measurement',
  efo: 'Experimental Factor Ontology',
  go: 'Gene Ontology',
  bao: 'BioAssay Ontology',
  clo: 'Cell Line Ontology',
  bto: 'BRENDA Tissue Ontology',
  pato: 'Phenotype and Trait Ontology',
} satisfies Record<string, string>

export interface OntologyTerm {
  iri: string
  label: string
  /** Lowercase ontology id, e.g. `chebi`. */
  ontology: string
  /** Short id such as `CHEBI_15377`. */
  shortForm: string | null
  description: string | null
}

/** How the service spells a term's description: one string, or a list of them. */
const olsDescription = z
  .union([z.string(), z.array(z.unknown())])
  .nullish()
  .catch(null)

/** One search hit, decoded at the service boundary. */
const olsDoc = z.object({
  iri: z.string().regex(/^https?:\/\//),
  label: z.string(),
  ontology_name: z.string(),
  short_form: z.string().nullish().catch(null),
  description: olsDescription,
})

/** The envelope the OLS search API answers with. */
const olsResponse = z.object({
  response: z.object({ docs: z.array(z.unknown()) }).nullish(),
})

/** The body the service answers with, before `parseOlsResponse` decodes it. */
export type OlsResponseBody = z.input<typeof olsResponse>

export type OlsFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<OlsResponseBody>
}>

/** The first description the service gave for a term, cut to a card's length. */
function descriptionOf(
  description: z.infer<typeof olsDescription>,
): string | null {
  const candidates = Array.isArray(description) ? description : [description]

  for (const candidate of candidates) {
    const text = z.string().safeParse(candidate).data

    if (text !== undefined) return text ? text.slice(0, 400) : null
  }

  return null
}

export function olsSearchUrl(
  query: string,
  ontologies: readonly string[],
  rows = 15,
): string {
  const params = new URLSearchParams({
    q: query,
    rows: String(Math.min(Math.max(rows, 1), 30)),
    // Obsolete terms are not worth linking to.
    obsoletes: 'false',
    fieldList: 'iri,label,ontology_name,short_form,description',
  })

  if (ontologies.length > 0) params.set('ontology', ontologies.join(','))

  return `${OLS_SEARCH_URL}?${params.toString()}`
}

export function parseOlsResponse(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The ontology service's JSON is untyped; this is the decoder that reads it into OntologyTerm rows.
  body: unknown,
): OntologyTerm[] {
  const envelope = olsResponse.safeParse(body)

  if (!envelope.success) return []
  const docs = envelope.data.response?.docs ?? []
  const out: OntologyTerm[] = []
  const seen = new Set<string>()

  for (const raw of docs) {
    const decoded = olsDoc.safeParse(raw)

    if (!decoded.success) continue
    const doc = decoded.data

    if (seen.has(doc.iri)) continue
    seen.add(doc.iri)

    out.push({
      iri: doc.iri,
      label: doc.label,
      ontology: doc.ontology_name.toLowerCase(),
      shortForm: doc.short_form ?? null,
      description: descriptionOf(doc.description),
    })
  }

  return out
}

export async function searchOntologyTerms(
  query: string,
  ontologies: readonly string[],
  deps: { fetch?: OlsFetch; timeoutMs?: number } = {},
): Promise<OntologyTerm[]> {
  const text = query.trim()

  if (text.length < 2) return []
  const fetcher: OlsFetch = deps.fetch ?? ((url, init) => fetch(url, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000)

  try {
    const res = await fetcher(olsSearchUrl(text, ontologies), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })

    if (!res.ok) throw new Error(`The ontology service answered ${res.status}`)

    return parseOlsResponse(await res.json())
  } finally {
    clearTimeout(timer)
  }
}
