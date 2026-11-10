/**
 * ODCS documents as files. The database speaks JSON; data teams keep YAML in
 * git. YAML is a superset of JSON, so one parser reads both.
 */
import { parse, stringify } from 'yaml'
import { z } from 'zod'

/** A JSON value as a data contract file carries it. */
export type OdcsValue =
  string | number | boolean | null | OdcsValue[] | { [key: string]: OdcsValue }

/** A data contract document: its named sections, each a JSON value. */
export type OdcsDocument = Record<string, OdcsValue>

const odcsValueSchema: z.ZodType<OdcsValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(odcsValueSchema),
    z.record(z.string(), odcsValueSchema),
  ]),
)

const odcsDocumentSchema: z.ZodType<OdcsDocument> = z.record(
  z.string(),
  odcsValueSchema,
)

/** What the writer accepts: a parsed file, or the JSON the export RPC returns. */
type OdcsYamlInput = Parameters<typeof stringify>[0]

export function odcsToYaml(document: OdcsYamlInput): string {
  return stringify(document, { lineWidth: 100 })
}

/** Read a YAML or JSON ODCS file. Throws a plain message when it is neither. */
export function parseOdcs(text: string): OdcsDocument {
  let parsed: unknown

  try {
    parsed = parse(text)
  } catch {
    throw new Error('The file is not valid YAML or JSON.')
  }

  const document = odcsDocumentSchema.safeParse(parsed)

  if (!document.success) {
    throw new Error('The file is not a data contract.')
  }

  return document.data
}

/** A file name for a contract: its name in lower case with dashes. */
export function odcsFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'data-contract'}.odcs.yaml`
}
