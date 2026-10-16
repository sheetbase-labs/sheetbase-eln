/**
 * ReUI `timeline`, installed from the pinned Base UI registry (ADR-0055):
 *
 *   pnpm dlx shadcn@latest add @reui/timeline
 *   @reui -> https://reui.io/r/base-nova/{name}.json
 *
 * Copy-and-own source. Two changes, both permitted by ADR-0055 decision 2: the
 * `cn` import is re-pointed from the `cn` package to `#/lib/utils` (the helper
 * that teaches tailwind-merge the Sheetbase type scale), and the published
 * shadcn-nova classes are restyled to the app-3 token vocabulary the v3 kit
 * writes (`text-fg-muted`, `border-border`, `bg-border`, `accent-strong`) and
 * to the app's timeline geometry — a 2rem indicator well carrying an icon, with
 * the connector running through its centre. The restyle is recorded as a cost
 * of adoption in docs/knowledge/design/component-comparison-record.md. Do not
 * extend or hand-edit this file beyond import-path fixes and restyling; see
 * docs/development/component-compare.md.
 */
import { createContext, useCallback, useContext, useState } from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { cn } from '#/lib/utils'

// Types
type TimelineContextValue = {
  activeStep: number
  setActiveStep: (step: number) => void
}

// Context
const TimelineContext = createContext<TimelineContextValue | undefined>(
  undefined,
)

const useTimeline = () => {
  const context = useContext(TimelineContext)
  if (!context) {
    throw new Error('useTimeline must be used within a Timeline')
  }
  return context
}

// Components
interface TimelineProps extends useRender.ComponentProps<'div'> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
}

function Timeline({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = 'vertical',
  className,
  render,
  children,
  ...props
}: TimelineProps) {
  const [activeStep, setInternalStep] = useState(defaultValue)

  const setActiveStep = useCallback(
    (step: number) => {
      if (value === undefined) {
        setInternalStep(step)
      }
      onValueChange?.(step)
    },
    [value, onValueChange],
  )

  const currentStep = value ?? activeStep

  const defaultProps = {
    className: cn(
      'group/timeline flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
      className,
    ),
    'data-orientation': orientation,
    'data-slot': 'timeline',
    children,
  }

  return (
    <TimelineContext.Provider
      value={{ activeStep: currentStep, setActiveStep }}
    >
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props),
      })}
    </TimelineContext.Provider>
  )
}

// TimelineContent
function TimelineContent({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    className: cn('text-sm text-fg-muted', className),
    'data-slot': 'timeline-content',
    children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

// TimelineDate
type TimelineDateProps = useRender.ComponentProps<'time'>

function TimelineDate({
  className,
  render,
  children,
  ...props
}: TimelineDateProps) {
  const defaultProps = {
    className: cn(
      'mb-1 block font-medium text-xs text-fg-muted group-data-[orientation=vertical]/timeline:max-sm:h-4',
      className,
    ),
    'data-slot': 'timeline-date',
    children,
  }

  return useRender({
    defaultTagName: 'time',
    render,
    props: mergeProps<'time'>(defaultProps, props),
  })
}

// TimelineHeader
function TimelineHeader({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    className: cn(className),
    'data-slot': 'timeline-header',
    children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

// TimelineIndicator
type TimelineIndicatorProps = useRender.ComponentProps<'div'>

function TimelineIndicator({
  className,
  children,
  render,
  ...props
}: TimelineIndicatorProps) {
  const defaultProps = {
    'aria-hidden': true,
    className: cn(
      'group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 absolute flex size-8 items-center justify-center rounded-full border border-border bg-surface text-fg-muted group-data-[orientation=vertical]/timeline:-left-8 group-data-[orientation=vertical]/timeline:top-0 group-data-[orientation=horizontal]/timeline:left-0 group-data-completed/timeline-item:border-accent-strong',
      className,
    ),
    'data-slot': 'timeline-indicator',
    children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

// TimelineItem
interface TimelineItemProps extends useRender.ComponentProps<'div'> {
  step: number
}

function TimelineItem({
  step,
  className,
  render,
  children,
  ...props
}: TimelineItemProps) {
  const { activeStep } = useTimeline()

  const defaultProps = {
    className: cn(
      'group/timeline-item relative flex flex-1 flex-col gap-0.5 group-data-[orientation=vertical]/timeline:ms-8 group-data-[orientation=horizontal]/timeline:mt-8 group-data-[orientation=horizontal]/timeline:not-last:pe-8 group-data-[orientation=vertical]/timeline:not-last:pb-4 has-[+[data-completed]]:**:data-[slot=timeline-separator]:bg-accent-strong',
      className,
    ),
    'data-completed': step <= activeStep || undefined,
    'data-slot': 'timeline-item',
    children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

// TimelineSeparator
function TimelineSeparator({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    'aria-hidden': true,
    className: cn(
      'group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 absolute self-start bg-border group-last/timeline-item:hidden group-data-[orientation=horizontal]/timeline:h-0.5 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem)] group-data-[orientation=horizontal]/timeline:w-[calc(100%-1rem-0.25rem)] group-data-[orientation=vertical]/timeline:top-8 group-data-[orientation=vertical]/timeline:-left-4 group-data-[orientation=vertical]/timeline:w-px group-data-[orientation=horizontal]/timeline:translate-x-4.5 group-data-[orientation=vertical]/timeline:translate-y-0',
      className,
    ),
    'data-slot': 'timeline-separator',
    children,
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

// TimelineTitle
function TimelineTitle({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'h3'>) {
  const defaultProps = {
    className: cn('text-sm font-medium text-fg', className),
    'data-slot': 'timeline-title',
    children,
  }

  return useRender({
    defaultTagName: 'h3',
    render,
    props: mergeProps<'h3'>(defaultProps, props),
  })
}

export {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
}
