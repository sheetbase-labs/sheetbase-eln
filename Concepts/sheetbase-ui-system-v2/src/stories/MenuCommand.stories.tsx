import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Copy, FileText, FlaskConical, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '#/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '#/components/ui/dropdown-menu'

const meta = { title: 'UI/Menu & command', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Dropdown: Story = { render: () => <DropdownMenu><DropdownMenuTrigger asChild><Button variant='outline' size='icon'><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>Record actions</DropdownMenuLabel><DropdownMenuItem><Copy/>Duplicate</DropdownMenuItem><DropdownMenuItem><FileText/>Export PDF</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem className='text-destructive'><Trash2/>Archive</DropdownMenuItem></DropdownMenuContent></DropdownMenu> }
export const CommandPalette: Story = { render: () => <Command className='w-[520px] rounded-lg border shadow-sm'><CommandInput placeholder='Search records and commands…'/><CommandList><CommandEmpty>No results found.</CommandEmpty><CommandGroup heading='Create'><CommandItem><FlaskConical/>Create experiment<CommandShortcut>⌘E</CommandShortcut></CommandItem><CommandItem><FileText/>Create protocol<CommandShortcut>⌘P</CommandShortcut></CommandItem></CommandGroup><CommandGroup heading='Navigate'><CommandItem><Search/>Knowledge search<CommandShortcut>⌘K</CommandShortcut></CommandItem></CommandGroup></CommandList></Command> }
