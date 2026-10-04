import { Link, createFileRoute } from '@tanstack/react-router'

import { useShortcuts } from '#/components/shortcuts/shortcut-provider'
import { ShortcutGroups } from '#/components/shortcuts/shortcuts-dialog'
import { Button } from '#/components/v3/ui/button'
import { Kbd } from '#/components/v3/ui/kbd'
import { SegmentLinks } from '#/components/v3/projects/search-tabs'
import { requestShortcutsDialog } from '#/lib/shortcuts-dialog'

import { ReleaseCard } from '../help'

/** Keyboard shortcuts. `?os=windows` shows Ctrl/Alt/Shift instead of ⌘/⌥/⇧. */
export const Route = createFileRoute('/help/shortcuts')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { os?: 'mac' | 'windows' } => ({
    os: search.os === 'windows' || search.os === 'mac' ? search.os : undefined,
  }),
  component: Shortcuts,
})

function Shortcuts() {
  const { os = 'mac' } = Route.useSearch()
  const { registry } = useShortcuts()
  return (
    <div className="grid max-w-[1164px] grid-cols-1 gap-8 px-4 pb-10 pt-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <nav aria-label="Breadcrumb" className="text-label text-fg-muted">
            <Link to="/help">Help</Link> / Keyboard shortcuts
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="flex-1 text-title max-md:basis-full max-md:text-[18px] max-md:leading-6">
              Keyboard shortcuts
            </h1>
            <SegmentLinks
              label="Keyboard"
              items={(['mac', 'windows'] as const).map((o) => ({
                key: o,
                label: o === 'mac' ? 'Mac' : 'Windows',
                active: os === o,
                link: {
                  to: '/help/shortcuts',
                  search: { os: o === 'mac' ? undefined : o },
                  replace: true,
                },
              }))}
            />
          </div>
          <p className="m-0 text-body text-fg-muted">
            Press <Kbd>?</Kbd> outside a text field to see shortcuts available
            on the current page. Open the dialog on a list, notebook or review
            page to see its shortcuts.
          </p>
        </header>
        <ShortcutGroups
          definitions={registry.definitions}
          platform={os === 'mac' ? 'mac' : 'other'}
        />
        <div>
          <Button onClick={requestShortcutsDialog}>
            Show keyboard shortcuts
          </Button>
        </div>
      </div>
      <aside
        aria-label="About this release"
        className="flex flex-col gap-4 lg:sticky lg:top-5 lg:self-start"
      >
        <section className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-label leading-[18px]">
          <h2 className="font-sans text-label font-semibold">Also useful</h2>
          <Link to="/help/records">
            How records, reviews and signatures work
          </Link>
          <Link to="/help">Help centre</Link>
        </section>
        <ReleaseCard />
      </aside>
    </div>
  )
}
