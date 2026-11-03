import { cn } from '#/lib/utils'
import { Icon } from '#/components/icons'

function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Icon>, 'name'>) {
  return (
    <Icon
      name="loader"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
