import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const [workbook, setWorkbook] = useState<ScientificWorkbook | null>(null)
  const workbookRef = useRef<ScientificWorkbook | null>(null)
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
  useEffect(() => {
    // Sheet queries often settle in the same browser turn. Build after those
    // registrations have coalesced instead of synchronously rebuilding the
    // complete HyperFormula workbook once per arriving sheet.
    const timeout = window.setTimeout(() => {
      let next: ScientificWorkbook | null = null
      if (tables.size) {
        try {
          next = buildScientificWorkbook([...tables.values()])
        } catch {
          next = null
        }
      }
      const previous = workbookRef.current
      workbookRef.current = next
      setWorkbook(next)
      previous?.destroy()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [tables])
  useEffect(
    () => () => {
      workbookRef.current?.destroy()
      workbookRef.current = null
    },
    [],
  )
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
