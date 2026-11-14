import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Avatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Icon } from '#/components/icons'
import { toast } from '#/components/ui/sonner'
import { useAvatarPhotoUrl } from '#/lib/avatar-photos-context'
import {
  memberPhotosQueryKey,
  removeMyPhoto,
  uploadMyPhoto,
} from '#/lib/avatar-photos'
import { t } from '#/copy'

/** Side of the square the cropped photo is saved at. */
const OUTPUT_PX = 512

/** Side of the crop area on screen. */
const STAGE_PX = 280
const MAX_ZOOM = 4

/**
 * Your avatar on the Profile page: upload a photo, position and zoom it in a
 * round frame, or remove it to go back to your initials.
 */
export function ProfilePhoto({
  userId,
  initials,
  name,
}: {
  userId: string
  initials: string
  name: string
}) {
  const queryClient = useQueryClient()
  const current = useAvatarPhotoUrl(userId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source)
    },
    [source],
  )

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: memberPhotosQueryKey })

  return (
    <div className="flex shrink-0 flex-col items-center gap-2.5 max-md:flex-row max-md:items-center">
      <Avatar size="lg" userId={userId} initials={initials} name={name} />
      <div className="flex flex-col items-stretch gap-1.5 max-md:items-start">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''

            // react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke -- The source-keyed effect above revokes this exact URL on replacement and on unmount, including cancelling the crop dialog.
            if (file) setSource(URL.createObjectURL(file))
          }}
        />
        <Button
          size="sm"
          icon="upload"
          onClick={() => inputRef.current?.click()}
        >
          {current
            ? t('settings.profile.photo.change')
            : t('settings.profile.photo.upload')}
        </Button>
        {current ? (
          <Button
            size="sm"
            variant="quiet"
            disabled={removing}
            onClick={async () => {
              setRemoving(true)

              try {
                await removeMyPhoto()
                await refresh()
                toast(t('settings.profile.photo.removedToast'))
              } catch (failure) {
                toast.error(t('settings.profile.photo.couldRemoveToast'), {
                  description:
                    failure instanceof Error
                      ? failure.message
                      : t('settings.profile.tryAgain'),
                })
              } finally {
                setRemoving(false)
              }
            }}
          >
            {t('settings.profile.photo.remove')}
          </Button>
        ) : null}
      </div>
      {source ? (
        <PhotoCropDialog
          source={source}
          onClose={() => setSource(null)}
          onSaved={async () => {
            await refresh()
            setSource(null)
            toast(t('settings.profile.photo.savedToast'))
          }}
        />
      ) : null}
    </div>
  )
}

interface Offset {
  x: number
  y: number
}

/** The scale that makes the image just cover the crop area. */
function coverScale(width: number, height: number): number {
  return Math.max(STAGE_PX / width, STAGE_PX / height)
}

/** Keeps the image covering the whole crop area. */
function clampOffset(
  offset: Offset,
  natural: { width: number; height: number },
  zoom: number,
): Offset {
  const scale = coverScale(natural.width, natural.height) * zoom
  const maxX = Math.max(0, (natural.width * scale - STAGE_PX) / 2)
  const maxY = Math.max(0, (natural.height * scale - STAGE_PX) / 2)

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
}

/** Draws the framed part of the image into a square and encodes it. */
async function renderCrop(
  image: HTMLImageElement,
  zoom: number,
  offset: Offset,
): Promise<Blob> {
  const scale = coverScale(image.naturalWidth, image.naturalHeight) * zoom
  const side = STAGE_PX / scale

  const sx =
    (image.naturalWidth * scale - STAGE_PX) / 2 / scale - offset.x / scale

  const sy =
    (image.naturalHeight * scale - STAGE_PX) / 2 / scale - offset.y / scale

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_PX
  canvas.height = OUTPUT_PX
  const context = canvas.getContext('2d')

  if (!context) throw new Error(t('settings.profile.tryAgain'))
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT_PX, OUTPUT_PX)

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))

  // Browsers that cannot write WebP hand back a PNG; JPEG is smaller then.
  const webp = await encode('image/webp')

  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await encode('image/jpeg')

  if (jpeg) return jpeg
  throw new Error(t('settings.profile.tryAgain'))
}

function PhotoCropDialog({
  source,
  onClose,
  onSaved,
}: {
  source: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const imageRef = useRef<HTMLImageElement>(null)

  const [natural, setNatural] = useState<{
    width: number
    height: number
  } | null>(null)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)

  const move = (next: Offset) => {
    if (natural) setOffset(clampOffset(next, natural, zoom))
  }

  const scale = natural ? coverScale(natural.width, natural.height) * zoom : 1
  const width = natural ? natural.width * scale : STAGE_PX
  const height = natural ? natural.height * scale : STAGE_PX

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(400px,calc(100vw-32px))]">
        <DialogHeader
          title={t('settings.profile.photo.cropTitle')}
          description={t('settings.profile.photo.cropDescription')}
        />
        <DialogBody className="items-center gap-4">
          <div
            role="group"
            tabIndex={0}
            aria-label={t('settings.profile.photo.cropArea')}
            className="relative shrink-0 cursor-grab touch-none select-none overflow-hidden rounded-md bg-surface-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:cursor-grabbing"
            style={{ width: STAGE_PX, height: STAGE_PX }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                pointer: event.pointerId,
                x: event.clientX - offset.x,
                y: event.clientY - offset.y,
              }
            }}
            onPointerMove={(event) => {
              const start = drag.current

              if (!start || start.pointer !== event.pointerId) return
              move({ x: event.clientX - start.x, y: event.clientY - start.y })
            }}
            onPointerUp={() => {
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 20 : 5

              const moves = new Map([
                ['ArrowLeft', { x: offset.x - step, y: offset.y }],
                ['ArrowRight', { x: offset.x + step, y: offset.y }],
                ['ArrowUp', { x: offset.x, y: offset.y - step }],
                ['ArrowDown', { x: offset.x, y: offset.y + step }],
              ])

              const next = moves.get(event.key)

              if (!next) return
              event.preventDefault()
              move(next)
            }}
          >
            <img
              ref={imageRef}
              src={source}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width,
                height,
                left: (STAGE_PX - width) / 2 + offset.x,
                top: (STAGE_PX - height) / 2 + offset.y,
                visibility: natural ? 'visible' : 'hidden',
              }}
              onLoad={(event) => {
                const image = event.currentTarget
                setNatural({
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                })
              }}
              onError={() => {
                toast(t('settings.profile.photo.unreadableToast'), {
                  description: t(
                    'settings.profile.photo.unreadableDescription',
                  ),
                })
                onClose()
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-1 ring-white/70"
            />
          </div>
          <label className="flex w-full max-w-[280px] items-center gap-2.5 text-fg-muted">
            <Icon name="minus" size={14} />
            <input
              type="range"
              aria-label={t('settings.profile.photo.zoom')}
              className="min-w-0 flex-1 accent-[var(--primary)]"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!natural}
              onChange={(event) => {
                const next = Number(event.target.value)
                setZoom(next)

                if (natural) setOffset(clampOffset(offset, natural, next))
              }}
            />
            <Icon name="plus" size={14} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!natural || saving}
            onClick={async () => {
              const image = imageRef.current

              if (!image) return
              setSaving(true)

              try {
                await uploadMyPhoto(await renderCrop(image, zoom, offset))
                await onSaved()
              } catch (failure) {
                toast.error(t('settings.profile.photo.couldSaveToast'), {
                  description:
                    failure instanceof Error
                      ? failure.message
                      : t('settings.profile.tryAgain'),
                })
              } finally {
                setSaving(false)
              }
            }}
          >
            {t('settings.profile.photo.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
