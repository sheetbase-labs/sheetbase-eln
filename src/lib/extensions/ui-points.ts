/**
 * Extension points that are whole screens a plugin draws itself, in code it
 * ships (HTML, JavaScript or TypeScript built to JavaScript, CSS). Each runs
 * only in the sandboxed frame (see `ui-frame.ts`) and reaches the lab only
 * through the UI SDK: context in, the plugin's own operations out.
 *
 * - **pages**: a page in the sidebar, under "Plugins".
 * - **settings-pages**: a page in Settings, for the plugin's own settings.
 * - **dashboard-widgets**: a card on Home.
 * - **report-sections**: a section a person adds to a report; what the plugin
 *   hands back is frozen into the report as text.
 *
 * The same strict rules as `hooks.ts`: anything unknown is rejected, never
 * ignored. Browser safe, no server imports.
 */
import { z } from 'zod'

import type { ExtensionContributions } from './manifest'
import { EXTENSION_ID_RE, MAX_EXTENSION_DECLARATIONS } from './points'

export const EXTENSION_UI_POINTS = [
  'pages',
  'settings-pages',
  'dashboard-widgets',
  'report-sections',
] as const

export type ExtensionUiPoint = (typeof EXTENSION_UI_POINTS)[number]

export function isUiPoint(value: string): value is ExtensionUiPoint {
  return z.enum(EXTENSION_UI_POINTS).safeParse(value).success
}

/** The `.html` file in `ui/` a screen runs as. */
export const PLUGIN_UI_FILE_ENTRY_RE = /^ui\/[A-Za-z0-9._/-]{1,100}\.html$/
const ICON_RE = /^[a-z][a-z0-9-]{0,39}$/

export interface ExtensionUiDeclaration {
  id: string
  title: string
  description?: string
  /** A name from the app's icon set; unknown names fall back to the plug icon. */
  icon?: string
  /** The bundle's entry file, such as `ui/page.html`. */
  ui: string
}

export interface ExtensionWidgetDeclaration extends ExtensionUiDeclaration {
  /** `wide` spans two columns on Home. */
  size?: 'normal' | 'wide'
}

export interface ExtensionUiContributions {
  pages?: ExtensionUiDeclaration[]
  'settings-pages'?: ExtensionUiDeclaration[]
  'dashboard-widgets'?: ExtensionWidgetDeclaration[]
  'report-sections'?: ExtensionUiDeclaration[]
}

// Fields are checked below in contract order so an author gets the same first
// error as before. A separate strict parse retains unknown-key diagnostics,
// including __proto__, which a parsed object's output deliberately omits.
const uiEntryInput = z.object({
  id: z.unknown().optional(),
  title: z.unknown().optional(),
  description: z.unknown().optional(),
  icon: z.unknown().optional(),
  ui: z.unknown().optional(),
  size: z.unknown().optional(),
})

export function parseUiPoint(
  point: ExtensionUiPoint,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Uploaded contribution lists enter here; list/object/field schemas reject malformed data before a declaration is returned (ui-points.test.ts).
  value: unknown,
  errors: string[],
): ExtensionWidgetDeclaration[] | null {
  const list = z
    .array(z.unknown())
    .max(MAX_EXTENSION_DECLARATIONS)
    .safeParse(value)

  if (!list.success) {
    errors.push(
      `contributions.${point} must be a list of at most ${MAX_EXTENSION_DECLARATIONS}`,
    )

    return null
  }

  const knownKeys = (
    point === 'dashboard-widgets'
      ? uiEntryInput
      : uiEntryInput.omit({ size: true })
  ).strict()

  const seen = new Set<string>()
  const out: ExtensionWidgetDeclaration[] = []

  for (const raw of list.data) {
    const object = uiEntryInput.safeParse(raw)

    if (!object.success) {
      errors.push(`contributions.${point} entries must be objects`)

      return null
    }

    const entry = object.data
    const id = z.string().regex(EXTENSION_ID_RE).safeParse(entry.id)

    if (!id.success) {
      errors.push(
        `contributions.${point} entry ids must match ^[a-z][a-z0-9-]{0,48}$`,
      )

      return null
    }

    const name = `contributions.${point}.${id.data}`

    if (seen.has(id.data)) {
      errors.push(`contributions.${point} has a duplicate id: ${id.data}`)

      return null
    }

    seen.add(id.data)
    const keys = knownKeys.safeParse(raw)

    const extra = keys.success
      ? undefined
      : keys.error.issues
          .flatMap((issue) =>
            issue.code === 'unrecognized_keys' ? issue.keys : [],
          )
          .at(0)

    if (extra) {
      errors.push(`${name} has an unknown setting: ${extra}`)

      return null
    }

    const title = z.string().trim().min(1).max(120).safeParse(entry.title)

    if (!title.success) {
      errors.push(`${name} title must be 1-120 characters`)

      return null
    }

    const description = z
      .string()
      .trim()
      .min(1)
      .max(600)
      .optional()
      .safeParse(entry.description)

    if (!description.success) {
      errors.push(`${name} description must be 1-600 characters`)

      return null
    }

    const icon = z.string().regex(ICON_RE).optional().safeParse(entry.icon)

    if (!icon.success) {
      errors.push(`${name} icon must be an icon name such as flask`)

      return null
    }

    const ui = z.string().regex(PLUGIN_UI_FILE_ENTRY_RE).safeParse(entry.ui)

    if (!ui.success) {
      errors.push(
        `${name} ui must be an .html file in ui/, such as ui/page.html`,
      )

      return null
    }

    const size = z.enum(['normal', 'wide']).optional().safeParse(entry.size)

    if (!size.success) {
      errors.push(`${name} size is normal or wide`)

      return null
    }

    const declaration: ExtensionWidgetDeclaration = {
      id: id.data,
      title: title.data,
      ui: ui.data,
    }

    if (description.data !== undefined)
      declaration.description = description.data

    if (icon.data !== undefined) declaration.icon = icon.data

    if (size.data) declaration.size = size.data
    out.push(declaration)
  }

  return out
}

/** Every point whose declaration can carry a UI bundle, and the setting that names its entry file. */
export const PLUGIN_FRAME_POINTS = {
  blocks: 'ui',
  panels: 'ui',
  pages: 'ui',
  'settings-pages': 'ui',
  'dashboard-widgets': 'ui',
  'report-sections': 'ui',
  'table-cells': 'render',
  'field-types': 'input',
} as const

export type PluginFramePoint = keyof typeof PLUGIN_FRAME_POINTS

export function isFramePoint(value: string): value is PluginFramePoint {
  return Object.hasOwn(PLUGIN_FRAME_POINTS, value)
}

/** The bundle entry a declaration of `point` runs, or undefined when it draws no UI. */
export function frameEntryOf(
  point: PluginFramePoint,
  declaration:
    | Partial<NonNullable<ExtensionContributions[PluginFramePoint]>[number]>
    | undefined,
): string | undefined {
  if (!declaration) return undefined
  const entry = PLUGIN_FRAME_POINTS[point]

  if (entry === 'ui' && 'ui' in declaration) return declaration.ui

  if (entry === 'render' && 'render' in declaration) return declaration.render

  if (entry === 'input' && 'input' in declaration) return declaration.input

  return undefined
}
