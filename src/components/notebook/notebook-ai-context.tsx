import { createContext, useContext } from 'react'

import type { NotebookBlock } from '#/lib/notebook-data'

/**
 * What the notebook on screen offers to "Write with AI": the record's identity
 * and the blocks as loaded. Provided by the notebook document; absent
 * elsewhere (a protocol editor, a test), where the helper still works on the
 * text in front of it.
 */
export interface NotebookAiContextValue {
  recordId: string
  title: string
  deepLink: string
  blocks: NotebookBlock[]
}

const NotebookAiContext = createContext<NotebookAiContextValue | null>(null)

export const NotebookAiProvider = NotebookAiContext.Provider

export function useNotebookAiContext(): NotebookAiContextValue | null {
  return useContext(NotebookAiContext)
}
