import { Link, createFileRoute } from '@tanstack/react-router'

import { shortcutGroups } from '#/components/v3/help/help-content'
import { Kbd } from '#/components/v3/ui/kbd'
import { SegmentLinks } from '#/components/v3/projects/search-tabs'

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

const win: Record<string, string> = { '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' }

function Shortcuts() {
  const { os = 'mac' } = Route.useSearch()
  const key = (k: string) => (os === 'windows' ? (win[k] ?? k) : k)
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
            Press <Kbd>?</Kbd> anywhere to see this list. Shortcuts never sign
            or submit on their own; they open the dialog that asks.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {shortcutGroups.map((g) => (
            <section key={g.title} aria-labelledby={`sc-${g.title}`}>
              <h2 id={`sc-${g.title}`} className="mb-1 text-section">
                {g.title}
              </h2>
              <dl className="m-0">
                {g.items.map((it) => (
                  <div
                    key={it.label}
                    className="flex min-h-9 items-center justify-between gap-3 border-b border-border-subtle text-body last:border-b-0"
                  >
                    <dt>{it.label}</dt>
                    <dd className="m-0 flex shrink-0 items-center gap-1">
                      {it.keys.map((combo, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i ? (
                            <span className="text-label text-fg-muted">
                              {it.keys.length === 2 &&
                              it.label.startsWith('Go to')
                                ? 'then'
                                : 'or'}
                            </span>
                          ) : null}
                          {combo.map((k) => (
                            <Kbd
                              key={k}
                              className="min-w-5 px-1.5 py-0.5 text-center text-[11px]"
                            >
                              {key(k)}
                            </Kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
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
