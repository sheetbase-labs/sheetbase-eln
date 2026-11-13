/**
 * Typing while a new notebook block is being made.
 *
 * Pressing Enter at the end of the last paragraph asks the server for a new
 * block and moves the cursor into it when the answer comes back. Until then
 * the old paragraph still has the cursor, so anything typed straight after
 * Enter landed at the end of the paragraph above. This holds that typing
 * back instead, and types it into the new block once it has the cursor.
 */

/** How long to wait for the new block to take the cursor before giving up. */
const FOCUS_WAIT_MS = 3000

type Insert = (text: string) => void

const insertIntoFocused: Insert = (text) => {
  // `execCommand` is the one call that types into a contenteditable the way
  // the keyboard does, so the editor sees an ordinary input event.
  document.execCommand('insertText', false, text)
}

/** The cursor is in a text field inside `target`, not just on its frame. */
function isCursorIn(target: HTMLElement | null): boolean {
  const active = document.activeElement

  return (
    target !== null &&
    active instanceof HTMLElement &&
    target.contains(active) &&
    active.isContentEditable
  )
}

export interface TypeAheadHold {
  /**
   * Stop holding. When a block was made, wait for it to take the cursor and
   * type what was held into it; otherwise hand the text back to nobody.
   */
  release: (findTarget: (() => HTMLElement | null) | null) => Promise<void>
}

export function holdTypeAhead(
  root: HTMLElement,
  insert: Insert = insertIntoFocused,
): TypeAheadHold {
  let held = ''

  const onBeforeInput = (event: InputEvent) => {
    // Nothing may reach the old paragraph while the new block is on its way.
    event.preventDefault()
    event.stopPropagation()

    if (event.inputType === 'insertText' && event.data) {
      held += event.data
    } else if (event.inputType === 'deleteContentBackward') {
      held = held.slice(0, -1)
    }
  }

  // Between the new block taking its frame's focus and its editor taking the
  // cursor, a key lands on something that is not a text field. A plain letter
  // there would run a single-key shortcut, so it is held as typing too.
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target

    if (target instanceof HTMLElement && target.isContentEditable) return

    if (event.ctrlKey || event.metaKey || event.altKey) return

    if (event.key.length !== 1) return

    event.preventDefault()
    event.stopPropagation()

    held += event.key
  }

  root.addEventListener('beforeinput', onBeforeInput, true)
  root.addEventListener('keydown', onKeyDown, true)

  return {
    release: async (findTarget) => {
      try {
        if (!findTarget || held === '') return

        const deadline = Date.now() + FOCUS_WAIT_MS

        while (!isCursorIn(findTarget())) {
          if (Date.now() > deadline) return

          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          })
        }

        insert(held)
      } finally {
        root.removeEventListener('beforeinput', onBeforeInput, true)
        root.removeEventListener('keydown', onKeyDown, true)
      }
    },
  }
}
