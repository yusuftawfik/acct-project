# Design notes (extracted from Figma)

Source: Figma file `TABJwJmuvkNYfJUhodeS2H`, frame "Frame 1" (`1:2`), read on 2026-11-07. These values are also in `client/src/tokens.css`. The Excel redesign (`docs/prompts/02-excel-redesign.md`) should reuse the colours below.

## Nodes (updated)

| Part | Node |
|---|---|
| Page frame | `1:2` (1440 wide) |
| Logo | `1:3` (image, 243x91) |
| New entry form card (named "Entries") | `23:4` |
| Entry Log card | `33:4` (was loose layers before; now a frame called `entry-log-section`) |
| Dashboard container | `11:2` |
| Cards: Cash Position / Accounting Equation / Profit & Loss | `11:31` / `11:4` / `11:47` |
| Print Reports panel | `13:4` |

## Colours

| Use | Value |
|---|---|
| Burgundy: table header rows, filled and outlined print buttons, section titles ("New entry", "Entry Log", "Dashboard") | `#960002` |
| Scroll bar thumb | `#960003` |
| Page header rule (5px), Entry Log header bar | `#c31b1e` |
| Page background | `#f4f6fa` |
| Cards | `#ffffff` |
| Outer border of New entry / Entry Log / Dashboard | `#e8eaee` |
| Border of dashboard cards, print panel, form inputs | `#000000` |
| Body text | `#000000`; muted text and data cells `#444444` |
| Column dividers in data rows | `#bdbdbd` |
| "Report through" dropdown fill | `#d9d9d9` |
| Form buttons (Add line, Suggest tax entry, Clear) border and text, balance bar text | `#12331a` |
| Balance bar when not balanced | `rgba(178, 9, 9, 0.24)` |
| Disabled Post entry | fill `rgba(68, 68, 68, 0.2)`, border black, text `#444` |
| Entry Log body | `rgba(224, 201, 166, 0.65)`; rows alternate `#ffffff` / `#f9f5ee`; row line `#dbd4c9` |

## Fonts

| Use | Font |
|---|---|
| Body, labels, buttons, tables | Inter (Light 300 for small labels, Regular 400, Bold 700) |
| Section titles ("New entry", "Entry Log"), form row labels (Account, Debit, Credit) | JetBrains Mono Regular 16 |
| "Dashboard" title | JetBrains Mono Bold 20 |
| "JOURNAL" page title | Figma says `jsMath-cmsy10` 64px, which is a maths font and does not exist on the web; Figma renders an italic script. The site uses a script fallback stack (`Brush Script MT`, `Segoe Script`, `Lucida Handwriting`, cursive). Pick a real web font if you want it exact. |

Sizes: card titles 24 bold; print panel title 22 bold; subtitles 14; table cells 14; form inputs 12 (date value 14); print buttons 12 bold.

## Spacing and radii

- Page content width 1300; top row = two cards 643 x 475 with a 14px gap; 39px gap to the Dashboard.
- Dashboard: 1300 x 667, padding 32 on the sides, cards 24px apart, cards 170 tall (header 82, header row 44, data row 44), Print Reports panel 210 wide, 24px gap.
- Radii: cards and panels 15; inputs 2; form buttons 5; print buttons 4; Entry Log header bar and body 10 (top / bottom).
- Shadows: New entry and Entry Log `0 5px 20px rgba(0,0,0,.25)`; Dashboard `0 1px 4px rgba(0,0,0,.25)`; Entry Log body `0 4px 4px rgba(0,0,0,.25)`.

## Choices made in code (not in the Figma file)

- **No "Balanced" pill:** it was removed from the Figma design on purpose, so the dashboard has no balanced indicator.
- **Balanced state of the balance bar:** the design only shows the red (not balanced) look; the green look reuses the pill's green.
- **Enabled "Post entry":** the design only shows the disabled look; enabled uses burgundy fill with white text (same as "Print all statements").
- **Messages and hints in the form:** the design has no message area, so notes ("Entry posted.", errors, template hints) appear as small text to the right of the Post entry / Clear buttons.
- **Entry form height:** the cards are at least 475 tall; the form can grow a few pixels with 3 lines, and lines beyond the third scroll inside the form.
- **Icons:** `client/src/assets/icons/*.svg` are simple stand-ins. Replace them with the exact Figma icons using the download commands in the 5A hand-off (the asset links expire after 7 days).
- **Fonts** load from Google Fonts (needs internet).
