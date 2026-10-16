import { CopyButton } from './copy-button'
import { cn } from '#/lib/utils'

/**
 * A code or payload block: statement, JSON, log — text shown as text.
 *
 * It started life inside `pipelines/pipeline-code.tsx` (R5-SHELL-06), where it
 * was the only one of the app's payload renderers that was deliberate. Next to
 * it, four screens each spelled out their own `<pre>`: four class strings, four
 * max-heights, three of them with no label, an empty state or a copy affordance,
 * and the two holding exactly the JSON a person pastes into a bug report.
 *
 * **The code is text.** It is placed in the tree as a text node, never through
 * `dangerouslySetInnerHTML`, and nothing here executes, evaluates or interprets
 * it. Content that is not valid UTF-16 (lone surrogates, as produced by
 * truncated or mis-decoded bytes) or that carries a NUL is shown with U+FFFD, so
 * a corrupt payload renders as visibly broken text rather than throwing or
 * smuggling a control character into the DOM.
 *
 * **Highlighting stays deferred, deliberately** — see ADR-0055's record row for
 * this component. A highlighter is a large dependency (`shiki@4` installs
 * 13.1 MB across 1,062 files) and it would add colour to text, not information
 * to it; the language chip names the syntax instead. This is the decision §11.3
 * asked to be revisited by the owner rather than side-stepped, and the record
 * states what would reverse it.
 *
 * Long content scrolls in both directions, and the scroll container is
 * focusable so a keyboard user can reach the whole payload.
 */

/**
 * Code is text. Lone surrogates and NUL become U+FFFD so a corrupt statement
 * renders as visibly broken text rather than throwing or smuggling a control
 * character into the DOM. Valid characters, including astral pairs, pass through
 * unchanged.
 */
export function codeText(value: string): string {
  let out = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const loneSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff
    out += loneSurrogate || codePoint === 0 ? '\uFFFD' : character
  }
  return out
}

/**
 * How tall a payload may get before it scrolls. The three values are the three
 * heights the hand-rolled blocks had chosen for themselves, so a migrated site
 * keeps the bound it asked for and the vocabulary stops drifting.
 */
const MAX_HEIGHT = {
  sm: 'max-h-40',
  md: 'max-h-48',
  lg: 'max-h-60',
} as const

export interface CodeBlockProps {
  /** The payload exactly as stored. */
  readonly code: string
  /** The stored language, e.g. `sql`; omitted when the config does not say. */
  readonly language?: string
  /** Accessible name for the scrollable code region. */
  readonly label: string
  /** Bound the payload's height; it scrolls past it. */
  readonly maxHeight?: keyof typeof MAX_HEIGHT
  /** Offer a copy control. On by default: a payload exists to be pasted. */
  readonly copyable?: boolean
  readonly className?: string
}

export function CodeBlock({
  code,
  language,
  label,
  maxHeight,
  copyable = true,
  className,
}: CodeBlockProps) {
  const text = codeText(code)
  const empty = text.trim().length === 0
  const header = Boolean(language) || (copyable && !empty)

  return (
    <div
      data-slot="code-block"
      className={cn('flex flex-col gap-1', className)}
    >
      {header ? (
        <div className="flex items-center gap-2">
          {language ? (
            <span
              data-slot="code-language"
              className="mono text-[10px] tracking-[.02em] text-fg-muted uppercase"
            >
              {language}
            </span>
          ) : null}
          {copyable && !empty ? (
            <CopyButton value={text} className="ml-auto">
              Copy
            </CopyButton>
          ) : null}
        </div>
      ) : null}
      {empty ? (
        <p
          data-slot="code-block-empty"
          className="m-0 rounded-md border border-dashed border-border-strong bg-surface p-3 text-caption text-fg-muted"
        >
          Empty statement.
        </p>
      ) : (
        <pre
          data-slot="code-block-pre"
          tabIndex={0}
          role="group"
          aria-label={label}
          className={cn(
            'm-0 overflow-auto rounded-md border border-border bg-surface p-3 text-caption whitespace-pre focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            maxHeight ? MAX_HEIGHT[maxHeight] : null,
          )}
        >
          <code className="mono">{text}</code>
        </pre>
      )}
    </div>
  )
}
