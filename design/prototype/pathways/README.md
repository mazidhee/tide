# Pathways: "What you know" as a map of how ideas build

A static prototype in two forms. Open `index.html` (works from file://). Nothing here touches the app.

- **Flat** (2D canvas): layered left to right by prerequisite depth, areas as bands, the frontier at the right-hand edge of what is filled in. Deterministic, so a concept stays where you last saw it.
- **Depth** (three.js r170, vendored in `vendor/`): each area a tower on a ring, fundamentals at the foot.

Both use the same encodings: the level (fill to how well it is held now, a line at the highest it stood), the amber diamond for fading, the blue ring for ready next, size for how much rests on a concept, pathway thickness (2D) or strength (3D) for how often a link has been travelled. Both draw only when something changes.

Query parameters: `form=2d|3d`, `theme=light|dark`, `n=320|2000`, `focus=<id>` (select and light its chain), `select=<id>`, `status=solid|fading|ready|learning|new`, `fps=1` (frame counter), `bench=1` (measures both forms at both sizes, JSON in `#bench`).

Keys: arrows move between concepts, `F` focus chain, `/` find, `0` show everything, `+`/`-` zoom, `2`/`3` switch form, `Esc` clear.

All data is sample data generated in `data.js` (320 named concepts across six areas; 2,000 adds the parts of each topic). The model follows `native/tide-core/src/knowledge.rs`.

`sh shoot.sh` writes screenshots to `shots/`. `vendor/make-global.sh` explains the one derived file.
