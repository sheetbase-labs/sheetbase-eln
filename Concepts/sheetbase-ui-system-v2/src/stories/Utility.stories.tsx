import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Bold, Italic, Underline } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import { Calendar } from '#/components/ui/calendar'
import { Kbd } from '#/components/ui/kbd'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Toggle } from '#/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'

const meta = { title: 'UI/Utility components', tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Catalogue: Story = { render: () => <div className='grid max-w-3xl gap-8'>
  <div className='flex items-center gap-4'><Avatar><AvatarFallback>GP</AvatarFallback></Avatar><Avatar><AvatarFallback>EL</AvatarFallback></Avatar><span className='text-sm'>Open command palette <Kbd>⌘</Kbd> <Kbd>K</Kbd></span></div>
  <ButtonGroup><Button variant='outline'>Table</Button><Button variant='outline'>Chart</Button><Button variant='outline'>Gallery</Button></ButtonGroup>
  <div className='flex gap-3'><Toggle aria-label='Bold'><Bold/></Toggle><ToggleGroup type='multiple' variant='outline'><ToggleGroupItem value='bold'><Bold/></ToggleGroupItem><ToggleGroupItem value='italic'><Italic/></ToggleGroupItem><ToggleGroupItem value='underline'><Underline/></ToggleGroupItem></ToggleGroup></div>
  <div className='grid grid-cols-2 gap-6'><Calendar mode='single' selected={new Date(2026,6,18)}/><ScrollArea className='h-64 rounded-md border p-4'>{Array.from({length:20}).map((_,i)=><div key={i} className='border-b py-2 text-sm'>Activity event {i+1}</div>)}</ScrollArea></div>
</div> }
