# Toast

A short confirmation after an action the person just took: saved, copied, submitted, sent to the printer. Bottom centre, one at a time.

- `Sheetbase.Toast` with the message as children, optional `action` (Undo, Retry) with `onAction`, `tone="bad"` for failures and `onClose`. Classes `.toast-stack`, `.toast`.
- Success toasts leave after 6 seconds. Offer Undo only when the action can really be reversed. Failures stay until dismissed and say how to recover.
- Never use a toast for something that needs a decision or for validation errors; those belong next to the field or in a banner.
