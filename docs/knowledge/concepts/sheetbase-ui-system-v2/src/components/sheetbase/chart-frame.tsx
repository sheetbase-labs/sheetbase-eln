import * as React from 'react'
import { Download, Expand, MoreHorizontal } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'

export function ChartFrame({ title, subtitle, children, legend }: { title:string; subtitle?:string; children:React.ReactNode; legend?:React.ReactNode }) { return <div className='rounded-lg border bg-card shadow-xs'><div className='flex items-start justify-between gap-3 border-b px-4 py-3'><div><div className='flex items-center gap-2'><h3 className='text-sm font-semibold'>{title}</h3><Badge variant='outline'>Live</Badge></div>{subtitle&&<p className='mt-0.5 text-xs text-muted-foreground'>{subtitle}</p>}</div><div className='flex items-center'><Button variant='ghost' size='icon-sm'><Download/></Button><Button variant='ghost' size='icon-sm'><Expand/></Button><Button variant='ghost' size='icon-sm'><MoreHorizontal/></Button></div></div><div className='p-4'>{children}</div>{legend&&<div className='border-t px-4 py-3'>{legend}</div>}</div> }
