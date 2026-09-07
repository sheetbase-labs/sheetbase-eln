import type { ReactNode } from 'react'

export function FormSection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="grid min-w-0 gap-3 border-t pt-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
