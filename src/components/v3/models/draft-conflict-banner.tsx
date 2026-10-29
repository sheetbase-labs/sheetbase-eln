import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import type { DraftConflict } from '#/lib/dataset-schema-draft'
import { t } from '#/copy'

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
          ? t('library.models.draftConflictBanner.someoneElseChangedAField')
          : t('library.models.draftConflictBanner.thisDraftChangedOnThe')
      }
      action={
        <>
          <Button size="sm" variant="quiet" disabled={busy} onClick={onReload}>
            {t('library.models.draftConflictBanner.reloadTheirs')}
          </Button>
          {conflict.overlap ? (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={onKeepMine}
            >
              {t('library.models.draftConflictBanner.keepMine')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={onMerge}
            >
              {t('library.models.draftConflictBanner.mergeAndKeepEditing')}
            </Button>
          )}
        </>
      }
    >
      {conflict.overlap
        ? t('library.models.draftConflictBanner.nothingIsOverwrittenUntilYou')
        : t('library.models.draftConflictBanner.theyChangedDifferentFieldsSo')}
      {changed > 0 ? (
        <span className="text-fg-muted">
          {t('library.models.draftConflictBanner.fieldsChangedElsewhere', {
            count: changed,
          })}
        </span>
      ) : null}
    </Banner>
  )
}
