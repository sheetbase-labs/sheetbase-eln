import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, ChevronRight, Database, FileQuestion, Filter, FlaskConical, Folder, MoreHorizontal, Plus, Search, Settings2, UploadCloud } from 'lucide-react'
import { PageHeader, Preview, ShowcaseSection } from '#/components/showcase'
import { SampleDataTable } from '#/components/sheetbase/data-table'
import { Property, PropertyList } from '#/components/sheetbase/property-list'
import { StatusBadge } from '#/components/sheetbase/status-badge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Empty, EmptyActions, EmptyDescription, EmptyIcon, EmptyTitle } from '#/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Separator } from '#/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'

export const Route = createFileRoute('/patterns')({ component: PatternsPage })

function PatternsPage(){return <div>
  <PageHeader eyebrow='Product patterns' title='Standard compositions for common workflows' description='Patterns define how primitives work together. Screens should use these arrangements rather than inventing new layouts for every feature.'/>

  <ShowcaseSection id='headers' title='Page and record headers'>
    <Preview title='Record header'><div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'><div><div className='flex items-center gap-2'><FlaskConical className='size-5 text-primary'/><h2 className='font-display text-xl font-semibold'>Virus Stability at 4 °C</h2><StatusBadge status='in progress'/><Badge variant='violet'>Experiment</Badge></div><div className='mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground'><span className='font-mono'>EXP-2025-0014</span><span>Gareth Price</span><span>14 Jul 2025</span><span>Updated 2h ago</span></div></div><div className='flex gap-2'><Button variant='outline'>Share</Button><Button>Actions</Button></div></div><Tabs defaultValue='overview' className='mt-5'><TabsList className='bg-transparent p-0'><TabsTrigger value='overview' className='rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none'>Overview</TabsTrigger><TabsTrigger value='results' className='rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none'>Results</TabsTrigger><TabsTrigger value='files' className='rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none'>Files</TabsTrigger></TabsList><TabsContent value='overview'/></Tabs></Preview>
  </ShowcaseSection>

  <ShowcaseSection id='filters' title='Table toolbar and filters'>
    <Preview title='Registry toolbar'><div className='mb-3 flex flex-col gap-2 lg:flex-row lg:items-center'><div className='relative flex-1 lg:max-w-xs'><Search className='absolute left-3 top-2.5 size-4 text-muted-foreground'/><Input className='pl-9' placeholder='Search samples'/></div><Button variant='outline'><Filter/>Status</Button><Button variant='outline'><Folder/>Storage</Button><Button variant='outline'><Settings2/>Fields</Button><Button variant='ghost'>Clear</Button><div className='lg:ml-auto'><Button><Plus/>Add sample</Button></div></div><SampleDataTable/></Preview>
  </ShowcaseSection>

  <ShowcaseSection id='forms' title='Create and edit forms'>
    <div className='grid gap-4 lg:grid-cols-[1fr_.8fr]'><Preview title='Create experiment'><FieldGroup><Field><FieldLabel>Title</FieldLabel><Input placeholder='Untitled experiment'/><FieldDescription>Be specific enough for future search and review.</FieldDescription></Field><div className='grid gap-4 sm:grid-cols-2'><Field><FieldLabel>Project</FieldLabel><Select defaultValue='stability'><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value='stability'>Lentivector Stability Study</SelectItem><SelectItem value='process'>Cell Therapy Process Dev</SelectItem></SelectContent></Select></Field><Field><FieldLabel>Template</FieldLabel><Select defaultValue='blank'><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value='blank'>Blank notebook</SelectItem><SelectItem value='qpcr'>qPCR assay</SelectItem></SelectContent></Select></Field></div><Field><FieldLabel>Purpose</FieldLabel><Textarea placeholder='Describe the intended experiment…'/></Field><div className='flex justify-end gap-2'><Button variant='outline'>Cancel</Button><Button>Create experiment</Button></div></FieldGroup></Preview><Preview title='Form guidance'><div className='space-y-4 text-sm'><div className='flex gap-3'><CheckCircle2 className='mt-0.5 size-4 text-emerald-600'/><p>Use one-column forms by default; split only closely related fields.</p></div><div className='flex gap-3'><CheckCircle2 className='mt-0.5 size-4 text-emerald-600'/><p>Place validation next to the affected field, not only in a page-level alert.</p></div><div className='flex gap-3'><CheckCircle2 className='mt-0.5 size-4 text-emerald-600'/><p>Keep primary actions at the end of the reading flow.</p></div><Separator/><p className='text-xs text-muted-foreground'>Long scientific records may use an inspector for secondary metadata, but creation should remain a focused dialog or page.</p></div></Preview></div>
  </ShowcaseSection>

  <ShowcaseSection id='inspector' title='Right-hand inspector'>
    <Preview title='Inspector pattern'><div className='grid min-h-[420px] overflow-hidden rounded-lg border lg:grid-cols-[1fr_330px]'><div className='bg-muted/20 p-6'><div className='h-full rounded-lg border border-dashed bg-background/70 p-8 text-center text-sm text-muted-foreground'>Primary record canvas</div></div><aside className='border-l bg-background'><div className='flex h-12 items-center border-b px-4'><p className='text-sm font-semibold'>EXP-2025-0014</p><Button variant='ghost' size='icon-sm' className='ml-auto'><MoreHorizontal/></Button></div><div className='p-4'><PropertyList><Property label='Status'><StatusBadge status='in progress'/></Property><Property label='Type'>Experiment</Property><Property label='Project'>Lentivector Stability Study</Property><Property label='Owner'>Gareth Price</Property><Property label='Created'>14 Jul 2025, 09:12</Property></PropertyList><Separator className='my-5'/><p className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Linked records</p>{[['Samples','3'],['Protocol','1'],['Dataset','1']].map(([name,count])=><button key={name} className='flex w-full items-center rounded-md px-2 py-2 text-sm hover:bg-muted'><Database className='mr-2 size-4 text-muted-foreground'/>{name}<Badge variant='secondary' className='ml-auto'>{count}</Badge><ChevronRight className='ml-2 size-3.5 text-muted-foreground'/></button>)}</div></aside></div></Preview>
  </ShowcaseSection>

  <ShowcaseSection id='states' title='Loading, empty, error and permission states'>
    <div className='grid gap-4 lg:grid-cols-2'><Preview title='Loading'><div className='space-y-3'><Skeleton className='h-8 w-1/3'/><Skeleton className='h-4 w-3/4'/><div className='grid grid-cols-3 gap-3 pt-3'><Skeleton className='h-24'/><Skeleton className='h-24'/><Skeleton className='h-24'/></div><Skeleton className='h-48'/></div></Preview><Preview title='Empty'><Empty><EmptyIcon><FileQuestion/></EmptyIcon><EmptyTitle>No experiments in this folder</EmptyTitle><EmptyDescription>Create a blank experiment or use an approved template.</EmptyDescription><EmptyActions><Button><Plus/>Create experiment</Button><Button variant='outline'>Use template</Button></EmptyActions></Empty></Preview><Preview title='Recoverable error'><Alert variant='destructive'><AlertTriangle/><AlertTitle>Dataset could not be loaded</AlertTitle><AlertDescription>The source file is temporarily unavailable. Existing notebook content has not been affected.<div className='mt-3'><Button size='sm' variant='outline'>Try again</Button></div></AlertDescription></Alert></Preview><Preview title='Permission state'><Empty><EmptyIcon><AlertTriangle/></EmptyIcon><EmptyTitle>Review access required</EmptyTitle><EmptyDescription>You can see that this record exists, but its scientific content is restricted to the assigned review team.</EmptyDescription><EmptyActions><Button variant='outline'>Request access</Button></EmptyActions></Empty></Preview></div>
  </ShowcaseSection>

  <ShowcaseSection id='upload' title='File upload'>
    <Preview title='Drop zone'><button className='flex min-h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.03]'><UploadCloud className='size-8 text-muted-foreground'/><p className='mt-3 text-sm font-semibold'>Drop instrument files here</p><p className='mt-1 text-xs text-muted-foreground'>CSV, XLSX, XML or instrument-native files up to 2 GB</p><Button variant='outline' size='sm' className='mt-4'>Choose files</Button></button></Preview>
  </ShowcaseSection>

  <ShowcaseSection id='responsive' title='Responsive inspector behaviour'>
    <Preview title='Inspector becomes a sheet on small screens'><Sheet><SheetTrigger asChild><Button variant='outline'>Open mobile inspector</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Experiment properties</SheetTitle><SheetDescription>The same inspector content is reused inside a modal sheet.</SheetDescription></SheetHeader><div className='mt-6'><PropertyList><Property label='ID'>EXP-2025-0014</Property><Property label='Status'><StatusBadge status='in progress'/></Property><Property label='Owner'>Gareth Price</Property></PropertyList></div></SheetContent></Sheet></Preview>
  </ShowcaseSection>
</div>}
