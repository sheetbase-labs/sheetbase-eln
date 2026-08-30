import { createFileRoute } from '@tanstack/react-router'
import { Activity, Box, Check, FlaskConical, Folder, Search, ShieldCheck, Table2, UserRound } from 'lucide-react'
import { PageHeader, Preview, ShowcaseSection, TokenSwatch } from '#/components/showcase'
import { Badge } from '#/components/ui/badge'

export const Route = createFileRoute('/foundations')({ component: FoundationsPage })

const colours = [
  ['Primary','oklch(0.55 0.19 255)','oklch(0.55 0.19 255)'],
  ['Foreground','oklch(0.18 0.02 260)','oklch(0.18 0.02 260)'],
  ['Muted','oklch(0.97 0.006 260)','oklch(0.97 0.006 260)'],
  ['Border','oklch(0.91 0.01 260)','oklch(0.91 0.01 260)'],
  ['Success','oklch(0.61 0.16 155)','oklch(0.61 0.16 155)'],
  ['Warning','oklch(0.74 0.16 75)','oklch(0.74 0.16 75)'],
  ['Danger','oklch(0.61 0.22 27)','oklch(0.61 0.22 27)'],
  ['Violet','oklch(0.58 0.2 300)','oklch(0.58 0.2 300)'],
]

function FoundationsPage(){return <div>
  <PageHeader eyebrow='Foundations' title='Visual rules and semantic tokens' description='A restrained, information-dense system for scientific software. Instrument Sans is used for interface headings; Inter is used for body copy, data and controls.'/>
  <ShowcaseSection id='colour' title='Colour' description='Product code should use semantic variables such as primary, border and muted—not literal palette values.'>
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>{colours.map(([name,value,colour])=><TokenSwatch key={name} name={name} value={value} colour={colour}/>)}</div>
    <div className='mt-5 flex flex-wrap gap-2'><Badge variant='success'>In progress</Badge><Badge variant='warning'>Needs review</Badge><Badge variant='danger'>Failed</Badge><Badge variant='violet'>Protocol</Badge><Badge variant='info'>Experiment</Badge><Badge variant='outline'>Archived</Badge></div>
  </ShowcaseSection>
  <ShowcaseSection id='type' title='Typography' description='Clear hierarchy without oversized marketing typography.'>
    <div className='grid gap-4 lg:grid-cols-2'>
      <Preview title='Interface hierarchy'><div className='space-y-5'><div><p className='text-xs text-muted-foreground'>Page title · 24/32 semibold</p><p className='font-display text-2xl font-semibold'>Virus Stability at 4 °C</p></div><div><p className='text-xs text-muted-foreground'>Section title · 18/26 semibold</p><p className='font-display text-lg font-semibold'>Experimental design</p></div><div><p className='text-xs text-muted-foreground'>Component title · 14/20 semibold</p><p className='text-sm font-semibold'>Linked samples</p></div><div><p className='text-xs text-muted-foreground'>Body · 14/22 regular</p><p className='max-w-lg text-sm leading-[1.55]'>Evaluate the stability of concentrated lentiviral vector when stored at 4 °C over 28 days.</p></div></div></Preview>
      <Preview title='Data typography'><div className='space-y-4'><div className='grid grid-cols-[8rem_1fr] gap-4'><span className='text-xs text-muted-foreground'>Tabular data</span><span className='font-mono text-sm tabular-nums'>3.20E+08 TU/mL</span></div><div className='grid grid-cols-[8rem_1fr] gap-4'><span className='text-xs text-muted-foreground'>Identifier</span><span className='font-mono text-xs'>EXP-2025-0014</span></div><div className='grid grid-cols-[8rem_1fr] gap-4'><span className='text-xs text-muted-foreground'>Caption</span><span className='text-xs text-muted-foreground'>Updated 2 hours ago by Gareth Price</span></div></div></Preview>
    </div>
  </ShowcaseSection>
  <ShowcaseSection id='spacing' title='Spacing, radius and elevation'>
    <div className='grid gap-4 lg:grid-cols-3'>
      <Preview title='8-point spacing'><div className='flex items-end gap-3'>{[4,8,12,16,24,32,48,64].map(v=><div key={v} className='flex flex-col items-center gap-2'><div className='rounded-sm bg-primary/20' style={{width:v,height:v}}/><span className='text-[10px] text-muted-foreground'>{v}</span></div>)}</div></Preview>
      <Preview title='Radius'><div className='flex items-end gap-4'>{[4,6,8,12,16].map(v=><div key={v} className='flex flex-col items-center gap-2'><div className='size-14 border bg-muted/50' style={{borderRadius:v}}/><span className='text-[10px] text-muted-foreground'>{v}px</span></div>)}</div></Preview>
      <Preview title='Elevation'><div className='grid grid-cols-3 gap-3'>{['border','shadow-xs','shadow-md'].map(v=><div key={v} className={`flex h-20 items-end rounded-lg border bg-card p-2 ${v==='border'?'':v}`}><span className='text-[10px] text-muted-foreground'>{v}</span></div>)}</div></Preview>
    </div>
  </ShowcaseSection>
  <ShowcaseSection id='icons' title='Iconography' description='Lucide icons at 1.5–2px stroke, normally 16px within controls.'>
    <div className='grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9'>{[FlaskConical,Folder,Table2,Activity,ShieldCheck,UserRound,Search,Box,Check].map((Icon,i)=><div key={i} className='flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border bg-card'><Icon className='size-5'/><span className='text-[10px] text-muted-foreground'>16–20px</span></div>)}</div>
  </ShowcaseSection>
</div>}
