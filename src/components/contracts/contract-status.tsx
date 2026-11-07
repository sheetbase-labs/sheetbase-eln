import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { statusLabel } from '#/lib/data-contracts/rules'
import type { ContractStatus } from '#/lib/data-contracts/types'

const TONES: Record<ContractStatus, Tone> = {
  pass: 'ok',
  warning: 'warn',
  fail: 'bad',
}

/** Pass, Warning or Fail beside a dataset or model; "Not checked" before the first run. */
export function ContractStatusBadge({
  status,
  className,
}: {
  status: ContractStatus | null | undefined
  className?: string
}) {
  return (
    <Status tone={status ? TONES[status] : 'none'} className={className}>
      {statusLabel(status)}
    </Status>
  )
}
