import { useCallback, useEffect, useRef, useState } from 'react'

import { paneKind, workspaceHref } from '#/lib/workspace-state'
import type { PeekTarget } from './peek-card'

/** A link whose target is a single record: the things that can be peeked. */
export function recordAnchor(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  const href = workspaceHref(anchor.href, location.origin)
  if (!href || !paneKind(href).record) return null
  return anchor
}

/**
 * The record link that holds keyboard focus. A focused list row stands for the
 * record link inside it, so Space on a row peeks that record.
 */
export function focusedRecordAnchor(): HTMLAnchorElement | null {
  const active = document.activeElement
  if (active instanceof HTMLTableRowElement) {
    for (const anchor of active.querySelectorAll('a[href]')) {
      const found = recordAnchor(anchor)
      if (found) return found
    }
    return null
  }
  return active instanceof HTMLAnchorElement ? recordAnchor(active) : null
}

const ID_PATTERN = /^[A-Z]{2,5}-[A-Z0-9-]{2,}$/

/** True only for a mouse or trackpad: the keyboard hints make sense there. */
const canHover = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

/** Touch-and-hold time before a record link peeks. */
export const LONG_PRESS_MS = 450

export const LINK_MIME = 'application/x-sheetbase-link'

/**
 * Everything that happens to a record link before it becomes a pane: the
 * hover hint after 400 ms, the peek card, and dragging it to a pane edge or
 * the shelf. The workspace host decides what each outcome does.
 */
export function useRecordLinks(
  root: React.RefObject<HTMLElement | null>,
  onLongPress?: (anchor: HTMLAnchorElement) => void,
) {
  const longPress = useRef(onLongPress)
  longPress.current = onLongPress
  const hovered = useRef<HTMLAnchorElement | null>(null)
  const timer = useRef<number | null>(null)
  const [hint, setHint] = useState<{ left: number; top: number } | null>(null)
  const [peek, setPeek] = useState<PeekTarget | null>(null)
  const [dragging, setDragging] = useState(false)

  const clearHint = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setHint(null)
  }, [])

  useEffect(() => {
    // Dialogs portal out of the workspace, but their record links peek too.
    const inside = (node: Element | null) =>
      !!node &&
      ((!!root.current && root.current.contains(node)) ||
        !!node.closest('[data-slot="dialog-content"]'))

    const onOver = (event: MouseEvent) => {
      // Touch fires emulated mouseover after a tap; no hover, no hint.
      if (!canHover()) return
      const anchor = recordAnchor(event.target)
      if (anchor === hovered.current) return
      clearHint()
      hovered.current = anchor && inside(anchor) ? anchor : null
      const current = hovered.current
      if (!current) return
      timer.current = window.setTimeout(() => {
        const rect = current.getBoundingClientRect()
        // Above the link, so it never covers the next row you are reading;
        // below only when the link is at the very top of the window.
        const above = rect.top - 30
        setHint({
          left: Math.max(4, Math.min(rect.left, window.innerWidth - 230)),
          top: above >= 4 ? above : rect.bottom + 6,
        })
      }, 400)
    }
    const onFocus = (event: FocusEvent) => {
      const anchor = recordAnchor(event.target)
      if (anchor && inside(anchor)) hovered.current = anchor
    }
    const onBlur = (event: FocusEvent) => {
      if (event.target === hovered.current) hovered.current = null
    }
    const dismiss = () => clearHint()
    const onDragStart = (event: DragEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || !inside(anchor)) return
      const href = workspaceHref(anchor.href, location.origin)
      if (!href || !event.dataTransfer) return
      event.dataTransfer.setData(LINK_MIME, href)
      event.dataTransfer.setData(
        'text/x-sheetbase-title',
        anchor.textContent.trim(),
      )
      event.dataTransfer.effectAllowed = 'copyLink'
      clearHint()
      setDragging(true)
    }
    const onDragEnd = () => setDragging(false)

    // Touch: hold a record link to peek it. The press that opens the peek
    // must not also follow the link or raise the iOS link callout.
    let hold: number | null = null
    let origin = { x: 0, y: 0 }
    let fired = false
    const cancelHold = () => {
      if (hold !== null) window.clearTimeout(hold)
      hold = null
    }
    const onTouchDown = (event: PointerEvent) => {
      cancelHold()
      fired = false
      if (event.pointerType !== 'touch') return
      const anchor = recordAnchor(event.target)
      if (!anchor || !inside(anchor)) return
      origin = { x: event.clientX, y: event.clientY }
      hold = window.setTimeout(() => {
        hold = null
        fired = true
        longPress.current?.(anchor)
      }, LONG_PRESS_MS)
    }
    const onTouchMove = (event: PointerEvent) => {
      if (
        hold !== null &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8
      )
        cancelHold()
    }
    const swallow = (event: Event) => {
      if (!fired) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onClickAfterHold = (event: MouseEvent) => {
      swallow(event)
      fired = false
    }
    const onContextMenu = (event: Event) => {
      if (fired || (hold !== null && recordAnchor(event.target))) swallow(event)
      if (!fired && recordAnchor(event.target) && !canHover())
        event.preventDefault()
    }

    window.addEventListener('mouseover', onOver, true)
    window.addEventListener('focusin', onFocus, true)
    window.addEventListener('focusout', onBlur, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('dragend', onDragEnd, true)
    window.addEventListener('drop', onDragEnd, true)
    window.addEventListener('pointerdown', onTouchDown, true)
    window.addEventListener('pointermove', onTouchMove, true)
    window.addEventListener('pointerup', cancelHold, true)
    window.addEventListener('pointercancel', cancelHold, true)
    window.addEventListener('scroll', cancelHold, true)
    window.addEventListener('click', onClickAfterHold, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('mouseover', onOver, true)
      window.removeEventListener('focusin', onFocus, true)
      window.removeEventListener('focusout', onBlur, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('dragend', onDragEnd, true)
      window.removeEventListener('drop', onDragEnd, true)
      window.removeEventListener('pointerdown', onTouchDown, true)
      window.removeEventListener('pointermove', onTouchMove, true)
      window.removeEventListener('pointerup', cancelHold, true)
      window.removeEventListener('pointercancel', cancelHold, true)
      window.removeEventListener('scroll', cancelHold, true)
      window.removeEventListener('click', onClickAfterHold, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      cancelHold()
      clearHint()
    }
  }, [root, clearHint])

  /** Build a peek for the link under the cursor or holding focus. */
  const peekHovered = useCallback(
    (
      paneLabel: (el: Element) => string | undefined,
      held?: HTMLAnchorElement,
    ) => {
      const anchor = held ?? hovered.current ?? focusedRecordAnchor()
      if (!anchor) return false
      const href = workspaceHref(anchor.href, location.origin)
      if (!href) return false
      const text = anchor.textContent.trim()
      const identifier = ID_PATTERN.test(text) ? text : undefined
      const rect = anchor.getBoundingClientRect()
      clearHint()
      setPeek({
        href,
        title: identifier ? paneKind(href).label : text || paneKind(href).label,
        identifier,
        from: paneLabel(anchor),
        rect: { left: rect.left, top: rect.top, bottom: rect.bottom },
      })
      return true
    },
    [clearHint],
  )

  const hoveredAnchor = useCallback(() => hovered.current, [])

  return { hint, peek, setPeek, peekHovered, dragging, hoveredAnchor }
}
