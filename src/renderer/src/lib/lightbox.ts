/**
 * Click a picture or diagram in a note, a lesson or a chat to see it large; click anywhere or press
 * Escape to put it back. One listener for the whole app, like the mermaid renderer.
 */
export function startLightbox() {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('a, button, .lightbox')) return
    const el = target.closest<HTMLElement>('.prose img, .web-figure img, .mermaid-diagram')
    if (!el || !el.closest('.prose, .msg, .s-turn, .conversation')) return
    open(el)
  })
}

function open(el: HTMLElement) {
  const box = document.createElement('div')
  box.className = 'lightbox'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Picture')
  const inner = el.cloneNode(true) as HTMLElement
  inner.classList.add('lightbox-item')
  inner.removeAttribute('loading')
  box.appendChild(inner)
  const cap = el.closest('.web-figure')?.querySelector('.web-figure-cap')
  if (cap) box.appendChild(cap.cloneNode(true))
  const close = () => {
    box.classList.add('closing')
    window.removeEventListener('keydown', onKey, true)
    setTimeout(() => box.remove(), 160)
  }
  const onKey = (k: KeyboardEvent) => {
    if (k.key === 'Escape') {
      k.stopPropagation()
      close()
    }
  }
  box.addEventListener('click', close)
  window.addEventListener('keydown', onKey, true)
  document.body.appendChild(box)
}
