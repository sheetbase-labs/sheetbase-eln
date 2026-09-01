import { createRoot } from 'react-dom/client'
import type Handsontable from 'handsontable/base'

import '../../../src/styles.css'
import { SheetbaseGrid } from '../../../src/components/sheet/sheetbase-grid'

const data = Array.from({ length: 30 }, (_, row) => [
  `local-${row + 1}`,
  `governed-${row + 1}`,
  `derived-${row + 1}`,
])

declare global {
  interface Window {
    sheetbaseTestGrid: Handsontable | null
  }
}

window.sheetbaseTestGrid = null

function GridKeyboardFixture() {
  return (
    <div className="mx-auto flex h-[420px] max-w-3xl flex-col gap-3 p-4">
      <button type="button" className="w-fit rounded border px-2 py-1">
        Before grid
      </button>
      <div className="min-h-0 flex-1">
        <SheetbaseGrid
          ariaLabel="Purification summary Sheet"
          settings={{
            data,
            columns: [
              { readOnly: false },
              { readOnly: false },
              { readOnly: true },
            ],
            colHeaders: [
              'Local observation',
              'Governed result',
              'Derived recovery',
            ],
            rowHeaders: true,
            copyPaste: true,
            height: '100%',
            width: '100%',
          }}
          onReady={(hot) => {
            window.sheetbaseTestGrid = hot
          }}
        />
      </div>
      <button type="button" className="w-fit rounded border px-2 py-1">
        After grid
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<GridKeyboardFixture />)
