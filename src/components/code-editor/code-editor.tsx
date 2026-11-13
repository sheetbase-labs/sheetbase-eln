import { lazy, Suspense } from 'react'

import type { CodeEditorProps } from './code-editor-view'

export type {
  CodeEditorHandle,
  CodeEditorProps,
  CodeProblem,
  CodeSuggestions,
  CodeToken,
} from './code-editor-view'

// CodeMirror is large: it loads when an editor first shows, not with the page.
const View = lazy(async () => {
  const loaded = await import('./code-editor-view')

  return { default: loaded.CodeEditorView }
})

/**
 * A code editor in the board's frame (line numbers, mistakes marked with their
 * message and fix, suggestions, find, real selection and undo). The owner keeps
 * the text: it comes in as `value` and every edit returns through `onChange`.
 * The editor itself loads on first use; until then a box of the same size.
 */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden="true"
          className={props.className}
          style={{
            minHeight: props.minHeight ?? '240px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface)',
          }}
        />
      }
    >
      <View {...props} />
    </Suspense>
  )
}
