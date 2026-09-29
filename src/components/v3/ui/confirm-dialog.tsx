import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Button } from './button'
import { DialogClose, DialogContent, DialogFooter } from './dialog'

/**
 * UI port (roadmap-4/ui-app3): a confirmation dialog with the shape the legacy
 * AlertDialog had (Trigger / Content / Header / Title / Description / Footer /
 * Cancel / Action), implemented on app-3's v3 Dialog so screens can move off the
 * legacy kit without rewriting their structure.
 */
export const ConfirmDialog = DialogPrimitive.Root

export function ConfirmDialogContent({
  children,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent role="alertdialog" {...props}>
      {children}
    </DialogContent>
  )
}

export const ConfirmDialogFooter = DialogFooter

export function ConfirmDialogTrigger({
  children,
}: {
  children: React.ReactElement
  asChild?: boolean
}) {
  return <DialogPrimitive.Trigger render={children} />
}

export function ConfirmDialogHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={className ?? 'border-b border-border-subtle px-5 pb-3 pt-4'}
    >
      {children}
    </div>
  )
}

export function ConfirmDialogTitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Title
      className={className ?? 'font-heading text-doc font-semibold text-fg'}
    >
      {children}
    </DialogPrimitive.Title>
  )
}

export function ConfirmDialogDescription({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Description
      className={className ?? 'mt-0.5 text-caption text-fg-muted'}
    >
      {children}
    </DialogPrimitive.Description>
  )
}

export function ConfirmDialogCancel({
  children,
  className,
  disabled,
}: {
  children?: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <DialogClose render={<Button className={className} disabled={disabled} />}>
      {children ?? 'Cancel'}
    </DialogClose>
  )
}

export function ConfirmDialogAction({
  children,
  onClick,
  className,
  variant = 'primary',
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  variant?: 'primary' | 'danger-fill'
  disabled?: boolean
}) {
  return (
    <DialogClose
      render={
        <Button
          variant={variant}
          className={className}
          onClick={onClick}
          disabled={disabled}
        />
      }
    >
      {children}
    </DialogClose>
  )
}
