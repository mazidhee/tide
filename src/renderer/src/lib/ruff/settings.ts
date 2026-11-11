/** Ruff's default rule set: pyflakes (F) and the pycodestyle errors that aren't about layout (E4, E7, E9) */
export const RUFF_SETTINGS = {
  'line-length': 100,
  'indent-width': 4,
  lint: { select: ['E4', 'E7', 'E9', 'F'] },
  format: { 'indent-style': 'space', 'quote-style': 'double' }
}
