/** A readback sentence whose `<b>…</b>` parts are set in bold. */
export function RichLine({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<b>.*?<\/b>)/).map((part, index) =>
        part.startsWith('<b>') ? (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- the parts come from splitting one sentence once, so their position is their identity.
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
