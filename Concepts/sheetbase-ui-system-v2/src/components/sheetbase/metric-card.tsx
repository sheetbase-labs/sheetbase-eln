import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { cn } from '#/lib/utils'

export function MetricCard({ label, value, change, trend='up', icon:Icon, className }: { label:string; value:string; change:string; trend?:'up'|'down'|'neutral'; icon:LucideIcon; className?:string }) { const Trend=trend==='down'?TrendingDown:TrendingUp; return <Card className={cn('min-w-0',className)}><CardContent className='p-4'><div className='flex items-center justify-between'><p className='text-xs font-medium text-muted-foreground'>{label}</p><div className='flex size-8 items-center justify-center rounded-md bg-primary/7 text-primary'><Icon className='size-4'/></div></div><p className='mt-3 font-display text-2xl font-semibold tabular-nums'>{value}</p><div className={cn('mt-1 flex items-center gap-1 text-xs',trend==='neutral'?'text-muted-foreground':trend==='down'?'text-amber-600':'text-emerald-600')}><Trend className='size-3'/>{change}</div></CardContent></Card> }
