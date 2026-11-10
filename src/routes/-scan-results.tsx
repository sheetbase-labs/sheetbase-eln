import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Status } from '#/components/ui/status'
import { Icon } from '#/components/icons'
import {
  scanTargetActionLabel,
  scanTargetHref,
} from '#/components/scan/scan-data'
import type { ScanTarget } from '#/components/scan/scan-data'
import { ScanSampleActions } from '#/components/scan/scan-sample-actions'
import { t } from '#/copy'

/**
 * The Scan screen's result panels: what a resolved code is, what a miss
 * suggests, and the codes resolved so far in this session.
 */

/** One resolved code: the record it is, and what can be done from here. */
export function ScanHitCard({
  hit,
  onChanged,
}: {
  hit: ScanTarget
  onChanged: () => void
}) {
  return (
    <section
      aria-label={t('library.scan.page.scannedRecord')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <span className="text-success">
          <Icon name="check" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mono text-fg-muted">{hit.identifier}</div>
          <div className="text-[15px] font-semibold">{hit.title}</div>
          <div className="text-label text-fg-muted">
            {hit.line}
            {hit.matchedAlias ? (
              <>
                {' '}
                {t('library.scan.page.alsoKnownAs', {
                  matchedAlias: hit.matchedAlias,
                })}
              </>
            ) : null}
          </div>
        </div>
        <Status tone={hit.status.tone}>{hit.status.label}</Status>
      </div>
      {hit.kind === 'sample' ? (
        <ScanSampleActions
          sampleId={hit.id}
          returnTo={`/scan?code=${encodeURIComponent(hit.identifier)}`}
          onChanged={onChanged}
        />
      ) : null}
      {hit.kind === 'instrument' ? (
        <Button
          size="lg"
          nativeButton={false}
          render={
            <Link
              to="/schedule"
              search={{
                book: hit.id,
                returnTo: `/scan?code=${encodeURIComponent(hit.identifier)}`,
              }}
            />
          }
        >
          {t('library.scan.page.bookThisInstrument')}
        </Button>
      ) : null}
      <Button
        variant={hit.kind === 'sample' ? 'secondary' : 'primary'}
        size="lg"
        nativeButton={false}
        render={<Link {...scanTargetHref(hit)} />}
      >
        {scanTargetActionLabel(hit)}
      </Button>
    </section>
  )
}

/** A code that found nothing, with the identifiers it might have meant. */
export function ScanMissNotice({
  code,
  suggestions,
  onPick,
}: {
  code: string
  suggestions: ScanTarget[]
  onPick: (identifier: string) => void
}) {
  return (
    <Notice tone="warn" title={t('library.scan.page.noRecordWithId', { code })}>
      {suggestions.length ? (
        <>
          {t('library.scan.page.didYouMean')}{' '}
          {suggestions.map((suggestion, index) => (
            <span key={suggestion.id}>
              {index ? ', ' : ''}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link underline"
                onClick={() => onPick(suggestion.identifier)}
              >
                {suggestion.identifier}
              </button>
            </span>
          ))}
          ?
        </>
      ) : (
        t('library.scan.page.checkTheLabelAndTry')
      )}
    </Notice>
  )
}

/** A code that could not be read at all: not the same as a miss. */
export function ScanErrorNotice({ message }: { message: string }) {
  return (
    <Notice tone="bad" title={t('library.scan.page.couldNotResolveThisCode')}>
      {message}
    </Notice>
  )
}

/** The codes resolved in this session, newest first. */
export function ScanRecentList({
  recent,
  onOpen,
}: {
  recent: ScanTarget[]
  onOpen: (target: ScanTarget) => void
}) {
  if (recent.length === 0) {
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('library.scan.page.scansYouResolveThisSession')}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-label font-medium text-fg-muted">
        {t('library.scan.page.recentScans')}
      </h2>
      {recent.map((target) => (
        <button
          key={target.id}
          type="button"
          onClick={() => onOpen(target)}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 text-left font-[inherit] hover:bg-surface-hover"
        >
          <span className="mono w-24 text-fg-muted">{target.identifier}</span>
          <span className="flex-1 truncate text-body">{target.title}</span>
          <Status tone={target.status.tone}>{target.status.label}</Status>
        </button>
      ))}
    </section>
  )
}
