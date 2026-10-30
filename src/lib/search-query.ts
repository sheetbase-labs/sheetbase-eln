import { parseSearchQuery } from '@sheetbase-labs/sheetbase-shared'
import type {
  ConditionNode,
  FilterNode,
  GroupNode,
  SheetbaseField,
} from '@sheetbase-labs/sheetbase-shared'

import { isEmptyFilter } from '#/lib/search-filter'

/**
 * What the search box means: words for the full-text search, and `key:value`
 * tokens (`type:sample -project:"AAV8 TFF"`) for the filter tree. The box and
 * the palette share this, so the same text finds the same things in both.
 */
export interface TypedSearch {
  /** The words left for full-text search, with quotes, `-word` and `OR` intact. */
  q: string
  /** The filters the tokens became, or undefined when there were none. */
  filter?: GroupNode
}

/** A name typed in a token (`project:"AAV8 TFF"`) stands for an id the search filters on. */
async function resolveValue(
  field: SheetbaseField,
  value: unknown,
): Promise<unknown> {
  if (typeof value !== 'string' || !field.loadOptions) return value
  const options = await field.loadOptions(value).catch(() => [])
  const wanted = value.trim().toLowerCase()
  const exact =
    options.find((o) => o.value === value) ??
    options.find((o) => o.label.toLowerCase() === wanted)
  if (exact) return exact.value
  // One candidate for a partly typed name is the one meant.
  return options.length === 1 && options[0] ? options[0].value : value
}

async function resolveNode(
  node: FilterNode,
  fields: ReadonlyMap<string, SheetbaseField>,
): Promise<FilterNode> {
  if (node.type === 'group')
    return {
      ...node,
      children: await Promise.all(
        node.children.map((child) => resolveNode(child, fields)),
      ),
    }
  const field = fields.get(node.field)
  if (!field?.loadOptions || node.value === undefined) return node
  const value = Array.isArray(node.value)
    ? await Promise.all(node.value.map((v) => resolveValue(field, v)))
    : await resolveValue(field, node.value)
  const resolved: ConditionNode = { ...node, value }
  return resolved
}

export async function parseTypedSearch(
  input: string,
  fields: readonly SheetbaseField[],
): Promise<TypedSearch> {
  const parsed = parseSearchQuery(input, fields)
  if (isEmptyFilter(parsed.filter)) return { q: parsed.text.trim() }
  const byId = new Map(fields.map((f) => [f.id, f]))
  const filter = (await resolveNode(parsed.filter, byId)) as GroupNode
  return { q: parsed.text.trim(), filter }
}
