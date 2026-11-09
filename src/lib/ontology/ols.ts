/**
 * Ontology terms from the EBI Ontology Lookup Service (OLS4), so a field or a
 * vocabulary term can say which OBI, ChEBI, CL, UBERON, NCBITaxon or UO term it
 * means. Looking terms up is the only thing that leaves the install, and only
 * after an admin turns it on (Settings > Open data): the words typed in the
 * picker go to www.ebi.ac.uk, nothing else does.
 */

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

export const ONTOLOGY_NAMES: Record<string, string> = {
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
}

export interface OntologyTerm {
  iri: string
  label: string
  /** Lowercase ontology id, e.g. `chebi`. */
  ontology: string
  /** Short id such as `CHEBI_15377`. */
  shortForm: string | null
  description: string | null
}

export type OlsFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

interface OlsDoc {
  iri?: unknown
  label?: unknown
  ontology_name?: unknown
  short_form?: unknown
  description?: unknown
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

export function parseOlsResponse(body: unknown): OntologyTerm[] {
  const docs = (body as { response?: { docs?: unknown } } | null)?.response
    ?.docs

  if (!Array.isArray(docs)) return []
  const out: OntologyTerm[] = []
  const seen = new Set<string>()

  for (const raw of docs as OlsDoc[]) {
    if (
      typeof raw.iri !== 'string' ||
      typeof raw.label !== 'string' ||
      typeof raw.ontology_name !== 'string' ||
      !/^https?:\/\//.test(raw.iri) ||
      seen.has(raw.iri)
    ) {
      continue
    }

    seen.add(raw.iri)

    const description = Array.isArray(raw.description)
      ? raw.description.find((d): d is string => typeof d === 'string')
      : typeof raw.description === 'string'
        ? raw.description
        : undefined

    out.push({
      iri: raw.iri,
      label: raw.label,
      ontology: raw.ontology_name.toLowerCase(),
      shortForm: typeof raw.short_form === 'string' ? raw.short_form : null,
      description: description ? description.slice(0, 400) : null,
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
