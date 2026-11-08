/**
 * Extension points that put a plugin into the app's screens and tables:
 * notebook blocks, record panels, table cell displays, computed columns,
 * row actions and model field types.
 *
 * Like `points.ts`, every declaration is strict and anything unknown is
 * rejected, never ignored. What a declaration points at is either a Python
 * function (a screen, a column, a row action) or a declarative spec that the
 * app draws itself (a cell display, a field type's look and checks); nothing a
 * plugin ships ever runs inside a table cell or in the app's own page. A plugin
 * UI bundle (`ui`) runs only in a sandboxed frame (see `ui-frame.ts`).
 *
 * The stored form uses `runner` objects, like operations; the package author
 * writes `run` and `screen` as `module:function` and `package.ts` converts.
 *
 * Browser safe, no server imports.
 */
import { parseCellDisplay } from './cell-display'
import type { CellDisplaySpec } from './cell-display'
import {
  EXTENSION_ENTRY_RE,
  EXTENSION_FIELD_NAME_RE,
  EXTENSION_ID_RE,
  MAX_EXTENSION_DECLARATIONS,
} from './points'
import type { ExtensionRunner } from './points'

export const EXTENSION_HOOK_POINTS = [
  'blocks',
  'table-cells',
  'columns',
  'row-actions',
  'field-types',
] as const
export type ExtensionHookPoint = (typeof EXTENSION_HOOK_POINTS)[number]

/** The screen of a block or panel: a Python function that describes it, or a UI bundle in a sandboxed frame. */
export type ExtensionScreenSource =
  | { screen: ExtensionRunner; ui?: undefined }
  | { ui: string; screen?: undefined }

export const PLUGIN_UI_ENTRY_RE = /^ui\/[A-Za-z0-9._/-]{1,100}\.html$/

export type ExtensionBlockDeclaration = {
  id: string
  title: string
  description: string
  /** A name from the app's icon set; unknown names fall back to the plug icon. */
  icon?: string
} & ExtensionScreenSource

export type ExtensionPanelDeclaration = {
  id: string
  title: string
  /** Model keys the panel shows on; absent means every record. */
  models?: string[]
} & (ExtensionScreenSource | { screen?: undefined; ui?: undefined })

export interface ExtensionTableCellDeclaration {
  id: string
  title: string
  /** Which cells it draws: fields of these logical types, in these models, or named plugin field types. */
  appliesTo: {
    fieldTypes?: string[]
    models?: string[]
    fields?: string[]
    pluginTypes?: string[]
  }
  display: CellDisplaySpec
}

export type ExtensionColumnValueType = 'number' | 'text' | 'boolean' | 'svg'

export interface ExtensionColumnAction {
  id: string
  title: string
  runner: ExtensionRunner
}

export interface ExtensionColumnDeclaration {
  id: string
  title: string
  description?: string
  /** Model keys the column shows in; absent means every model's record list. */
  models?: string[]
  /** What each row gets back. */
  value: ExtensionColumnValueType
  display?: CellDisplaySpec
  /** The Python function: rows in (one object per row), one value per row out. */
  runner: ExtensionRunner
  /** Field names the function reads; absent sends all of them. */
  inputs?: string[]
  /** Entries in the column's header menu. */
  actions?: ExtensionColumnAction[]
}

export interface ExtensionRowActionDeclaration {
  id: string
  title: string
  description: string
  models?: string[]
  /** `one` offers it for a single chosen row, `many` for any selection. */
  selection: 'one' | 'many'
  runner: ExtensionRunner
  inputs?: string[]
}

export type ExtensionFieldTypeBase = 'text' | 'integer' | 'decimal'

export interface ExtensionFieldTypeDeclaration {
  id: string
  title: string
  description?: string
  /** What the database stores it as. */
  base: ExtensionFieldTypeBase
  /** Anchored pattern a text value has to match (stored as the field's own regex check). */
  pattern?: string
  /** Said when a value does not match. */
  patternMessage?: string
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  placeholder?: string
  display?: CellDisplaySpec
}

export interface ExtensionHookContributions {
  blocks?: ExtensionBlockDeclaration[]
  'table-cells'?: ExtensionTableCellDeclaration[]
  columns?: ExtensionColumnDeclaration[]
  'row-actions'?: ExtensionRowActionDeclaration[]
  'field-types'?: ExtensionFieldTypeDeclaration[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function words(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max
  )
}

const MODEL_KEY_RE = /^[a-z][a-z0-9_-]{0,63}$/
const FIELD_TYPE_NAMES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
  'reference',
]
const ICON_RE = /^[a-z][a-z0-9-]{0,39}$/

function list(
  point: string,
  value: unknown,
  errors: string[],
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length > MAX_EXTENSION_DECLARATIONS) {
    errors.push(
      `contributions.${point} must be a list of at most ${MAX_EXTENSION_DECLARATIONS}`,
    )
    return null
  }
  const out: Array<Record<string, unknown>> = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      errors.push(`contributions.${point} entries must be objects`)
      return null
    }
    out.push(entry)
  }
  return out
}

function head(
  point: string,
  entry: Record<string, unknown>,
  seen: Set<string>,
  errors: string[],
  allowed: readonly string[],
  descriptionRequired = false,
): string | null {
  if (typeof entry.id !== 'string' || !EXTENSION_ID_RE.test(entry.id)) {
    errors.push(
      `contributions.${point} entry ids must match ^[a-z][a-z0-9-]{0,48}$`,
    )
    return null
  }
  const name = `contributions.${point}.${entry.id}`
  if (seen.has(entry.id)) {
    errors.push(`contributions.${point} has a duplicate id: ${entry.id}`)
    return null
  }
  seen.add(entry.id)
  if (!words(entry.title, 1, 120)) {
    errors.push(`${name} title must be 1-120 characters`)
    return null
  }
  if (
    descriptionRequired
      ? !words(entry.description, 1, 600)
      : entry.description !== undefined && !words(entry.description, 1, 600)
  ) {
    errors.push(`${name} description must be 1-600 characters`)
    return null
  }
  const extra = Object.keys(entry).find((key) => !allowed.includes(key))
  if (extra) {
    errors.push(`${name} has an unknown setting: ${extra}`)
    return null
  }
  return name
}

function runnerOf(
  where: string,
  value: unknown,
  errors: string[],
): ExtensionRunner | null {
  if (
    !isRecord(value) ||
    value.kind !== 'python' ||
    typeof value.entry !== 'string' ||
    !EXTENSION_ENTRY_RE.test(value.entry)
  ) {
    errors.push(
      `${where} needs a python runner whose entry looks like module:function`,
    )
    return null
  }
  return { kind: 'python', entry: value.entry }
}

function modelKeys(
  where: string,
  value: unknown,
  errors: string[],
): string[] | undefined | null {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 25 ||
    !value.every((k) => typeof k === 'string' && MODEL_KEY_RE.test(k))
  ) {
    errors.push(`${where} models is a list of 1-25 model keys`)
    return null
  }
  return [...new Set(value as string[])]
}

function fieldNames(
  where: string,
  value: unknown,
  errors: string[],
): string[] | undefined | null {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 24 ||
    !value.every(
      (k) => typeof k === 'string' && EXTENSION_FIELD_NAME_RE.test(k),
    )
  ) {
    errors.push(`${where} inputs is a list of 1-24 field names`)
    return null
  }
  return [...new Set(value as string[])]
}

/** A block's or panel's screen: exactly one of a Python function or a UI bundle file. */
function screenSource(
  where: string,
  entry: Record<string, unknown>,
  errors: string[],
  optional: boolean,
): ExtensionScreenSource | 'none' | null {
  const hasScreen = entry.screen !== undefined
  const hasUi = entry.ui !== undefined
  if (hasScreen && hasUi) {
    errors.push(`${where} has a screen or a ui, not both`)
    return null
  }
  if (!hasScreen && !hasUi) {
    if (optional) return 'none'
    errors.push(`${where} needs a screen (Python) or a ui (a bundle in ui/)`)
    return null
  }
  if (hasScreen) {
    const run = runnerOf(`${where} screen`, entry.screen, errors)
    return run ? { screen: run } : null
  }
  if (typeof entry.ui !== 'string' || !PLUGIN_UI_ENTRY_RE.test(entry.ui)) {
    errors.push(
      `${where} ui must be an .html file in ui/, such as ui/index.html`,
    )
    return null
  }
  return { ui: entry.ui }
}

export function parseBlocks(
  value: unknown,
  errors: string[],
): ExtensionBlockDeclaration[] | null {
  const entries = list('blocks', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionBlockDeclaration[] = []
  for (const entry of entries) {
    const name = head(
      'blocks',
      entry,
      seen,
      errors,
      ['id', 'title', 'description', 'icon', 'screen', 'ui'],
      true,
    )
    if (!name) return null
    if (
      entry.icon !== undefined &&
      !(typeof entry.icon === 'string' && ICON_RE.test(entry.icon))
    ) {
      errors.push(`${name} icon must be an icon name such as flask`)
      return null
    }
    const source = screenSource(name, entry, errors, false)
    if (!source || source === 'none') return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      description: (entry.description as string).trim(),
      ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
      ...source,
    })
  }
  return out
}

/** Panels keep their older `{ id, title }` shape; a screen, a ui and model keys are optional. */
export function parsePanelDetails(
  entry: Record<string, unknown>,
  where: string,
  errors: string[],
): Pick<ExtensionPanelDeclaration, 'screen' | 'ui' | 'models'> | null {
  const source = screenSource(where, entry, errors, true)
  if (!source) return null
  const models = modelKeys(where, entry.models, errors)
  if (models === null) return null
  return {
    ...(source === 'none' ? {} : source),
    ...(models ? { models } : {}),
  }
}

export function parseTableCells(
  value: unknown,
  errors: string[],
): ExtensionTableCellDeclaration[] | null {
  const entries = list('table-cells', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionTableCellDeclaration[] = []
  for (const entry of entries) {
    const name = head('table-cells', entry, seen, errors, [
      'id',
      'title',
      'description',
      'appliesTo',
      'display',
    ])
    if (!name) return null
    const target = entry.appliesTo
    if (
      !isRecord(target) ||
      Object.keys(target).some(
        (k) => !['fieldTypes', 'models', 'fields', 'pluginTypes'].includes(k),
      ) ||
      Object.keys(target).length === 0
    ) {
      errors.push(
        `${name} appliesTo says which cells: fieldTypes, models, fields or pluginTypes`,
      )
      return null
    }
    const applies: ExtensionTableCellDeclaration['appliesTo'] = {}
    if (target.fieldTypes !== undefined) {
      if (
        !Array.isArray(target.fieldTypes) ||
        target.fieldTypes.length < 1 ||
        !target.fieldTypes.every(
          (t) => typeof t === 'string' && FIELD_TYPE_NAMES.includes(t),
        )
      ) {
        errors.push(
          `${name} appliesTo.fieldTypes are field types such as decimal`,
        )
        return null
      }
      applies.fieldTypes = [...new Set(target.fieldTypes as string[])]
    }
    const keyed = modelKeys(`${name} appliesTo`, target.models, errors)
    if (keyed === null) return null
    if (keyed) applies.models = keyed
    if (target.fields !== undefined) {
      if (
        !Array.isArray(target.fields) ||
        target.fields.length < 1 ||
        target.fields.length > 25 ||
        !target.fields.every(
          (f) => typeof f === 'string' && EXTENSION_FIELD_NAME_RE.test(f),
        )
      ) {
        errors.push(`${name} appliesTo.fields are 1-25 field names`)
        return null
      }
      applies.fields = [...new Set(target.fields as string[])]
    }
    if (target.pluginTypes !== undefined) {
      if (
        !Array.isArray(target.pluginTypes) ||
        target.pluginTypes.length < 1 ||
        !target.pluginTypes.every(
          (t) => typeof t === 'string' && EXTENSION_ID_RE.test(t),
        )
      ) {
        errors.push(
          `${name} appliesTo.pluginTypes are the ids of this plugin's field types`,
        )
        return null
      }
      applies.pluginTypes = [...new Set(target.pluginTypes as string[])]
    }
    const display = parseCellDisplay(entry.display, name, errors)
    if (!display) return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      appliesTo: applies,
      display,
    })
  }
  return out
}

export const EXTENSION_COLUMN_VALUE_TYPES = [
  'number',
  'text',
  'boolean',
  'svg',
] as const

export function parseColumns(
  value: unknown,
  errors: string[],
): ExtensionColumnDeclaration[] | null {
  const entries = list('columns', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionColumnDeclaration[] = []
  for (const entry of entries) {
    const name = head('columns', entry, seen, errors, [
      'id',
      'title',
      'description',
      'models',
      'value',
      'display',
      'runner',
      'inputs',
      'actions',
    ])
    if (!name) return null
    if (
      typeof entry.value !== 'string' ||
      !(EXTENSION_COLUMN_VALUE_TYPES as readonly string[]).includes(entry.value)
    ) {
      errors.push(`${name} value is ${EXTENSION_COLUMN_VALUE_TYPES.join(', ')}`)
      return null
    }
    const run = runnerOf(`${name} runner`, entry.runner, errors)
    const models = modelKeys(name, entry.models, errors)
    const inputs = fieldNames(name, entry.inputs, errors)
    if (!run || models === null || inputs === null) return null
    let display: CellDisplaySpec | undefined
    if (entry.display !== undefined) {
      const parsed = parseCellDisplay(entry.display, name, errors)
      if (!parsed) return null
      display = parsed
    }
    let actions: ExtensionColumnAction[] | undefined
    if (entry.actions !== undefined) {
      if (
        !Array.isArray(entry.actions) ||
        entry.actions.length < 1 ||
        entry.actions.length > 10
      ) {
        errors.push(`${name} actions are 1-10 header menu entries`)
        return null
      }
      const ids = new Set<string>()
      actions = []
      for (const action of entry.actions as unknown[]) {
        if (
          !isRecord(action) ||
          typeof action.id !== 'string' ||
          !EXTENSION_ID_RE.test(action.id) ||
          ids.has(action.id) ||
          !words(action.title, 1, 80) ||
          Object.keys(action).some(
            (k) => !['id', 'title', 'runner'].includes(k),
          )
        ) {
          errors.push(`${name} actions need a unique id, a title and a runner`)
          return null
        }
        ids.add(action.id)
        const actionRun = runnerOf(
          `${name} action ${action.id}`,
          action.runner,
          errors,
        )
        if (!actionRun) return null
        actions.push({
          id: action.id,
          title: (action.title as string).trim(),
          runner: actionRun,
        })
      }
    }
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      ...(models ? { models } : {}),
      value: entry.value as ExtensionColumnValueType,
      ...(display ? { display } : {}),
      runner: run,
      ...(inputs ? { inputs } : {}),
      ...(actions ? { actions } : {}),
    })
  }
  return out
}

export function parseRowActions(
  value: unknown,
  errors: string[],
): ExtensionRowActionDeclaration[] | null {
  const entries = list('row-actions', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionRowActionDeclaration[] = []
  for (const entry of entries) {
    const name = head(
      'row-actions',
      entry,
      seen,
      errors,
      ['id', 'title', 'description', 'models', 'selection', 'runner', 'inputs'],
      true,
    )
    if (!name) return null
    if (entry.selection !== 'one' && entry.selection !== 'many') {
      errors.push(`${name} selection is one or many`)
      return null
    }
    const run = runnerOf(`${name} runner`, entry.runner, errors)
    const models = modelKeys(name, entry.models, errors)
    const inputs = fieldNames(name, entry.inputs, errors)
    if (!run || models === null || inputs === null) return null
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      description: (entry.description as string).trim(),
      ...(models ? { models } : {}),
      selection: entry.selection,
      runner: run,
      ...(inputs ? { inputs } : {}),
    })
  }
  return out
}

const BASE_TYPES = ['text', 'integer', 'decimal'] as const

export function parseFieldTypes(
  value: unknown,
  errors: string[],
): ExtensionFieldTypeDeclaration[] | null {
  const entries = list('field-types', value, errors)
  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionFieldTypeDeclaration[] = []
  for (const entry of entries) {
    const name = head('field-types', entry, seen, errors, [
      'id',
      'title',
      'description',
      'base',
      'pattern',
      'patternMessage',
      'minLength',
      'maxLength',
      'min',
      'max',
      'placeholder',
      'display',
    ])
    if (!name) return null
    if (!(BASE_TYPES as readonly string[]).includes(entry.base as string)) {
      errors.push(`${name} base is ${BASE_TYPES.join(', ')}`)
      return null
    }
    const base = entry.base as ExtensionFieldTypeBase
    const textOnly = ['pattern', 'patternMessage', 'minLength', 'maxLength']
    const numberOnly = ['min', 'max']
    for (const key of base === 'text' ? numberOnly : textOnly)
      if (entry[key] !== undefined) {
        errors.push(`${name} ${key} does not apply to a ${base} type`)
        return null
      }
    if (entry.pattern !== undefined) {
      const pattern = entry.pattern
      let valid = typeof pattern === 'string' && pattern.length <= 200
      if (valid) {
        const p = pattern as string
        valid = p.startsWith('^') && p.endsWith('$')
        if (valid)
          try {
            new RegExp(p)
          } catch {
            valid = false
          }
      }
      if (!valid) {
        errors.push(
          `${name} pattern must be an anchored expression (^…$) up to 200 characters`,
        )
        return null
      }
    }
    if (
      entry.patternMessage !== undefined &&
      !words(entry.patternMessage, 1, 160)
    ) {
      errors.push(`${name} patternMessage is 1-160 characters`)
      return null
    }
    for (const key of ['minLength', 'maxLength'] as const)
      if (
        entry[key] !== undefined &&
        !(
          Number.isInteger(entry[key]) &&
          (entry[key] as number) >= 0 &&
          (entry[key] as number) <= 10000
        )
      ) {
        errors.push(`${name} ${key} is a whole number up to 10000`)
        return null
      }
    for (const key of ['min', 'max'] as const)
      if (
        entry[key] !== undefined &&
        !(typeof entry[key] === 'number' && Number.isFinite(entry[key]))
      ) {
        errors.push(`${name} ${key} is a number`)
        return null
      }
    if (entry.placeholder !== undefined && !words(entry.placeholder, 1, 80)) {
      errors.push(`${name} placeholder is 1-80 characters`)
      return null
    }
    let display: CellDisplaySpec | undefined
    if (entry.display !== undefined) {
      const parsed = parseCellDisplay(entry.display, name, errors)
      if (!parsed) return null
      display = parsed
    }
    out.push({
      id: entry.id as string,
      title: (entry.title as string).trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      base,
      ...(entry.pattern !== undefined
        ? { pattern: entry.pattern as string }
        : {}),
      ...(entry.patternMessage !== undefined
        ? { patternMessage: (entry.patternMessage as string).trim() }
        : {}),
      ...(entry.minLength !== undefined
        ? { minLength: entry.minLength as number }
        : {}),
      ...(entry.maxLength !== undefined
        ? { maxLength: entry.maxLength as number }
        : {}),
      ...(entry.min !== undefined ? { min: entry.min as number } : {}),
      ...(entry.max !== undefined ? { max: entry.max as number } : {}),
      ...(entry.placeholder !== undefined
        ? { placeholder: (entry.placeholder as string).trim() }
        : {}),
      ...(display ? { display } : {}),
    })
  }
  return out
}

/** The reference a model field keeps to a plugin field type: `<plugin key>/<type id>`. */
export function pluginFieldTypeRef(pluginKey: string, typeId: string): string {
  return `${pluginKey}/${typeId}`
}

const FIELD_TYPE_REF_RE = /^([a-z][a-z0-9-]{0,48})\/([a-z][a-z0-9-]{0,48})$/
export function parseFieldTypeRef(
  ref: string,
): { key: string; id: string } | null {
  const match = FIELD_TYPE_REF_RE.exec(ref)
  return match ? { key: match[1], id: match[2] } : null
}

/** How the app would check a value against a declared field type, before it reaches the database. */
export function checkFieldTypeValue(
  type: ExtensionFieldTypeDeclaration,
  value: string,
): string | null {
  if (value === '') return null
  if (type.base === 'text') {
    if (type.minLength !== undefined && value.length < type.minLength)
      return `Use at least ${type.minLength} characters.`
    if (type.maxLength !== undefined && value.length > type.maxLength)
      return `Use at most ${type.maxLength} characters.`
    if (type.pattern && !new RegExp(type.pattern).test(value))
      return type.patternMessage ?? `That doesn’t look like ${type.title}.`
    return null
  }
  const n = Number(value)
  if (!Number.isFinite(n) || (type.base === 'integer' && !Number.isInteger(n)))
    return type.base === 'integer' ? 'Use a whole number.' : 'Use a number.'
  if (type.min !== undefined && n < type.min) return `Use ${type.min} or more.`
  if (type.max !== undefined && n > type.max) return `Use ${type.max} or less.`
  return null
}
