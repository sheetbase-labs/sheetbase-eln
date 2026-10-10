import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Menus take focus, trap it, close on Esc or an outside click and return focus to their trigger (Base UI does this).
export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger

export function DropdownMenuContent({
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50 outline-none"
        align={align}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'flex min-w-[200px] flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-overlay outline-none origin-(--transform-origin) transition-[opacity,scale] duration-100 data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const itemCls =
  'flex h-[30px] w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-body text-fg no-underline outline-none hover:no-underline data-highlighted:bg-surface-hover data-highlighted:text-fg data-disabled:cursor-default data-disabled:text-fg-faint [&_svg]:text-fg-muted'

type ItemExtras = { icon?: IconName; hint?: React.ReactNode; danger?: boolean }
function ItemInner({
  icon,
  hint,
  children,
}: ItemExtras & { children?: React.ReactNode }) {
  return (
    <>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? (
        <span className="ml-auto text-label text-fg-muted">{hint}</span>
      ) : null}
    </>
  )
}

export function DropdownMenuItem({
  className,
  icon,
  hint,
  danger,
  children,
  ...props
}: MenuPrimitive.Item.Props & ItemExtras) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemCls, danger && 'text-danger-text', className)}
      {...props}
    >
      <ItemInner icon={icon} hint={hint}>
        {children}
      </ItemInner>
    </MenuPrimitive.Item>
  )
}

/** A menu item that navigates. Pass a router Link through `render`. */
export function DropdownMenuLinkItem({
  className,
  icon,
  hint,
  danger,
  children,
  ...props
}: MenuPrimitive.LinkItem.Props & ItemExtras) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="dropdown-menu-item"
      className={cn(itemCls, danger && 'text-danger-text', className)}
      {...props}
    >
      <ItemInner icon={icon} hint={hint}>
        {children}
      </ItemInner>
    </MenuPrimitive.LinkItem>
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn('my-1 h-px bg-border-subtle', className)}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        'px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}
export const DropdownMenuGroup = MenuPrimitive.Group
