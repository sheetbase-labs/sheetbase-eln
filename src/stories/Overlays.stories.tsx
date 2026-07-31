import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui'

const meta = { title: 'UI/Overlays', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Dialogs: Story = {
  render: () => (
    <div className="flex gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button>New experiment</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create experiment</DialogTitle>
            <DialogDescription>Start a new stability study.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Archive</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive experiment?</AlertDialogTitle>
            <AlertDialogDescription>
              Links remain visible, but this record becomes read-only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ),
}
export const SheetPanel: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Inspect sample</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>SMP-2026-0142</SheetTitle>
          <SheetDescription>Human plasma · frozen · 2.4 mL</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}
export const Floating: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex gap-5">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Conditions</Button>
          </PopoverTrigger>
          <PopoverContent>37 °C · 5% CO₂ · 24 h</PopoverContent>
        </Popover>
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">SMP-2026-0142</Button>
          </HoverCardTrigger>
          <HoverCardContent>Plasma aliquot, donor cohort B</HoverCardContent>
        </HoverCard>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon">?</Button>
          </TooltipTrigger>
          <TooltipContent>Method detection limit</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Export PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  ),
}
