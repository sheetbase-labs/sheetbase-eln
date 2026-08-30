import { createFileRoute, Link } from '@tanstack/react-router'
import { Blocks, BookOpen, Boxes, CheckCircle2, FlaskConical, Palette, Route as RouteIcon, ShieldCheck, Workflow } from 'lucide-react'
import { PageHeader, Preview } from '#/components/showcase'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'

export const Route = createFileRoute('/')({ component: OverviewPage })

const areas = [
  { to: '/foundations', title: 'Foundations', description: 'Colour, type, spacing, radii, elevation and icon rules.', icon: Palette, count: '28 tokens' },
  { to: '/components', title: 'UI components', description: 'Accessible shadcn-style primitives for general product UI.', icon: Blocks, count: '31 components' },
  { to: '/scientific', title: 'Scientific components', description: 'ELN-specific records, notebook blocks, charts and audit patterns.', icon: FlaskConical, count: '14 components' },
  { to: '/patterns', title: 'Product patterns', description: 'Forms, data grids, inspectors, states and workflows.', icon: Workflow, count: '12 patterns' },
  { to: '/templates', title: 'Page templates', description: 'Standard application shells assembled from the system.', icon: Boxes, count: '6 templates' },
] as const

function OverviewPage() {
  return <div>
    <PageHeader eyebrow='Sheetbase UI system' title='A defined foundation before we build screens' description='A TanStack Start framework using the shadcn architecture and Radix primitives. Components are owned by Sheetbase, documented in code and styled through semantic tokens.'>
      <div className='flex gap-2'><Button asChild variant='outline'><Link to='/foundations'><BookOpen/>Read foundations</Link></Button><Button asChild><Link to='/components'><Blocks/>Browse components</Link></Button></div>
    </PageHeader>

    <div className='grid gap-4 py-8 md:grid-cols-2 xl:grid-cols-3'>
      {areas.map((area)=><Link key={area.to} to={area.to} className='group no-underline'><Card className='h-full transition-colors hover:border-primary/35 hover:bg-muted/20'><CardHeader><div className='mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/7 text-primary'><area.icon className='size-4.5'/></div><CardTitle className='flex items-center justify-between'>{area.title}<RouteIcon className='size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'/></CardTitle></CardHeader><CardContent><p className='text-sm leading-6 text-muted-foreground'>{area.description}</p><Badge variant='outline' className='mt-4'>{area.count}</Badge></CardContent></Card></Link>)}
    </div>

    <div className='grid gap-5 lg:grid-cols-[1.35fr_.65fr]'>
      <Preview title='Architecture principles' description='How the system should be extended.'>
        <div className='grid gap-5 sm:grid-cols-2'>
          {[
            { icon: CheckCircle2, title: 'Own the source', text: 'Components live in the repository. They are not a dependency black box.' },
            { icon: Palette, title: 'Token-first styling', text: 'Use semantic tokens rather than isolated colour or spacing values.' },
            { icon: ShieldCheck, title: 'Accessible by default', text: 'Radix handles behaviour; Sheetbase defines appearance and composition.' },
            { icon: Workflow, title: 'Compose, do not fork', text: 'Scientific components assemble primitives instead of duplicating them.' },
          ].map((item)=><div key={item.title} className='flex gap-3'><div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-muted'><item.icon className='size-4'/></div><div><p className='text-sm font-semibold'>{item.title}</p><p className='mt-1 text-xs leading-5 text-muted-foreground'>{item.text}</p></div></div>)}
        </div>
      </Preview>
      <Preview title='Stack' description='Deliberately small and composable.'>
        <div className='space-y-3 text-sm'>
          {['TanStack Start','React 19','Tailwind CSS 4','Radix UI','shadcn architecture','TanStack Table','Recharts'].map((item,i)=><div key={item}><div className='flex items-center justify-between'><span>{item}</span><Badge variant={i<5?'success':'outline'}>{i<5?'core':'optional'}</Badge></div>{i<6&&<Separator className='mt-3'/>}</div>)}
        </div>
      </Preview>
    </div>
  </div>
}
