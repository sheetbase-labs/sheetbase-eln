import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import {
  helpArticles,
  guides,
  helpFlow,
  helpTopics,
} from '#/components/v3/help/help-content'
import { useShortcuts } from '#/components/shortcuts/shortcut-provider'
import { ShortcutKeys } from '#/components/shortcuts/shortcuts-dialog'
import { Button } from '#/components/v3/ui/button'
import { Badge } from '#/components/v3/ui/badge'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Kbd } from '#/components/v3/ui/kbd'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Section } from '#/components/v3/ui/layout'
import { Icon } from '#/components/v3/icons'
import { useHelp } from '#/lib/help'
import { cn } from '#/lib/utils'

import { ReleaseCard } from '../help'

/**
 * Help centre (redesign of the legacy /help). `?q=` searches the help
 * articles; with no match it offers support.
 */
export const Route = createFileRoute('/help/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  component: HelpCentre,
})

const RELEASE_NOTES: {
  version: string
  date: string
  validation: { tone: Tone; label: string }
  changeControl: string
  items: { kind: 'New' | 'Changed' | 'Fixed'; text: string }[]
}[] = [
  {
    version: '3.4.0',
    date: '15 Sep 2026',
    validation: { tone: 'ok', label: 'Validated' },
    changeControl: 'CC-2026-041',
    items: [
      {
        kind: 'New',
        text: 'Dataset snapshots show which signed records cite them, and snapshots that are cited can’t be removed.',
      },
      {
        kind: 'New',
        text: 'Reviewers see changes since their last review marked in the margin.',
      },
      {
        kind: 'Changed',
        text: 'Signing asks for your password every time, even straight after signing in.',
      },
      {
        kind: 'Fixed',
        text: 'Units in imported Ambr 250 files are no longer dropped when the header row is merged.',
      },
    ],
  },
  {
    version: '3.3.2',
    date: '21 Aug 2026',
    validation: { tone: 'ok', label: 'Validated' },
    changeControl: 'CC-2026-033',
    items: [
      {
        kind: 'Fixed',
        text: 'Audit log exports include the reason for change on cell edits.',
      },
    ],
  },
]

function HelpCentre() {
  const { q = '' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { registry } = useShortcuts()
  const topShortcuts = registry
    .inScope('global')
    .filter((definition) => !definition.id.startsWith('go-'))
  const help = useHelp()
  const [query, setQuery] = useState(q)
  const term = q.trim().toLowerCase()
  const hits = term
    ? helpArticles.filter((a) =>
        `${a.title} ${a.summary} ${a.terms}`.toLowerCase().includes(term),
      )
    : []
  const version = help?.release.version ?? 'this release'

  return (
    <div className="flex flex-col">
      <header className="border-b border-border bg-surface-muted px-4 pb-6 pt-5 md:px-8">
        <div className="max-w-[1100px]">
          <h1 className="text-title max-md:text-[18px] max-md:leading-6">
            Help
          </h1>
          <p className="m-0 mt-0.5 text-body text-fg-muted">
            Guides for Sheetbase {version}, the release running in this
            workspace.
          </p>
          <form
            role="search"
            className="mt-3.5 flex max-w-[600px] gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void navigate({
                search: { q: query.trim() || undefined },
                replace: true,
              })
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search help</span>
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help, e.g. amendment, snapshot, import"
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus max-md:h-11"
              />
            </label>
            <Button type="submit" className="h-9 max-md:h-11">
              Search
            </Button>
          </form>
        </div>
      </header>

      <div className="grid max-w-[1164px] grid-cols-1 gap-8 px-4 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-8">
          {term ? (
            <Section
              title={`Results for “${q}”`}
              count={hits.length}
              action={
                <Link to="/help" className="text-label">
                  Clear search
                </Link>
              }
            >
              {hits.length ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {hits.map((a) => (
                    <li
                      key={a.id}
                      className="border-b border-border-subtle last:border-b-0"
                    >
                      <Link
                        {...a.link}
                        className="flex flex-col gap-0.5 py-2.5 text-fg no-underline hover:text-fg hover:no-underline [&:hover_.t]:underline"
                      >
                        <span className="text-label text-fg-muted">
                          {a.section}
                        </span>
                        <span className="t text-body font-medium text-link">
                          {a.title}
                        </span>
                        <span className="text-label text-fg-muted">
                          {a.summary}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon="search"
                  className="py-3"
                  title="No help articles match"
                  body={
                    <>
                      Try the name of an action or a record, like “sign”,
                      “snapshot” or “import”. If you’re stuck, see{' '}
                      <a href="#support">Contact support</a> for how to reach
                      the IT service desk.
                    </>
                  }
                />
              )}
            </Section>
          ) : null}

          <Section title="Getting started">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {guides.map((g, i) => (
                <div
                  key={g.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-label text-fg-muted">
                      Step {i + 1}
                    </span>
                    <span className="num text-label text-fg-muted">
                      {g.time}
                    </span>
                  </div>
                  <h3 className="font-heading text-[14px] font-semibold">
                    {g.title}
                  </h3>
                  <ol className="m-0 flex flex-1 list-decimal flex-col gap-1 pl-4 text-label leading-[17px]">
                    {g.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <div>
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link {...g.link} />}
                    >
                      {g.linkLabel}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="How records work"
            action={
              <Link to="/help/records" className="text-label">
                Read the guide
              </Link>
            }
          >
            <div className="flex flex-col gap-3 rounded-md border border-border p-3.5">
              <ol
                aria-label="Record states"
                className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-2 p-0 text-label"
              >
                {helpFlow.map((f, i) => (
                  <li key={f.label} className="flex items-center gap-1.5">
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border bg-surface px-2">
                      <Dot tone={f.tone} />
                      {f.label}
                    </span>
                    {i < helpFlow.length - 1 ? (
                      <Icon
                        name="chevronRight"
                        size={12}
                        className="text-fg-muted"
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="m-0 text-body leading-5 text-fg-muted">
                Every experiment, dataset and protocol moves through the same
                states. What you can change depends on the state, and every
                change is kept with who, when, the old value and the reason.
              </p>
              <ul className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 md:grid-cols-2">
                {helpTopics.map((tp) => (
                  <li
                    key={tp.label}
                    className="border-t border-border-subtle py-2"
                  >
                    <Link
                      to="/help/records"
                      hash={tp.hash}
                      className="text-body font-medium"
                    >
                      {tp.label}
                    </Link>
                    <span className="block text-label text-fg-muted">
                      {tp.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section
            title="Keyboard shortcuts"
            action={
              <Link to="/help/shortcuts" className="text-label">
                All shortcuts
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              {topShortcuts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5 text-body"
                >
                  <span>{s.description}</span>
                  <ShortcutKeys bindings={s.keys} platform="mac" />
                </div>
              ))}
            </div>
            <p className="m-0 text-label text-fg-muted">
              Press <Kbd>?</Kbd> outside a text field to see this page’s
              shortcuts. On Windows, use Ctrl for ⌘ and Alt for ⌥.
            </p>
          </Section>

          <Section title={<span id="whats-new">What’s new</span>}>
            {RELEASE_NOTES.map((r, i) => (
              <article
                key={r.version}
                className={cn(
                  'flex flex-col gap-2',
                  i > 0 && 'border-t border-border-subtle pt-3',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-heading text-[14px] font-semibold">
                    Sheetbase {r.version}
                  </h3>
                  <span className="text-label text-fg-muted">{r.date}</span>
                  <span className="text-label">
                    <Status tone={r.validation.tone}>
                      {r.validation.label}
                    </Status>
                  </span>
                  <span className="mono text-[11px] text-fg-muted">
                    {r.changeControl}
                  </span>
                  {help?.release.version === r.version ? (
                    <span className="text-label text-fg-muted">
                      · running here
                    </span>
                  ) : null}
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {r.items.map((it) => (
                    <li
                      key={it.text}
                      className="grid grid-cols-[64px_1fr] items-baseline gap-2 text-body leading-5"
                    >
                      <span>
                        <Badge
                          variant={
                            it.kind === 'New'
                              ? 'add'
                              : it.kind === 'Changed'
                                ? 'chg'
                                : 'kind'
                          }
                          className={
                            it.kind === 'Fixed'
                              ? 'font-sans text-[11px] tracking-normal'
                              : undefined
                          }
                        >
                          {it.kind}
                        </Badge>
                      </span>
                      <span>{it.text}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </Section>

          <SupportSection />
        </div>

        <aside
          aria-label="About this release"
          className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start"
        >
          <ReleaseCard />
          <section className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-label leading-[18px]">
            <h2 className="font-sans text-label font-semibold">Support</h2>
            {help ? (
              <>
                <span>{help.support.hours}</span>
                <span className="text-fg-muted">{help.support.urgent}</span>
              </>
            ) : null}
            <a href="#support">Contact support</a>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** Support needs a service-desk integration; until it exists, the honest gap. */
function SupportSection() {
  const help = useHelp()
  return (
    <Section title={<span id="support">Contact support</span>}>
      <div
        role="note"
        className="flex max-w-[640px] gap-2.5 rounded-md border border-dashed border-border-strong px-3 py-2.5 text-label leading-[18px]"
      >
        <Icon
          name="clock"
          size={14}
          className="mt-0.5 shrink-0 text-fg-muted"
        />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            Support requests from Sheetbase aren’t set up yet
          </span>
          <p className="m-0 mt-0.5 text-fg-muted">
            {help
              ? `${help.support.hours}. ${help.support.urgent}`
              : 'Contact the IT service desk.'}
          </p>
        </div>
      </div>
    </Section>
  )
}
