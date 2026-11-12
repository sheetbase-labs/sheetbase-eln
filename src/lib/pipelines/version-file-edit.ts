/** The file and where the caret or selection sits in it. */
export interface Edit {
  text: string
  start: number
  end: number
}

/**
 * Indent or outdent every line a selection touches by two spaces, as a code
 * editor does. Blank lines stay blank. Null when nothing would change.
 */
export function shiftLines(
  text: string,
  start: number,
  end: number,
  outdent: boolean,
): Edit | null {
  const first = text.lastIndexOf('\n', start - 1) + 1
  // A selection that ends at the start of a line does not touch that line.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const stopAt = text.indexOf('\n', last)
  const stop = stopAt < 0 ? text.length : stopAt
  const rows = text.slice(first, stop).split('\n')

  const next = rows.map((row) => {
    if (outdent) return row.replace(/^ {1,2}/, '')

    return row.trim() ? `  ${row}` : row
  })

  const change = next.reduce(
    (sum, row, i) => sum + row.length - rows[i].length,
    0,
  )

  if (!change) return null
  const own = next[0].length - rows[0].length

  return {
    text: text.slice(0, first) + next.join('\n') + text.slice(stop),
    start: Math.max(first, start + own),
    end: Math.max(first, end + change),
  }
}

/** What the editor can step back and forward through. */
export interface History {
  stack: Edit[]
  at: number
  /** When the top entry was last typed into; 0 for one that must stay its own step. */
  time: number
}

export const newHistory = (): History => ({ stack: [], at: -1, time: 0 })

/**
 * Remember the file as it now is. Typing within a second of the last typing
 * joins its entry, so one undo takes back a word, not a letter.
 */
export function record(
  history: History,
  edit: Edit,
  now: number,
  join: boolean,
): void {
  const top = history.stack.at(history.at)

  if (top && top.text === edit.text) {
    top.start = edit.start
    top.end = edit.end

    return
  }

  history.stack.length = history.at + 1

  if (join && top && history.time > 0 && now - history.time < 1000)
    history.stack[history.at] = edit
  else {
    history.stack.push(edit)
    history.at = history.stack.length - 1
  }

  history.time = join ? now : 0
}

/** Step back (-1) or forward (1); null when there is nowhere to go. */
export function move(history: History, direction: -1 | 1): Edit | null {
  const to = history.at + direction

  if (to < 0 || to >= history.stack.length) return null
  history.at = to
  history.time = 0

  return history.stack[to]
}
