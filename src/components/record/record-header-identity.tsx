import * as React from 'react'

/**
 * The identity strip above a record's title: what kind of record this is, its
 * stable identifier, and the status and phase pills that qualify it. Every
 * field is optional, so a record type only shows what it provides.
 */
export function RecordHeaderIdentity({
  recordType,
  identifier,
  status,
  phase,
}: {
  recordType: string
  identifier?: string
  status?: React.ReactNode
  phase?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold uppercase tracking-[0.14em] text-fg-muted">
        {recordType}
      </span>
      {identifier ? (
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {identifier}
        </span>
      ) : null}
      {status ? <span className="ml-1">{status}</span> : null}
      {phase ? <span>{phase}</span> : null}
    </div>
  )
}
