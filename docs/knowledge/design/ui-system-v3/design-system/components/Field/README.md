# Field

Labels stay visible above the control; placeholders are never labels. Units live in the label ("Load (L/m²)"), not the placeholder.

- `.field` wraps label, `.input` or `.select`, and a `.hint` or `.err` line.
- Validation appears under the affected field and says how to fix it. Keep the user's input.
- Read-only values use plain text in a `.dl`, not a disabled input.
