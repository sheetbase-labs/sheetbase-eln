/**
 * ELN-007 — conflict resolution banner. When a block save conflicts with
 * a newer server version, the autosave hook preserves both the local
 * draft and the canonical server value and asks the user to choose
 * instead of silently overwriting either side. This banner renders that
 * choice:
 *
 * - **Use server version** → discard the local draft, adopt the server
 *   value, mark the block clean.
 * - **Keep my edit** → re-attempt saving the local draft against the
 *   latest server version.
 *
 * The banner also shows a compact, read-only preview of the server value
 * so the choice is comprehensible without switching tabs.
 *
 * Presentational only; the autosave hook owns the state.
 */

import { cn } from '#/lib/utils'
import { Button } from '#/components/ui'

export interface ConflictBannerProps {
  /** Human-readable explanation of the conflict. */
  message: string
  /**
   * Compact, read-only preview of the canonical server value. The
   * caller serialises the payload into a readable string (e.g. the
   * prose text or a one-line summary of the checklist).
   */
  serverPreview: string
  onUseServer: () => void
  onKeepLocal: () => void
  /** True while the retry save is in flight. */
  retrying?: boolean
  className?: string
}

export function ConflictBanner({
  message,
  serverPreview,
  onUseServer,
  onKeepLocal,
  retrying,
  className,
}: ConflictBannerProps) {
  return (
    <div
      role="alert"
      data-conflict-banner
      className={cn(
        'mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs',
        className,
      )}
    >
      <p className="font-medium text-destructive">{message}</p>
      <p className="mt-1 text-muted-foreground">
        Your edits are preserved below. The latest server version is:
      </p>
      <pre
        className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs"
        data-conflict-server-preview
      >
        {serverPreview}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onUseServer}
          data-conflict-use-server
        >
          Use server version
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onKeepLocal}
          disabled={retrying}
          data-conflict-keep-local
        >
          {retrying ? 'Retrying…' : 'Keep my edit'}
        </Button>
      </div>
    </div>
  )
}
