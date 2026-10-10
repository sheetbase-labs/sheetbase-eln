# Calendar

Instrument and bench bookings on a time axis. Rows are instruments or people; the current time is a thin `danger` line.

- Classes: `.cal` grid, `.cal-h` column header (`.today`), `.cal-t` time labels, `.cal-ev` booking with `.mine` (yours, `accent-strong`), `.other` (someone else’s), `.clash` (overlap, `warning-wash`) and `.done`, and `.cal-now`.
- Label every booking with what and for which record ("ELISA plate 4 · EXP-0142"). Truncate the label, never the time.
- A clash is shown before booking, with the next free slot offered as a button.
