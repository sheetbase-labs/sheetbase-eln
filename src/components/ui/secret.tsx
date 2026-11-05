import { CopyButton } from './copy-button'

// A value shown once (a new API token). Pair with a warn Notice; never show it again after the dialog closes.
export function Secret({
  value,
  copyLabel = 'Copy',
  copiedMessage = 'Copied',
  failedMessage = 'Couldn’t copy. Select the value and copy it by hand.',
}: {
  value: string
  copyLabel?: string
  copiedMessage?: string
  failedMessage?: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted py-1.5 pl-2.5 pr-1.5">
      <code className="min-w-0 flex-1 font-mono text-[12px] [overflow-wrap:anywhere]">
        {value}
      </code>
      <CopyButton
        value={value}
        copiedMessage={copiedMessage}
        failedMessage={failedMessage}
      >
        {copyLabel}
      </CopyButton>
    </div>
  )
}
