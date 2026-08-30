import * as React from 'react'
import { cn } from '#/lib/utils'

export function PropertyList({ children, className }: { children:React.ReactNode; className?:string }) { return <dl className={cn('grid gap-3 text-sm',className)}>{children}</dl> }
export function Property({ label, children }: { label:string; children:React.ReactNode }) { return <div className='grid grid-cols-[7rem_1fr] items-start gap-3'><dt className='text-xs text-muted-foreground'>{label}</dt><dd className='min-w-0 text-xs font-medium text-foreground'>{children}</dd></div> }
