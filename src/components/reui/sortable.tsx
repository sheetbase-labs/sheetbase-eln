/**
 * ReUI `sortable`, installed from the pinned Base UI registry (ADR-0055):
 *
 *   pnpm dlx shadcn@latest add @reui/sortable
 *   @reui -> https://reui.io/r/base-nova/{name}.json
 *
 * Copy-and-own source. The changes from the registry item, and the local patches
 * after ADR-0057, which makes this file first-party-maintained source — a
 * registry re-sync merges these rather than taking the item over them:
 * - `cn` re-pointed from the `cn` package to `#/lib/utils`, the helper that
 *   teaches tailwind-merge the Sheetbase type scale (ADR-0055).
 * - The two `@dnd-kit/core` imports are one value import and one top-level type
 *   import, as the repository's import rules require.
 * - The drag overlay's active child is found through a typed `isValidElement`
 *   call and cloned from its own props, instead of asserting the child's props
 *   four times. Same child, same merge, no assertion.
 * - `style` is annotated rather than asserted, `STRATEGY_MAP` no longer carries
 *   an unreachable `??` fallback, and the item context value is memoised so a
 *   drag does not re-render every row through a fresh provider value.
 * - `SortableOverlay` tells a render-prop child from a node through one
 *   documented type guard; a public prop union of `ReactNode` and a function
 *   is only distinguishable by its runtime representation, and that guard is
 *   the one line where it is decided.
 */
import * as React from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import type {
  DragCancelEvent,
  DragEndEvent,
  DragStartEvent,
  DraggableSyntheticListeners,
  DropAnimation,
  Modifiers,
  UniqueIdentifier,
} from '@dnd-kit/core'
import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'

import { cn } from '#/lib/utils'

// Sortable Item Context
const SortableItemContext = createContext<{
  listeners: DraggableSyntheticListeners | undefined
  isDragging?: boolean
  disabled?: boolean
}>({
  listeners: undefined,
  isDragging: false,
  disabled: false,
})

const IsOverlayContext = createContext(false)

const SortableInternalContext = createContext<{
  activeId: UniqueIdentifier | null
  modifiers?: Modifiers
}>({
  activeId: null,
  modifiers: undefined,
})

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4',
      },
    },
  }),
}

/**
 * Client-mount gate for the `createPortal` calls below, which need
 * `document.body` and so must not run on the server or during hydration.
 *
 * A never-notifying subscription makes `useSyncExternalStore` return the server
 * snapshot (`false`) while rendering on the server and while hydrating, then the
 * client snapshot (`true`) once mounted - the same gate the previous
 * `useLayoutEffect(() => setMounted(true), [])` provided, minus the extra render
 * pass that `react-hooks/set-state-in-effect` flags. All three functions are
 * module-scoped so their identities stay stable; an inline `getSnapshot` is the
 * classic cause of an infinite re-subscribe loop.
 */
const subscribeToNothing = () => () => {}
const getIsMounted = () => true
const getIsMountedOnServer = () => false

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 10 } }

const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 250, tolerance: 5 },
}

const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
}

const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.Always },
}

const STRATEGY_MAP = {
  horizontal: rectSortingStrategy,
  grid: rectSortingStrategy,
  vertical: verticalListSortingStrategy,
} as const

// Multipurpose Sortable Component
export interface SortableCommitMeta<T> {
  event: DragEndEvent
  activeIndex: number
  overIndex: number
  previousValue: T[]
}

export interface SortableRootProps<T> extends Omit<
  useRender.ComponentProps<'div'>,
  'onDragStart' | 'onDragEnd' | 'children'
> {
  value: T[]
  onValueChange: (value: T[]) => void
  getItemValue: (item: T) => string
  children: ReactNode
  onMove?: (event: {
    event: DragEndEvent
    activeIndex: number
    overIndex: number
  }) => void
  onValueCommit?: (value: T[], meta: SortableCommitMeta<T>) => void
  strategy?: 'horizontal' | 'vertical' | 'grid'
  onDragStart?: (event: DragStartEvent) => void
  onDragEnd?: (event: DragEndEvent) => void
  onDragCancel?: (event: DragCancelEvent) => void
  accessibility?: React.ComponentProps<typeof DndContext>['accessibility']
  modifiers?: Modifiers
}

function Sortable<T>({
  value,
  onValueChange,
  getItemValue,
  className,
  render,
  onMove,
  onValueCommit,
  strategy = 'vertical',
  onDragStart,
  onDragEnd,
  onDragCancel,
  accessibility,
  modifiers,
  children,
  ...props
}: SortableRootProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getIsMounted,
    getIsMountedOnServer,
  )

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id)
      onDragStart?.(event)
    },
    [onDragStart],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      onDragEnd?.(event)

      if (!over) return

      // Handle item reordering
      const activeIndex = value.findIndex(
        (item: T) => getItemValue(item) === active.id,
      )

      const overIndex = value.findIndex(
        (item: T) => getItemValue(item) === over.id,
      )

      if (activeIndex === -1 || overIndex === -1) return

      if (activeIndex !== overIndex) {
        if (onMove) {
          onMove({ event, activeIndex, overIndex })
        } else {
          const newValue = arrayMove(value, activeIndex, overIndex)
          onValueChange(newValue)
          onValueCommit?.(newValue, {
            event,
            activeIndex,
            overIndex,
            previousValue: value,
          })
        }
      }
    },
    [value, getItemValue, onValueChange, onMove, onDragEnd, onValueCommit],
  )

  const handleDragCancel = useCallback(
    (event: DragCancelEvent) => {
      setActiveId(null)
      onDragCancel?.(event)
    },
    [onDragCancel],
  )

  const itemIds = useMemo(() => {
    const ids = value.map(getItemValue)

    if (process.env.NODE_ENV !== 'production') {
      const seen = new Set<string>()

      for (const id of ids) {
        if (seen.has(id)) {
          console.warn(
            `[Sortable] Duplicate item id "${id}". Item ids must be unique, or drag and drop will misbehave.`,
          )
          break
        }

        seen.add(id)
      }
    }

    return ids
  }, [value, getItemValue])

  const contextValue = useMemo(
    () => ({ activeId, modifiers }),
    [activeId, modifiers],
  )

  const defaultProps = {
    'data-slot': 'sortable',
    'data-dragging': activeId !== null,
    className: cn(activeId !== null && 'cursor-grabbing!', className),
    children,
  }

  // Find the active child for the overlay
  const overlayContent = useMemo(() => {
    if (!activeId) return null
    let result: ReactNode = null
    Children.forEach(children, (child) => {
      if (
        !isValidElement<{ value?: UniqueIdentifier; className?: string }>(child)
      ) {
        return
      }

      if (child.props.value !== activeId) return

      result = cloneElement(child, {
        ...child.props,
        className: cn(child.props.className, 'z-50'),
      })
    })

    return result
  }, [activeId, children])

  return (
    <SortableInternalContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        modifiers={modifiers}
        accessibility={accessibility}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={itemIds} strategy={STRATEGY_MAP[strategy]}>
          {useRender({
            defaultTagName: 'div',
            render,
            props: mergeProps<'div'>(defaultProps, props),
          })}
        </SortableContext>
        {mounted &&
          createPortal(
            <DragOverlay
              dropAnimation={dropAnimationConfig}
              modifiers={modifiers}
              className={cn('z-50', activeId && 'cursor-grabbing')}
            >
              <IsOverlayContext.Provider value={true}>
                {overlayContent}
              </IsOverlayContext.Provider>
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </SortableInternalContext.Provider>
  )
}

export interface SortableItemProps extends useRender.ComponentProps<'div'> {
  value: string
  disabled?: boolean
}

function SortableItem({
  value,
  className,
  render,
  disabled,
  ...props
}: SortableItemProps) {
  const isOverlay = useContext(IsOverlayContext)

  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging: isSortableDragging,
  } = useSortable({
    id: value,
    disabled: disabled || isOverlay,
    animateLayoutChanges,
  })

  const style: CSSProperties = {
    transition,
    transform: CSS.Transform.toString(transform),
  }

  const itemContext = useMemo(
    () =>
      isOverlay
        ? { listeners: undefined, isDragging: true, disabled: false }
        : { listeners, isDragging: isSortableDragging, disabled },
    [isOverlay, listeners, isSortableDragging, disabled],
  )

  const defaultProps = isOverlay
    ? {
        'data-slot': 'sortable-item',
        'data-value': value,
        'data-dragging': true,
        className: cn(className),
        children: props.children,
      }
    : {
        'data-slot': 'sortable-item',
        'data-value': value,
        'data-dragging': isSortableDragging,
        'data-disabled': disabled,
        ref: setNodeRef,
        style,
        ...attributes,
        className: cn(isSortableDragging && 'opacity-50 z-50', className),
        children: props.children,
      }

  return (
    <SortableItemContext.Provider value={itemContext}>
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props),
      })}
    </SortableItemContext.Provider>
  )
}

export interface SortableItemHandleProps extends useRender.ComponentProps<'div'> {
  cursor?: boolean
}

function SortableItemHandle({
  className,
  render,
  cursor = true,
  ...props
}: SortableItemHandleProps) {
  const { listeners, isDragging, disabled } = useContext(SortableItemContext)

  const defaultProps = {
    'data-slot': 'sortable-item-handle',
    'data-dragging': isDragging,
    'data-disabled': disabled,
    ...listeners,
    className: cn(
      cursor && (isDragging ? 'cursor-grabbing!' : 'cursor-grab!'),
      className,
    ),
    children: props.children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

export interface SortableOverlayProps extends Omit<
  React.ComponentProps<typeof DragOverlay>,
  'children'
> {
  children?: ReactNode | ((params: { value: UniqueIdentifier }) => ReactNode)
}

/** The render-prop half of `SortableOverlayProps['children']`. */
type SortableOverlayRender = (params: { value: UniqueIdentifier }) => ReactNode

/**
 * Which of the overlay's two child forms this is. `children` is a public prop
 * typed as a node or a render prop, and nothing in the type survives to
 * runtime, so the representation is the only evidence there is.
 */
function isOverlayRender(
  children: NonNullable<SortableOverlayProps['children']>,
): children is SortableOverlayRender {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `children` is a public prop union of ReactNode and a render function; a function-valued child carries no other marker, and this is the boundary where the union is decided.
  return typeof children === 'function'
}

function SortableOverlay({
  children,
  className,
  ...props
}: SortableOverlayProps) {
  const { activeId, modifiers } = useContext(SortableInternalContext)

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getIsMounted,
    getIsMountedOnServer,
  )

  const content =
    activeId && children
      ? isOverlayRender(children)
        ? children({ value: activeId })
        : children
      : null

  if (!mounted) return null

  return createPortal(
    <DragOverlay
      dropAnimation={dropAnimationConfig}
      modifiers={modifiers}
      className={cn('z-50', activeId && 'cursor-grabbing', className)}
      {...props}
    >
      <IsOverlayContext.Provider value={true}>
        {content}
      </IsOverlayContext.Provider>
    </DragOverlay>,
    document.body,
  )
}

export { Sortable, SortableItem, SortableItemHandle, SortableOverlay }
