import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '#/lib/utils'

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) { return <SliderPrimitive.Root className={cn('relative flex w-full touch-none select-none items-center', className)} {...props}><SliderPrimitive.Track className='relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary'><SliderPrimitive.Range className='absolute h-full bg-primary' /></SliderPrimitive.Track>{Array.from({ length: props.value?.length ?? props.defaultValue?.length ?? 1 }).map((_, i) => <SliderPrimitive.Thumb key={i} className='block size-4 rounded-full border border-primary/20 bg-background shadow-sm outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50' />)}</SliderPrimitive.Root> }
export { Slider }
