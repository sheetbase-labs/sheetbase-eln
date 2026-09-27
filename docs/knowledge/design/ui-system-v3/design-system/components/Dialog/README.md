# Dialog

Use a dialog only when the action needs focused input or has consequences that must be confirmed (signing, withdrawing volume, publishing a schema). Prefer inline disclosure otherwise.

- `.scrim` behind, `.dialog` with `.dialog-head`, `.dialog-body`, `.dialog-foot`. `radius-lg` and `shadow-dialog` belong to dialogs only.
- The confirm button names the action and object. Destructive consequences are stated above it.
- Focus moves into the dialog and returns to the trigger on close.
