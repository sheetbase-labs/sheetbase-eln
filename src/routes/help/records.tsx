import { Link, createFileRoute } from '@tanstack/react-router'

import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { DescriptionList } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { helpToc } from '#/components/v3/help/help-content'

import { ReleaseCard } from '../help'

/**
 * Help article: record states as a diagram, then what each state means.
 * Illustrative record IDs are plain text, never links, so the page cannot
 * point at records that do not exist in this workspace.
 */
export const Route = createFileRoute('/help/records')({
  component: RecordsArticle,
})

type Node = {
  id: string
  tone: Tone
  label: string
  sub: string
  x: number
  y: number
}
const W = 148
const H = 58
const nodes: Node[] = [
  {
    id: 'draft',
    tone: 'draft',
    label: 'Draft',
    sub: 'Only you can see it',
    x: 0,
    y: 24,
  },
  {
    id: 'progress',
    tone: 'progress',
    label: 'In progress',
    sub: 'Team edits; autosaves',
    x: 206,
    y: 24,
  },
  {
    id: 'review',
    tone: 'review',
    label: 'In review',
    sub: 'Locked for the author',
    x: 412,
    y: 24,
  },
  {
    id: 'approved',
    tone: 'ok',
    label: 'Approved',
    sub: 'Signed; PDF and hash kept',
    x: 618,
    y: 24,
  },
  {
    id: 'returned',
    tone: 'warn',
    label: 'Returned',
    sub: 'Comments to resolve',
    x: 412,
    y: 150,
  },
  {
    id: 'amendment',
    tone: 'progress',
    label: 'Amendment · v2',
    sub: 'Copy with a reason; new review',
    x: 618,
    y: 150,
  },
]

const states: {
  tone: Tone
  state: string
  see: string
  change: string
  kept: string
}[] = [
  {
    tone: 'draft',
    state: 'Draft',
    see: 'You',
    change: 'You',
    kept: 'Every save, as revisions',
  },
  {
    tone: 'progress',
    state: 'In progress',
    see: 'Project members',
    change: 'Owner and collaborators',
    kept: 'Every change: who, when, old value, reason',
  },
  {
    tone: 'review',
    state: 'In review',
    see: 'Project members, reviewer',
    change: 'Nobody. The reviewer comments',
    kept: 'The submitted version, frozen',
  },
  {
    tone: 'warn',
    state: 'Returned',
    see: 'Project members',
    change: 'Owner, to resolve comments',
    kept: 'Comments and the returned version',
  },
  {
    tone: 'ok',
    state: 'Approved · signed',
    see: 'Project members, QA, client if shared',
    change: 'Nobody. Start an amendment',
    kept: 'Signed PDF, content hash, signatures',
  },
]

function RecordsArticle() {
  return (
    <div className="grid max-w-[1164px] grid-cols-1 gap-8 px-4 pb-10 pt-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <article className="flex min-w-0 max-w-[768px] flex-col gap-7">
        <header className="flex flex-col gap-1.5">
          <nav aria-label="Breadcrumb" className="text-label text-fg-muted">
            <Link to="/help">Help</Link> / How records work
          </nav>
          <h1 className="text-title max-md:text-[18px] max-md:leading-6">
            How records, reviews and signatures work
          </h1>
          <p className="m-0 text-prose leading-6 text-fg-muted">
            Every experiment, dataset and protocol moves through the same
            states. What you can change depends on the state, and every change
            is written to History with who, when, the old value and the reason.
          </p>
        </header>

        <section id="states" className="flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-section">Record states</h2>
          <StateDiagram />
          <ol
            aria-label="Record states, in order"
            className="m-0 flex list-none flex-col gap-0 p-0 md:hidden"
          >
            {nodes.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-2 border-b border-border-subtle py-2 text-body last:border-b-0"
              >
                <Dot tone={n.tone} className="mt-1.5" />
                <span>
                  <b className="font-medium">{n.label}</b>
                  <span className="block text-label text-fg-muted">
                    {n.sub}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 text-body leading-5">
            You <b className="font-medium">start</b> a draft,{' '}
            <b className="font-medium">submit</b> it for review, and the
            reviewer either <b className="font-medium">signs</b> it or{' '}
            <b className="font-medium">returns</b> it with comments. A returned
            record goes back to review after your edits. A signed record never
            changes; to correct it, create an amendment, which is a new version
            with a reason and its own review.
          </p>
        </section>

        <section id="changes" className="flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-section">What you can change in each state</h2>
          <TableBox className="max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">State</TableHead>
                  <TableHead>Who can see it</TableHead>
                  <TableHead>Who can change it</TableHead>
                  <TableHead>What’s kept</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {states.map((s) => (
                  <TableRow key={s.state}>
                    <TableCell className="first:pl-3">
                      <Status tone={s.tone}>{s.state}</Status>
                    </TableCell>
                    <TableCell className="whitespace-normal py-1.5">
                      {s.see}
                    </TableCell>
                    <TableCell className="whitespace-normal py-1.5">
                      {s.change}
                    </TableCell>
                    <TableCell className="whitespace-normal py-1.5 text-fg-muted">
                      {s.kept}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          <div className="flex flex-col md:hidden">
            {states.map((s) => (
              <div
                key={s.state}
                className="border-b border-border-subtle py-2.5 text-label leading-[18px] last:border-b-0"
              >
                <div className="text-body font-medium">
                  <Status tone={s.tone}>{s.state}</Status>
                </div>
                <DescriptionList
                  className="mt-1"
                  labelWidth={96}
                  items={[
                    ['Can see', s.see],
                    ['Can change', s.change],
                    ['Kept', s.kept],
                  ]}
                />
              </div>
            ))}
          </div>
        </section>

        <section id="revisions" className="flex scroll-mt-4 flex-col gap-2">
          <h2 className="text-section">Revisions and history</h2>
          <p className="m-0 text-body leading-5">
            Each save makes a revision. The History tab lists every change with
            who made it, when (server time), the old and new value, and the
            reason. Once a record has been submitted, changing a value asks for
            a reason. Nothing is deleted: a removed row or block stays in
            History.
          </p>
          <div className="rounded-md border border-border px-3 py-2.5 text-label leading-[18px]">
            <div className="text-fg-muted">
              Example from an experiment’s History
            </div>
            <div className="mt-1">
              <b className="font-medium">Gareth P.</b> edited Load (L/m²) in
              Clarification runs, row 9: <del>125</del> <ins>150</ins>
            </div>
            <div className="text-fg-muted">
              25 Sep 2026, 09:32 BST · Reason: Transcription error; run sheet
              says 150
            </div>
          </div>
        </section>

        <section id="reviews" className="flex scroll-mt-4 flex-col gap-2">
          <h2 className="text-section">What reviewers see</h2>
          <p className="m-0 text-body leading-5">
            Reviewers see changes since their last review marked in the margin,
            can comment on any block or cell, and either sign or return the
            record with comments. They can’t edit the author’s content. You
            can’t review a record you authored.
          </p>
        </section>

        <section id="signatures" className="flex scroll-mt-4 flex-col gap-2">
          <h2 className="text-section">Signatures</h2>
          <p className="m-0 text-body leading-5">
            A signature is your password entered again at the moment of signing,
            plus a meaning. It is bound to one version of the record by its
            content hash, so any later change needs an amendment and a new
            signature. The time on a signature is the server’s, not your
            computer’s.
          </p>
          <DescriptionList
            className="rounded-md border border-border p-3 text-body"
            labelWidth={96}
            items={[
              [
                'Authored',
                'I wrote this record and it is complete and accurate.',
              ],
              [
                'Reviewed',
                'I checked the record against the protocol and its data.',
              ],
              ['Approved', 'I approve this record as the final version.'],
              ['Witnessed', 'I saw the work described being done.'],
            ]}
          />
          <Notice>
            Signing always asks for your password, even straight after you sign
            in. Your signature is set up once in your profile.
          </Notice>
        </section>

        <section id="snapshots" className="flex scroll-mt-4 flex-col gap-2">
          <h2 className="text-section">Dataset snapshots</h2>
          <p className="m-0 text-body leading-5">
            A dataset keeps growing as you import. A snapshot is a copy of it at
            one moment that never changes. Signed records and analyses cite a
            snapshot, not the live table, so what a reviewer signed always reads
            the same. Snapshots cited by a signed record are kept for the
            retention period; others may have their rows removed. Open a{' '}
            <Link to="/datasets">dataset</Link> to see its snapshots.
          </p>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link to="/settings/signatures" />}
          >
            Set up your signature
          </Button>
          <Button nativeButton={false} render={<Link to="/help/shortcuts" />}>
            Keyboard shortcuts
          </Button>
        </div>
      </article>

      <aside
        aria-label="On this page"
        className="flex flex-col gap-4 lg:sticky lg:top-5 lg:self-start"
      >
        <nav
          aria-label="On this page"
          className="flex flex-col gap-1 text-label max-lg:hidden"
        >
          <span className="mb-0.5 font-semibold">On this page</span>
          {helpToc.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-fg-muted hover:text-link"
            >
              {label}
            </a>
          ))}
        </nav>
        <ReleaseCard />
      </aside>
    </div>
  )
}

function StateDiagram() {
  const box = (id: string) => nodes.find((n) => n.id === id)!
  const mid = (n: Node) => ({
    l: n.x,
    r: n.x + W,
    t: n.y,
    b: n.y + H,
    cy: n.y + H / 2,
    cx: n.x + W / 2,
  })
  const [d, p, r, a, ret, am] = [
    'draft',
    'progress',
    'review',
    'approved',
    'returned',
    'amendment',
  ].map((i) => mid(box(i)))
  const arrows: {
    d: string
    label: string
    lx: number
    ly: number
    anchor?: 'start' | 'middle' | 'end'
  }[] = [
    {
      d: `M${d.r} ${d.cy} H${p.l - 2}`,
      label: 'Start',
      lx: (d.r + p.l) / 2,
      ly: d.cy - 7,
    },
    {
      d: `M${p.r} ${p.cy} H${r.l - 2}`,
      label: 'Submit',
      lx: (p.r + r.l) / 2,
      ly: p.cy - 7,
    },
    {
      d: `M${r.r} ${r.cy} H${a.l - 2}`,
      label: 'Sign',
      lx: (r.r + a.l) / 2,
      ly: r.cy - 7,
    },
    {
      d: `M${r.cx - 24} ${r.b} V${ret.t - 2}`,
      label: 'Return',
      lx: r.cx - 30,
      ly: (r.b + ret.t) / 2 + 4,
      anchor: 'end',
    },
    {
      d: `M${ret.cx + 24} ${ret.t} V${r.b + 2}`,
      label: 'Resubmit after edits',
      lx: ret.cx + 30,
      ly: (r.b + ret.t) / 2 + 4,
      anchor: 'start',
    },
    { d: `M${a.l + 22} ${a.b} V${am.t - 2}`, label: '', lx: 0, ly: 0 },
  ]
  return (
    <div className="overflow-x-auto max-md:hidden">
      <div className="relative h-[210px] w-[768px]">
        <svg
          aria-hidden="true"
          className="absolute inset-0"
          width="768"
          height="210"
          viewBox="0 0 768 210"
        >
          <defs>
            <marker
              id="sb-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0L8 4L0 8z" fill="var(--color-fg-muted)" />
            </marker>
          </defs>
          {arrows.map((x, i) => (
            <g key={i}>
              <path
                d={x.d}
                fill="none"
                stroke="var(--color-fg-muted)"
                strokeWidth="1.2"
                markerEnd="url(#sb-arrow)"
              />
              {x.label ? (
                <text
                  x={x.lx}
                  y={x.ly}
                  textAnchor={x.anchor ?? 'middle'}
                  fontSize="11"
                  fill="var(--color-fg-muted)"
                  fontFamily="inherit"
                >
                  {x.label}
                </text>
              ) : null}
            </g>
          ))}
          <text
            x={a.l + 28}
            y={(a.b + am.t) / 2 + 4}
            fontSize="11"
            fill="var(--color-fg-muted)"
            fontFamily="inherit"
          >
            Create amendment
          </text>
        </svg>
        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute flex flex-col justify-center rounded-md border border-border bg-surface px-2.5 shadow-[0_1px_0_var(--color-border-subtle)]"
            style={{ left: n.x, top: n.y, width: W, height: H }}
          >
            <span className="flex items-center gap-1.5 text-body font-medium">
              <Dot tone={n.tone} />
              {n.label}
            </span>
            <span className="text-[11px] leading-4 text-fg-muted">{n.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
