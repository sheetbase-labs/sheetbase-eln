# Navigation

The left sidebar answers "where am I?". 232px wide, 30px items, current item on the `selection` wash. It collapses to a 48px icon rail with hover labels.

- Home, Inbox and Schedule sit above a divider; record sections below; pinned projects after.
- Counts are muted text; a problem count uses `danger-text`.
- Sections a role can't open are left out, never shown disabled.
- Collapsed rail: `.nav-rail`, 48px, icons only with an `aria-label` and a tooltip on hover.
- On phones the sidebar becomes a three-item bottom bar (`.phone-tabs`): Today, Scan, Inbox.
