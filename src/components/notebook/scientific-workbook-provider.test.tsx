import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { WorkbookTable } from '#/lib/scientific-workbook'
import {
  ScientificWorkbookProvider,
  useNotebookScientificWorkbook,
} from './scientific-workbook-provider'

const table = (id: string): WorkbookTable => ({
  id,
  columns: [],
  rows: [],
})

function Registration({
  blockId,
  value,
}: {
  blockId: string
  value: WorkbookTable
}) {
  const workbook = useNotebookScientificWorkbook(blockId, value)
  return <span>{workbook?.engineSheetNames().length ?? 0}</span>
}

describe('ScientificWorkbookProvider', () => {
  it('owns one engine with one sheet for every registered notebook block', async () => {
    render(
      <ScientificWorkbookProvider>
        <Registration
          blockId="block-1"
          value={table('10000000-0000-4000-8000-000000000001')}
        />
        <Registration
          blockId="block-2"
          value={table('10000000-0000-4000-8000-000000000002')}
        />
      </ScientificWorkbookProvider>,
    )
    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(2))
  })
})
