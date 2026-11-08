/**
 * The `.sbplugin` package: a zip an administrator uploads to install a plugin.
 *
 * ```
 * plugin.json     the manifest an author writes
 * python/…        the .py files it points at
 * README.md       optional
 * LICENSE         optional
 * ui/…            html, js, css, svg and json files of a plugin UI bundle, run only in a sandboxed frame
 * ```
 *
 * `readPluginPackage` unzips (with size limits applied before anything is
 * inflated), checks every path, checks `plugin.json`, and turns it into the
 * manifest Sheetbase stores for an install. The same rules are written in
 * Python in `sdks/plugin-python/src/sheetbase_plugin/package.py`, which the
 * `sheetbase-plugin` command uses on an author's machine; the shared cases in
 * `sdks/plugin-python/tests/package_cases.json` keep the two in step.
 *
 * Browser safe: it imports no server module, so the upload form can check a
 * file before sending it.
 */
import { unzipSync } from 'fflate'

import { VALID_SCOPES } from '../api-credential-scopes'
import type { Scope } from '../api-credential-scopes'
import { validateExtensionManifest } from './manifest'
import type { ExtensionManifest } from './manifest'
import { EXTENSION_ENTRY_RE, EXTENSION_SWITCH_POINTS } from './points'
import { PLUGIN_UI_ENTRY_RE } from './hooks'
import { parsePythonDeclaration } from './runtime-config'

/**
 * Sanity bounds on a package so a malformed or hostile zip can't exhaust the
 * server while it is read. They sit far above any real plugin's code; the
 * plugin's runtime limits (time, memory, data) are separate, per-plugin
 * settings.
 */
export const PLUGIN_MAX_FILES = 2000
export const PLUGIN_MAX_FILE_BYTES = 16 * 1024 * 1024
export const PLUGIN_MAX_TOTAL_BYTES = 64 * 1024 * 1024
/** The zip itself. */
export const PLUGIN_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

const ROOT_FILES = [
  'plugin.json',
  'README.md',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
]
const TOP_LEVEL = [
  'id',
  'name',
  'version',
  'description',
  'author',
  'compatibleWith',
  'permissions',
  'provides',
  'examples',
  'python',
]
const PROVIDES: readonly string[] = EXTENSION_SWITCH_POINTS
/** The points drawn on screens and in tables (`hooks.ts`). */
const HOOK_POINTS: readonly string[] = [
  'blocks',
  'panels',
  'table-cells',
  'columns',
  'row-actions',
  'field-types',
  'pages',
  'settings-pages',
  'dashboard-widgets',
  'report-sections',
]
/** The points that need no Python function of their own to be useful. */
const PROVIDES_WITHOUT_PYTHON = [
  'table-cells',
  'field-types',
  'pages',
  'settings-pages',
  'dashboard-widgets',
  'report-sections',
]
const SCOPE_RE = /^[a-z][a-z_]*:[a-z][a-z_]*$/

/** A plugin UI bundle: plain files that run in a sandboxed frame. */
export const PLUGIN_UI_FILE_RE =
  /^ui\/[A-Za-z0-9._/-]+\.(html|js|mjs|css|svg|json)$/
/** The one file name the UI SDK is served as; a bundle's HTML includes it with a plain script tag. */
export const PLUGIN_UI_SDK_NAME = 'sheetbase-ui.js'

export interface PluginExample {
  operation: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
}

export interface PluginPackage {
  /** What Sheetbase stores for the install. */
  manifest: ExtensionManifest
  /** Every file in the package, as text, by path. */
  files: Record<string, string>
  /** SHA-256 of the files (path and content, in path order); empty until `readPluginPackage` fills it. */
  sha256: string
  /** Total size of the files in bytes. */
  size: number
  examples: PluginExample[]
}

export class PluginPackageError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(`This is not a usable plugin package: ${errors.join('; ')}`)
    this.name = 'PluginPackageError'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** Problems with the paths and sizes of a package's files. */
export function validatePluginFiles(files: Record<string, string>): string[] {
  const errors: string[] = []
  const paths = Object.keys(files)
  if (paths.length > PLUGIN_MAX_FILES)
    errors.push(`a package has at most ${PLUGIN_MAX_FILES} files`)
  let total = 0
  for (const path of paths) {
    const size = byteLength(files[path])
    total += size
    if (size > PLUGIN_MAX_FILE_BYTES)
      errors.push(
        `${path} is over ${PLUGIN_MAX_FILE_BYTES / (1024 * 1024)} MiB`,
      )
    const parts = path.split('/')
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      parts.includes('..') ||
      parts.includes('')
    )
      errors.push(`${path} is not a safe path`)
    else if (parts[0] === 'ui') {
      if (!PLUGIN_UI_FILE_RE.test(path))
        errors.push(
          `${path}: ui/ holds .html, .js, .mjs, .css, .svg and .json files only`,
        )
      else if (parts[parts.length - 1] === PLUGIN_UI_SDK_NAME)
        errors.push(
          `${path}: ${PLUGIN_UI_SDK_NAME} is provided by Sheetbase, leave it out`,
        )
      else if (
        /\.(html|css)$/.test(path) &&
        /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(files[path])
      )
        errors.push(
          `${path} refers to a web address; a plugin UI cannot reach the network, bundle what it needs`,
        )
    } else if (parts[0] === 'python') {
      if (!path.endsWith('.py') || parts.length < 2)
        errors.push(`${path}: python/ holds .py files only`)
    } else if (!ROOT_FILES.includes(path))
      errors.push(`${path} does not belong in a plugin package`)
  }
  if (total > PLUGIN_MAX_TOTAL_BYTES)
    errors.push(
      `a package is at most ${PLUGIN_MAX_TOTAL_BYTES / (1024 * 1024)} MiB`,
    )
  if (!('plugin.json' in files)) errors.push('plugin.json is missing')
  return errors
}

function entryExists(
  run: unknown,
  files: Record<string, string | undefined>,
  where: string,
  errors: string[],
) {
  const match = typeof run === 'string' ? EXTENSION_ENTRY_RE.exec(run) : null
  if (!match) {
    errors.push(
      `${where} run must look like module:function, such as ops:viability`,
    )
    return
  }
  const [, module, fn] = match
  const path = module.replaceAll('.', '/')
  const source =
    files[`python/${path}.py`] ?? files[`python/${path}/__init__.py`]
  if (source === undefined) {
    errors.push(`${where} run points at ${module}, which is not in python/`)
    return
  }
  const defined = new RegExp(
    `^(?:def\\s+${fn}\\s*\\(|${fn}\\s*=|from\\s+\\S+\\s+import\\s+.*\\b${fn}\\b)`,
    'm',
  )
  if (!defined.test(source))
    errors.push(`${where} run points at ${fn}, which ${module} does not define`)
}

/** Author form (`run`) to the stored form (`runner`). Leaves bad values alone for the validator to name. */
export function toStored(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry)) return entry
    const { run, parse, ...rest } = entry
    return {
      ...rest,
      runner: { kind: 'python', entry: run },
      // A connector's second function: turns the answers into rows.
      ...(parse !== undefined
        ? { parse: { kind: 'python', entry: parse } }
        : {}),
    }
  })
}

const asRunner = (run: unknown) =>
  typeof run === 'string' ? { kind: 'python', entry: run } : run

/**
 * Author form to stored form for the screen and table points: `screen` and
 * `run` strings become runner objects, in the entry and in a column's actions.
 */
function toStoredHooks(point: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry)) return entry
    const { run, screen, actions, ...rest } = entry
    return {
      ...rest,
      ...(run !== undefined ? { runner: asRunner(run) } : {}),
      ...(screen !== undefined ? { screen: asRunner(screen) } : {}),
      ...(point === 'columns' && Array.isArray(actions)
        ? {
            actions: actions.map((action) => {
              if (!isRecord(action)) return action
              const { run: actionRun, ...others } = action
              return { ...others, runner: asRunner(actionRun) }
            }),
          }
        : {}),
    }
  })
}

/** Where a screen or action in a declaration points: a `run`, a `screen`, a `ui` file and column action runs. */
function pointers(entry: Record<string, unknown>): {
  python: unknown[]
  ui: unknown[]
} {
  const python = [entry.run, entry.screen]
  if (Array.isArray(entry.actions))
    for (const action of entry.actions)
      if (isRecord(action)) python.push(action.run)
  return {
    python: python.filter((value) => value !== undefined),
    ui: [entry.ui, entry.render, entry.input].filter(
      (value) => value !== undefined,
    ),
  }
}

/**
 * Checks a package given as `{ path: text }` and builds the install manifest.
 * Throws `PluginPackageError` listing every problem found.
 */
export function buildPluginPackage(
  files: Record<string, string>,
): PluginPackage {
  const errors = validatePluginFiles(files)
  if (!('plugin.json' in files)) throw new PluginPackageError(errors)
  let raw: unknown
  try {
    raw = JSON.parse(files['plugin.json'])
  } catch (error) {
    throw new PluginPackageError([
      ...errors,
      `plugin.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }
  if (!isRecord(raw))
    throw new PluginPackageError([...errors, 'plugin.json must be an object'])

  for (const key of Object.keys(raw))
    if (!TOP_LEVEL.includes(key))
      errors.push(`unknown key in plugin.json: ${key}`)

  const permissions = raw.permissions ?? []
  const scopes: Scope[] = []
  if (
    !Array.isArray(permissions) ||
    !permissions.every((p) => typeof p === 'string' && SCOPE_RE.test(p))
  )
    errors.push('permissions must be a list of scopes such as projects:read')
  else
    for (const p of permissions as string[]) {
      if (!(VALID_SCOPES as readonly string[]).includes(p))
        errors.push(`unknown scope: ${p}`)
      else scopes.push(p as Scope)
    }

  const provides = raw.provides
  const contributions: Record<string, unknown> = {}
  if (!isRecord(provides)) errors.push('provides must be an object')
  else {
    for (const key of Object.keys(provides))
      if (!PROVIDES.includes(key))
        errors.push(`unknown contribution point: ${key}`)
    if (
      !PROVIDES.some(
        (key) => Array.isArray(provides[key]) && provides[key].length > 0,
      )
    )
      errors.push(
        'a plugin has to provide at least one thing: an operation, calculator, analysis kind, pipeline step, check, search, connector, publisher, notification channel, importer, exporter, preview, same-thing rule, event reaction, instrument parser, label format, barcode format, storage rule, block, panel, table cell display, column, row action, field type, page, settings page, Home widget or report section',
      )
    const usedUi = new Set<string>()
    for (const point of PROVIDES) {
      if (provides[point] === undefined) continue
      contributions[point] = HOOK_POINTS.includes(point)
        ? toStoredHooks(point, provides[point])
        : toStored(provides[point])
      for (const entry of Array.isArray(provides[point]) ? provides[point] : [])
        if (isRecord(entry)) {
          const where = `provides.${point}.${String(entry.id)}`
          if (!HOOK_POINTS.includes(point)) {
            entryExists(entry.run, files, where, errors)
            if (
              point === 'connectors' ||
              point === 'publishers' ||
              (point === 'notification-channels' && entry.parse !== undefined)
            )
              entryExists(entry.parse, files, `${where} parse`, errors)
            else if (point === 'barcode-formats' && entry.parse !== undefined)
              entryExists(entry.parse, files, `${where} parse`, errors)
          } else {
            const { python, ui: bundles } = pointers(entry)
            if (
              python.length === 0 &&
              bundles.length === 0 &&
              !PROVIDES_WITHOUT_PYTHON.includes(point) &&
              point !== 'panels'
            )
              errors.push(`${where} needs a Python function to run`)
            for (const run of python) entryExists(run, files, where, errors)
            for (const bundle of bundles) {
              if (
                typeof bundle !== 'string' ||
                !PLUGIN_UI_ENTRY_RE.test(bundle)
              )
                continue
              usedUi.add(bundle)
              if (!(bundle in files))
                errors.push(
                  `${where} ui points at ${bundle}, which is not in the package`,
                )
            }
          }
        }
    }
    if (
      usedUi.size === 0 &&
      Object.keys(files).some((path) => path.startsWith('ui/'))
    )
      errors.push(
        'ui/ files need a screen (a block, panel, page, widget, report section, field input or cell renderer) whose ui points at one of them',
      )
  }

  const examples: PluginExample[] = []
  if (raw.examples !== undefined) {
    if (
      !Array.isArray(raw.examples) ||
      raw.examples.length > 50 ||
      !raw.examples.every(
        (e) =>
          isRecord(e) && typeof e.operation === 'string' && isRecord(e.input),
      )
    )
      errors.push('examples must be a list of { operation, input, output? }')
    else examples.push(...(raw.examples as PluginExample[]))
  }

  const python = parsePythonDeclaration(raw.python)
  errors.push(...python.errors)

  const manifest = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    source: typeof raw.id === 'string' ? `package:${raw.id}` : undefined,
    ...(raw.compatibleWith !== undefined
      ? { compatibleWith: raw.compatibleWith }
      : {}),
    description: raw.description,
    ...(raw.author !== undefined ? { author: raw.author } : {}),
    capabilities: [],
    // A plugin that only computes needs no authority; a manifest still carries
    // the least one it may, which a plugin without a network can never use.
    scopes: scopes.length > 0 ? scopes : ['projects:read'],
    contributions,
    ...(raw.python !== undefined ? { python: python.value } : {}),
  }
  // The point checks (fields, runners, analysis shapes) live in one place.
  const problems = validateExtensionManifest(manifest).map((message) =>
    message.replace(/^contributions\./, 'provides.'),
  )
  // `description` is optional for a stored manifest but a plugin must say what it is for.
  if (typeof raw.description !== 'string' || raw.description.trim() === '')
    problems.push('description must be 1-600 characters')
  errors.push(...problems.filter((message) => !errors.includes(message)))
  if (errors.length > 0) throw new PluginPackageError([...new Set(errors)])

  const sorted = Object.keys(files).sort()
  return {
    manifest: manifest as unknown as ExtensionManifest,
    files,
    sha256: '',
    size: sorted.reduce((sum, path) => sum + byteLength(files[path]), 0),
    examples,
  }
}

/** Reads the zip, applying the size limits before inflating anything. */
export async function readPluginPackage(
  data: Uint8Array,
): Promise<PluginPackage> {
  if (data.byteLength > PLUGIN_MAX_ARCHIVE_BYTES)
    throw new PluginPackageError([
      `a package is at most ${PLUGIN_MAX_ARCHIVE_BYTES / (1024 * 1024)} MiB`,
    ])
  let entries: Record<string, Uint8Array>
  let declared = 0
  let count = 0
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        count += 1
        declared += file.originalSize
        if (
          count > PLUGIN_MAX_FILES + 20 ||
          declared > PLUGIN_MAX_TOTAL_BYTES * 2 ||
          file.originalSize > PLUGIN_MAX_FILE_BYTES * 2
        )
          throw new PluginPackageError(['this package is too large to open'])
        return !file.name.endsWith('/')
      },
    })
  } catch (error) {
    if (error instanceof PluginPackageError) throw error
    throw new PluginPackageError(['this is not a readable zip file'])
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(entries)) {
    try {
      files[path] = decoder.decode(bytes)
    } catch {
      throw new PluginPackageError([`${path} is not text`])
    }
  }
  const built = buildPluginPackage(files)
  return { ...built, sha256: await hashPluginFiles(files) }
}

/** SHA-256 of the files, hex. Web Crypto, so it runs in browsers too. */
export async function hashPluginFiles(
  files: Record<string, string>,
): Promise<string> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const path of Object.keys(files).sort()) {
    parts.push(
      encoder.encode(`${path}\n${byteLength(files[path])}\n`),
      encoder.encode(files[path]),
    )
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  const digest = await crypto.subtle.digest('SHA-256', joined)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
