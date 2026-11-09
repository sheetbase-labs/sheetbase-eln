/**
 * ODCS documents as files. The database speaks JSON; data teams keep YAML in
 * git. YAML is a superset of JSON, so one parser reads both.
 */
import { parse, stringify } from 'yaml'

export function odcsToYaml(document: Record<string, unknown>): string {
  return stringify(document, { lineWidth: 100 })
}

/** Read a YAML or JSON ODCS file. Throws a plain message when it is neither. */
export function parseOdcs(text: string): Record<string, unknown> {
  let parsed: unknown

  try {
    parsed = parse(text)
  } catch {
    throw new Error('The file is not valid YAML or JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The file is not a data contract.')
  }

  return parsed as Record<string, unknown>
}

/** A file name for a contract: its name in lower case with dashes. */
export function odcsFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${slug || 'data-contract'}.odcs.yaml`
}
