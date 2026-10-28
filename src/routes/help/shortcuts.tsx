import { Link, createFileRoute } from '@tanstack/react-router'

import { usePlatform } from '#/lib/use-platform'
import { useShortcuts } from '#/components/shortcuts/shortcut-provider'
import { ShortcutGroups } from '#/components/shortcuts/shortcuts-dialog'
import { Button } from '#/components/v3/ui/button'
import { Breadcrumb } from '#/components/v3/ui/breadcrumb'
import { Kbd } from '#/components/v3/ui/kbd'
import { Tabs } from '#/components/v3/ui/tabs'
import { requestShortcutsDialog } from '#/lib/shortcuts-dialog'

import { ReleaseCard } from '../help'

/** Keyboard shortcuts. `?os=windows` (the default off a Mac) shows Ctrl/Alt/Shift instead of ⌘/⌥/⇧. */
export const Route = createFileRoute('/help/shortcuts')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { os?: 'mac' | 'windows' } => ({
    os: search.os === 'windows' || search.os === 'mac' ? search.os : undefined,
  }),
  component: Shortcuts,
})

function Shortcuts() {
  const platform = usePlatform()
  // Open on the tab for the keyboard the reader actually has.
  const { os = platform === 'mac' ? 'mac' : 'windows' } = Route.useSearch()
  const { registry } = useShortcuts()
  return (
    <div className="grid grid-cols-1 gap-8 px-4 pb-10 pt-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <Breadcrumb
            trail={[
              { label: 'Help', link: { to: '/help' } },
              { label: 'Keyboard shortcuts' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="flex-1 text-title max-md:basis-full max-md:text-[18px] max-md:leading-6">
              Keyboard shortcuts
            </h1>
            <Tabs
              mode="url"
              variant="segment"
              value={os}
              label="Keyboard"
              items={(['mac', 'windows'] as const).map((o) => ({
                key: o,
                label: o === 'mac' ? 'Mac' : 'Windows / Linux',
                link: {
                  to: '/help/shortcuts',
                  search: { os: o },
                  replace: true,
                },
              }))}
            />
          </div>
          <p className="m-0 text-body text-fg-muted">
            Press <Kbd>?</Kbd> outside a text field to see all shortcuts. This
            page lists the whole catalogue: the List, Notebook and Review groups
            work only while that screen is open, so a shortcut here may do
            nothing until you are standing where it belongs. Each group keeps
            the same permissions as its buttons. While typing, only cell edit
            cancellation and saving remain available.
          </p>
        </header>
        <ShortcutGroups
          definitions={registry.definitions.filter(
            (definition) => !definition.additional,
          )}
          platform={os === 'mac' ? 'mac' : 'other'}
        />
        <section className="flex flex-col gap-3">
          <h2 className="text-title">Additional navigation shortcuts</h2>
          <ShortcutGroups
            definitions={registry.definitions.filter(
              (definition) => definition.additional,
            )}
            platform={os === 'mac' ? 'mac' : 'other'}
            headingLevel={3}
          />
        </section>
        <div>
          <Button onClick={requestShortcutsDialog}>
            Show keyboard shortcuts
          </Button>
        </div>
        <section
          id="focus-order"
          className="flex scroll-mt-5 flex-col gap-2 text-body"
        >
          <h2 className="text-title">Focus order</h2>
          <p>
            Tab starts at Skip to content, then moves through the top bar,
            navigation, page actions and tabs, content, and inspector. Arrow
            keys move within navigation and grids.
          </p>
          <p>
            Enter edits a sheet cell. Esc cancels its edit. Tab moves to the
            next cell and leaves the grid at its boundary.
          </p>
          <p>
            Overlays take focus and return it when closed. Esc closes the
            top-most overlay. Clicking outside does not discard unsaved dialog
            input. Signing starts in the password field and always requires
            explicit confirmation.
          </p>
        </section>
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
