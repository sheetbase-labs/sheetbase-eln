/** A readback sentence whose `<b>…</b>` parts are set in bold. */
export function RichLine({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<b>.*?<\/b>)/).map((part, index) =>
        part.startsWith('<b>') ? (
          <b key={index} className="font-semibold">
            {part.slice(3, -4)}
          </b>
        ) : (
          part
        ),
      )}
    </>
  )
}
