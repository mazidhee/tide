// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { pageKey, typingIn } from '../src/renderer/src/lib/typing'

/**
 * Page-wide keys (the warm-up's Space, a card's 1 2 3, ⌘[ back) never fire while you type: Space
 * in the Rust lesson's warm-up box, the notes editor or a code editor stays a space.
 */
// Asked while the event is going through, as a handler does (its path is gone afterwards)
const press = (el: Element, key: string, mods: Partial<KeyboardEventInit> = {}) => {
  const out = { page: false, typing: false }
  const grab = (e: Event) => Object.assign(out, { page: pageKey(e as KeyboardEvent), typing: typingIn(e) })
  window.addEventListener('keydown', grab)
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...mods }))
  window.removeEventListener('keydown', grab)
  return out
}

describe('pageKey', () => {
  it('leaves Space to a textarea, an input, a contenteditable and a CodeMirror editor', () => {
    document.body.innerHTML = `<textarea id=a></textarea><input id=b><div contenteditable="true" id=c><p id=c2>x</p></div><div class="cm-editor"><div class="cm-content" id=d></div></div><div role="textbox" id=e></div>`
    for (const id of ['a', 'b', 'c2', 'd', 'e']) expect(press(document.getElementById(id)!, ' ').page).toBe(false)
  })

  it('sees a field inside a shadow root, where the target is retargeted to the host', () => {
    document.body.innerHTML = '<div id=host></div>'
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<textarea></textarea>'
    const e = press(root.querySelector('textarea')!, ' ')
    expect(e.typing).toBe(true)
  })

  it('leaves Space and Return to a focused button, but takes digits there', () => {
    document.body.innerHTML = '<button id=b>Go</button>'
    const b = document.getElementById('b')!
    expect(press(b, ' ').page).toBe(false)
    expect(press(b, 'Enter').page).toBe(false)
    expect(press(b, '1').page).toBe(true)
  })

  it('takes a plain key on the page, and never one with ⌘', () => {
    document.body.innerHTML = '<main id=m></main>'
    expect(press(document.getElementById('m')!, ' ').page).toBe(true)
    expect(press(document.getElementById('m')!, ' ', { metaKey: true }).page).toBe(false)
  })
})
