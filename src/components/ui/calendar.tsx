import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { DayPicker } from 'react-day-picker'

import { buttonVariants } from '#/components/v3/ui/button'
import { cn } from '#/lib/utils'

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'space-y-4',
        month_caption: 'relative flex items-center justify-center pt-1',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'secondary', size: 'icon' }),
          'absolute left-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'secondary', size: 'icon' }),
          'absolute right-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday:
          'w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground',
        week: 'mt-2 flex w-full',
        day: 'relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20',
        day_button: cn(
          buttonVariants({ variant: 'quiet', size: 'icon' }),
          'size-9 p-0 font-normal aria-selected:opacity-100',
        ),
        range_end: 'day-range-end',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside:
          'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        disabled: 'text-muted-foreground opacity-50',
        range_middle:
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') return <ChevronLeft className="size-4" />
          if (orientation === 'right')
            return <ChevronRight className="size-4" />
          if (orientation === 'up') return <ChevronUp className="size-4" />
          return <ChevronDown className="size-4" />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
