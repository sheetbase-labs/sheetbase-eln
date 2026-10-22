import { forwardRef } from 'react'

import { tokenizeSql } from '#/lib/pipelines/sql-highlight'
import type { SqlTokenKind } from '#/lib/pipelines/sql-highlight'
import { cn } from '#/lib/utils'

const TOKEN_CLASS: Record<SqlTokenKind, string | undefined> = {
  keyword: 'font-semibold text-primary-text',
  string: 'text-success-text',
  identifier: 'text-fg',
  number: 'text-info',
  comment: 'italic text-fg-faint',
  parameter: 'rounded-sm bg-selection-subtle text-warning-text',
  plain: undefined,
}

/**
 * A textarea for SQL with the statement coloured behind it. The text the person
 * edits is still a plain textarea (selection, undo, paste, spell-check off and
 * the accessible name all behave as before); a copy of it is drawn underneath
 * with keywords, strings, numbers, comments and {{parameters}} coloured, and the
 * textarea's own text is made see-through. Both sit in one grid cell with the
 * same box, so the box grows with the statement and nothing needs to be scrolled
 * in step. The colouring is cosmetic: the server checks the statement.
 */
export const SqlEditor = forwardRef<
  HTMLTextAreaElement,
  Omit<React.ComponentProps<'textarea'>, 'value'> & { value: string }
>(function SqlEditorField({ value, className, rows = 6, ...props }, ref) {
  // One spare line so a trailing newline in the textarea has height underneath too.
  const behind = value.endsWith('\n') ? `${value} ` : value
  const box =
    'col-start-1 row-start-1 m-0 w-full min-w-0 rounded-md border p-2 font-mono text-body whitespace-pre-wrap break-words'
  return (
    <div className={cn('grid', className)}>
      <pre
        aria-hidden="true"
        data-slot="sql-highlight"
        className={cn(
          box,
          'pointer-events-none overflow-hidden border-transparent bg-surface text-fg',
        )}
        style={{ minHeight: `${rows * 1.5 + 1}rem` }}
      >
        {tokenizeSql(behind).map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </pre>
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        {...props}
        className={cn(
          box,
          'h-full resize-none overflow-hidden border-border bg-transparent text-transparent caret-fg selection:bg-selection',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        )}
      />
    </div>
  )
})
