import * as React from 'react'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

export function NotebookBlock({ title, label='H2', children, actions, className }: { title:string; label?:string; children:React.ReactNode; actions?:React.ReactNode; className?:string }) { return <div className={cn('group relative rounded-lg border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm',className)}><div className='absolute -left-7 top-4 hidden items-center text-muted-foreground lg:flex'><GripVertical className='size-4 opacity-0 transition-opacity group-hover:opacity-100'/></div><div className='mb-3 flex items-center gap-2'><span className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>{label}</span><h3 className='font-display text-sm font-semibold'>{title}</h3><div className='ml-auto flex items-center gap-1'>{actions}<Button variant='ghost' size='icon-sm' className='opacity-0 group-hover:opacity-100'><MoreHorizontal/></Button></div></div>{children}</div> }
