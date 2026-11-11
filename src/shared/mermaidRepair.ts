/**
 * Mends the commonest ways a small model breaks a Mermaid diagram, so it is drawn rather than left
 * as code: a second ```mermaid fence (and its diagram type) repeated inside the block, and a
 * mindmap with more than one root (its first node becomes the root, the rest go under it).
 */
export function repairMermaid(code: string): string {
  let lines = code.replace(/\r\n?/g, '\n').split('\n')
  // Fences inside the block are the model opening it twice
  lines = lines.filter((l) => !/^\s*```[\w-]*\s*$/.test(l))
  // The diagram type said twice ("mindmap", blank, "mindmap")
  const first = lines.findIndex((l) => l.trim())
  if (first >= 0) {
    const type = lines[first].trim()
    lines = lines.filter((l, i) => i <= first || l.trim() !== type || !/^[a-zA-Z-]+$/.test(type))
  }
  const start = lines.findIndex((l) => l.trim())
  if (start >= 0 && lines[start].trim() === 'mindmap') {
    const nodes = lines.map((l, i) => ({ i, l })).filter(({ i, l }) => i > start && l.trim() && !/^\s*%%/.test(l))
    if (nodes.length) {
      const indentOf = (l: string) => l.match(/^\s*/)![0].replace(/\t/g, '  ').length
      const min = Math.min(...nodes.map((n) => indentOf(n.l)))
      const roots = nodes.filter((n) => indentOf(n.l) === min)
      if (roots.length > 1) {
        const rootAt = roots[0].i
        lines = lines.map((l, i) => (i > rootAt && l.trim() ? `  ${l}` : l))
      }
      // A blank line inside a mindmap is noise
      lines = lines.filter((l, i) => i <= start || l.trim())
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
