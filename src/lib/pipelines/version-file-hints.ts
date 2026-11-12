import { PIPELINE_STEP_KINDS } from './config'
import {
  KIND_OBJECTS,
  OUTPUT_KEYS,
  START_KEYS,
  STEP_KEYS,
  TOP_KEYS,
} from './version-file'

export interface FileHints {
  /** What has been typed of the key. */
  prefix: string
  /** The keys the file allows here that start with it. */
  keys: string[]
}

const LINE = /^(\s*)(- )?([a-z_]*)$/
const KEY = /^(\s*)(- )?([a-z_]+):/

/** The leading spaces of a line, or null for one with nothing to say. */
const indentOf = (line: string): number | null =>
  line.trim() === '' || line.trim().startsWith('#')
    ? null
    : line.length - line.trimStart().length

/** The nearest line above with less indentation, and its key. */
function parentOf(lines: string[], from: number, indent: number) {
  for (let at = from - 1; at >= 0; at -= 1) {
    const found = indentOf(lines[at])

    if (found === null || found >= indent) continue
    const match = KEY.exec(lines[at])

    return { at, key: match?.[3] ?? '', dash: Boolean(match?.[2]) }
  }

  return null
}

/**
 * The keys the file allows where the caret is, when it sits at the end of a
 * half-typed key. Read from the indentation, not from a parse, so it still
 * answers while the file does not validate.
 */
export function hintsAt(
  text: string,
  line: number,
  column: number,
): FileHints | null {
  const lines = text.split('\n')
  const before = (lines[line - 1] ?? '').slice(0, column - 1)
  const match = LINE.exec(before)

  if (!match || !match[3]) return null
  const spaces = match[1].length
  const prefix = match[3]
  const row = line - 1

  const options = ((): readonly string[] | null => {
    if (spaces === 0 && !match[2]) return TOP_KEYS
    const parent = parentOf(lines, row, spaces + (match[2] ? 1 : 0))

    if (!parent) return null

    if (match[2]) {
      if (parent.key === 'steps') return [...STEP_KEYS, ...PIPELINE_STEP_KINDS]

      if (parent.key === 'outputs') return Object.keys(OUTPUT_KEYS)

      return null
    }

    const kindOf = (key: string) => {
      const kind = PIPELINE_STEP_KINDS.find((k) => k === key)
      const names = kind ? KIND_OBJECTS[kind] : undefined

      return names ? Object.keys(names) : null
    }

    if (parent.dash) {
      const lead = indentOf(lines[parent.at]) ?? 0

      // Deeper than the step's own keys: inside the kind's settings.
      if (spaces > lead + 2) return kindOf(parent.key)
      const above = parentOf(lines, parent.at, indentOf(lines[parent.at]) ?? 0)

      if (above?.key === 'steps') return [...STEP_KEYS, ...PIPELINE_STEP_KINDS]

      if (above?.key === 'outputs') return Object.keys(OUTPUT_KEYS)

      return null
    }

    if (parent.key === 'output') return Object.keys(OUTPUT_KEYS)

    if (parent.key === 'starts') return Object.keys(START_KEYS)

    return kindOf(parent.key)
  })()

  const keys = (options ?? []).filter(
    (key) => key.startsWith(prefix) && key !== prefix,
  )

  return keys.length ? { prefix, keys: [...new Set(keys)] } : null
}
