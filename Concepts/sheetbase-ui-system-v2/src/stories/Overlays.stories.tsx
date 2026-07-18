import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Info } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '#/components/ui/hover-card'
import { Input } from '#/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'

const meta = { title: 'UI/Overlays', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Catalogue: Story = { render: () => <TooltipProvider><div className='flex flex-wrap gap-3'>
  <Dialog><DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Create experiment</DialogTitle><DialogDescription>Start from a blank notebook or template.</DialogDescription></DialogHeader><Input placeholder='Experiment title'/><DialogFooter><Button>Create</Button></DialogFooter></DialogContent></Dialog>
  <AlertDialog><AlertDialogTrigger asChild><Button variant='destructive'>Delete record</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this record?</AlertDialogTitle><AlertDialogDescription>This action moves the record to trash.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <Sheet><SheetTrigger asChild><Button variant='outline'>Open inspector</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Experiment properties</SheetTitle><SheetDescription>Metadata, linked records and activity.</SheetDescription></SheetHeader></SheetContent></Sheet>
  <Popover><PopoverTrigger asChild><Button variant='outline'>Filter</Button></PopoverTrigger><PopoverContent className='text-sm'>Filter controls appear here.</PopoverContent></Popover>
  <HoverCard><HoverCardTrigger asChild><Button variant='ghost'>EXP-2025-0014</Button></HoverCardTrigger><HoverCardContent><div className='font-medium'>Virus Stability at 4 °C</div><p className='mt-1 text-sm text-muted-foreground'>Experiment · In progress</p></HoverCardContent></HoverCard>
  <Tooltip><TooltipTrigger asChild><Button size='icon' variant='outline'><Info/></Button></TooltipTrigger><TooltipContent>More information</TooltipContent></Tooltip>
</div></TooltipProvider> }
