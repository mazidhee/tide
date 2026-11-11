# Tide redesign prototype: the system

A static prototype of a replacement visual world for Tide. Open `index.html`. Nothing here touches the app.

## Where the look comes from

Tide is a working tool (Operate mode), so the layout, navigation and controls are the standard ones: a side rail, a top bar, tables, tabs. The world lends only four things: type, palette, density and one signature move.

The world is the British educational paperback of the 1960s, the Pelican series on the Marber grid: white stock, one strong blue, a plain grotesque, ruled bands, and each subject given its own colour. It was a self-taught reader's university, which is who Tide is for. It shows up as the library's covers, the subject colours, and the ruled, banded structure of every page. It is not used as a costume: no paper texture, no retro type.

## The signature move: the level

How well a concept is held is drawn as water standing in a small tank. The fill is where it stands now. A line marks the highest it has stood. A gap between the two is something fading. The same mark is used on Home (Fading), in a lesson (the recall question), and as the cells of the map in What you know. It is the one thing in Tide that only Tide would draw, and it earns the name.

## Tokens

All in `styles.css` under `:root` and `:root[data-theme='dark']`.

### Colour

| Role | Light | Dark |
|---|---|---|
| Paper (content) | `#ffffff` | `#141a23` |
| Rail (sidebar) | `#eff3f8` | `#0f141c` |
| Sunk (insets, block headers) | `#f5f7fa` | `#10151d` |
| Raised | `#ffffff` | `#1a212c` |
| Line / strong line | `#e1e6ed` / `#c9d1dc` | `#242c39` / `#364152` |
| Ink / secondary / muted | `#121a26` / `#414b5a` / `#5f6a7b` | `#e7eaf0` / `#b3bbc9` / `#8993a5` |
| Accent | `#1257b8` | `#7db5f5` |
| Accent soft / line | `#e8f0fb` / `#b5cdf0` | 13% / 38% of accent |
| Good, warn, bad (text) | `#17703c` `#8a5600` `#b3261e` | `#5fcf8e` `#e8b04a` `#f08a80` |

- Neutrals are tinted towards the brand's dark blue, never plain grey. The dark theme is a deep ink blue, the colour of the app icon, not black.
- One accent, a tidal blue. It means three things only: the primary action, the current selection, and "now" (the current step, the question waiting for you). Nothing decorative is blue.
- Five area colours, in a fixed order, always beside a label: Computer systems violet, Distributed systems orange, Machine learning green, Data engineering amber, C++ pink. The order was checked with the dataviz validator for colour-blind separation in both themes (adjacent pairs pass; in light, three of them are under 3:1 against white, which is why they never carry meaning without a label).
- Positive and negative (weights, this Mac against cloud) are blue against orange, with a legend.
- Status is a dot and a word, never a coloured pill: round green for running, a hollow ring for idle, an amber diamond for attention.

### Type

- Interface: **Hanken Grotesk**, 400/500/600. Fixed sizes, no fluid type: 11.5 (axes), 12.5 (meta), 13.5 (base), 15 (lede, section heads), 19 (the next thing), 24 (page title), 28 to 30 (a lesson or note title).
- Long reading (lessons and notes): **Source Serif 4** at 17/28, old-style figures, a measure of about 74 characters. It sits with the maths.
- Maths: native MathML in **STIX Two Math**, which ships with macOS. No KaTeX needed. Display equations are indented and numbered on the right, as in a textbook, so the tutor and the questions can refer to "equation (4)".
- Code and SQL only: the system monospace.
- All data uses tabular figures.
- The `Aa` button in a lesson or note switches the reading face to the sans, so both can be judged.

### Space, radius, depth

- Spacing on a 4 px base: 4, 8, 12, 16, 24, 32, 40, 48. More space above a heading than below it.
- Radius says what a thing is: 3 px for marks (tags, map cells, bars), 6 px for controls and rows, 10 px for blocks and panels, 14 px for things that float. Table cells are square.
- Containers are ruled, not shadowed. A shadow means "this floats" and is used once, on the lesson's Ask bar.
- Rail 244 px. Rows 44 to 58 px in tables, 30 px in navigation.

### Icons

One set, redrawn: 20 px grid, 1.5 px round strokes, no fills, in `app.js`. Third-party services keep their real logos on a white tile. No emoji, no icon font. The wave mark is two strokes on the icon's dark blue square.

### Motion

Only in answer to an action: 120 ms hover and press on controls, a book cover lifting 3 px, the simulation when Run is pressed. Nothing moves on load, and nothing loops, so the interface stays still while Gemma is using the GPU.

## Main choices and why

1. **Serif for reading, sans for the tool.** The learner reads technical prose for hours; a book face at 17/28 beside real maths reads as a textbook, and makes the tutor's words visibly different from the chrome around them.
2. **Sentences before charts.** Each data screen opens with one plain sentence carrying the numbers (Connections, Speed, What you know), then the chart. Trust comes from being told, then shown.
3. **Tables over cards.** Connections, Fading, the papers list and Recent answers are tables with aligned columns. The chosen Connections design carries over almost unchanged: summary, tabs, grouped rows, one row opened in place.
4. **Where it ran is always stated.** Every block and answer says "on this Mac" or names the cloud service, in the same small line, in the same place.
5. **Bars share a scale.** In Speed every answer's bar is drawn to the same scale, so the slow answer is visibly the long one.
6. **The professor appears only where the tutor speaks.** 24 px beside a tutor message, 28 px in a guided tour, 56 px on Home. Drawn from `src/shared/professorArt.ts`.

## Deliberately rejected

- Cream paper, serif display type and a terracotta accent.
- Near-black with an acid accent, glows, or gradients of any kind.
- A grid of identical rounded cards with the same grey shadow. There are four bordered blocks on Home and none is a card of icon, heading and text.
- All-caps tracked labels above headings, and middle-dot strings of metadata. Meta is a short sentence or a table column.
- Arrows on links; progress rings; sparklines as decoration; hero numbers standing in for content.
- Coloured side-stripes on callouts, and status pills.
- A dark navy rail in the light theme: striking in a screenshot, tiring across a day.
- The roll's other worlds (a split-flap board, an orienteering map, a ticket wallet, a Crouwel grid, a design annual, a botanical folio). Kept from them: columns that never move (split-flap), one colour reserved for the current leg (orienteering), one shared scale across plates (botanical).

## What is sample data

Everything. Lessons, counts, timings, memory figures and allowances are written to look real and are not read from the Mac.

## Files

- `index.html` Home, `lesson.html`, `note.html`, `library.html`, `know.html`, `connections.html`, `speed.html`
- `styles.css` the system, `app.js` the rail, icons, theme switch, tooltips
- `shoot.sh` screenshots every screen in both themes into `shots/`
