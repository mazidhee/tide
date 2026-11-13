// @vitest-environment jsdom
/**
 * "Cleaned: N items hidden · Show original" (components/CleanedNote): the page reads cleaned, the
 * toggle brings the original back with each hidden part marked, and the tutor's view of the page
 * (lib/onScreen sectionIn) reads the lesson, not the noise, even while the original is shown.
 */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { cleanPage, type PageCleaning } from '../src/shared/pageClean'
import { catalogueCourse } from '../src/shared/courseCatalogue'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { sectionIn } from '../src/renderer/src/lib/onScreen'
import { CleanedNote, originalHtml, useShowOriginal } from '../src/renderer/src/components/CleanedNote'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const env = { notePath: '', filesByName: new Map<string, string>() }
const render = (md: string) => renderMarkdown(md, env)
const page = cleanPage(readFileSync(join(__dirname, 'fixtures', 'pageClean', 'zoomcamp-readme.md'), 'utf8'), { repo: 'Example/example-zoomcamp', rules: catalogueCourse('ml-zoomcamp')!.clean })

/** A reader as the course room and the link viewer have it: the note over the article */
function Reader({ markdown, cleaning }: { markdown: string; cleaning: PageCleaning | null }) {
  const [original, toggle] = useShowOriginal(markdown)
  const html = original && cleaning ? originalHtml(cleaning, render) : render(markdown)
  return createElement('div', null, createElement(CleanedNote, { cleaning, original, onToggle: toggle }), createElement('article', { className: 'prose', dangerouslySetInnerHTML: { __html: html } }))
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const button = () => container.querySelector<HTMLButtonElement>('.page-cleaned button')!

describe('the cleaned page and its original', () => {
  it('says how much was hidden, and shows the lesson without it', () => {
    act(() => root.render(createElement(Reader, { markdown: page.markdown, cleaning: page.cleaning })))
    const note = container.querySelector('.page-cleaned')!
    expect(note.textContent).toMatch(new RegExp(`^Cleaned: ${page.cleaning!.hidden.length} items hidden·Show original$`))
    expect(note.getAttribute('title')).toMatch(/^Hidden: .*badge/)
    expect(container.querySelector('article')!.textContent).not.toContain('Learner Stories')
    expect(container.querySelector('[data-tide-noise]')).toBeNull()
  })

  it('shows the original with each hidden part marked, and hides it again', () => {
    act(() => root.render(createElement(Reader, { markdown: page.markdown, cleaning: page.cleaning })))
    act(() => button().click())
    expect(button().textContent).toBe('Hide them again')
    expect(button().getAttribute('aria-pressed')).toBe('true')
    const marked = [...container.querySelectorAll<HTMLElement>('[data-tide-noise]')]
    expect(marked.length).toBeGreaterThan(3)
    expect(marked.some((m) => m.textContent!.includes('Learner Stories'))).toBe(true)
    expect(marked.find((m) => m.textContent!.includes('Learner Stories'))!.dataset.noiseLabel).toBe('Hidden: Promotion')
    // The lesson is there too, unmarked
    expect(container.querySelector('article')!.textContent).toContain('About the Course')
    act(() => button().click())
    expect(container.querySelector('[data-tide-noise]')).toBeNull()
    expect(button().textContent).toBe('Show original')
  })

  it('says nothing over a page that had nothing to hide', () => {
    act(() => root.render(createElement(Reader, { markdown: '# A lesson\n\nJust the lesson.\n', cleaning: null })))
    expect(container.querySelector('.page-cleaned')).toBeNull()
  })

  it('goes back to the cleaned page when another page opens', () => {
    function Two() {
      const [which, setWhich] = useState(0)
      return createElement('div', null, createElement('button', { id: 'next', onClick: () => setWhich(1) }), createElement(Reader, { markdown: which ? `${page.markdown}\n\nMore.` : page.markdown, cleaning: page.cleaning }))
    }
    act(() => root.render(createElement(Two)))
    act(() => button().click())
    expect(container.querySelector('[data-tide-noise]')).not.toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('#next')!.click())
    expect(container.querySelector('[data-tide-noise]')).toBeNull()
  })
})

describe('what the tutor sees of the page', () => {
  it('passes over the hidden parts even while the original is shown', () => {
    const el = document.createElement('article')
    el.innerHTML = originalHtml(page.cleaning!, render)
    // jsdom lays nothing out: every heading is "above" the line, so the last one that isn't noise is in view
    const seen = sectionIn(el, 1000)!
    expect(seen.section).toBe('Is the course free?')
    expect(seen.excerpt).toBe('Yes. The videos, materials and homework are free.')
    expect(seen.excerpt).not.toMatch(/Website|Newsletter|LinkedIn/)
    // And reading from the top, the text under the first heading has no banner or link bar in it
    const first = sectionIn(el, -1)!
    expect(first.excerpt).not.toContain('Course Slack Channel')
    expect(first.excerpt).not.toContain('Register')
  })
})
