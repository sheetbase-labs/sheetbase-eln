import { cn } from '#/lib/utils'
import type { FieldChange } from './record-model-fields'

const CHIP: Record<FieldChange['kind'], string> = {
  Added: 'bg-success-wash text-success-text',
  Removed: 'bg-danger-wash text-danger-text',
  Changed: 'bg-warning-wash text-warning-text',
}

export function ChangeChip({ kind }: { kind: FieldChange['kind'] }) {
  return (
    <span
      className={cn(
        'inline-block rounded-[3px] px-1.5 text-caption font-medium',
        CHIP[kind],
      )}
    >
      {kind}
    </span>
  )
}

/** One change row: "Added Thaw viability · Number, 1 dp · Release tests", or
 * "Changed Passage · Rule ≤ 40 → ≤ 30" with the old value struck through. */
export function FieldChangeRow({ change }: { change: FieldChange }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 text-label leading-[20px]">
      <ChangeChip kind={change.kind} />
      <span className="font-medium">{change.subject}</span>
      {change.from !== undefined || change.to !== undefined ? (
        <span className="text-fg-muted">
          {change.detail} <s className="text-danger-text">{change.from}</s>{' '}
          <span className="text-success-text underline">{change.to}</span>
        </span>
      ) : change.detail ? (
        <span className="text-fg-muted">· {change.detail}</span>
      ) : null}
    </li>
  )
}

export function FieldChangeList({
  changes,
  label,
}: {
  changes: FieldChange[]
  label: string
}) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-1 p-0">
      {changes.map((change, i) => (
        <FieldChangeRow key={i} change={change} />
      ))}
    </ul>
  )
}
