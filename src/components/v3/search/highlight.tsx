// Renders fixture text where [[…]] marks a match; also marks plain occurrences of the query when there are no explicit marks.
export function Highlight({ text, q }: { text: string; q?: string }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g).filter(Boolean)
  if (parts.length > 1 || text.startsWith('[[')) {
    return (
      <>
        {parts.map((p, i) =>
          p.startsWith('[[') ? (
            <mark key={i} className="rounded-[2px] bg-highlight px-px text-fg">
              {p.slice(2, -2)}
            </mark>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </>
    )
  }
  const needle = q?.trim()
  if (!needle) return <>{text}</>
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-highlight px-px text-fg">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </>
  )
}
