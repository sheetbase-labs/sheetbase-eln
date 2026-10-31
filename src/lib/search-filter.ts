import { normaliseOperator } from '@sheetbase-labs/sheetbase-shared'
import type {
  Combinator,
  ConditionNode,
  FilterNode,
  FilterOperator,
  GroupNode,
} from '@sheetbase-labs/sheetbase-shared'

import {
  MODEL_FIELD_PREFIX,
  parseModelFieldId,
} from '#/lib/search-model-fields'

/**
 * The filter tree behind the results page and the palette. One tree describes
 * the "Add filter" rows, the chips above the results, what a typed
 * `type:sample -project:"AAV8"` becomes, and what a saved search keeps.
 *
 * In the URL the tree travels as compact JSON (`filter`), without the node ids
 * the builder invents; the server takes the same tree as `p_filter`.
 */

export const SEARCH_SORTS = ['relevance', 'updated', 'created'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export function parseSearchSort(value: unknown): SearchSort | undefined {
  return value === 'updated' || value === 'created' ? value : undefined
}

/** The server compiles at most this deep, with at most this many conditions. */
export const FILTER_MAX_DEPTH = 4
export const FILTER_MAX_CONDITIONS = 50

const COMBINATORS: readonly Combinator[] = ['AND', 'OR', 'NOT']

export function emptyFilterRoot(): GroupNode {
  return { type: 'group', id: 'n', combinator: 'AND', children: [] }
}

export function countConditions(node: FilterNode): number {
  if (node.type === 'condition') return 1
  return node.children.reduce((sum, child) => sum + countConditions(child), 0)
}

export function isEmptyFilter(
  node: FilterNode | null | undefined,
): node is null | undefined {
  return !node || countConditions(node) === 0
}

const VALUELESS_OPERATORS: ReadonlySet<string> = new Set(['isNull', 'notNull'])

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some(hasValue)
  return true
}

/**
 * The tree with only the conditions someone has finished: a value picked, or
 * an operator that takes none. Undefined when nothing is finished yet, so a
 * half-built filter is not counted as matching nothing.
 */
export function completeFilter(node: GroupNode): GroupNode | undefined {
  const children = node.children
    .map((child): FilterNode | undefined => {
      if (child.type === 'group') return completeFilter(child)
      return VALUELESS_OPERATORS.has(child.operator) || hasValue(child.value)
        ? child
        : undefined
    })
    .filter((child): child is FilterNode => child !== undefined)
  const next = { ...node, children }
  return countConditions(next) === 0 ? undefined : next
}

export type FilterParam =
  { f: string; o: string; v?: unknown } | { g: string; k: FilterParam[] }
type Compact = FilterParam

function compact(node: FilterNode): Compact | null {
  if (node.type === 'condition') {
    return node.value === undefined
      ? { f: node.field, o: node.operator }
      : { f: node.field, o: node.operator, v: node.value }
  }
  const k = node.children
    .map(compact)
    .filter((child): child is Compact => child !== null)
  return k.length ? { g: node.combinator, k } : null
}

/**
 * The `filter` URL value for a tree, or undefined when it has no conditions.
 * The router writes it as JSON, so the link carries the compact tree as is.
 */
export function encodeFilter(
  node: FilterNode | null | undefined,
): FilterParam | undefined {
  if (isEmptyFilter(node)) return undefined
  return compact(node) ?? undefined
}

function expand(
  raw: unknown,
  path: string,
  depth: number,
  budget: { left: number },
): FilterNode | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return undefined
  const body = raw as Record<string, unknown>
  if (typeof body.g === 'string') {
    if (depth >= FILTER_MAX_DEPTH) return undefined
    if (!COMBINATORS.includes(body.g as Combinator)) return undefined
    if (!Array.isArray(body.k)) return undefined
    const children: FilterNode[] = []
    for (const [index, child] of body.k.entries()) {
      const node = expand(child, `${path}.${index}`, depth + 1, budget)
      if (node) children.push(node)
    }
    return {
      type: 'group',
      id: `n${path}`,
      combinator: body.g as Combinator,
      children,
    }
  }
  if (typeof body.f !== 'string' || typeof body.o !== 'string') return undefined
  const operator = normaliseOperator(body.o)
  if (!body.f || !operator || budget.left <= 0) return undefined
  budget.left -= 1
  const condition: ConditionNode = {
    type: 'condition',
    id: `n${path}`,
    field: body.f,
    operator,
    ...(body.v === undefined ? {} : { value: body.v }),
  }
  return condition
}

/**
 * The tree for a `filter` URL value. A link someone hand-edited, or one from a
 * newer version, decodes to nothing rather than breaking the page.
 */
export function decodeFilter(raw: unknown): GroupNode | undefined {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const node = expand(parsed, '', 0, { left: FILTER_MAX_CONDITIONS })
  if (!node || countConditions(node) === 0) return undefined
  // A bare condition is a one-row AND.
  return node.type === 'group'
    ? node
    : { type: 'group', id: 'n', combinator: 'AND', children: [node] }
}

/** The URL value as it round-trips: what a router should hold for `filter`. */
export function normaliseFilterParam(raw: unknown): FilterParam | undefined {
  return encodeFilter(decodeFilter(raw))
}

/** `a` AND `b`, dropping whichever is empty. */
export function andFilters(
  a: GroupNode | null | undefined,
  b: GroupNode | null | undefined,
): GroupNode | undefined {
  if (isEmptyFilter(a)) return isEmptyFilter(b) ? undefined : b
  if (isEmptyFilter(b)) return a
  const flatten = (node: GroupNode): readonly FilterNode[] =>
    node.combinator === 'AND' ? node.children : [node]
  return {
    type: 'group',
    id: 'n',
    combinator: 'AND',
    children: [...flatten(a), ...flatten(b)],
  }
}

// ---------------------------------------------------------------------------
// Fields. The names the server accepts in `p_filter`; `fields.<key>` reaches
// the per-type values a result row carries.
// ---------------------------------------------------------------------------

/** Record kinds, which a person calls the "type" of a record. */
const RECORD_KINDS = new Set([
  'experiment',
  'protocol_template',
  'report',
  'sample',
  'material',
  'notebook_template',
  'study',
])

/**
 * People say `type:sample` for a sample, which is a kind of record, and
 * `type:dataset` for a dataset, which is its own object class. The server keeps
 * the two apart (`kind` and `type`), so a `type` condition is routed to
 * whichever it names before it is sent.
 */
function routeType(condition: ConditionNode): FilterNode {
  const values = Array.isArray(condition.value)
    ? condition.value
    : condition.value === undefined
      ? []
      : [condition.value]
  const isKind = (v: unknown) => typeof v === 'string' && RECORD_KINDS.has(v)
  const kinds = values.filter(isKind)
  const objects = values.filter((v) => !isKind(v))
  if (condition.operator !== 'eq' && condition.operator !== 'neq')
    if (condition.operator !== 'in') return condition
  if (!kinds.length) return condition
  const negate = condition.operator === 'neq'
  const parts: ConditionNode[] = [
    {
      type: 'condition',
      id: `${condition.id}k`,
      field: 'kind',
      operator: kinds.length === 1 ? 'eq' : 'in',
      value: kinds.length === 1 ? kinds[0] : kinds,
    },
  ]
  if (objects.length)
    parts.push({
      type: 'condition',
      id: `${condition.id}t`,
      field: 'type',
      operator: objects.length === 1 ? 'eq' : 'in',
      value: objects.length === 1 ? objects[0] : objects,
    })
  const matched: FilterNode =
    parts.length === 1
      ? parts[0]
      : {
          type: 'group',
          id: `${condition.id}g`,
          combinator: 'OR',
          children: parts,
        }
  return negate
    ? {
        type: 'group',
        id: `${condition.id}n`,
        combinator: 'NOT',
        children: [matched],
      }
    : matched
}

/**
 * A model field (`model:sample:concentration`) is that kind of thing AND its
 * value, so a Sample field never matches a Material with a field of the same
 * name.
 */
function routeModelField(condition: ConditionNode): FilterNode {
  const model = parseModelFieldId(condition.field)
  if (!model) return condition
  return {
    type: 'group',
    id: `${condition.id}m`,
    combinator: 'AND',
    children: [
      {
        type: 'condition',
        id: `${condition.id}k`,
        field: 'kind',
        operator: 'eq',
        value: model.kind,
      },
      { ...condition, field: `fields.${model.key}` },
    ],
  }
}

function routeNode(node: FilterNode): FilterNode {
  if (node.type === 'condition')
    return node.field === 'type'
      ? routeType(node)
      : node.field.startsWith(MODEL_FIELD_PREFIX)
        ? routeModelField(node)
        : node
  return { ...node, children: node.children.map(routeNode) }
}

type WireNode =
  | {
      type: 'condition'
      field: string
      operator: FilterOperator
      value?: unknown
    }
  | { type: 'group'; combinator: Combinator; children: WireNode[] }

function toWire(node: FilterNode): WireNode {
  if (node.type === 'condition')
    return {
      type: 'condition',
      field: node.field,
      operator: node.operator,
      ...(node.value === undefined ? {} : { value: node.value }),
    }
  return {
    type: 'group',
    combinator: node.combinator,
    children: node.children.map(toWire),
  }
}

/** `p_filter` for the search RPC: the tree without ids, or undefined when empty. */
export function filterToRpc(
  node: FilterNode | null | undefined,
): WireNode | undefined {
  if (isEmptyFilter(node)) return undefined
  return toWire(routeNode(node))
}

/** The tree without the node (and everything under it) with this id. */
export function withoutNode(
  node: GroupNode,
  id: string,
): GroupNode | undefined {
  const children = node.children
    .filter((child) => child.id !== id)
    .map((child) =>
      child.type === 'group' ? (withoutNode(child, id) ?? null) : child,
    )
    .filter((child): child is FilterNode => child !== null)
  const next = { ...node, children }
  return countConditions(next) === 0 ? undefined : next
}
