import type { GridSettings } from 'handsontable/settings'
import type Handsontable from 'handsontable/base'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { Component, useEffect, useId, useState } from 'react'

export type SheetbaseGridSettings = Omit<
  GridSettings,
  'className' | 'licenseKey' | 'themeName'
>

export interface SheetbaseGridProps {
  settings: SheetbaseGridSettings
  ariaLabel?: string
  description?: string
  onReady?: (instance: Handsontable | null) => void
}

export interface SheetbaseGridClientProps {
  settings: SheetbaseGridSettings
  licenseKey: string
  onReady?: (instance: Handsontable | null) => void
}

type ClientGrid = ComponentType<SheetbaseGridClientProps>

interface GridBoundaryProps {
  children: ReactNode
}

interface GridBoundaryState {
  failed: boolean
}

class GridBoundary extends Component<GridBoundaryProps, GridBoundaryState> {
  state: GridBoundaryState = { failed: false }

  static getDerivedStateFromError(): GridBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Handsontable failed to initialise.', error, info)
  }

  render() {
    if (this.state.failed) {
      return <GridFailure message="The scientific sheet could not start." />
    }
    return this.props.children
  }
}

function GridFailure({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <p className="font-medium">Sheet unavailable</p>
      <p className="mt-1 text-xs">
        {message} Reload the page or contact support.
      </p>
    </div>
  )
}

export function SheetbaseGrid({
  settings,
  ariaLabel = 'Scientific data sheet',
  description = 'Spreadsheet editor. Use the arrow keys to move between cells and Enter to edit.',
  onReady,
}: SheetbaseGridProps) {
  const descriptionId = useId()
  const [ClientGrid, setClientGrid] = useState<ClientGrid | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const licenseKey = import.meta.env.VITE_HANDSONTABLE_LICENSE_KEY?.trim()

  useEffect(() => {
    if (!licenseKey) return
    let active = true
    import('./sheetbase-grid-client')
      .then(({ SheetbaseGridClient }) => {
        if (active) setClientGrid(() => SheetbaseGridClient)
      })
      .catch((error: unknown) => {
        console.error('Handsontable client bundle failed to load.', error)
        if (active) setLoadFailed(true)
      })
    return () => {
      active = false
    }
  }, [licenseKey])

  if (!licenseKey) {
    return <GridFailure message="A Handsontable licence is not configured." />
  }
  if (loadFailed) {
    return <GridFailure message="The grid client could not be loaded." />
  }

  return (
    <section aria-describedby={descriptionId} aria-label={ariaLabel}>
      <p className="sr-only" id={descriptionId}>
        {description}
      </p>
      {ClientGrid ? (
        <GridBoundary>
          <ClientGrid licenseKey={licenseKey} settings={settings} onReady={onReady} />
        </GridBoundary>
      ) : (
        <div
          className="rounded-md border border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground"
          role="status"
        >
          Preparing scientific sheet…
        </div>
      )}
    </section>
  )
}
