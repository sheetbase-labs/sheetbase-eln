import { createFileRoute } from '@tanstack/react-router'
import { CalendarClock, Database, FileText, FlaskConical, TestTube2, UsersRound } from 'lucide-react'
import { PageHeader, Preview, ShowcaseSection } from '#/components/showcase'
import { AuditTrail } from '#/components/sheetbase/audit-trail'
import { ApprovalStepper } from '#/components/sheetbase/approval-stepper'
import { ChartFrame } from '#/components/sheetbase/chart-frame'
import { SampleDataTable } from '#/components/sheetbase/data-table'
import { MetricCard } from '#/components/sheetbase/metric-card'
import { NotebookBlock } from '#/components/sheetbase/notebook-block'
import { PlateMap } from '#/components/sheetbase/plate-map'
import { Property, PropertyList } from '#/components/sheetbase/property-list'
import { RecordLink } from '#/components/sheetbase/record-link'
import { SampleChart } from '#/components/sheetbase/sample-chart'
import { StatusBadge } from '#/components/sheetbase/status-badge'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'

export const Route = createFileRoute('/scientific')({ component: ScientificPage })

function ScientificPage(){return <div>
  <PageHeader eyebrow='Scientific components' title='Domain components for an ELN' description='These components carry scientific meaning and should be reused consistently. They are composed from the general UI primitives rather than implemented as isolated screen code.'/>

  <ShowcaseSection id='status' title='Scientific status and metadata'>
    <div className='grid gap-4 lg:grid-cols-2'>
      <Preview title='Record status'><div className='flex flex-wrap gap-2'>{(['draft','planned','in progress','review','approved','locked','failed','archived'] as const).map(status=><StatusBadge key={status} status={status}/>)}</div></Preview>
      <Preview title='Property list'><PropertyList><Property label='Record ID'><span className='font-mono'>EXP-2025-0014</span></Property><Property label='Status'><StatusBadge status='in progress'/></Property><Property label='Project'>Lentivector Stability Study</Property><Property label='Owner'>Gareth Price</Property><Property label='Created'>14 Jul 2025, 09:12</Property><Property label='Tags'><span className='flex gap-1'><Badge variant='violet'>Stability</Badge><Badge variant='info'>qPCR</Badge></span></Property></PropertyList></Preview>
    </div>
  </ShowcaseSection>

  <ShowcaseSection id='metrics' title='Operational metrics'>
    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'><MetricCard label='Active experiments' value='12' change='+3 this week' icon={FlaskConical}/><MetricCard label='Linked samples' value='1,248' change='+32 this week' icon={TestTube2}/><MetricCard label='Pending reviews' value='7' change='2 overdue' trend='down' icon={CalendarClock}/><MetricCard label='Project members' value='18' change='No change' trend='neutral' icon={UsersRound}/></div>
  </ShowcaseSection>

  <ShowcaseSection id='records' title='Record relationships'>
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'><RecordLink icon={FlaskConical} type='Experiment' title='Virus Stability at 4 °C' meta='EXP-2025-0014 · In progress'/><RecordLink icon={TestTube2} type='Sample' title='LVV-250601' meta='SMP-LV-0001 · In stock'/><RecordLink icon={Database} type='Dataset' title='Stability raw data' meta='2,431 rows · Updated 2h ago'/><RecordLink icon={FileText} type='Protocol' title='Lentivirus Titration Assay' meta='v2.1 · Approved'/></div>
  </ShowcaseSection>

  <ShowcaseSection id='blocks' title='Notebook blocks' description='The notebook is a vertical document. Blocks may contain prose, lists, linked records, tables, charts and scientific visualisations.'>
    <div className='mx-auto max-w-4xl space-y-3 rounded-xl bg-muted/25 p-5'>
      <NotebookBlock title='Objective' label='H2'><p className='text-sm leading-6'>Evaluate the stability of concentrated lentiviral vector when stored at 4 °C over 28 days.</p></NotebookBlock>
      <NotebookBlock title='Materials' label='H2'><ul className='list-disc space-y-1 pl-5 text-sm'><li>LVV-CAR-T, lot LVV-250601</li><li>DPBS, sterile filtered</li><li>qPCR kit, TaqMan</li></ul></NotebookBlock>
      <NotebookBlock title='Experimental design' label='Table'><Table><TableHeader><TableRow><TableHead>Timepoint</TableHead><TableHead>Replicate</TableHead><TableHead>Volume</TableHead><TableHead>Condition</TableHead></TableRow></TableHeader><TableBody>{[[0,1,100,'4 °C'],[7,2,100,'4 °C'],[14,2,100,'4 °C'],[28,2,100,'4 °C']].map((row)=><TableRow key={row[0]}>{row.map((cell)=><TableCell key={String(cell)}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></NotebookBlock>
      <NotebookBlock title='Next steps' label='Checklist'><div className='space-y-2'>{['Run transduction assay','Review 28-day stability results','Prepare study report'].map(item=><label key={item} className='flex items-center gap-2 text-sm'><Checkbox/>{item}</label>)}</div></NotebookBlock>
      <div className='flex justify-center'><Button variant='outline'>+ Add block</Button></div>
    </div>
  </ShowcaseSection>

  <ShowcaseSection id='data' title='Scientific data and visualisation'>
    <div className='space-y-4'><Preview title='Data table' description='TanStack Table underneath; Sheetbase controls columns, density and scientific cell formatting.'><SampleDataTable/></Preview><div className='grid gap-4 xl:grid-cols-[1.2fr_.8fr]'><ChartFrame title='Vector genome copies over time' subtitle='Mean ± SD · Log Y'><SampleChart/></ChartFrame><Preview title='96-well plate map'><PlateMap selected={18}/><div className='mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground'><span className='flex items-center gap-1.5'><i className='size-2 rounded-full bg-blue-400'/>Sample</span><span className='flex items-center gap-1.5'><i className='size-2 rounded-full bg-indigo-300'/>Control</span><span className='flex items-center gap-1.5'><i className='size-2 rounded-full bg-slate-200'/>Blank</span></div></Preview></div></div>
  </ShowcaseSection>

  <ShowcaseSection id='compliance' title='Review, approval and audit'>
    <div className='grid gap-4 lg:grid-cols-2'><Preview title='Approval workflow'><ApprovalStepper/></Preview><Preview title='Audit trail'><AuditTrail/></Preview></div>
  </ShowcaseSection>
</div>}
