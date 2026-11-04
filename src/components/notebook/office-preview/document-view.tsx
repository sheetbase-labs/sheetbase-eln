import { cn } from '#/lib/utils'

/** A converted Word or OpenDocument text file, set in the app's own type. */
export function DocumentView({ html, tall }: { html: string; tall?: boolean }) {
  return (
    <div
      className={cn(
        'overflow-auto rounded-md border border-border bg-surface px-5 py-4 text-body leading-relaxed',
        tall ? 'max-h-[70vh]' : 'max-h-96',
        '[&_a]:text-link [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:font-heading [&_h1]:text-doc [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:font-heading [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_img]:my-2 [&_img]:max-h-72 [&_img]:max-w-full [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      )}
      // The HTML was cleaned by `sanitiseDocumentHtml` before it got here.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
