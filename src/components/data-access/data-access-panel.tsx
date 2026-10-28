import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { CodeBlock } from '#/components/v3/ui/code-block'
import { CopyButton } from '#/components/v3/ui/copy-button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  apiRoute,
  dataAccessSnippets,
  resolveDataAccessHandle,
} from '#/lib/data-access-handles'
import { useReportingNames } from '#/lib/data-access-names'
import type { DataAccessHandle } from '#/lib/data-access-handles'

function HandleRow({
  label,
  value,
  copyLabel,
}: {
  label: string
  value: string
  copyLabel: string
}) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-24 shrink-0 text-label text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 truncate">
        <code className="mono text-caption" title={value}>
          {value}
        </code>
      </dd>
      <CopyButton value={value} aria-label={copyLabel} />
    </div>
  )
}

/** Keys, routes and snippets for one page, for the roles that use them. */
export function DataAccessPanel({ handle }: { handle: DataAccessHandle }) {
  const [origin, setOrigin] = useState('https://your-workspace.example')
  useEffect(() => setOrigin(window.location.origin), [])
  const [tab, setTab] = useState('curl')
  const snippets = dataAccessSnippets(handle, origin)
  const active = snippets.find((snippet) => snippet.id === tab) ?? snippets[0]
  const route = apiRoute(handle)
  return (
    <div className="flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-4">
      <PopoverTitle className="m-0 text-body font-semibold">
        Data access · {handle.label}
      </PopoverTitle>
      <dl className="m-0 flex flex-col gap-1.5">
        {handle.modelKey ? (
          <HandleRow
            label="Model key"
            value={handle.modelKey}
            copyLabel="Copy model key"
          />
        ) : null}
        {handle.recordRef ? (
          <HandleRow
            label="Record"
            value={handle.recordRef}
            copyLabel="Copy record reference"
          />
        ) : null}
        <HandleRow label="API route" value={route} copyLabel="Copy API route" />
        <HandleRow
          label="Postgres"
          value={handle.relation}
          copyLabel="Copy Postgres name"
        />
      </dl>
      <Tabs
        mode="state"
        label="Snippet language"
        variant="segment"
        value={tab}
        onValueChange={setTab}
        items={snippets.map((snippet) => ({
          key: snippet.id,
          label: snippet.label,
        }))}
      />
      <CodeBlock
        code={active.code}
        language={active.language}
        label={`${active.label} snippet`}
        maxHeight="lg"
      />
      <p className="m-0 text-label text-fg-muted">
        Get a token or a read-only SQL login in{' '}
        <Link to="/settings/api" className="text-link hover:underline">
          Settings → API
        </Link>
        .
      </p>
    </div>
  )
}

/** The `{ }` button in a page header. Renders only for data-access roles. */
export function DataAccessButton({ handle }: { handle: DataAccessHandle }) {
  return (
    <Popover>
      <PopoverTrigger
        data-data-access-trigger
        className="mx-act mono text-[11px] font-semibold"
        aria-label="Data access"
        title="Data access"
      >
        {'{ }'}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] overflow-auto">
        <DataAccessPanel handle={handle} />
      </PopoverContent>
    </Popover>
  )
}

/** A pane's `{ }` button, once the address is known to have data handles. */
export function PaneDataAccess({ href }: { href: string }) {
  const names = useReportingNames()
  const handle = resolveDataAccessHandle(href, names)
  return handle ? <DataAccessButton handle={handle} /> : null
}
