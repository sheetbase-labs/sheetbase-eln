/**
 * Plugin screens: a screen is a description of what to show, returned by the
 * plugin's Python and drawn by Sheetbase with its own components, so it looks
 * native, follows dark mode and the phone layout, and cannot run code in the
 * page.
 *
 * A screen function gets `{ context, state, event }` and returns
 * `{ view, state?, notice? }`. `event` is `null` on first draw, or
 * `{ action, values }` after a person presses a button or submits a form; the
 * `state` the plugin returns comes back on the next call. A notebook block keeps
 * that state with the block, a panel keeps it for as long as it is open.
 *
 * Everything here is validated before it reaches the page: unknown node kinds,
 * unknown settings, long text and deep trees are rejected, never ignored.
 * `sdks/plugin-python/src/sheetbase_plugin/ui.py` builds the same shapes;
 * `sdks/plugin-python/tests/screen_cases.json` keeps the two validators in step.
 *
 * Browser safe, no server imports.
 */
import { z } from 'zod'

import { isRecord } from './points'

export const SCREEN_TONES = [
  'neutral',
  'success',
  'warning',
  'danger',
  'info',
] as const

export type ScreenTone = (typeof SCREEN_TONES)[number]

export type ScreenCell = string | number | boolean | null

export interface ScreenInputOption {
  value: string
  label: string
}

export type ScreenNode =
  | {
      type: 'stack'
      direction?: 'column' | 'row'
      gap?: 'sm' | 'md' | 'lg'
      children: ScreenNode[]
    }
  | { type: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { type: 'text'; text: string; tone?: 'muted' | 'success' | 'danger' }
  | {
      type: 'stat'
      label: string
      value: string | number
      unit?: string
      tone?: ScreenTone
    }
  | { type: 'badge'; text: string; tone?: ScreenTone }
  | {
      type: 'bar'
      value: number
      max?: number
      label?: string
      tone?: ScreenTone
    }
  | { type: 'sparkline'; values: number[]; tone?: ScreenTone }
  | {
      type: 'table'
      columns: Array<{ key: string; label: string; align?: 'start' | 'end' }>
      rows: Array<Record<string, ScreenCell>>
    }
  | { type: 'svg'; svg: string; title: string }
  | {
      type: 'input'
      name: string
      label: string
      kind?: 'text' | 'number' | 'select' | 'checkbox' | 'date'
      options?: ScreenInputOption[]
      value?: string | number | boolean
      required?: boolean
      help?: string
    }
  | {
      type: 'button'
      label: string
      action: string
      variant?: 'primary' | 'secondary'
    }
  | {
      type: 'form'
      children: ScreenNode[]
      submit: { label: string; action: string }
    }
  | { type: 'link'; text: string; to: string }
  | { type: 'divider' }

export interface ScreenNotice {
  tone: ScreenTone
  text: string
}

export interface ScreenResult {
  view: ScreenNode
  state?: unknown
  notice?: ScreenNotice
}

/**
 * Technical bounds on a drawn screen, there to keep a runaway loop in a plugin
 * from freezing the page, not to limit what a plugin may show. A lab with a
 * real need for more says so and the number goes up.
 */
export const SCREEN_LIMITS = {
  depth: 64,
  nodes: 100_000,
  text: 100_000,
  label: 120,
  tableRows: 100_000,
  tableColumns: 500,
  sparkline: 100_000,
  options: 10_000,
  svgBytes: 8 * 1024 * 1024,
  stateBytes: 4 * 1024 * 1024,
} as const

const NAME_RE = /^[a-z][a-z0-9_]{0,47}$/
const ACTION_RE = /^[a-z][a-z0-9_-]{0,47}$/

/** Inside Sheetbase only: a path, never a full address or a script. */
const INTERNAL_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/

const byteLength = (value: string) => new TextEncoder().encode(value).length

const noticeSchema = z.strictObject({
  tone: z.enum(SCREEN_TONES),
  text: z.string().min(1).max(300),
})

const screenColumnSchema = z.strictObject({
  key: z.string().regex(NAME_RE),
  label: z.string().min(1).max(60),
  align: z.enum(['start', 'end']).optional(),
})

const screenCellSchema = z.union([
  z.string().max(10_000),
  z.boolean(),
  z.number(),
  z.null(),
])

class Walk {
  nodes = 0
  constructor(readonly errors: string[]) {}
  fail(path: string, message: string): null {
    if (this.errors.length < 20) this.errors.push(`${path}: ${message}`)

    return null
  }
}

function text(
  walk: Walk,
  path: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Screen text enters from plugin nodes; the bounded string schema rejects malformed or oversized text before returning it to the renderer.
  value: unknown,
  max: number,
  min = 1,
): string | null {
  const parsed = z.string().min(min).max(max).safeParse(value)

  if (!parsed.success)
    return walk.fail(path, `${name} must be ${min}-${max} characters`)

  return parsed.data
}

function keys(
  walk: Walk,
  path: string,
  actual: readonly string[],
  allowed: readonly string[],
): boolean {
  const known = new Set(allowed)
  const extra = actual.find((key) => !known.has(key))

  if (extra !== undefined) {
    walk.fail(path, `unknown setting ${extra}`)

    return false
  }

  return true
}

function parseNode(
  walk: Walk,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Recursive plugin nodes are parsed here; each selected kind validates its settings and constructs a ScreenNode under the shared depth/node limits before rendering.
  inputNode: unknown,
  path: string,
  depth: number,
): ScreenNode | null {
  walk.nodes += 1

  if (walk.nodes > SCREEN_LIMITS.nodes)
    return walk.fail(path, `a screen has at most ${SCREEN_LIMITS.nodes} parts`)

  if (depth > SCREEN_LIMITS.depth)
    return walk.fail(path, `parts nest at most ${SCREEN_LIMITS.depth} deep`)

  if (!isRecord(inputNode)) return walk.fail(path, 'every part needs a type')
  const identity = z.string().safeParse(inputNode.type)

  if (!identity.success) return walk.fail(path, 'every part needs a type')
  const type = identity.data
  const node = inputNode
  const at = `${path}(${type})`

  switch (node.type) {
    case 'stack': {
      if (
        !keys(walk, at, Object.keys(node), [
          'type',
          'direction',
          'gap',
          'children',
        ])
      )
        return null

      const direction = z
        .enum(['column', 'row'])
        .optional()
        .safeParse(node.direction)

      const gap = z.enum(['sm', 'md', 'lg']).optional().safeParse(node.gap)

      if (!direction.success || !gap.success)
        return walk.fail(at, 'direction is column or row, gap is sm, md or lg')
      const children = parseChildren(walk, node.children, at, depth)

      if (!children) return null

      const result: Extract<ScreenNode, { type: 'stack' }> = {
        type: 'stack',
        children,
      }

      if (direction.data !== undefined) result.direction = direction.data

      if (gap.data !== undefined) result.gap = gap.data

      return result
    }

    case 'heading': {
      if (!keys(walk, at, Object.keys(node), ['type', 'text', 'level']))
        return null
      const heading = text(walk, at, 'text', node.text, SCREEN_LIMITS.label)

      if (heading === null) return null

      const level = z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .optional()
        .safeParse(node.level)

      if (!level.success) return walk.fail(at, 'level is 1, 2 or 3')

      const result: Extract<ScreenNode, { type: 'heading' }> = {
        type: 'heading',
        text: heading,
      }

      if (level.data !== undefined) result.level = level.data

      return result
    }

    case 'text': {
      if (!keys(walk, at, Object.keys(node), ['type', 'text', 'tone']))
        return null
      const body = text(walk, at, 'text', node.text, SCREEN_LIMITS.text, 0)

      if (body === null) return null

      const tone = z
        .enum(['muted', 'success', 'danger'])
        .optional()
        .safeParse(node.tone)

      if (!tone.success)
        return walk.fail(at, 'tone is muted, success or danger')

      const result: Extract<ScreenNode, { type: 'text' }> = {
        type: 'text',
        text: body,
      }

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'stat': {
      if (
        !keys(walk, at, Object.keys(node), [
          'type',
          'label',
          'value',
          'unit',
          'tone',
        ])
      )
        return null
      const label = text(walk, at, 'label', node.label, SCREEN_LIMITS.label)

      if (label === null) return null

      const value = z
        .union([z.number(), z.string().max(60)])
        .safeParse(node.value)

      if (!value.success)
        return walk.fail(at, 'value is a number or up to 60 characters')

      const unit =
        node.unit === undefined
          ? undefined
          : text(walk, at, 'unit', node.unit, 20)

      if (unit === null) return null
      const tone = z.enum(SCREEN_TONES).optional().safeParse(node.tone)

      if (!tone.success) return walk.fail(at, 'unknown tone')

      const result: Extract<ScreenNode, { type: 'stat' }> = {
        type: 'stat',
        label,
        value: value.data,
      }

      if (unit !== undefined) result.unit = unit

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'badge': {
      if (!keys(walk, at, Object.keys(node), ['type', 'text', 'tone']))
        return null
      const label = text(walk, at, 'text', node.text, 60)

      if (label === null) return null

      const tone = z.enum(SCREEN_TONES).optional().safeParse(node.tone)

      if (!tone.success) return walk.fail(at, 'unknown tone')

      const result: Extract<ScreenNode, { type: 'badge' }> = {
        type: 'badge',
        text: label,
      }

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'bar': {
      if (
        !keys(walk, at, Object.keys(node), [
          'type',
          'value',
          'max',
          'label',
          'tone',
        ])
      )
        return null

      const value = z.number().safeParse(node.value)

      if (!value.success) return walk.fail(at, 'value is a number')

      const max = z.number().positive().optional().safeParse(node.max)

      if (!max.success) return walk.fail(at, 'max is a number above 0')

      const label =
        node.label === undefined
          ? undefined
          : text(walk, at, 'label', node.label, 60)

      if (label === null) return null
      const tone = z.enum(SCREEN_TONES).optional().safeParse(node.tone)

      if (!tone.success) return walk.fail(at, 'unknown tone')

      const result: Extract<ScreenNode, { type: 'bar' }> = {
        type: 'bar',
        value: value.data,
      }

      if (max.data !== undefined) result.max = max.data

      if (label !== undefined) result.label = label

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'sparkline': {
      if (!keys(walk, at, Object.keys(node), ['type', 'values', 'tone']))
        return null

      const values = z
        .array(z.number())
        .min(2)
        .max(SCREEN_LIMITS.sparkline)
        .safeParse(node.values)

      if (!values.success)
        return walk.fail(at, `values are 2-${SCREEN_LIMITS.sparkline} numbers`)

      const tone = z.enum(SCREEN_TONES).optional().safeParse(node.tone)

      if (!tone.success) return walk.fail(at, 'unknown tone')

      const result: Extract<ScreenNode, { type: 'sparkline' }> = {
        type: 'sparkline',
        values: values.data,
      }

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'table': {
      if (!keys(walk, at, Object.keys(node), ['type', 'columns', 'rows']))
        return null

      const declaredColumns = z
        .array(z.unknown())
        .min(1)
        .max(SCREEN_LIMITS.tableColumns)
        .safeParse(node.columns)

      if (!declaredColumns.success)
        return walk.fail(
          at,
          `a table has 1-${SCREEN_LIMITS.tableColumns} columns`,
        )

      const columns: Extract<ScreenNode, { type: 'table' }>['columns'] = []

      const seen = new Set<string>()

      for (const raw of declaredColumns.data) {
        const column = screenColumnSchema.safeParse(raw)

        if (!column.success || seen.has(column.data.key))
          return walk.fail(
            at,
            'columns need a unique key (a-z, 0-9, _), a label and an optional align',
          )
        seen.add(column.data.key)

        const declaration: Extract<
          ScreenNode,
          { type: 'table' }
        >['columns'][number] = {
          key: column.data.key,
          label: column.data.label,
        }

        if (column.data.align !== undefined)
          declaration.align = column.data.align
        columns.push(declaration)
      }

      const declaredRows = z
        .array(z.unknown())
        .max(SCREEN_LIMITS.tableRows)
        .safeParse(node.rows)

      if (!declaredRows.success)
        return walk.fail(
          at,
          `a table has at most ${SCREEN_LIMITS.tableRows} rows`,
        )
      const rows: Array<Record<string, ScreenCell>> = []

      for (const row of declaredRows.data) {
        if (!isRecord(row)) return walk.fail(at, 'each row is an object')
        const out: Record<string, ScreenCell> = {}

        for (const column of columns) {
          const cell = screenCellSchema.safeParse(row[column.key] ?? null)

          if (!cell.success)
            return walk.fail(
              at,
              'cells are text (up to 10000 characters), numbers, true/false or empty',
            )
          out[column.key] = cell.data
        }

        rows.push(out)
      }

      return { type: 'table', columns, rows }
    }

    case 'svg': {
      if (!keys(walk, at, Object.keys(node), ['type', 'svg', 'title']))
        return null

      const svg = z
        .string()
        .refine((source) => byteLength(source) <= SCREEN_LIMITS.svgBytes)
        .safeParse(node.svg)

      if (!svg.success) return walk.fail(at, 'svg is text up to 64 KiB')

      if (sanitizeSvg(svg.data) === null)
        return walk.fail(
          at,
          'svg uses an element or attribute that is not allowed',
        )
      const title = text(walk, at, 'title', node.title, SCREEN_LIMITS.label)

      if (title === null) return null

      return { type: 'svg', svg: svg.data, title }
    }

    case 'input': {
      if (
        !keys(walk, at, Object.keys(node), [
          'type',
          'name',
          'label',
          'kind',
          'options',
          'value',
          'required',
          'help',
        ])
      )
        return null

      const name = z.string().regex(NAME_RE).safeParse(node.name)

      if (!name.success)
        return walk.fail(at, 'name matches ^[a-z][a-z0-9_]{0,47}$')
      const label = text(walk, at, 'label', node.label, SCREEN_LIMITS.label)

      if (label === null) return null

      const kind = z
        .enum(['text', 'number', 'select', 'checkbox', 'date'])
        .nullish()
        .safeParse(node.kind)

      if (!kind.success)
        return walk.fail(at, 'kind is text, number, select, checkbox or date')
      let options: ScreenInputOption[] | undefined

      if (kind.data === 'select') {
        const declaredOptions = z
          .array(
            z.object({
              value: z.string().max(100),
              label: z.string().min(1).max(100),
            }),
          )
          .min(1)
          .max(SCREEN_LIMITS.options)
          .safeParse(node.options)

        if (!declaredOptions.success)
          return walk.fail(
            at,
            `a select needs 1-${SCREEN_LIMITS.options} options of { value, label }`,
          )
        options = declaredOptions.data
      } else if (node.options !== undefined)
        return walk.fail(at, 'only a select has options')

      const value = z
        .union([z.string(), z.boolean(), z.number()])
        .optional()
        .safeParse(node.value)

      if (!value.success)
        return walk.fail(at, 'value is text, a number or true/false')

      const required = z.boolean().optional().safeParse(node.required)

      if (!required.success) return walk.fail(at, 'required is true or false')

      const help =
        node.help === undefined
          ? undefined
          : text(walk, at, 'help', node.help, 300)

      if (help === null) return null

      const result: Extract<ScreenNode, { type: 'input' }> = {
        type: 'input',
        name: name.data,
        label,
      }

      if (kind.data != null) result.kind = kind.data

      if (options !== undefined) result.options = options

      if (value.data !== undefined) result.value = value.data

      if (required.data !== undefined) result.required = required.data

      if (help !== undefined) result.help = help

      return result
    }

    case 'button': {
      if (
        !keys(walk, at, Object.keys(node), [
          'type',
          'label',
          'action',
          'variant',
        ])
      )
        return null
      const label = text(walk, at, 'label', node.label, 60)

      if (label === null) return null

      const action = z.string().regex(ACTION_RE).safeParse(node.action)

      if (!action.success)
        return walk.fail(at, 'action matches ^[a-z][a-z0-9_-]{0,47}$')

      const variant = z
        .enum(['primary', 'secondary'])
        .optional()
        .safeParse(node.variant)

      if (!variant.success)
        return walk.fail(at, 'variant is primary or secondary')

      const result: Extract<ScreenNode, { type: 'button' }> = {
        type: 'button',
        label,
        action: action.data,
      }

      if (variant.data !== undefined) result.variant = variant.data

      return result
    }

    case 'form': {
      if (!keys(walk, at, Object.keys(node), ['type', 'children', 'submit']))
        return null

      const submit = z
        .strictObject({
          label: z.string().min(1).max(60),
          action: z.string().regex(ACTION_RE),
        })
        .safeParse(node.submit)

      if (!submit.success)
        return walk.fail(at, 'submit needs a label and an action')
      const children = parseChildren(walk, node.children, at, depth)

      if (!children) return null

      return {
        type: 'form',
        children,
        submit: submit.data,
      }
    }

    case 'link': {
      if (!keys(walk, at, Object.keys(node), ['type', 'text', 'to']))
        return null
      const label = text(walk, at, 'text', node.text, 100)

      if (label === null) return null

      const to = z
        .string()
        .max(300)
        .regex(INTERNAL_PATH_RE)
        .refine((destination) => !destination.startsWith('//'))
        .safeParse(node.to)

      if (!to.success)
        return walk.fail(
          at,
          'to is a path inside Sheetbase, such as /records/…, never a web address',
        )

      return { type: 'link', text: label, to: to.data }
    }

    case 'divider': {
      if (!keys(walk, at, Object.keys(node), ['type'])) return null

      return { type: 'divider' }
    }

    default:
      return walk.fail(path, `unknown part type ${type}`)
  }
}

function parseChildren(
  walk: Walk,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Nested plugin screen parts cross here; bound the list before recursively validating each node with the shared depth/node budget.
  value: unknown,
  path: string,
  depth: number,
): ScreenNode[] | null {
  const children = z.array(z.unknown()).max(60).safeParse(value)

  if (!children.success)
    return walk.fail(path, 'children is a list of up to 60 parts')
  const out: ScreenNode[] = []

  for (const [index, child] of children.data.entries()) {
    const parsed = parseNode(walk, child, `${path}[${index}]`, depth + 1)

    if (!parsed) return null
    out.push(parsed)
  }

  return out
}

/** Names of the inputs and actions in a view, for checking an event against what was drawn. */
export function screenActions(node: ScreenNode): Set<string> {
  const out = new Set<string>()

  const visit = (n: ScreenNode) => {
    if (n.type === 'button') out.add(n.action)

    if (n.type === 'form') out.add(n.submit.action)

    if (n.type === 'stack' || n.type === 'form') n.children.forEach(visit)
  }

  visit(node)

  return out
}

/** Checks a screen function's answer. Returns the normalised result, or the problems. */
export function parseScreenResult(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plugin screen answers are untrusted: original keys, recursive nodes, strict notices and serialized state size are checked before returning a renderable result.
  value: unknown,
): { ok: true; result: ScreenResult } | { ok: false; errors: string[] } {
  const errors: string[] = []

  if (!isRecord(value))
    return { ok: false, errors: ['a screen returns an object'] }

  for (const key of Object.keys(value))
    if (!['view', 'state', 'notice'].includes(key))
      errors.push(`unknown key in a screen's answer: ${key}`)

  if (errors.length > 0) return { ok: false, errors }
  const walk = new Walk(errors)
  const view = parseNode(walk, value.view, 'view', 1)
  let notice: ScreenNotice | undefined

  if (value.notice !== undefined && value.notice !== null) {
    const parsed = noticeSchema.safeParse(value.notice)

    if (!parsed.success)
      errors.push('notice needs a tone and text of up to 300 characters')
    else notice = parsed.data
  }

  if (value.state !== undefined && value.state !== null) {
    let size = Infinity

    try {
      size = byteLength(JSON.stringify(value.state))
    } catch {
      /* not JSON */
    }

    if (size > SCREEN_LIMITS.stateBytes)
      errors.push('state is data up to 64 KiB')
  }

  if (!view || errors.length > 0) return { ok: false, errors }

  const result: ScreenResult = { view }

  if (value.state !== undefined && value.state !== null)
    result.state = value.state

  if (notice) result.notice = notice

  return { ok: true, result }
}

// ---------------------------------------------------------------------------
// What a row action or a column's header action answers with.
// ---------------------------------------------------------------------------

export const ACTION_DOWNLOAD_TYPES = [
  'text/csv',
  'text/plain',
  'application/json',
  'chemical/x-mdl-sdfile',
  'chemical/x-mdl-molfile',
] as const

export const ACTION_DOWNLOAD_BYTES = 2 * 1024 * 1024

export interface ActionResult {
  notice?: ScreenNotice
  /** A small screen to show in a dialog, such as a summary of what the action found. */
  view?: ScreenNode
  /** A file for the person's computer. */
  download?: { filename: string; mime: string; text: string }
}

export function parseActionResult(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Action answers enter from plugin execution; strict notice/download schemas and recursive screen parsing reject unknown settings and unsafe downloads before returning the result.
  value: unknown,
): { ok: true; result: ActionResult } | { ok: false; errors: string[] } {
  const errors: string[] = []

  if (!isRecord(value))
    return { ok: false, errors: ['an action returns an object'] }

  for (const key of Object.keys(value))
    if (!['notice', 'view', 'download'].includes(key))
      errors.push(`unknown key in an action's answer: ${key}`)
  const result: ActionResult = {}

  if (value.notice !== undefined && value.notice !== null) {
    const parsed = noticeSchema.safeParse(value.notice)

    if (!parsed.success)
      errors.push('notice needs a tone and text of up to 300 characters')
    else result.notice = parsed.data
  }

  if (value.view !== undefined && value.view !== null) {
    const walk = new Walk(errors)
    const view = parseNode(walk, value.view, 'view', 1)

    if (view) result.view = view
  }

  if (value.download !== undefined && value.download !== null) {
    const download = z
      .strictObject({
        filename: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
        mime: z.enum(ACTION_DOWNLOAD_TYPES),
        text: z
          .string()
          .refine((content) => byteLength(content) <= ACTION_DOWNLOAD_BYTES),
      })
      .safeParse(value.download)

    if (!download.success)
      errors.push(
        `download needs a plain file name, a mime type (${ACTION_DOWNLOAD_TYPES.join(', ')}) and text up to 2 MiB`,
      )
    else result.download = download.data
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, result }
}

// ---------------------------------------------------------------------------
// SVG: the one part that carries markup, so it is cleaned on the way out too.
// ---------------------------------------------------------------------------

const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'text',
  'tspan',
  'title',
  'desc',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
])

const SVG_CASE = new Map([
  ['lineargradient', 'linearGradient'],
  ['radialgradient', 'radialGradient'],
  ['clippath', 'clipPath'],
  ['viewbox', 'viewBox'],
  ['gradientunits', 'gradientUnits'],
  ['gradienttransform', 'gradientTransform'],
  ['preserveaspectratio', 'preserveAspectRatio'],
])

const SVG_ATTRIBUTES = new Set([
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-weight',
  'font-family',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'id',
  'clip-path',
  'preserveaspectratio',
  'xmlns',
  'role',
  'aria-label',
])

/**
 * Keeps only SVG elements and attributes on an allow-list, so a picture drawn by
 * a plugin cannot carry a script, an event handler, a link or an external
 * image. A value that uses `url(` is allowed only as `url(#id)`.
 */
export function sanitizeSvg(source: string): string | null {
  if (
    !z.string().safeParse(source).success ||
    byteLength(source) > SCREEN_LIMITS.svgBytes
  )
    return null

  if (!/^\s*<svg[\s>]/i.test(source)) return null
  const out: string[] = []

  const tag =
    /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)|<!--[\s\S]*?-->/g

  let match: RegExpExecArray | null
  let depth = 0
  const stack: string[] = []

  while ((match = tag.exec(source)) !== null) {
    const found: readonly (string | undefined)[] = match

    if (found[4] !== undefined) {
      out.push(found[4].replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g, '&amp;'))
      continue
    }

    if (found[1] === undefined) continue // comment
    const closing = match[0].startsWith('</')
    const name = match[1].toLowerCase()

    if (!SVG_ELEMENTS.has(name)) return null

    if (closing) {
      const open = stack.pop()

      if (open !== name) return null
      depth -= 1
      out.push(`</${SVG_CASE.get(name) ?? name}>`)
      continue
    }

    const attrs: string[] = []
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let a: RegExpExecArray | null

    while ((a = attrRe.exec(match[2])) !== null) {
      const key = a[1].toLowerCase()
      const parts: readonly (string | undefined)[] = a
      const val = parts[2] ?? parts[3] ?? ''

      if (key.startsWith('on') || !SVG_ATTRIBUTES.has(key)) return null
      const lower = val.toLowerCase()

      if (
        lower.includes('javascript:') ||
        lower.includes('data:') ||
        /url\((?!\s*#)/i.test(val) ||
        val.includes('<')
      )
        return null
      attrs.push(`${SVG_CASE.get(key) ?? key}="${val.replace(/"/g, '&quot;')}"`)
    }

    const selfClosing = match[3] === '/'
    out.push(
      `<${SVG_CASE.get(name) ?? name}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClosing ? '/' : ''}>`,
    )

    if (!selfClosing) {
      stack.push(name)
      depth += 1

      if (depth > 24) return null
    }
  }

  if (stack.length > 0) return null
  const joined = out.join('')

  return joined.includes('xmlns') || !joined.startsWith('<svg')
    ? joined
    : joined.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
}
