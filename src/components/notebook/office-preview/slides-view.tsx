import { useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { t } from '#/copy'
import type { PreviewSlide } from '#/lib/office-preview/slides'

/** One slide at a time: title, picture(s) and the text. */
export function SlidesView({ slides }: { slides: PreviewSlide[] }) {
  const [index, setIndex] = useState(0)
  const slide = slides.at(Math.min(index, slides.length - 1))
  const urls = useMemo(
    () =>
      slide
        ? slide.images.map((image) =>
            URL.createObjectURL(
              new Blob([image.data as BlobPart], { type: image.mediaType }),
            ),
          )
        : [],
    [slide],
  )
  useEffect(
    () => () => {
      for (const url of urls) URL.revokeObjectURL(url)
    },
    [urls],
  )
  if (!slide) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="num text-caption text-fg-muted">
          {t('notebook.officeFiles.slideOf', {
            number: slide.number,
            count: slides.length,
          })}
        </p>
        <div className="flex gap-1">
          <Button
            size="sm"
            icon="chevronLeft"
            aria-label={t('notebook.officeFiles.previousSlide')}
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          />
          <Button
            size="sm"
            icon="chevronRight"
            aria-label={t('notebook.officeFiles.nextSlide')}
            disabled={index >= slides.length - 1}
            onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
          />
        </div>
      </div>
      <div className="max-h-96 space-y-3 overflow-auto rounded-md border border-border bg-surface-muted/40 p-4">
        <h4 className="font-heading text-doc font-semibold">
          {slide.title ??
            t('notebook.officeFiles.slideTitleFallback', {
              number: slide.number,
            })}
        </h4>
        {urls.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {urls.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="max-h-56 max-w-full rounded-sm border border-border-subtle"
              />
            ))}
          </div>
        ) : null}
        {slide.lines.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-body">
            {slide.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
