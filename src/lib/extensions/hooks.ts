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
import { z } from 'zod'

import { parseCellDisplay } from './cell-display'
import type { CellDisplaySpec } from './cell-display'
import {
  EXTENSION_ENTRY_RE,
  EXTENSION_FIELD_NAME_RE,
  EXTENSION_ID_RE,
  head as declarationHead,
  list,
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

export type ExtensionPanelSettings = {
  /** Model keys the panel shows on; absent means every record. */
  models?: string[]
} & (ExtensionScreenSource | { screen?: undefined; ui?: undefined })

export type ExtensionPanelDeclaration = {
  id: string
  title: string
} & ExtensionPanelSettings

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
  /** A declared look (text, number, badge, bar, sparkline, svg). */
  display?: CellDisplaySpec
  /**
   * Or code the plugin ships: a UI bundle that draws each cell as an image
   * (SVG or PNG) or text, in a sandboxed frame. Takes over from `display`.
   */
  render?: string
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
  /** A UI bundle that is the field's input in forms (a structure drawer, a sequence editor). */
  input?: string
}

export interface ExtensionHookContributions {
  blocks?: ExtensionBlockDeclaration[]
  'table-cells'?: ExtensionTableCellDeclaration[]
  columns?: ExtensionColumnDeclaration[]
  'row-actions'?: ExtensionRowActionDeclaration[]
  'field-types'?: ExtensionFieldTypeDeclaration[]
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
] as const

const ICON_RE = /^[a-z][a-z0-9-]{0,39}$/

function head(
  point: ExtensionHookPoint,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Manifest identity is parsed immediately by declarationHead; keys must be inspected on the original object to reject unknown JSON keys such as __proto__, covered in hooks.test.ts. No raw values are returned.
  entry: Record<string, unknown>,
  seen: Set<string>,
  errors: string[],
  allowed: readonly string[],
  descriptionRequired = false,
) {
  const parsed = declarationHead(
    point,
    entry,
    seen,
    errors,
    descriptionRequired,
  )

  if (!parsed) return null
  const keys = new Set(allowed)
  const extra = Object.keys(entry).find((key) => !keys.has(key))

  if (extra) {
    errors.push(`${parsed.name} has an unknown setting: ${extra}`)

    return null
  }

  return parsed
}

function runnerOf(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Hook screen/runner objects arrive from plugin manifests; both literal kind and entry grammar are parsed before returning a runner.
  value: unknown,
  errors: string[],
): ExtensionRunner | null {
  const parsed = z
    .object({
      kind: z.literal('python'),
      entry: z.string().regex(EXTENSION_ENTRY_RE),
    })
    .safeParse(value)

  if (!parsed.success) {
    errors.push(
      `${where} needs a python runner whose entry looks like module:function`,
    )

    return null
  }

  return parsed.data
}

function modelKeys(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The manifest's optional model selector is parsed as 1-25 model keys before deduplication.
  value: unknown,
  errors: string[],
): string[] | undefined | null {
  if (value === undefined) return undefined

  const parsed = z
    .array(z.string().regex(MODEL_KEY_RE))
    .min(1)
    .max(25)
    .safeParse(value)

  if (!parsed.success) {
    errors.push(`${where} models is a list of 1-25 model keys`)

    return null
  }

  return [...new Set(parsed.data)]
}

function fieldNames(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The manifest's optional input selector is parsed as 1-24 field names before deduplication.
  value: unknown,
  errors: string[],
): string[] | undefined | null {
  if (value === undefined) return undefined

  const parsed = z
    .array(z.string().regex(EXTENSION_FIELD_NAME_RE))
    .min(1)
    .max(24)
    .safeParse(value)

  if (!parsed.success) {
    errors.push(`${where} inputs is a list of 1-24 field names`)

    return null
  }

  return [...new Set(parsed.data)]
}

/** A block's or panel's screen: exactly one of a Python function or a UI bundle file. */
function screenSource(
  where: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This screen-source boundary first parses the settings object, then rejects ambiguous sources and validates the Python runner or UI path before returning a typed source.
  value: unknown,
  errors: string[],
  optional: boolean,
): ExtensionScreenSource | 'none' | null {
  const settings = z
    .object({ screen: z.unknown().optional(), ui: z.unknown().optional() })
    .safeParse(value)

  if (!settings.success) {
    errors.push(`${where} must be an object`)

    return null
  }

  const entry = settings.data
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

  const ui = z.string().regex(PLUGIN_UI_ENTRY_RE).safeParse(entry.ui)

  if (!ui.success) {
    errors.push(
      `${where} ui must be an .html file in ui/, such as ui/index.html`,
    )

    return null
  }

  return { ui: ui.data }
}

export function parseBlocks(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This manifest boundary parses the bounded object list, identity, icon and exactly one checked screen/UI source before constructing blocks. hooks.test.ts covers invalid identity and unknown raw JSON keys.
  value: unknown,
  errors: string[],
): ExtensionBlockDeclaration[] | null {
  const entries = list('blocks', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionBlockDeclaration[] = []

  for (const entry of entries) {
    const metadata = head(
      'blocks',
      entry,
      seen,
      errors,
      ['id', 'title', 'description', 'icon', 'screen', 'ui'],
      true,
    )

    if (!metadata) return null
    const { name, identity } = metadata
    const icon = z.string().regex(ICON_RE).optional().safeParse(entry.icon)

    if (!icon.success) {
      errors.push(`${name} icon must be an icon name such as flask`)

      return null
    }

    const source = screenSource(name, entry, errors, false)

    if (!source || source === 'none') return null

    const declaration: ExtensionBlockDeclaration = {
      id: identity.id,
      title: identity.title,
      description: identity.description ?? '',
      ...source,
    }

    if (icon.data !== undefined) declaration.icon = icon.data
    out.push(declaration)
  }

  return out
}

/** Panels keep their older `{ id, title }` shape; a screen, a ui and model keys are optional. */
export function parsePanelDetails(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This panel-settings boundary checks the object, mutually exclusive screen/UI and optional model keys before returning typed details; hooks.test.ts covers malformed objects, sources and selectors.
  value: unknown,
  where: string,
  errors: string[],
): ExtensionPanelSettings | null {
  const settings = z.object({ models: z.unknown().optional() }).safeParse(value)

  if (!settings.success) {
    errors.push(`${where} must be an object`)

    return null
  }

  const source = screenSource(where, value, errors, true)

  if (!source) return null
  const models = modelKeys(where, settings.data.models, errors)

  if (models === null) return null

  const details: ExtensionPanelSettings = source === 'none' ? {} : source

  if (models) details.models = models

  return details
}

export function parseTableCells(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw manifest table-cell declarations are parsed here, including strict appliesTo selectors and display/render contracts; package fixtures and hooks.test.ts cover malformed declarations.
  value: unknown,
  errors: string[],
): ExtensionTableCellDeclaration[] | null {
  const entries = list('table-cells', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionTableCellDeclaration[] = []

  for (const entry of entries) {
    const metadata = head('table-cells', entry, seen, errors, [
      'id',
      'title',
      'description',
      'appliesTo',
      'display',
      'render',
    ])

    if (!metadata) return null
    const { name, identity } = metadata

    const target = z
      .strictObject({
        fieldTypes: z.unknown().optional(),
        models: z.unknown().optional(),
        fields: z.unknown().optional(),
        pluginTypes: z.unknown().optional(),
      })
      .safeParse(entry.appliesTo)

    if (!target.success || Object.keys(target.data).length === 0) {
      errors.push(
        `${name} appliesTo says which cells: fieldTypes, models, fields or pluginTypes`,
      )

      return null
    }

    const applies: ExtensionTableCellDeclaration['appliesTo'] = {}

    if (target.data.fieldTypes !== undefined) {
      const types = z
        .array(z.enum(FIELD_TYPE_NAMES))
        .min(1)
        .safeParse(target.data.fieldTypes)

      if (!types.success) {
        errors.push(
          `${name} appliesTo.fieldTypes are field types such as decimal`,
        )

        return null
      }

      applies.fieldTypes = [...new Set(types.data)]
    }

    const keyed = modelKeys(`${name} appliesTo`, target.data.models, errors)

    if (keyed === null) return null

    if (keyed) applies.models = keyed

    if (target.data.fields !== undefined) {
      const fields = z
        .array(z.string().regex(EXTENSION_FIELD_NAME_RE))
        .min(1)
        .max(25)
        .safeParse(target.data.fields)

      if (!fields.success) {
        errors.push(`${name} appliesTo.fields are 1-25 field names`)

        return null
      }

      applies.fields = [...new Set(fields.data)]
    }

    if (target.data.pluginTypes !== undefined) {
      const types = z
        .array(z.string().regex(EXTENSION_ID_RE))
        .min(1)
        .safeParse(target.data.pluginTypes)

      if (!types.success) {
        errors.push(
          `${name} appliesTo.pluginTypes are the ids of this plugin's field types`,
        )

        return null
      }

      applies.pluginTypes = [...new Set(types.data)]
    }

    if ((entry.display === undefined) === (entry.render === undefined)) {
      errors.push(
        `${name} needs a display (a declared look) or a render (a UI bundle that draws the cells), not both`,
      )

      return null
    }

    let display: CellDisplaySpec | undefined

    if (entry.display !== undefined) {
      const parsed = parseCellDisplay(entry.display, name, errors)

      if (!parsed) return null
      display = parsed
    }

    const render = z
      .string()
      .regex(PLUGIN_UI_ENTRY_RE)
      .optional()
      .safeParse(entry.render)

    if (!render.success) {
      errors.push(
        `${name} render must be an .html file in ui/, such as ui/cells.html`,
      )

      return null
    }

    const declaration: ExtensionTableCellDeclaration = {
      id: identity.id,
      title: identity.title,
      appliesTo: applies,
    }

    if (display) declaration.display = display

    if (render.data !== undefined) declaration.render = render.data
    out.push(declaration)
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the manifest column boundary: list, identity, value type, runner, selectors, display and header actions are checked before constructing columns. hooks.test.ts checks malformed selectors.
  value: unknown,
  errors: string[],
): ExtensionColumnDeclaration[] | null {
  const entries = list('columns', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionColumnDeclaration[] = []

  for (const entry of entries) {
    const metadata = head('columns', entry, seen, errors, [
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

    if (!metadata) return null
    const { name, identity } = metadata

    const valueType = z
      .enum(EXTENSION_COLUMN_VALUE_TYPES)
      .safeParse(entry.value)

    if (!valueType.success) {
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
      const actionList = z
        .array(z.unknown())
        .min(1)
        .max(10)
        .safeParse(entry.actions)

      if (!actionList.success) {
        errors.push(`${name} actions are 1-10 header menu entries`)

        return null
      }

      const ids = new Set<string>()
      actions = []

      for (const raw of actionList.data) {
        const action = z
          .strictObject({
            id: z.string().regex(EXTENSION_ID_RE),
            title: z.string().trim().min(1).max(80),
            runner: z.unknown().optional(),
          })
          .safeParse(raw)

        if (!action.success || ids.has(action.data.id)) {
          errors.push(`${name} actions need a unique id, a title and a runner`)

          return null
        }

        ids.add(action.data.id)

        const actionRun = runnerOf(
          `${name} action ${action.data.id}`,
          action.data.runner,
          errors,
        )

        if (!actionRun) return null
        actions.push({
          id: action.data.id,
          title: action.data.title,
          runner: actionRun,
        })
      }
    }

    const declaration: ExtensionColumnDeclaration = {
      id: identity.id,
      title: identity.title,
      value: valueType.data,
      runner: run,
    }

    if (identity.description !== undefined)
      declaration.description = identity.description

    if (models) declaration.models = models

    if (display) declaration.display = display

    if (inputs) declaration.inputs = inputs

    if (actions) declaration.actions = actions
    out.push(declaration)
  }

  return out
}

export function parseRowActions(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw row-action declarations enter from manifests; this parser checks identity, selection, runner and model/input selectors before returning actions. Shared package fixtures exercise rejection.
  value: unknown,
  errors: string[],
): ExtensionRowActionDeclaration[] | null {
  const entries = list('row-actions', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionRowActionDeclaration[] = []

  for (const entry of entries) {
    const metadata = head(
      'row-actions',
      entry,
      seen,
      errors,
      ['id', 'title', 'description', 'models', 'selection', 'runner', 'inputs'],
      true,
    )

    if (!metadata) return null
    const { name, identity } = metadata

    if (entry.selection !== 'one' && entry.selection !== 'many') {
      errors.push(`${name} selection is one or many`)

      return null
    }

    const run = runnerOf(`${name} runner`, entry.runner, errors)
    const models = modelKeys(name, entry.models, errors)
    const inputs = fieldNames(name, entry.inputs, errors)

    if (!run || models === null || inputs === null) return null

    const declaration: ExtensionRowActionDeclaration = {
      id: identity.id,
      title: identity.title,
      description: identity.description ?? '',
      selection: entry.selection,
      runner: run,
    }

    if (models) declaration.models = models

    if (inputs) declaration.inputs = inputs
    out.push(declaration)
  }

  return out
}

const BASE_TYPES = ['text', 'integer', 'decimal'] as const

const fieldTypeOptions = z.object({
  pattern: z
    .string()
    .max(200)
    .refine((pattern) => {
      if (!pattern.startsWith('^') || !pattern.endsWith('$')) return false

      try {
        new RegExp(pattern)

        return true
      } catch {
        return false
      }
    })
    .optional(),
  patternMessage: z.string().trim().min(1).max(160).optional(),
  minLength: z.number().int().min(0).max(10000).optional(),
  maxLength: z.number().int().min(0).max(10000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().trim().min(1).max(80).optional(),
})

export function parseFieldTypes(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This manifest boundary parses identity, base, bounded options, display and UI path before constructing field types. hooks.test.ts covers malformed patterns, numeric limits, path traversal and error precedence.
  value: unknown,
  errors: string[],
): ExtensionFieldTypeDeclaration[] | null {
  const entries = list('field-types', value, errors)

  if (!entries) return null
  const seen = new Set<string>()
  const out: ExtensionFieldTypeDeclaration[] = []

  for (const entry of entries) {
    const metadata = head('field-types', entry, seen, errors, [
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
      'input',
    ])

    if (!metadata) return null
    const { name, identity } = metadata
    const base = z.enum(BASE_TYPES).safeParse(entry.base)

    if (!base.success) {
      errors.push(`${name} base is ${BASE_TYPES.join(', ')}`)

      return null
    }

    const textOnly = ['pattern', 'patternMessage', 'minLength', 'maxLength']
    const numberOnly = ['min', 'max']

    for (const key of base.data === 'text' ? numberOnly : textOnly)
      if (entry[key] !== undefined) {
        errors.push(`${name} ${key} does not apply to a ${base.data} type`)

        return null
      }

    const options = fieldTypeOptions.safeParse(entry)

    if (!options.success) {
      const key = options.error.issues[0]?.path[0]

      const problem =
        key === 'pattern'
          ? 'pattern must be an anchored expression (^…$) up to 200 characters'
          : key === 'patternMessage'
            ? 'patternMessage is 1-160 characters'
            : key === 'minLength' || key === 'maxLength'
              ? `${key} is a whole number up to 10000`
              : key === 'min' || key === 'max'
                ? `${key} is a number`
                : 'placeholder is 1-80 characters'

      errors.push(`${name} ${problem}`)

      return null
    }

    let display: CellDisplaySpec | undefined

    if (entry.display !== undefined) {
      const parsed = parseCellDisplay(entry.display, name, errors)

      if (!parsed) return null

      display = parsed
    }

    const input = z
      .string()
      .regex(PLUGIN_UI_ENTRY_RE)
      .optional()
      .safeParse(entry.input)

    if (!input.success) {
      errors.push(
        `${name} input must be an .html file in ui/, such as ui/input.html`,
      )

      return null
    }

    const declaration: ExtensionFieldTypeDeclaration = {
      id: identity.id,
      title: identity.title,
      base: base.data,
    }

    if (identity.description !== undefined)
      declaration.description = identity.description

    if (input.data !== undefined) declaration.input = input.data

    if (options.data.pattern !== undefined)
      declaration.pattern = options.data.pattern

    if (options.data.patternMessage !== undefined)
      declaration.patternMessage = options.data.patternMessage

    if (options.data.minLength !== undefined)
      declaration.minLength = options.data.minLength

    if (options.data.maxLength !== undefined)
      declaration.maxLength = options.data.maxLength

    if (options.data.min !== undefined) declaration.min = options.data.min

    if (options.data.max !== undefined) declaration.max = options.data.max

    if (options.data.placeholder !== undefined)
      declaration.placeholder = options.data.placeholder

    if (display) declaration.display = display
    out.push(declaration)
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
