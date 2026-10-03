import { createFileRoute, redirect } from '@tanstack/react-router'
import { Spreadsheet } from '@sheetbase-labs/sheetbase-table'

/**
 * COMP-05 Check-it: a development-only surface rendering the
 * `@sheetbase-labs/sheetbase-table` grid on the ELN's own tokens.
 *
 * The packages' variables are bound to the ELN tokens by the host mapping in
 * `src/styles.css`, so this page inherits the ELN theme (including `.dark`)
 * rather than the packages' default preset. Production builds redirect to `/`
 * and the route is not part of the product navigation — it carries no business
 * data. See docs/development/sheetbase-components.md.
 */
export const Route = createFileRoute('/sheetbase-components')({
  beforeLoad: () => {
    if (import.meta.env.PROD) {
      throw redirect({ to: '/' })
    }
  },
  component: SheetbaseComponentsDemo,
})

/**
 * A small measurement sheet — a notebook run's columns, as the v3 grid shows
 * them. Values are literals so the demo needs no adapter.
 */
const DEMO_ROWS: Record<string, string> = {
  A1: 'Run',
  B1: 'Measured · DS-0311',
  C1: 'Derived',
  D1: 'Status',
  A2: 'S-01',
  B2: '0.412',
  C2: '412',
  D2: 'Promoted',
  A3: 'S-02',
  B3: '0.508',
  C3: '508',
  D3: 'Promoted',
  A4: 'S-03',
  B4: '0.377',
  C4: '377',
  D4: 'Flagged',
  A5: 'S-04',
  B5: '0.431',
  C5: '431',
  D5: 'Draft',
  A6: 'S-05',
  B6: '0.466',
  C6: '466',
  D6: 'Draft',
}

/** The package grid takes an A1-address map; the literal above stays a Record. */
const DEMO_CELLS: ReadonlyMap<string, string> = new Map(
  Object.entries(DEMO_ROWS),
)

/** The grid's own dark preset follows `data-theme`; the ELN keeps it on `<html>`. */
function resolvedGridTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function SheetbaseComponentsDemo() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="border-b pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sheetbase components
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            Package grid on the ELN tokens
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The grid below is <code>@sheetbase-labs/sheetbase-table</code>. Its
            colours, fonts and sizes come from the host mapping in{' '}
            <code>src/styles.css</code>, which points every package variable at
            the ELN's v3 token — so it follows the ELN theme, not the package
            default preset. Development-only surface (COMP-05).
          </p>
        </header>

        <section className="mt-6" data-testid="sheetbase-components-demo">
          <div className="h-[420px] overflow-hidden rounded-md border border-border">
            <Spreadsheet
              initialData={DEMO_CELLS}
              rowCount={12}
              columnCount={4}
              theme={resolvedGridTheme()}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
