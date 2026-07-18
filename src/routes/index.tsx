import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

export function Home() {
  return (
    <main className="grid min-h-svh place-items-center p-8">
      <div className="max-w-lg space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Sheetbase</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Product foundation ready
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The application shell, data libraries, and PostgreSQL tooling are in
          place. Product screens and the UI system come next.
        </p>
      </div>
    </main>
  )
}
