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
import { EXTENSION_ID_RE, MAX_EXTENSION_DECLARATIONS } from './points'

export const EXTENSION_UI_POINTS = [
  'pages',
  'settings-pages',
  'dashboard-widgets',
  'report-sections',
] as const
export type ExtensionUiPoint = (typeof EXTENSION_UI_POINTS)[number]

export function isUiPoint(value: string): value is ExtensionUiPoint {
  return (EXTENSION_UI_POINTS as readonly string[]).includes(value)
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

export function parseUiPoint(
  point: ExtensionUiPoint,
  value: unknown,
  errors: string[],
): ExtensionWidgetDeclaration[] | null {
  if (!Array.isArray(value) || value.length > MAX_EXTENSION_DECLARATIONS) {
    errors.push(
      `contributions.${point} must be a list of at most ${MAX_EXTENSION_DECLARATIONS}`,
    )
    return null
  }
  const allowed = [
    'id',
    'title',
    'description',
    'icon',
    'ui',
    ...(point === 'dashboard-widgets' ? ['size'] : []),
  ]
  const seen = new Set<string>()
  const out: ExtensionWidgetDeclaration[] = []
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) {
      errors.push(`contributions.${point} entries must be objects`)
      return null
    }
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
    const extra = Object.keys(entry).find((key) => !allowed.includes(key))
    if (extra) {
      errors.push(`${name} has an unknown setting: ${extra}`)
      return null
    }
    if (!words(entry.title, 1, 120)) {
      errors.push(`${name} title must be 1-120 characters`)
      return null
    }
    if (entry.description !== undefined && !words(entry.description, 1, 600)) {
      errors.push(`${name} description must be 1-600 characters`)
      return null
    }
    if (
      entry.icon !== undefined &&
      !(typeof entry.icon === 'string' && ICON_RE.test(entry.icon))
    ) {
      errors.push(`${name} icon must be an icon name such as flask`)
      return null
    }
    if (
      typeof entry.ui !== 'string' ||
      !PLUGIN_UI_FILE_ENTRY_RE.test(entry.ui)
    ) {
      errors.push(
        `${name} ui must be an .html file in ui/, such as ui/page.html`,
      )
      return null
    }
    if (
      entry.size !== undefined &&
      entry.size !== 'normal' &&
      entry.size !== 'wide'
    ) {
      errors.push(`${name} size is normal or wide`)
      return null
    }
    out.push({
      id: entry.id,
      title: entry.title.trim(),
      ...(typeof entry.description === 'string'
        ? { description: entry.description.trim() }
        : {}),
      ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
      ui: entry.ui,
      ...(entry.size ? { size: entry.size } : {}),
    })
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
  declaration: object | undefined,
): string | undefined {
  const value = (declaration as Record<string, unknown> | undefined)?.[
    PLUGIN_FRAME_POINTS[point]
  ]
  return typeof value === 'string' ? value : undefined
}
