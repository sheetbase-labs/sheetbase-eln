import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import { buildScientificWorkbook } from '#/lib/scientific-workbook'
import type {
  ScientificWorkbook,
  WorkbookTable,
} from '#/lib/scientific-workbook'

interface WorkbookContextValue {
  register: (blockId: string, table: WorkbookTable | null) => void
  workbook: ScientificWorkbook | null
}

const WorkbookContext = createContext<WorkbookContextValue | null>(null)

export function ScientificWorkbookProvider({
  children,
}: {
  children: ReactNode
}) {
  const [tables, setTables] = useState<Map<string, WorkbookTable>>(new Map())
  const register = useCallback(
    (blockId: string, table: WorkbookTable | null) => {
      setTables((current) => {
        if (table && current.get(blockId) === table) return current
        if (!table && !current.has(blockId)) return current
        const next = new Map(current)
        if (table) next.set(blockId, table)
        else next.delete(blockId)
        return next
      })
    },
    [],
  )
  const workbook = useMemo(() => {
    if (!tables.size) return null
    try {
      return buildScientificWorkbook([...tables.values()])
    } catch {
      return null
    }
  }, [tables])
  useEffect(() => () => workbook?.destroy(), [workbook])
  const value = useMemo(() => ({ register, workbook }), [register, workbook])
  return (
    <WorkbookContext.Provider value={value}>
      {children}
    </WorkbookContext.Provider>
  )
}

export function useNotebookScientificWorkbook(
  blockId: string,
  table: WorkbookTable | null,
) {
  const context = useContext(WorkbookContext)
  if (!context)
    throw new Error(
      'Scientific sheet blocks require notebook workbook ownership.',
    )
  const { register } = context
  useEffect(() => {
    register(blockId, table)
    return () => register(blockId, null)
  }, [blockId, register, table])
  return context.workbook
}
