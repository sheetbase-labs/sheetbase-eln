import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
const meta = { title: 'UI/Navigation', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Breadcrumbs: Story = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Projects</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbEllipsis />
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>EXP-2026-0042</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}
export const Pages: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}
export const RecordTabs: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="max-w-xl">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        Stability assay overview and linked samples.
      </TabsContent>
      <TabsContent value="data">24 measurements.</TabsContent>
      <TabsContent value="audit">Revision approved by Dr. Chen.</TabsContent>
    </Tabs>
  ),
}
export const Scrolling: Story = {
  render: () => (
    <div className="w-full min-w-[28rem] max-w-xl">
      <p className="mb-2 text-sm text-muted-foreground">
        Scroll to view all sample records
      </p>
      <ScrollArea className="h-48 w-full rounded border px-4">
        <div className="py-3">
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} className="whitespace-nowrap py-1">
              SMP-2026-{String(i + 1).padStart(4, '0')} · Plasma aliquot
            </p>
          ))}
        </div>
      </ScrollArea>
    </div>
  ),
}
