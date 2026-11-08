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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTone(value: unknown): value is ScreenTone {
  return (
    typeof value === 'string' &&
    (SCREEN_TONES as readonly string[]).includes(value)
  )
}

const byteLength = (value: string) => new TextEncoder().encode(value).length

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
  value: unknown,
  max: number,
  min = 1,
): string | null {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    return walk.fail(path, `${name} must be ${min}-${max} characters`)
  return value
}

function keys(
  walk: Walk,
  path: string,
  node: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const extra = Object.keys(node).find((key) => !allowed.includes(key))
  if (extra !== undefined) {
    walk.fail(path, `unknown setting ${extra}`)
    return false
  }
  return true
}

function parseNode(
  walk: Walk,
  value: unknown,
  path: string,
  depth: number,
): ScreenNode | null {
  walk.nodes += 1
  if (walk.nodes > SCREEN_LIMITS.nodes)
    return walk.fail(path, `a screen has at most ${SCREEN_LIMITS.nodes} parts`)
  if (depth > SCREEN_LIMITS.depth)
    return walk.fail(path, `parts nest at most ${SCREEN_LIMITS.depth} deep`)
  if (!isRecord(value) || typeof value.type !== 'string')
    return walk.fail(path, 'every part needs a type')
  const node = value
  const at = `${path}(${node.type})`
  const tone = (allowed: readonly string[] = SCREEN_TONES) =>
    node.tone === undefined ||
    (typeof node.tone === 'string' && allowed.includes(node.tone))

  switch (node.type) {
    case 'stack': {
      if (!keys(walk, at, node, ['type', 'direction', 'gap', 'children']))
        return null
      if (
        (node.direction !== undefined &&
          node.direction !== 'column' &&
          node.direction !== 'row') ||
        (node.gap !== undefined &&
          node.gap !== 'sm' &&
          node.gap !== 'md' &&
          node.gap !== 'lg')
      )
        return walk.fail(at, 'direction is column or row, gap is sm, md or lg')
      const children = parseChildren(walk, node.children, at, depth)
      if (!children) return null
      return {
        type: 'stack',
        ...(node.direction ? { direction: node.direction } : {}),
        ...(node.gap ? { gap: node.gap } : {}),
        children,
      }
    }
    case 'heading': {
      if (!keys(walk, at, node, ['type', 'text', 'level'])) return null
      const heading = text(walk, at, 'text', node.text, SCREEN_LIMITS.label)
      if (heading === null) return null
      if (node.level !== undefined && ![1, 2, 3].includes(node.level as number))
        return walk.fail(at, 'level is 1, 2 or 3')
      return {
        type: 'heading',
        text: heading,
        ...(node.level ? { level: node.level as 1 | 2 | 3 } : {}),
      }
    }
    case 'text': {
      if (!keys(walk, at, node, ['type', 'text', 'tone'])) return null
      const body = text(walk, at, 'text', node.text, SCREEN_LIMITS.text, 0)
      if (body === null) return null
      if (!tone(['muted', 'success', 'danger']))
        return walk.fail(at, 'tone is muted, success or danger')
      return {
        type: 'text',
        text: body,
        ...(node.tone
          ? { tone: node.tone as 'muted' | 'success' | 'danger' }
          : {}),
      }
    }
    case 'stat': {
      if (!keys(walk, at, node, ['type', 'label', 'value', 'unit', 'tone']))
        return null
      const label = text(walk, at, 'label', node.label, SCREEN_LIMITS.label)
      if (label === null) return null
      if (!(
        (typeof node.value === 'number' && Number.isFinite(node.value)) ||
        (typeof node.value === 'string' && node.value.length <= 60)
      ))
        return walk.fail(at, 'value is a number or up to 60 characters')
      if (node.unit !== undefined && !text(walk, at, 'unit', node.unit, 20))
        return null
      if (!tone()) return walk.fail(at, 'unknown tone')
      return {
        type: 'stat',
        label,
        value: node.value,
        ...(node.unit !== undefined ? { unit: node.unit as string } : {}),
        ...(node.tone ? { tone: node.tone as ScreenTone } : {}),
      }
    }
    case 'badge': {
      if (!keys(walk, at, node, ['type', 'text', 'tone'])) return null
      const label = text(walk, at, 'text', node.text, 60)
      if (label === null) return null
      if (!tone()) return walk.fail(at, 'unknown tone')
      return {
        type: 'badge',
        text: label,
        ...(node.tone ? { tone: node.tone as ScreenTone } : {}),
      }
    }
    case 'bar': {
      if (!keys(walk, at, node, ['type', 'value', 'max', 'label', 'tone']))
        return null
      if (typeof node.value !== 'number' || !Number.isFinite(node.value))
        return walk.fail(at, 'value is a number')
      if (
        node.max !== undefined &&
        (typeof node.max !== 'number' ||
          !Number.isFinite(node.max) ||
          node.max <= 0)
      )
        return walk.fail(at, 'max is a number above 0')
      if (node.label !== undefined && !text(walk, at, 'label', node.label, 60))
        return null
      if (!tone()) return walk.fail(at, 'unknown tone')
      return {
        type: 'bar',
        value: node.value,
        ...(node.max !== undefined ? { max: node.max } : {}),
        ...(node.label !== undefined ? { label: node.label as string } : {}),
        ...(node.tone ? { tone: node.tone as ScreenTone } : {}),
      }
    }
    case 'sparkline': {
      if (!keys(walk, at, node, ['type', 'values', 'tone'])) return null
      if (
        !Array.isArray(node.values) ||
        node.values.length < 2 ||
        node.values.length > SCREEN_LIMITS.sparkline ||
        !node.values.every((n) => typeof n === 'number' && Number.isFinite(n))
      )
        return walk.fail(at, `values are 2-${SCREEN_LIMITS.sparkline} numbers`)
      if (!tone()) return walk.fail(at, 'unknown tone')
      return {
        type: 'sparkline',
        values: node.values as number[],
        ...(node.tone ? { tone: node.tone as ScreenTone } : {}),
      }
    }
    case 'table': {
      if (!keys(walk, at, node, ['type', 'columns', 'rows'])) return null
      if (
        !Array.isArray(node.columns) ||
        node.columns.length < 1 ||
        node.columns.length > SCREEN_LIMITS.tableColumns
      )
        return walk.fail(
          at,
          `a table has 1-${SCREEN_LIMITS.tableColumns} columns`,
        )
      const columns: Array<{
        key: string
        label: string
        align?: 'start' | 'end'
      }> = []
      const seen = new Set<string>()
      for (const column of node.columns as unknown[]) {
        if (
          !isRecord(column) ||
          typeof column.key !== 'string' ||
          !NAME_RE.test(column.key) ||
          seen.has(column.key) ||
          typeof column.label !== 'string' ||
          column.label.length < 1 ||
          column.label.length > 60 ||
          (column.align !== undefined &&
            column.align !== 'start' &&
            column.align !== 'end') ||
          Object.keys(column).some(
            (k) => !['key', 'label', 'align'].includes(k),
          )
        )
          return walk.fail(
            at,
            'columns need a unique key (a-z, 0-9, _), a label and an optional align',
          )
        seen.add(column.key)
        columns.push({
          key: column.key,
          label: column.label,
          ...(column.align ? { align: column.align } : {}),
        })
      }
      if (
        !Array.isArray(node.rows) ||
        node.rows.length > SCREEN_LIMITS.tableRows
      )
        return walk.fail(
          at,
          `a table has at most ${SCREEN_LIMITS.tableRows} rows`,
        )
      const rows: Array<Record<string, ScreenCell>> = []
      for (const row of node.rows as unknown[]) {
        if (!isRecord(row)) return walk.fail(at, 'each row is an object')
        const out: Record<string, ScreenCell> = {}
        for (const column of columns) {
          const cell = row[column.key]
          if (cell === undefined || cell === null) {
            out[column.key] = null
            continue
          }
          if (
            !(
              typeof cell === 'string' ||
              typeof cell === 'boolean' ||
              (typeof cell === 'number' && Number.isFinite(cell))
            ) ||
            (typeof cell === 'string' && cell.length > 10_000)
          )
            return walk.fail(
              at,
              'cells are text (up to 10000 characters), numbers, true/false or empty',
            )
          out[column.key] = cell
        }
        rows.push(out)
      }
      return { type: 'table', columns, rows }
    }
    case 'svg': {
      if (!keys(walk, at, node, ['type', 'svg', 'title'])) return null
      if (
        typeof node.svg !== 'string' ||
        byteLength(node.svg) > SCREEN_LIMITS.svgBytes
      )
        return walk.fail(at, 'svg is text up to 64 KiB')
      if (sanitizeSvg(node.svg) === null)
        return walk.fail(
          at,
          'svg uses an element or attribute that is not allowed',
        )
      const title = text(walk, at, 'title', node.title, SCREEN_LIMITS.label)
      if (title === null) return null
      return { type: 'svg', svg: node.svg, title }
    }
    case 'input': {
      if (
        !keys(walk, at, node, [
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
      if (typeof node.name !== 'string' || !NAME_RE.test(node.name))
        return walk.fail(at, 'name matches ^[a-z][a-z0-9_]{0,47}$')
      const label = text(walk, at, 'label', node.label, SCREEN_LIMITS.label)
      if (label === null) return null
      const kind = node.kind ?? 'text'
      if (
        !['text', 'number', 'select', 'checkbox', 'date'].includes(
          kind as string,
        )
      )
        return walk.fail(at, 'kind is text, number, select, checkbox or date')
      let options: ScreenInputOption[] | undefined
      if (kind === 'select') {
        if (
          !Array.isArray(node.options) ||
          node.options.length < 1 ||
          node.options.length > SCREEN_LIMITS.options ||
          !node.options.every(
            (o) =>
              isRecord(o) &&
              typeof o.value === 'string' &&
              o.value.length <= 100 &&
              typeof o.label === 'string' &&
              o.label.length >= 1 &&
              o.label.length <= 100,
          )
        )
          return walk.fail(
            at,
            `a select needs 1-${SCREEN_LIMITS.options} options of { value, label }`,
          )
        options = (node.options as ScreenInputOption[]).map((o) => ({
          value: o.value,
          label: o.label,
        }))
      } else if (node.options !== undefined)
        return walk.fail(at, 'only a select has options')
      if (
        node.value !== undefined &&
        !(
          typeof node.value === 'string' ||
          typeof node.value === 'boolean' ||
          (typeof node.value === 'number' && Number.isFinite(node.value))
        )
      )
        return walk.fail(at, 'value is text, a number or true/false')
      if (node.required !== undefined && typeof node.required !== 'boolean')
        return walk.fail(at, 'required is true or false')
      if (node.help !== undefined && !text(walk, at, 'help', node.help, 300))
        return null
      return {
        type: 'input',
        name: node.name,
        label,
        ...(node.kind ? { kind: node.kind as 'text' } : {}),
        ...(options ? { options } : {}),
        ...(node.value !== undefined ? { value: node.value } : {}),
        ...(node.required !== undefined ? { required: node.required } : {}),
        ...(node.help !== undefined ? { help: node.help as string } : {}),
      }
    }
    case 'button': {
      if (!keys(walk, at, node, ['type', 'label', 'action', 'variant']))
        return null
      const label = text(walk, at, 'label', node.label, 60)
      if (label === null) return null
      if (typeof node.action !== 'string' || !ACTION_RE.test(node.action))
        return walk.fail(at, 'action matches ^[a-z][a-z0-9_-]{0,47}$')
      if (
        node.variant !== undefined &&
        node.variant !== 'primary' &&
        node.variant !== 'secondary'
      )
        return walk.fail(at, 'variant is primary or secondary')
      return {
        type: 'button',
        label,
        action: node.action,
        ...(node.variant ? { variant: node.variant } : {}),
      }
    }
    case 'form': {
      if (!keys(walk, at, node, ['type', 'children', 'submit'])) return null
      const submit = node.submit
      if (
        !isRecord(submit) ||
        typeof submit.label !== 'string' ||
        submit.label.length < 1 ||
        submit.label.length > 60 ||
        typeof submit.action !== 'string' ||
        !ACTION_RE.test(submit.action) ||
        Object.keys(submit).some((k) => !['label', 'action'].includes(k))
      )
        return walk.fail(at, 'submit needs a label and an action')
      const children = parseChildren(walk, node.children, at, depth)
      if (!children) return null
      return {
        type: 'form',
        children,
        submit: { label: submit.label, action: submit.action },
      }
    }
    case 'link': {
      if (!keys(walk, at, node, ['type', 'text', 'to'])) return null
      const label = text(walk, at, 'text', node.text, 100)
      if (label === null) return null
      if (
        typeof node.to !== 'string' ||
        node.to.length > 300 ||
        node.to.startsWith('//') ||
        !INTERNAL_PATH_RE.test(node.to)
      )
        return walk.fail(
          at,
          'to is a path inside Sheetbase, such as /records/…, never a web address',
        )
      return { type: 'link', text: label, to: node.to }
    }
    case 'divider': {
      if (!keys(walk, at, node, ['type'])) return null
      return { type: 'divider' }
    }
    default:
      return walk.fail(path, `unknown part type ${node.type}`)
  }
}

function parseChildren(
  walk: Walk,
  value: unknown,
  path: string,
  depth: number,
): ScreenNode[] | null {
  if (!Array.isArray(value) || value.length > 60)
    return walk.fail(path, 'children is a list of up to 60 parts')
  const out: ScreenNode[] = []
  for (const [index, child] of (value as unknown[]).entries()) {
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
    const n = value.notice
    if (
      !isRecord(n) ||
      !isTone(n.tone) ||
      typeof n.text !== 'string' ||
      n.text.length < 1 ||
      n.text.length > 300 ||
      Object.keys(n).some((k) => !['tone', 'text'].includes(k))
    )
      errors.push('notice needs a tone and text of up to 300 characters')
    else notice = { tone: n.tone, text: n.text }
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
  return {
    ok: true,
    result: {
      view,
      ...(value.state !== undefined && value.state !== null
        ? { state: value.state }
        : {}),
      ...(notice ? { notice } : {}),
    },
  }
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
    const n = value.notice
    if (
      !isRecord(n) ||
      !isTone(n.tone) ||
      typeof n.text !== 'string' ||
      n.text.length < 1 ||
      n.text.length > 300 ||
      Object.keys(n).some((k) => !['tone', 'text'].includes(k))
    )
      errors.push('notice needs a tone and text of up to 300 characters')
    else result.notice = { tone: n.tone, text: n.text }
  }
  if (value.view !== undefined && value.view !== null) {
    const walk = new Walk(errors)
    const view = parseNode(walk, value.view, 'view', 1)
    if (view) result.view = view
  }
  if (value.download !== undefined && value.download !== null) {
    const d = value.download
    if (
      !isRecord(d) ||
      typeof d.filename !== 'string' ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(d.filename) ||
      typeof d.mime !== 'string' ||
      !(ACTION_DOWNLOAD_TYPES as readonly string[]).includes(d.mime) ||
      typeof d.text !== 'string' ||
      byteLength(d.text) > ACTION_DOWNLOAD_BYTES ||
      Object.keys(d).some((k) => !['filename', 'mime', 'text'].includes(k))
    )
      errors.push(
        `download needs a plain file name, a mime type (${ACTION_DOWNLOAD_TYPES.join(', ')}) and text up to 2 MiB`,
      )
    else result.download = { filename: d.filename, mime: d.mime, text: d.text }
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
const SVG_CASE: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  viewbox: 'viewBox',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  preserveaspectratio: 'preserveAspectRatio',
}
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
  if (typeof source !== 'string' || byteLength(source) > SCREEN_LIMITS.svgBytes)
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
      out.push(`</${SVG_CASE[name] ?? name}>`)
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
      attrs.push(`${SVG_CASE[key] ?? key}="${val.replace(/"/g, '&quot;')}"`)
    }
    const selfClosing = match[3] === '/'
    out.push(
      `<${SVG_CASE[name] ?? name}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClosing ? '/' : ''}>`,
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
