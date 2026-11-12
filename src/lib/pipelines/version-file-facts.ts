/** A block of the file: where it starts and ends, 1-based and inclusive. */
export interface FileBlock {
  from: number
  to: number
  /** What it holds: entries in a list or a map, or names on one line. */
  count: number
}

export interface FileFacts {
  outputs?: FileBlock
  parameters?: FileBlock
  include?: FileBlock & { names: string[] }
  starts?: FileBlock
  /** Secret names the steps are sent with, in file order. */
  secrets: string[]
  /** Lines before `steps:` (the header the editor can fold), 0 when there is no `steps:`. */
  headerLines: number
  /** The top-level keys in that header, in file order. */
  headerKeys: string[]
}

const TOP = /^([a-z_]+):(.*)$/

/** Every indentation of a line's leading spaces. */
const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * What the file says beyond the forms: several outputs, parameters, includes,
 * start rules, secret names. Read from the text so it still answers while the
 * file does not yet validate.
 */
export function readFileFacts(text: string): FileFacts {
  const lines = text.split('\n')
  const tops: Array<{ key: string; line: number; rest: string }> = []

  lines.forEach((raw, index) => {
    const found = TOP.exec(raw)

    if (found) tops.push({ key: found[1], line: index + 1, rest: found[2] })
  })

  const block = (key: string): FileBlock | undefined => {
    const at = tops.findIndex((top) => top.key === key)

    if (at < 0) return undefined
    const top = tops[at]
    const next = tops.at(at + 1)
    let to = (next ? next.line : lines.length + 1) - 1

    // Trailing blank and comment lines belong to nothing.
    while (
      to > top.line &&
      (lines[to - 1].trim() === '' || lines[to - 1].trim().startsWith('#'))
    )
      to -= 1

    const body = lines
      .slice(top.line, to)
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))

    const first = body[0]
    const level = first ? indentOf(first) : 0

    const count = first
      ? body.filter((l) => indentOf(l) === level).length
      : top.rest.trim().startsWith('[')
        ? top.rest.split(',').filter((part) => part.trim() !== '').length
        : 0

    return { from: top.line, to, count }
  }

  const include = block('include')
  const includeTop = tops.find((top) => top.key === 'include')

  const names = includeTop
    ? [
        ...(includeTop.rest.match(/[A-Za-z0-9_.-]+/g) ?? []),
        ...lines
          .slice(includeTop.line, include?.to ?? includeTop.line)
          .flatMap((l) => /^\s*-\s*([A-Za-z0-9_.-]+)/.exec(l)?.[1] ?? []),
      ]
    : []

  const seen = new Set<string>()

  for (const line of lines) {
    const name = /^\s*(?:-\s*)?secret:\s*([A-Za-z0-9_]+)/.exec(line)?.[1]

    if (name) seen.add(name)
  }

  const secrets = [...seen]

  const steps = tops.find((top) => top.key === 'steps')

  return {
    outputs: block('outputs'),
    parameters: block('parameters'),
    include: include ? { ...include, names } : undefined,
    starts: block('starts'),
    secrets,
    headerLines: steps ? steps.line - 1 : 0,
    headerKeys: steps
      ? tops.flatMap((top) => (top.line < steps.line ? [top.key] : []))
      : [],
  }
}
