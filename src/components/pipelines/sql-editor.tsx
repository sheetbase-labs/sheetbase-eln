import { CodeEditor } from '#/components/code-editor/code-editor'
import { sqlTokens } from '#/lib/pipelines/code-tokens'

/** A line of the editor, in px, and what the box adds around its lines. */
const LINE = 19
const FRAME = 18

/**
 * The editor for a SQL statement: the shared code editor with keywords,
 * strings, numbers, comments and {{parameters}} coloured. The colouring is
 * cosmetic: the server checks the statement.
 */
export function SqlEditor({
  value,
  onChange,
  rows = 6,
  ...props
}: {
  value: string
  onChange: (text: string) => void
  'aria-label': string
  rows?: number
  readOnly?: boolean
  maxLength?: number
  onBlur?: () => void
}) {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      ariaLabel={props['aria-label']}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      onBlur={props.onBlur}
      highlight={sqlTokens}
      lineNumbers={false}
      minHeight={`${rows * LINE + FRAME}px`}
    />
  )
}
