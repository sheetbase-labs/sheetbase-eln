# UI primitives

The source-owned shadcn/Radix primitives restyled to UI system v3 (DSYS-03)
plus the new v3 components (DSYS-04). Import from `#/components/ui`.

## Design component mapping

Mapping from every component in the vendored design's
`design-system/components/index.d.ts` to its product implementation. Keep this
table current: a design component with no implementation is a parity gap.

| Design component | Product implementation                           |
| ---------------- | ------------------------------------------------ |
| `Avatar`         | `ui/avatar.tsx`                                  |
| `Banner`         | `ui/alert.tsx` (`Banner`)                        |
| `Button`         | `ui/button.tsx`                                  |
| `Chip`           | `ui/chip.tsx`                                    |
| `Choice`         | `ui/choice.tsx`                                  |
| `Diff`           | `scientific/diff.tsx`                            |
| `Dot`            | `ui/dot.tsx`                                     |
| `EmptyState`     | `ui/empty.tsx`                                   |
| `Icon`           | `components/icons/index.tsx`                     |
| `Kbd`            | `ui/kbd.tsx`                                     |
| `Menu`           | `ui/dropdown-menu.tsx` (`DropdownMenu`)          |
| `MenuItem`       | `ui/dropdown-menu.tsx` (`DropdownMenuItem`)      |
| `MenuLabel`      | `ui/dropdown-menu.tsx` (`DropdownMenuLabel`)     |
| `MenuSep`        | `ui/dropdown-menu.tsx` (`DropdownMenuSeparator`) |
| `Notice`         | `ui/alert.tsx` (`Notice`)                        |
| `Secret`         | `ui/secret.tsx`                                  |
| `Segmented`      | `ui/segmented.tsx`                               |
| `Skeleton`       | `ui/skeleton.tsx`                                |
| `Source`         | `scientific/source.tsx`                          |
| `Status`         | `scientific/status-badge.tsx` (`StatusBadge`)    |
| `Stepper`        | `v3/ui/stepper.tsx`                              |
| `Tag`            | `ui/tag.tsx`                                     |
| `Toast`          | `ui/sonner.tsx` (`Toaster`)                      |
| `Tooltip`        | `ui/tooltip.tsx`                                 |
| `Tree`           | `ui/tree.tsx` (`Tree`)                           |
| `TreeItem`       | `ui/tree.tsx` (`TreeItem`)                       |
| `theme`          | `../theme-provider.tsx` (`ThemeProvider`)        |

A right-click context menu uses `ui/context-menu.tsx`, which shares the
`Menu`/`MenuItem` treatment.
