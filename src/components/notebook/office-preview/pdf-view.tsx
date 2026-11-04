import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { t } from '#/copy'

interface PdfDocument {
  numPages: number
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: {
      canvasContext: CanvasRenderingContext2D
      canvas: HTMLCanvasElement
      viewport: { width: number; height: number }
    }) => { promise: Promise<void> }
  }>
  destroy: () => Promise<void>
}

/** A PDF drawn by pdf.js, one page at a time. */
export default function PdfView({
  bytes,
  name,
  tall,
}: {
  bytes: Uint8Array
  name: string
  tall?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [page, setPage] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const run: { cancelled: boolean; loaded: PdfDocument | null } = {
      cancelled: false,
      loaded: null,
    }
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
          .default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const task = pdfjs.getDocument({ data: bytes.slice() })
        const opened = (await task.promise) as unknown as PdfDocument
        run.loaded = opened
        if (run.cancelled) {
          void opened.destroy()
          return
        }
        setDoc(opened)
      } catch {
        if (!run.cancelled) setFailed(true)
      }
    })()
    return () => {
      run.cancelled = true
      if (run.loaded) void run.loaded.destroy()
    }
  }, [bytes])

  useEffect(() => {
    if (!doc || !canvas.current || !frame.current) return
    const run = { cancelled: false }
    const target = canvas.current
    const width = frame.current.clientWidth || 640
    void (async () => {
      try {
        const p = await doc.getPage(page)
        const natural = p.getViewport({ scale: 1 })
        const scale = Math.min(Math.max(width / natural.width, 0.5), 2.5)
        const viewport = p.getViewport({ scale })
        const ratio = window.devicePixelRatio || 1
        const context = target.getContext('2d')
        if (!context || run.cancelled) return
        target.width = Math.floor(viewport.width * ratio)
        target.height = Math.floor(viewport.height * ratio)
        target.style.width = `${Math.floor(viewport.width)}px`
        target.style.height = `${Math.floor(viewport.height)}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        await p.render({ canvasContext: context, canvas: target, viewport })
          .promise
      } catch {
        if (!run.cancelled) setFailed(true)
      }
    })()
    return () => {
      run.cancelled = true
    }
  }, [doc, page])

  if (failed) {
    return (
      <p role="alert" className="text-sm text-fg-muted">
        {t('notebook.officeFiles.couldNotOpen')}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="num text-caption text-fg-muted">
          {doc
            ? t('notebook.officeFiles.pageOf', {
                number: page,
                count: doc.numPages,
              })
            : t('notebook.officeFiles.loading')}
        </p>
        <div className="flex gap-1">
          <Button
            size="sm"
            icon="chevronLeft"
            aria-label={t('notebook.officeFiles.previousSlide')}
            disabled={!doc || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <Button
            size="sm"
            icon="chevronRight"
            aria-label={t('notebook.officeFiles.nextSlide')}
            disabled={!doc || page >= doc.numPages}
            onClick={() =>
              setPage((p) => (doc ? Math.min(doc.numPages, p + 1) : p))
            }
          />
        </div>
      </div>
      <div
        ref={frame}
        className={
          tall
            ? 'max-h-[70vh] overflow-auto rounded-md border border-border bg-surface-muted/40 p-2'
            : 'max-h-96 overflow-auto rounded-md border border-border bg-surface-muted/40 p-2'
        }
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={name}
          className="mx-auto block bg-white"
        />
      </div>
    </div>
  )
}
