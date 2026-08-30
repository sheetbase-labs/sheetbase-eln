import * as React from 'react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { cva  } from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority';
import { cn } from '#/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const sheetVariants = cva('fixed z-50 gap-4 bg-background p-6 shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out', { variants: { side: { top:'inset-x-0 top-0 border-b', bottom:'inset-x-0 bottom-0 border-t', left:'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm', right:'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm' } }, defaultVariants:{side:'right'} })
function SheetContent({ side='right', className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & VariantProps<typeof sheetVariants>) { return <SheetPrimitive.Portal><SheetPrimitive.Overlay className='fixed inset-0 z-50 bg-black/35'/><SheetPrimitive.Content className={cn(sheetVariants({side}), className)} {...props}>{children}<SheetPrimitive.Close className='absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100'><X className='size-4'/></SheetPrimitive.Close></SheetPrimitive.Content></SheetPrimitive.Portal> }
function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('flex flex-col space-y-2 text-left', className)} {...props}/> }
function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props}/> }
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) { return <SheetPrimitive.Title className={cn('text-base font-semibold', className)} {...props}/> }
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) { return <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props}/> }
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
