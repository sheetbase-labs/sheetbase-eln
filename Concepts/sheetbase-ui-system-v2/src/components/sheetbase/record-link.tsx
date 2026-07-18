import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '#/lib/utils'

export function RecordLink({ icon:Icon, type, title, meta, className }: { icon:LucideIcon; type:string; title:string; meta?:string; className?:string }) { return <button className={cn('group flex w-full items-center gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/50',className)}><div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/7 text-primary'><Icon className='size-4'/></div><div className='min-w-0 flex-1'><p className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>{type}</p><p className='truncate text-sm font-medium'>{title}</p>{meta && <p className='truncate text-xs text-muted-foreground'>{meta}</p>}</div><ArrowUpRight className='size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'/></button> }
