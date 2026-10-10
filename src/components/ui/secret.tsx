import { useState } from 'react'
import { toast } from 'sonner'

import { cn } from '#/lib/utils'

import { Button } from './button'

/**
 * Secret (DSYS-04): a one-time value (API token, verification code) with a
 * copy control. The value is held in props and never written to component
 * state; copying uses the clipboard and confirms with a toast.
 */
export interface SecretProps {
  value: string
  onCopy?: () => void
  copyLabel?: string
  className?: string
}

export function Secret({
  value,
  onCopy,
  copyLabel = 'Copy',
  className,
}: SecretProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard access can be denied; the value stays visible to copy by hand.
    }
    setCopied(true)
    onCopy?.()
    toast.success('Copied to clipboard')
  }

  return (
    <div
      data-slot="secret"
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-surface-derived px-2 py-1.5',
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate text-id">{value}</code>
      <Button type="button" size="sm" variant="secondary" onClick={copy}>
        {copied ? 'Copied' : copyLabel}
      </Button>
    </div>
  )
}
