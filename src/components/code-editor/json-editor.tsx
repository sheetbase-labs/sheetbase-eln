import { useMemo } from 'react'

import { t } from '#/copy'
import { CodeEditor } from './code-editor'
import type { CodeEditorHandle, CodeProblem } from './code-editor'
import { jsonProblem, jsonTokens } from '#/lib/code-json'

/**
 * The shared code editor set up for JSON: keys, strings and numbers coloured,
 * brackets and quotes closed as they are typed, and a mistake marked on its
 * line with what to do about it. The owner keeps the text.
 */
export function JsonEditor({
  value,
  onChange,
  ariaLabel,
  accepts = 'any',
  rows = 6,
  readOnly,
  placeholder,
  onBlur,
  ref,
  lineNumbers = false,
}: {
  value: string
  onChange?: (text: string) => void
  ariaLabel: string
  /** `object` also marks JSON that is not written between { and }. */
  accepts?: 'object' | 'any'
  rows?: number
  readOnly?: boolean
  placeholder?: string
  onBlur?: () => void
  ref?: React.Ref<CodeEditorHandle>
  lineNumbers?: boolean
}) {
  const problems = useMemo<CodeProblem[]>(() => {
    const found = jsonProblem(value, accepts)

    if (!found) return []

    return [
      {
        line: found.spot.line,
        column: found.spot.column,
        length: 1,
        title: t('common.codeEditor.lineN', { line: found.spot.line }),
        message:
          found.reason === 'notObject'
            ? t('common.codeEditor.notAnObject')
            : t('common.codeEditor.notJson'),
      },
    ]
  }, [value, accepts])

  return (
    <CodeEditor
      ref={ref}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      readOnly={readOnly}
      placeholder={placeholder}
      onBlur={onBlur}
      highlight={jsonTokens}
      problems={problems}
      lineNumbers={lineNumbers}
      minHeight={`${rows * 19 + 18}px`}
    />
  )
}
