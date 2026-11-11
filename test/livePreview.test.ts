import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { tideMarkdown, frontmatterEnd, mathBlockEnd } from '../src/renderer/src/lib/livePreview/syntax'
import { activeLinesKey, buildDecorations, wikilinkLabel } from '../src/renderer/src/lib/livePreview/decorations'
import { cellOffset, type LivePreviewEnv } from '../src/renderer/src/lib/livePreview/widgets'

const env: LivePreviewEnv = {
  imageUrl: (t) => `vault://file/${t}`,
  renderMath: (s) => `<katex>${s}</katex>`,
  renderTable: () => '<table></table>',
  openLink: () => {}
}

/** A state for `doc`, with the cursor where `‸` is (or at the very end when there is none) */
function stateFor(doc: string) {
  const at = doc.indexOf('‸')
  const text = at < 0 ? doc : doc.slice(0, at) + doc.slice(at + 1)
  const state = EditorState.create({
    doc: text,
    selection: { anchor: at < 0 ? text.length : at },
    extensions: [markdown({ base: markdownLanguage, extensions: tideMarkdown })]
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

/** The parser's node names, in order */
function nodes(doc: string) {
  const state = stateFor(doc)
  const names: string[] = []
  syntaxTree(state).iterate({ enter: (n) => void names.push(n.name) })
  return names
}

/** What the live preview does to `doc`: hidden text, widgets and classes, as readable strings */
function preview(doc: string) {
  const state = stateFor(doc)
  const set = buildDecorations(state, [{ from: 0, to: state.doc.length }], env)
  const out: string[] = []
  set.between(0, state.doc.length, (from, to, d) => {
    const spec = d.spec as { widget?: object; class?: string; attributes?: Record<string, string> }
    const text = state.doc.sliceString(from, to)
    if (spec.widget) out.push(`${spec.widget.constructor.name}(${JSON.stringify(text)})`)
    else if (spec.class === 'cm-lp-hide') out.push(`hide(${JSON.stringify(text)})`)
    else if (from === to && spec.class) out.push(`line ${state.doc.lineAt(from).number}: ${spec.class}`)
    else if (spec.class) out.push(`${spec.class}(${JSON.stringify(text)})`)
    else out.push(`hide(${JSON.stringify(text)})`)
  })
  return out
}

describe('the editor parses what Tide renders', () => {
  it('reads wiki links, embeds, maths, highlights and tags', () => {
    expect(nodes('See [[Graphs#BFS|breadth first]] and ![[fig.png]]')).toEqual(expect.arrayContaining(['Wikilink', 'WikilinkTarget', 'WikilinkAlias', 'WikiEmbed']))
    expect(nodes('Euler: $e^{i\\pi} + 1 = 0$')).toContain('InlineMath')
    expect(nodes('$$\n\\int_0^1 x\\,dx\n$$\n')).toContain('MathBlock')
    expect(nodes('a ==key== idea #physics')).toEqual(expect.arrayContaining(['Highlight', 'HighlightMark', 'Hashtag']))
  })

  it('follows the reading view on what is not maths', () => {
    expect(nodes('costs $5 and $6')).not.toContain('InlineMath')
    expect(nodes('from $1 to $2a')).not.toContain('InlineMath')
    // An unclosed $$ is not a display block
    expect(nodes('$$\nx + y\n')).not.toContain('MathBlock')
    // Underscores inside maths are not emphasis
    expect(nodes('$a_1 + b_1$')).not.toContain('Emphasis')
  })

  it('reads frontmatter at the top of the note, not as a heading and rule', () => {
    const names = nodes('---\ntitle: Graphs\nlearning_status: learning\n---\n# Graphs\n')
    expect(names).toContain('Frontmatter')
    expect(names).not.toContain('SetextHeading2')
    expect(names).not.toContain('HorizontalRule')
    expect(nodes('text\n\n---\n\nmore')).toContain('HorizontalRule')
  })

  it('finds where frontmatter and display maths end', () => {
    expect(frontmatterEnd('---\na: 1\n---\nbody')).toBe(12)
    expect(frontmatterEnd('---\na: 1\nbody')).toBe(-1)
    expect(mathBlockEnd('$$x^2$$\nmore')).toEqual({ end: 7, closeFrom: 5 })
    expect(mathBlockEnd('$$\nx\n$$\nmore')).toEqual({ end: 7, closeFrom: 5 })
    expect(mathBlockEnd('$$\nx\n')).toBeNull()
  })
})

describe('live preview', () => {
  it('hides heading marks away from the cursor and shows them on its line', () => {
    expect(preview('## Graphs\n\ntext‸')).toEqual(['line 1: cm-lp-heading cm-lp-h2', 'hide("## ")'])
    expect(preview('## Gra‸phs\n\ntext')).toEqual(['line 1: cm-lp-heading cm-lp-h2'])
  })

  it('hides bold, italic, strikethrough and code delimiters on other lines only', () => {
    const away = preview('**bold** *it* ~~old~~ `code`\n‸')
    expect(away.filter((d) => d.startsWith('hide'))).toEqual(['hide("**")', 'hide("**")', 'hide("*")', 'hide("*")', 'hide("~~")', 'hide("~~")', 'hide("`")', 'hide("`")'])
    expect(away).toContain('cm-lp-code("code")')
    expect(preview('**bo‸ld** *it*').filter((d) => d.startsWith('hide'))).toEqual([])
  })

  it('draws links as their text and keeps the href for the click', () => {
    expect(preview('[Dijkstra](https://en.wikipedia.org/wiki/Dijkstra)\n‸')).toEqual(['hide("[")', 'cm-lp-link("Dijkstra")', 'hide("](https://en.wikipedia.org/wiki/Dijkstra)")'])
  })

  it('draws wiki links by the reading view’s label, and image embeds as pictures', () => {
    expect(preview('[[Maths/Graphs#BFS]]\n‸')).toEqual(['hide("[[Maths/")', 'cm-lp-wikilink("Graphs")', 'hide("#BFS]]")'])
    expect(preview('[[Graphs|the graph notes]]\n‸')).toEqual(['hide("[[Graphs|")', 'cm-lp-wikilink("the graph notes")', 'hide("]]")'])
    expect(wikilinkLabel('Maths/Graphs#BFS')).toBe('Graphs')
    expect(preview('![[diagram.png|300]]\n‸')).toEqual(['line 1: cm-lp-block-line', 'ImageWidget("![[diagram.png|300]]")'])
    expect(preview('[[Gra‸phs]]')).toEqual([])
  })

  it('turns tasks into checkboxes and bullets into dots, except on the cursor line', () => {
    const away = preview('- [ ] read\n- [x] write\n- plain\n‸')
    expect(away).toEqual(expect.arrayContaining(['CheckboxWidget("- [ ]")', 'CheckboxWidget("- [x]")', 'cm-lp-task-done("write")', 'BulletWidget("-")']))
    expect(preview('- [ ] re‸ad').some((d) => d.startsWith('CheckboxWidget'))).toBe(false)
  })

  it('typesets maths away from the cursor and shows a preview under display maths being edited', () => {
    expect(preview('Euler $e^{i\\pi}=-1$ here\n‸')).toEqual(['MathWidget("$e^{i\\\\pi}=-1$")'])
    const block = preview('$$\n\\sum_i x_i\n$$\n\n‸')
    expect(block).toEqual(['line 1: cm-lp-block-line', 'MathWidget("$$")', 'line 2: cm-lp-hidden', 'line 3: cm-lp-hidden'])
    const editing = preview('$$\n\\sum_i x_i‸\n$$\n')
    expect(editing).toContain('MathWidget("")')
    expect(editing).toContain('line 2: cm-lp-math-source-line')
  })

  it('draws a table in place of its pipes until the cursor is in it', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n\n‸'
    expect(preview(doc)).toEqual(['line 1: cm-lp-block-line', 'TableWidget("| a | b |")', 'line 2: cm-lp-hidden', 'line 3: cm-lp-hidden'])
    expect(preview('| a | b |\n| - | - |\n| 1 | ‸2 |\n')).toEqual(['line 1: cm-lp-table-source', 'line 2: cm-lp-table-source', 'line 3: cm-lp-table-source'])
  })

  it('keeps fenced code as a block with its fences folded away from the cursor', () => {
    const away = preview('```python\nprint(1)\n```\n\n‸')
    expect(away).toEqual(['line 1: cm-lp-fence cm-lp-fence-open', 'LabelWidget("```python")', 'line 2: cm-lp-fence', 'line 3: cm-lp-fence cm-lp-fence-close', 'hide("```")'])
    const near = preview('```python\nprint(1)‸\n```\n')
    expect(near.some((d) => d.startsWith('LabelWidget') || d.startsWith('hide'))).toBe(false)
  })

  it('draws quotes, callouts and rules', () => {
    expect(preview('> quoted\n\n‸')).toEqual(['line 1: cm-lp-quote', 'hide("> ")'])
    expect(preview('> [!tip] Remember\n> body\n\n‸')).toEqual(expect.arrayContaining(['line 1: cm-lp-callout-title', 'hide("[!tip] ")']))
    expect(preview('a\n\n---\n\n‸')).toEqual(expect.arrayContaining(['line 3: cm-lp-hr', 'hide("---")']))
  })

  it('leaves frontmatter alone apart from quietening it', () => {
    expect(preview('---\ntitle: x\n---\n\n‸')).toEqual(['line 1: cm-lp-frontmatter', 'line 2: cm-lp-frontmatter', 'line 3: cm-lp-frontmatter'])
  })

  it('rebuilds only when the cursor changes line', () => {
    const s = stateFor('one\ntwo‸\nthree')
    const moved = s.update({ selection: { anchor: 5 } }).state
    expect(activeLinesKey(moved)).toBe(activeLinesKey(s))
    expect(activeLinesKey(s.update({ selection: { anchor: 0 } }).state)).not.toBe(activeLinesKey(s))
  })
})

describe('clicking a drawn table cell', () => {
  const table = '| Name | Big O |\n| --- | --- |\n| BFS | O(V+E) |'
  it('puts the cursor at the start of that cell in the source', () => {
    expect(table.slice(cellOffset(table, 0, 1))).toMatch(/^Big O/)
    expect(table.slice(cellOffset(table, 1, 0))).toMatch(/^BFS/)
    expect(table.slice(cellOffset(table, 1, 1))).toMatch(/^O\(V\+E\)/)
  })
})
