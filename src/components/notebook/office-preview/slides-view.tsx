import { useCallback, useState } from 'react'

import { Button } from '#/components/ui/button'
import { t } from '#/copy'
import type { PreviewSlide } from '#/lib/office-preview/slides'
import { readOnlyEntries } from '../read-only-entries'

function SlideImage({ image }: { image: PreviewSlide['images'][number] }) {
  const mount = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) return

      const url = URL.createObjectURL(
        new Blob([image.data.slice().buffer], { type: image.mediaType }),
      )

      node.src = url

      // React 19 runs this ref teardown on image replacement and unmount.
      return () => URL.revokeObjectURL(url)
    },
    [image],
  )

  return (
    <img
      ref={mount}
      alt=""
      className="max-h-56 max-w-full rounded-sm border border-border-subtle"
    />
  )
}

/** One slide at a time: title, picture(s) and the text. */
export function SlidesView({ slides }: { slides: PreviewSlide[] }) {
  const [index, setIndex] = useState(0)
  const slide = slides.at(Math.min(index, slides.length - 1))

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
        {slide.images.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {slide.images.map((image, i) => (
              // Duplicate image objects have no placement IDs; the image-dependent ref replaces/revokes each slot's URL.
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              <SlideImage key={i} image={image} />
            ))}
          </div>
        ) : null}
        {slide.lines.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-body">
            {readOnlyEntries(slide.lines, (line) => line).map(
              ({ key, value }) => (
                <li key={key}>{value}</li>
              ),
            )}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
