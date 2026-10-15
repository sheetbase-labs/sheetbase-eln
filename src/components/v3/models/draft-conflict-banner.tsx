import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import type { DraftConflict } from '#/lib/dataset-schema-draft'

/**
 * R5-CONFIG-03 — the stale-draft banner.
 *
 * The server refused a save because the draft moved underneath it (SB001).
 * Nothing has been written, and nothing is written until the author chooses:
 * Reload theirs, or — when the two sides changed different fields — Merge and
 * keep editing, or — when they overlap — an explicit Keep mine that overwrites
 * their version. There is no silent resolution.
 *
 * The copy is derived from `conflict.overlap`, which comes from comparing the
 * field contract snapshots, not from a guess.
 */
export function DraftConflictBanner({
  conflict,
  onReload,
  onMerge,
  onKeepMine,
  busy = false,
}: {
  conflict: DraftConflict
  onReload: () => void
  onMerge: () => void
  onKeepMine: () => void
  busy?: boolean
}) {
  const changed = conflict.theirs.size
  return (
    <Banner
      tone="warn"
      icon="warn"
      title={
        conflict.overlap
          ? 'Someone else changed a field you also changed.'
          : 'This draft changed on the server.'
      }
      action={
        <>
          <Button size="sm" variant="quiet" disabled={busy} onClick={onReload}>
            Reload theirs
          </Button>
          {conflict.overlap ? (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={onKeepMine}
            >
              Keep mine
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={onMerge}
            >
              Merge and keep editing
            </Button>
          )}
        </>
      }
    >
      {conflict.overlap
        ? 'Nothing is overwritten until you choose. Keeping yours replaces their version of the shared fields.'
        : 'They changed different fields, so both can be kept. Merging takes their fields and re-applies yours; their ordering stands. '}
      {changed > 0 ? (
        <span className="text-fg-muted">
          {changed} {changed === 1 ? 'field' : 'fields'} changed elsewhere.
        </span>
      ) : null}
    </Banner>
  )
}
