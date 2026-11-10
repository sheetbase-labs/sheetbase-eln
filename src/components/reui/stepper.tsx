/**
 * ReUI `stepper`, installed from the pinned Base UI registry (ADR-0055):
 *
 *   pnpm dlx shadcn@latest add @reui/stepper     # in a scratch directory
 *   @reui -> https://reui.io/r/base-nova/{name}.json
 *
 * Copy-and-own source, placed by hand at `src/components/reui/stepper.tsx` (the
 * item's own `files[].target` names the same path; a plain install here would
 * still resolve its bare `cn` dependency into the repository). The `cn` import
 * is re-pointed from the `cn` package to `#/lib/utils` (the helper that teaches
 * tailwind-merge the Sheetbase type scale), and the classes are restyled from
 * the item's own palette names onto the app-3 token vocabulary in
 * `src/styles.css` (`bg-surface`, `text-fg-muted`, `bg-accent-strong`,
 * `text-on-accent`, `bg-border-strong`, `outline-focus`, `text-label`). The
 * semantics it renders — `<nav>`, `<div>` items, a `role="tablist"` trigger set
 * — are the item's, and they are what the comparison in
 * `docs/knowledge/design/component-comparison-record.md` measures.
 *
 * Local patches after ADR-0057 (this file is first-party-maintained source; a
 * registry re-sync merges these rather than taking the item over them):
 * - Each trigger registers through a stable callback ref keyed by its step.
 *   The registry form registered from an effect whose dependency was
 *   `ref.current`, so the effect could not re-run when the rendered element
 *   changed: the stepper kept a detached node, and the arrow keys stopped
 *   moving between steps. Registration is now also removed when a trigger
 *   unmounts, which the registry form never did.
 * - The trigger's key handling is a module-level function, so the component is
 *   a render function rather than a switch with a closure over six values.
 * - Both context values are memoised, and the `indicators` default is one
 *   module constant, so a step change is the only thing that re-renders the
 *   steps. The item context previously rebuilt its object every render.
 * - `stepsCount` counts children whose type is `StepperItem`; the registry form
 *   read a `displayName` this file never sets, so it always counted zero.
 * - `tabIndex` falls back with `??`, and the indicator picks its node once
 *   instead of evaluating the same four-way `||` chain twice.
 */
import type { HTMLAttributes, KeyboardEvent, ReactElement } from 'react'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

// Import-path fix (ADR-0055 decision 2): the registry item imports `cn` from
// the `cn` package; this repository's helper teaches tailwind-merge the
// Sheetbase type scale, so the class merge has to be ours.
import { cn } from '#/lib/utils'

// Types
type StepperOrientation = 'horizontal' | 'vertical'

type StepState = 'active' | 'completed' | 'inactive' | 'loading'

type StepIndicators = {
  active?: React.ReactNode
  completed?: React.ReactNode
  inactive?: React.ReactNode
  loading?: React.ReactNode
}

/** One shared empty set, so an unset `indicators` does not change identity. */
const NO_INDICATORS: StepIndicators = {}

/** The handlers that move focus between the registered steps. */
type StepperFocusActions = {
  focusNext: (currentIdx: number) => void
  focusPrev: (currentIdx: number) => void
  focusFirst: () => void
  focusLast: () => void
}

interface StepperContextValue extends StepperFocusActions {
  activeStep: number
  setActiveStep: (step: number) => void
  stepsCount: number
  orientation: StepperOrientation
  registerTrigger: (step: number, node: HTMLButtonElement | null) => void
  /** Registered triggers in document order. */
  triggerNodes: HTMLButtonElement[]
  /** The steps those triggers belong to, in the same order. */
  triggerSteps: number[]
  indicators: StepIndicators
}

/** Registered triggers, keyed by step; replaced on every change, never mutated. */
type TriggerMap = ReadonlyMap<number, HTMLButtonElement>

interface StepItemContextValue {
  step: number
  state: StepState
  isDisabled: boolean
  isLoading: boolean
}

const StepperContext = createContext<StepperContextValue | undefined>(undefined)

const StepItemContext = createContext<StepItemContextValue | undefined>(
  undefined,
)

function useStepper() {
  const ctx = useContext(StepperContext)

  if (!ctx) throw new Error('useStepper must be used within a Stepper')

  return ctx
}

function useStepItem() {
  const ctx = useContext(StepItemContext)

  if (!ctx) throw new Error('useStepItem must be used within a StepperItem')

  return ctx
}

/** A child that is this item and nothing else, for counting a stepper's steps. */
function isStepperItem(child: React.ReactNode): child is ReactElement {
  return isValidElement(child) && child.type === StepperItem
}

/**
 * The roving tab stop's key handling: the arrow keys move to a sibling step,
 * Home and End to the ends, and Enter or Space selects this one. Module-level,
 * so the trigger stays a render function rather than a switch over six values.
 */
function handleTriggerKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  focus: StepperFocusActions,
  select: () => void,
): void {
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      event.preventDefault()

      if (index !== -1) focus.focusNext(index)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()

      if (index !== -1) focus.focusPrev(index)
      break
    case 'Home':
      event.preventDefault()
      focus.focusFirst()
      break
    case 'End':
      event.preventDefault()
      focus.focusLast()
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      select()
      break
  }
}

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: StepperOrientation
  indicators?: StepIndicators
}

function Stepper({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
  indicators = NO_INDICATORS,
  ...props
}: StepperProps) {
  const [activeStep, setActiveStep] = useState(defaultValue)

  const [triggers, setTriggers] = useState<TriggerMap>(() => new Map())

  /**
   * Register or release one step's trigger. Stable, so a trigger can use it as
   * the identity of its own callback ref: the ref then runs again exactly when
   * the element it is attached to is replaced or removed.
   */
  const registerTrigger = useCallback(
    (step: number, node: HTMLButtonElement | null) => {
      setTriggers((prev) => {
        const current = prev.get(step)

        if (node === null) {
          if (current === undefined) return prev

          const next = new Map(prev)
          next.delete(step)

          return next
        }

        if (current === node) return prev

        const next = new Map(prev)
        next.set(step, node)

        return next
      })
    },
    [],
  )

  // Document order, not registration order: a step added above another must not
  // put the arrow keys out of order.
  const orderedTriggers = useMemo(
    () => [...triggers.entries()].sort(([left], [right]) => left - right),
    [triggers],
  )

  const triggerNodes = useMemo(
    () => orderedTriggers.map(([, node]) => node),
    [orderedTriggers],
  )

  const triggerSteps = useMemo(
    () => orderedTriggers.map(([step]) => step),
    [orderedTriggers],
  )

  const handleSetActiveStep = useCallback(
    (step: number) => {
      if (value === undefined) {
        setActiveStep(step)
      }

      onValueChange?.(step)
    },
    [value, onValueChange],
  )

  const currentStep = value ?? activeStep

  // Keyboard navigation logic
  const focusTrigger = useCallback(
    (idx: number) => {
      triggerNodes[idx]?.focus()
    },
    [triggerNodes],
  )

  const focusNext = useCallback(
    (currentIdx: number) =>
      focusTrigger((currentIdx + 1) % triggerNodes.length),
    [focusTrigger, triggerNodes.length],
  )

  const focusPrev = useCallback(
    (currentIdx: number) =>
      focusTrigger(
        (currentIdx - 1 + triggerNodes.length) % triggerNodes.length,
      ),
    [focusTrigger, triggerNodes.length],
  )

  const focusFirst = useCallback(() => focusTrigger(0), [focusTrigger])

  const focusLast = useCallback(
    () => focusTrigger(triggerNodes.length - 1),
    [focusTrigger, triggerNodes.length],
  )

  const focusActions = useMemo<StepperFocusActions>(
    () => ({ focusNext, focusPrev, focusFirst, focusLast }),
    [focusNext, focusPrev, focusFirst, focusLast],
  )

  // Context value
  const contextValue = useMemo<StepperContextValue>(
    () => ({
      activeStep: currentStep,
      setActiveStep: handleSetActiveStep,
      stepsCount: Children.toArray(children).filter(isStepperItem).length,
      orientation,
      registerTrigger,
      triggerNodes,
      triggerSteps,
      ...focusActions,
      indicators,
    }),
    [
      currentStep,
      handleSetActiveStep,
      children,
      orientation,
      registerTrigger,
      triggerNodes,
      triggerSteps,
      focusActions,
      indicators,
    ],
  )

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={orientation}
        data-slot="stepper"
        className={cn('w-full', className)}
        data-orientation={orientation}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  )
}

interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number
  completed?: boolean
  disabled?: boolean
  loading?: boolean
}

function StepperItem({
  step,
  completed = false,
  disabled = false,
  loading = false,
  className,
  children,
  ...props
}: StepperItemProps) {
  const { activeStep } = useStepper()

  const state: StepState =
    completed || step < activeStep
      ? 'completed'
      : activeStep === step
        ? 'active'
        : 'inactive'

  const isLoading = loading && step === activeStep

  const itemContext = useMemo<StepItemContextValue>(
    () => ({ step, state, isDisabled: disabled, isLoading }),
    [step, state, disabled, isLoading],
  )

  return (
    <StepItemContext.Provider value={itemContext}>
      <div
        data-slot="stepper-item"
        className={cn(
          'group/step flex items-center justify-center not-last:flex-1 group-data-[orientation=horizontal]/stepper-nav:flex-row group-data-[orientation=vertical]/stepper-nav:flex-col',
          className,
        )}
        data-state={state}
        {...(isLoading ? { 'data-loading': true } : {})}
        {...props}
      >
        {children}
      </div>
    </StepItemContext.Provider>
  )
}

type StepperTriggerProps = useRender.ComponentProps<'button'>

function StepperTrigger({
  className,
  children,
  tabIndex,
  render,
  ...props
}: StepperTriggerProps) {
  const { state, isLoading, step, isDisabled } = useStepItem()
  const stepperCtx = useStepper()

  const { setActiveStep, activeStep, registerTrigger, triggerSteps } =
    stepperCtx

  const isSelected = activeStep === step
  const id = `stepper-tab-${step}`
  const panelId = `stepper-panel-${step}`

  // Stable for this step, so React calls it exactly when the element it is
  // attached to is mounted, replaced or removed.
  const triggerRef = useCallback(
    (element: HTMLButtonElement | null) => registerTrigger(step, element),
    [registerTrigger, step],
  )

  // Find our index among triggers for navigation
  const myIdx = triggerSteps.indexOf(step)

  const select = useCallback(() => setActiveStep(step), [setActiveStep, step])

  const defaultProps = {
    role: 'tab',
    id,
    'aria-selected': isSelected,
    'aria-controls': panelId,
    tabIndex: tabIndex ?? (isSelected ? 0 : -1),
    'data-slot': 'stepper-trigger',
    'data-state': state,
    'data-loading': isLoading,
    className: cn(
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus inline-flex cursor-pointer items-center outline-none focus-visible:z-10 disabled:pointer-events-none disabled:opacity-60',
      'gap-2.5 rounded-full',
      className,
    ),
    onClick: select,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
      handleTriggerKeyDown(event, myIdx, stepperCtx, select),
    disabled: isDisabled,
    children,
  }

  return useRender({
    defaultTagName: 'button',
    render,
    ref: triggerRef,
    props: mergeProps<'button'>(defaultProps, props),
  })
}

function StepperIndicator({
  children,
  className,
}: React.ComponentProps<'div'>) {
  const { state, isLoading } = useStepItem()
  const { indicators } = useStepper()

  const indicator =
    (isLoading && indicators.loading) ||
    (state === 'completed' && indicators.completed) ||
    (state === 'active' && indicators.active) ||
    (state === 'inactive' && indicators.inactive)

  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      className={cn(
        'border-border-strong bg-surface text-fg-muted data-[state=completed]:border-fg-muted data-[state=completed]:bg-fg-muted data-[state=completed]:text-surface data-[state=active]:border-accent-strong data-[state=active]:bg-accent-strong data-[state=active]:text-on-accent relative flex size-6 shrink-0 items-center justify-center overflow-hidden',
        'rounded-full text-xs',
        className,
      )}
    >
      <div className="absolute">{indicator || children}</div>
    </div>
  )
}

function StepperSeparator({ className }: React.ComponentProps<'div'>) {
  const { state } = useStepItem()

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        'bg-border-strong m-0.5 rounded-sm group-data-[orientation=horizontal]/stepper-nav:h-0.5 group-data-[orientation=horizontal]/stepper-nav:flex-1 group-data-[orientation=vertical]/stepper-nav:h-12 group-data-[orientation=vertical]/stepper-nav:w-0.5',
        className,
      )}
    />
  )
}

function StepperTitle({ children, className }: React.ComponentProps<'h3'>) {
  const { state } = useStepItem()

  return (
    <h3
      data-slot="stepper-title"
      data-state={state}
      className={cn('text-label leading-none font-medium', className)}
    >
      {children}
    </h3>
  )
}

function StepperDescription({
  children,
  className,
}: React.ComponentProps<'div'>) {
  const { state } = useStepItem()

  return (
    <div
      data-slot="stepper-description"
      data-state={state}
      className={cn('text-fg-muted text-label', className)}
    >
      {children}
    </div>
  )
}

function StepperNav({ children, className }: React.ComponentProps<'nav'>) {
  const { activeStep, orientation } = useStepper()

  return (
    <nav
      data-slot="stepper-nav"
      data-state={activeStep}
      data-orientation={orientation}
      className={cn(
        'group/stepper-nav inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
        className,
      )}
    >
      {children}
    </nav>
  )
}

function StepperPanel({ children, className }: React.ComponentProps<'div'>) {
  const { activeStep } = useStepper()

  return (
    <div
      data-slot="stepper-panel"
      data-state={activeStep}
      className={cn('w-full', className)}
    >
      {children}
    </div>
  )
}

interface StepperContentProps extends React.ComponentProps<'div'> {
  value: number
  forceMount?: boolean
}

function StepperContent({
  value,
  forceMount,
  children,
  className,
}: StepperContentProps) {
  const { activeStep } = useStepper()
  const isActive = value === activeStep

  if (!forceMount && !isActive) {
    return null
  }

  return (
    <div
      data-slot="stepper-content"
      data-state={activeStep}
      className={cn('w-full', className, !isActive && forceMount && 'hidden')}
      hidden={!isActive && forceMount}
    >
      {children}
    </div>
  )
}

export {
  useStepper,
  useStepItem,
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperDescription,
  StepperPanel,
  StepperContent,
  StepperNav,
  type StepperProps,
  type StepperItemProps,
  type StepperTriggerProps,
  type StepperContentProps,
}
