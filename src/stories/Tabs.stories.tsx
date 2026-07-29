import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-96">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="methods">Methods</TabsTrigger>
        <TabsTrigger value="results">Results</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Experiment overview content.</TabsContent>
      <TabsContent value="methods">Methods and materials.</TabsContent>
      <TabsContent value="results">Recorded results.</TabsContent>
    </Tabs>
  ),
}
export const DisabledTab: Story = {
  render: () => (
    <Tabs defaultValue="active">
      <TabsList>
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="archived" disabled>
          Archived
        </TabsTrigger>
      </TabsList>
      <TabsContent value="active">Active records</TabsContent>
    </Tabs>
  ),
}
