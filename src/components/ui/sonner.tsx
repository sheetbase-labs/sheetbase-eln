import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'

/**
 * Toaster wrapper for Sonner. Uses `theme="light"` so Sonner never applies
 * its own built-in dark styles (hardcoded black bg). Theming is handled
 * entirely by our semantic CSS variables (--background, --foreground, etc.)
 * which switch automatically when the `.dark` class is on <html>.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      data-slot="toaster"
      theme="light"
      position="bottom-center"
      duration={6000}
      visibleToasts={1}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:!rounded-lg group-[.toaster]:!border-transparent group-[.toaster]:!bg-inverse-bg group-[.toaster]:!text-caption group-[.toaster]:!text-inverse-text group-[.toaster]:!shadow-overlay',
          // copy-ignore-next-line
          description: 'group-[.toast]:!text-inverse-text',
          actionButton:
            'group-[.toast]:!bg-inverse-text group-[.toast]:!text-inverse-bg',
          cancelButton:
            'group-[.toast]:!bg-inverse-bg group-[.toast]:!text-inverse-text',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
