import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircle, Bell, Bold, ChevronDown, CircleHelp, Copy, Download, FileText, Filter, Info, Italic, MoreHorizontal, Plus, Search, Settings, Trash2, Upload, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, Preview, ShowcaseSection } from '#/components/showcase'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '#/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '#/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import { Calendar } from '#/components/ui/calendar'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '#/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '#/components/ui/dropdown-menu'
import { Empty, EmptyActions, EmptyDescription, EmptyIcon, EmptyTitle } from '#/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '#/components/ui/hover-card'
import { Input } from '#/components/ui/input'
import { Kbd } from '#/components/ui/kbd'
import { Label } from '#/components/ui/label'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '#/components/ui/pagination'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Progress } from '#/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Separator } from '#/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { Slider } from '#/components/ui/slider'
import { Spinner } from '#/components/ui/spinner'
import { Switch } from '#/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'
import { Toggle } from '#/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'

export const Route = createFileRoute('/components')({ component: ComponentsPage })

function ComponentsPage(){
  const [date,setDate]=React.useState<Date|undefined>(new Date())
  return <div>
    <PageHeader eyebrow='UI components' title='Core shadcn-style primitives' description='The general-purpose layer. These components are visually Sheetbase, behaviourally accessible, and intentionally free of scientific domain assumptions.'/>

    <ShowcaseSection id='actions' title='Actions' description='Button hierarchy is restrained: one primary action per region, with outline and ghost variants for supporting controls.'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Preview title='Buttons'><div className='flex flex-wrap items-center gap-2'><Button>Primary</Button><Button variant='secondary'>Secondary</Button><Button variant='outline'>Outline</Button><Button variant='ghost'>Ghost</Button><Button variant='destructive'>Destructive</Button><Button variant='link'>Text link</Button><Button disabled>Disabled</Button><Button><Plus/>With icon</Button><Button size='icon' aria-label='Settings'><Settings/></Button></div></Preview>
        <Preview title='Button groups'><div className='flex flex-wrap gap-4'><ButtonGroup><Button variant='outline'><Bold/></Button><Button variant='outline'><Italic/></Button><Button variant='outline'><MoreHorizontal/></Button></ButtonGroup><ButtonGroup><Button>Save</Button><Button aria-label='More save options'><ChevronDown/></Button></ButtonGroup></div></Preview>
        <Preview title='Toggles'><div className='flex flex-wrap items-center gap-4'><Toggle aria-label='Toggle bold'><Bold/></Toggle><Toggle variant='outline' aria-label='Toggle italic'><Italic/></Toggle><ToggleGroup type='multiple' variant='outline'><ToggleGroupItem value='bold'><Bold/></ToggleGroupItem><ToggleGroupItem value='italic'><Italic/></ToggleGroupItem></ToggleGroup></div></Preview>
        <Preview title='Dropdown menu'><DropdownMenu><DropdownMenuTrigger asChild><Button variant='outline'>Actions<ChevronDown/></Button></DropdownMenuTrigger><DropdownMenuContent align='start'><DropdownMenuLabel>Record actions</DropdownMenuLabel><DropdownMenuItem><Copy/>Duplicate<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem><Download/>Export</DropdownMenuItem><DropdownMenuCheckboxItem checked>Show activity</DropdownMenuCheckboxItem><DropdownMenuSeparator/><DropdownMenuItem className='text-destructive'><Trash2/>Archive</DropdownMenuItem></DropdownMenuContent></DropdownMenu></Preview>
      </div>
    </ShowcaseSection>

    <ShowcaseSection id='forms' title='Forms and inputs' description='Fields always include a visible label. Help and validation text are part of the component contract.'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Preview title='Text inputs'><FieldGroup><Field><FieldLabel htmlFor='name'>Experiment name</FieldLabel><Input id='name' placeholder='e.g. Virus stability at 4 °C'/><FieldDescription>Use a specific, searchable title.</FieldDescription></Field><Field><FieldLabel htmlFor='invalid'>Sample identifier</FieldLabel><Input id='invalid' defaultValue='SMP-001' aria-invalid className='border-destructive'/><FieldError>This identifier is already in use.</FieldError></Field><Field><FieldLabel htmlFor='notes'>Notes</FieldLabel><Textarea id='notes' placeholder='Add scientific context…'/></Field></FieldGroup></Preview>
        <Preview title='Select and search'><FieldGroup><Field><FieldLabel>Record type</FieldLabel><Select defaultValue='experiment'><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value='experiment'>Experiment</SelectItem><SelectItem value='sample'>Sample</SelectItem><SelectItem value='protocol'>Protocol</SelectItem><SelectItem value='dataset'>Dataset</SelectItem></SelectContent></Select></Field><Field><FieldLabel htmlFor='search'>Search</FieldLabel><div className='relative'><Search className='absolute left-3 top-2.5 size-4 text-muted-foreground'/><Input id='search' className='pl-9' placeholder='Search records'/></div></Field></FieldGroup></Preview>
        <Preview title='Choice controls'><div className='space-y-5'><div className='flex items-center gap-2'><Checkbox id='check' defaultChecked/><Label htmlFor='check'>Include archived records</Label></div><RadioGroup defaultValue='comfortable'><div className='flex items-center gap-2'><RadioGroupItem id='comfortable' value='comfortable'/><Label htmlFor='comfortable'>Comfortable density</Label></div><div className='flex items-center gap-2'><RadioGroupItem id='compact' value='compact'/><Label htmlFor='compact'>Compact density</Label></div></RadioGroup><div className='flex items-center justify-between rounded-md border p-3'><div><p className='text-sm font-medium'>Automatic saving</p><p className='text-xs text-muted-foreground'>Save changes as they are made.</p></div><Switch defaultChecked/></div><div><div className='mb-2 flex justify-between text-xs'><span>Confidence threshold</span><span>80%</span></div><Slider defaultValue={[80]} max={100} step={5}/></div></div></Preview>
        <Preview title='Calendar'><div className='flex justify-center'><Calendar mode='single' selected={date} onSelect={setDate} className='rounded-md border'/></div></Preview>
      </div>
    </ShowcaseSection>

    <ShowcaseSection id='display' title='Data display'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Preview title='Badges and statuses'><div className='flex flex-wrap gap-2'><Badge>Default</Badge><Badge variant='secondary'>Secondary</Badge><Badge variant='outline'>Outline</Badge><Badge variant='success'>In progress</Badge><Badge variant='warning'>Review</Badge><Badge variant='danger'>Failed</Badge><Badge variant='info'>Experiment</Badge><Badge variant='violet'>Protocol</Badge></div></Preview>
        <Preview title='Avatars'><div className='flex items-center gap-4'><Avatar><AvatarFallback>GP</AvatarFallback></Avatar><div className='flex -space-x-2'>{['GP','EL','ML','PN'].map((name)=><Avatar key={name} className='border-2 border-background'><AvatarFallback>{name}</AvatarFallback></Avatar>)}</div><HoverCard><HoverCardTrigger asChild><Button variant='link' className='px-0'>Gareth Price</Button></HoverCardTrigger><HoverCardContent><div className='flex gap-3'><Avatar><AvatarFallback>GP</AvatarFallback></Avatar><div><p className='text-sm font-semibold'>Gareth Price</p><p className='text-xs text-muted-foreground'>Principal Scientist · OXB Labs</p></div></div></HoverCardContent></HoverCard></div></Preview>
        <Preview title='Cards'><Card><CardHeader><CardTitle>Experiment overview</CardTitle><CardDescription>Core record metadata and status.</CardDescription></CardHeader><CardContent><div className='grid grid-cols-2 gap-3 text-sm'><span className='text-muted-foreground'>Status</span><Badge variant='success' className='w-fit'>In progress</Badge><span className='text-muted-foreground'>Samples</span><span className='font-medium'>12 linked</span></div></CardContent><CardFooter><Button variant='outline' size='sm'>Open record</Button></CardFooter></Card></Preview>
        <Preview title='Table'><div className='overflow-hidden rounded-md border'><Table><TableHeader><TableRow><TableHead>Sample</TableHead><TableHead>Batch</TableHead><TableHead>Concentration</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[['SMP-LV-0001','B25-0701','3.2E+08','In stock'],['SMP-LV-0002','B25-0701','2.8E+08','In stock'],['SMP-LV-0003','B25-0625','1.1E+08','Low stock']].map(row=><TableRow key={row[0]}>{row.map((cell,i)=><TableCell key={cell}>{i===3?<Badge variant={cell==='In stock'?'success':'warning'}>{cell}</Badge>:cell}</TableCell>)}</TableRow>)}</TableBody></Table></div></Preview>
        <Preview title='Progress and loading'><div className='space-y-5'><div><div className='mb-2 flex justify-between text-xs'><span>Review completion</span><span>60%</span></div><Progress value={60}/></div><div className='flex items-center gap-2 text-sm text-muted-foreground'><Spinner/>Processing instrument file…</div><div className='space-y-2'><Skeleton className='h-4 w-2/3'/><Skeleton className='h-4 w-full'/><Skeleton className='h-4 w-4/5'/></div></div></Preview>
        <Preview title='Empty state'><Empty><EmptyIcon><FileText/></EmptyIcon><EmptyTitle>No protocols yet</EmptyTitle><EmptyDescription>Create a protocol or add one from the shared template library.</EmptyDescription><EmptyActions><Button size='sm'><Plus/>Create protocol</Button><Button size='sm' variant='outline'>Browse templates</Button></EmptyActions></Empty></Preview>
      </div>
    </ShowcaseSection>

    <ShowcaseSection id='navigation' title='Navigation'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Preview title='Breadcrumbs'><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href='#'>Projects</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbLink href='#'>Lentivector Stability Study</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbPage>Virus Stability at 4 °C</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></Preview>
        <Preview title='Tabs'><Tabs defaultValue='overview'><TabsList><TabsTrigger value='overview'>Overview</TabsTrigger><TabsTrigger value='results'>Results</TabsTrigger><TabsTrigger value='files'>Files</TabsTrigger><TabsTrigger value='activity'>Activity</TabsTrigger></TabsList><TabsContent value='overview' className='rounded-md border p-4 text-sm text-muted-foreground'>The overview tab is selected.</TabsContent><TabsContent value='results' className='rounded-md border p-4 text-sm text-muted-foreground'>Results content.</TabsContent><TabsContent value='files' className='rounded-md border p-4 text-sm text-muted-foreground'>Files content.</TabsContent><TabsContent value='activity' className='rounded-md border p-4 text-sm text-muted-foreground'>Activity content.</TabsContent></Tabs></Preview>
        <Preview title='Pagination'><Pagination><PaginationContent><PaginationItem><PaginationPrevious href='#'/></PaginationItem><PaginationItem><PaginationLink href='#' isActive>1</PaginationLink></PaginationItem><PaginationItem><PaginationLink href='#'>2</PaginationLink></PaginationItem><PaginationItem><PaginationLink href='#'>3</PaginationLink></PaginationItem><PaginationItem><PaginationEllipsis/></PaginationItem><PaginationItem><PaginationNext href='#'/></PaginationItem></PaginationContent></Pagination></Preview>
        <Preview title='Command menu'><Command className='rounded-md border'><CommandInput placeholder='Search Sheetbase…'/><CommandList><CommandEmpty>No results.</CommandEmpty><CommandGroup heading='Create'><CommandItem><Plus/>New experiment<CommandShortcut>⌘E</CommandShortcut></CommandItem><CommandItem><Upload/>Upload dataset<CommandShortcut>⌘U</CommandShortcut></CommandItem><CommandItem><UserPlus/>Invite user</CommandItem></CommandGroup></CommandList></Command></Preview>
      </div>
    </ShowcaseSection>

    <ShowcaseSection id='overlays' title='Overlays and feedback'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Preview title='Dialogs'><div className='flex flex-wrap gap-2'><Dialog><DialogTrigger asChild><Button variant='outline'>Open dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create experiment</DialogTitle><DialogDescription>Start from a blank notebook or an approved template.</DialogDescription></DialogHeader><Field><FieldLabel>Experiment title</FieldLabel><Input placeholder='Untitled experiment'/></Field><DialogFooter><Button variant='outline'>Cancel</Button><Button>Create</Button></DialogFooter></DialogContent></Dialog><AlertDialog><AlertDialogTrigger asChild><Button variant='destructive'>Archive record</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Archive this experiment?</AlertDialogTitle><AlertDialogDescription>The record remains discoverable and its audit history is retained.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction>Archive</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Sheet><SheetTrigger asChild><Button variant='outline'>Open inspector</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Experiment properties</SheetTitle><SheetDescription>Record metadata and linked objects.</SheetDescription></SheetHeader><div className='my-6 space-y-4 text-sm'><div className='flex justify-between'><span className='text-muted-foreground'>ID</span><span className='font-mono text-xs'>EXP-2025-0014</span></div><div className='flex justify-between'><span className='text-muted-foreground'>Status</span><Badge variant='success'>In progress</Badge></div></div><SheetFooter><Button>Save changes</Button></SheetFooter></SheetContent></Sheet></div></Preview>
        <Preview title='Popover, tooltip and toast'><div className='flex flex-wrap items-center gap-2'><Popover><PopoverTrigger asChild><Button variant='outline'><Filter/>Filters</Button></PopoverTrigger><PopoverContent><p className='text-sm font-semibold'>Filter records</p><div className='mt-3 space-y-3'><div className='flex items-center gap-2'><Checkbox id='mine'/><Label htmlFor='mine'>Assigned to me</Label></div><div className='flex items-center gap-2'><Checkbox id='open'/><Label htmlFor='open'>Open records only</Label></div></div></PopoverContent></Popover><Tooltip><TooltipTrigger asChild><Button variant='ghost' size='icon'><CircleHelp/></Button></TooltipTrigger><TooltipContent>View component guidance</TooltipContent></Tooltip><Button variant='outline' onClick={()=>toast.success('Changes saved', {description:'Your component preferences were updated.'})}><Bell/>Show toast</Button></div></Preview>
        <Preview title='Alerts'><div className='space-y-3'><Alert><Info/><AlertTitle>Information</AlertTitle><AlertDescription>This experiment is linked to three samples and one protocol.</AlertDescription></Alert><Alert variant='info'><CircleHelp/><AlertTitle>Review required</AlertTitle><AlertDescription>Complete the reviewer checklist before applying your signature.</AlertDescription></Alert><Alert variant='destructive'><AlertCircle/><AlertTitle>Import failed</AlertTitle><AlertDescription>Two rows contain invalid sample identifiers.</AlertDescription></Alert></div></Preview>
        <Preview title='Accordion'><Accordion type='single' collapsible className='w-full'><AccordionItem value='one'><AccordionTrigger>When should I create a scientific component?</AccordionTrigger><AccordionContent>When a pattern carries domain meaning that should remain consistent across several screens.</AccordionContent></AccordionItem><AccordionItem value='two'><AccordionTrigger>Can primitives be changed?</AccordionTrigger><AccordionContent>Yes. Components are repository-owned and can be adapted while preserving their API.</AccordionContent></AccordionItem></Accordion></Preview>
      </div>
    </ShowcaseSection>

    <ShowcaseSection id='utility' title='Utility components'>
      <div className='grid gap-4 lg:grid-cols-2'><Preview title='Keyboard shortcuts'><div className='flex flex-wrap gap-3 text-sm'><span className='flex items-center gap-2'>Search <span><Kbd>⌘</Kbd> <Kbd>K</Kbd></span></span><span className='flex items-center gap-2'>Save <span><Kbd>⌘</Kbd> <Kbd>S</Kbd></span></span><span className='flex items-center gap-2'>New block <Kbd>/</Kbd></span></div></Preview><Preview title='Scrollable region'><ScrollArea className='h-40 rounded-md border'><div className='p-4'>{Array.from({length:12}).map((_,i)=><div key={i}><p className='text-sm'>Audit event {i+1}</p><p className='text-xs text-muted-foreground'>14 Jul 2025 · {String(9+i).padStart(2,'0')}:12</p>{i<11&&<Separator className='my-3'/>}</div>)}</div></ScrollArea></Preview></div>
    </ShowcaseSection>
  </div>
}
