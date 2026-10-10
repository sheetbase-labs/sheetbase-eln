import { Toaster as Sonner, toast } from 'sonner'

// Feedback for an action you just took: bottom centre, 6 s, inverse surface, Undo when reversible.
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      duration={6000}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex min-h-9 items-center gap-3 whitespace-nowrap rounded-lg bg-inverse py-1.5 pl-3.5 pr-2 text-body text-inverse-foreground shadow-overlay before:size-[7px] before:shrink-0 before:rounded-full before:bg-success data-[type=error]:before:bg-danger',
          actionButton:
            'h-6 cursor-pointer rounded-sm border-0 bg-transparent px-2 text-label font-semibold text-inverse-foreground hover:bg-inverse-foreground/20',
          closeButton: 'text-inverse-foreground',
        },
      }}
    />
  )
}
export { toast }
