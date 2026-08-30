import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '#/components/ui/accordion'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#/components/ui/breadcrumb'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '#/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'

const meta = { title: 'UI/Navigation', tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Catalogue: Story = { render: () => <div className='grid max-w-3xl gap-8'>
  <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href='#'>Projects</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbLink href='#'>Lentivector Stability Study</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbPage>Virus Stability at 4 °C</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
  <Tabs defaultValue='overview'><TabsList><TabsTrigger value='overview'>Overview</TabsTrigger><TabsTrigger value='results'>Results</TabsTrigger><TabsTrigger value='activity'>Activity</TabsTrigger></TabsList><TabsContent value='overview' className='rounded-md border p-4 text-sm'>Experiment overview content.</TabsContent><TabsContent value='results' className='rounded-md border p-4 text-sm'>Result blocks and charts.</TabsContent><TabsContent value='activity' className='rounded-md border p-4 text-sm'>Audit events and comments.</TabsContent></Tabs>
  <Accordion type='single' collapsible className='rounded-md border px-4'><AccordionItem value='one'><AccordionTrigger>Project folders</AccordionTrigger><AccordionContent>Experiments, protocols, datasets and reports.</AccordionContent></AccordionItem><AccordionItem value='two'><AccordionTrigger>Saved views</AccordionTrigger><AccordionContent>Recently edited, awaiting review and failed runs.</AccordionContent></AccordionItem></Accordion>
  <Pagination><PaginationContent><PaginationItem><PaginationPrevious href='#'/></PaginationItem><PaginationItem><PaginationLink href='#' isActive>1</PaginationLink></PaginationItem><PaginationItem><PaginationLink href='#'>2</PaginationLink></PaginationItem><PaginationItem><PaginationEllipsis/></PaginationItem><PaginationItem><PaginationNext href='#'/></PaginationItem></PaginationContent></Pagination>
</div> }
