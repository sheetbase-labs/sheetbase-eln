/**
 * The toast entry point every screen calls. It lives beside the `Toaster` that
 * renders what it is given, but in a module of its own so mounting the toaster
 * and firing one are separate imports: `sonner.tsx` then exports a component
 * only, and Fast Refresh can preserve the toasts on screen when it changes.
 */
export { toast } from 'sonner'
