/** Small DOM helpers and the labelled controls every simulation shares. */

type Attrs = Record<string, string | number | boolean | null | undefined>
type Child = Node | string | null | undefined | false

function fill(el: Element, attrs: Attrs | null | undefined, children: Child[]): void {
  if (attrs)
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue
      el.setAttribute(key, value === true ? '' : String(value))
    }
  for (const child of children) if (child) el.append(child)
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  fill(el, attrs, children)
  return el
}

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  fill(el, attrs, children)
  return el
}

/** A number for display: fixed decimals, a real minus sign, never "−0.000" */
export function num(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '–' : v > 0 ? '∞' : '−∞'
  const abs = Math.abs(v)
  const text = abs >= 1e5 || (abs > 0 && abs < 0.5 * Math.pow(10, -digits) && digits >= 3) ? abs.toExponential(1).replace('e-', 'e−').replace('e+', 'e') : abs.toFixed(digits)
  return v < 0 && Number(text) !== 0 ? `−${text}` : text
}

export const pair = (x: number, y: number, digits = 3) => `(${num(x, digits)}, ${num(y, digits)})`

export interface Field<T> {
  el: HTMLElement
  set(value: T): void
  input: HTMLElement
}

export function selectField<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): Field<T> {
  const select = h('select', { class: 'sim-select' })
  for (const [v, text] of options) select.append(h('option', { value: v }, text))
  select.value = value
  select.addEventListener('change', () => onChange(select.value as T))
  return { el: h('label', { class: 'sim-field' }, h('span', { class: 'sim-label' }, label), select), set: (v) => (select.value = v), input: select }
}

export interface RangeOptions {
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
}

export function rangeField(label: string, o: RangeOptions, onInput: (v: number) => void): Field<number> & { label(text: string): void; disable(off: boolean): void } {
  const input = h('input', { type: 'range', class: 'sim-range', min: o.min, max: o.max, step: o.step })
  const out = h('output', { class: 'sim-value' })
  const name = h('span', { class: 'sim-label' }, label)
  const show = () => {
    out.textContent = o.format(Number(input.value))
    input.setAttribute('aria-valuetext', out.textContent)
  }
  input.value = String(o.value)
  show()
  input.addEventListener('input', () => {
    show()
    onInput(Number(input.value))
  })
  const el = h('label', { class: 'sim-field sim-field-range' }, name, input, out)
  return {
    el,
    input,
    set: (v) => {
      input.value = String(v)
      show()
    },
    label: (text) => (name.textContent = text),
    disable: (off) => {
      input.disabled = off
      el.classList.toggle('off', off)
    }
  }
}

export function segmented<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): Field<T> {
  const group = h('div', { class: 'sim-seg', role: 'group', 'aria-label': label })
  const buttons = options.map(([v, text]) => {
    const b = h('button', { type: 'button', class: 'sim-seg-btn', 'aria-pressed': v === value ? 'true' : 'false' }, text)
    b.addEventListener('click', () => {
      set(v)
      onChange(v)
    })
    group.append(b)
    return [v, b] as const
  })
  const set = (v: T) => buttons.forEach(([key, b]) => b.setAttribute('aria-pressed', key === v ? 'true' : 'false'))
  return { el: h('div', { class: 'sim-field' }, h('span', { class: 'sim-label' }, label), group), set, input: group }
}

export function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `sim-btn ${cls}`.trim() }, text)
  b.addEventListener('click', onClick)
  return b
}

/** Sizes a canvas's backing store to its laid-out size and returns a context scaled to CSS pixels */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } | null {
  const w = canvas.clientWidth
  const hgt = canvas.clientHeight
  if (!w || !hgt) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(hgt * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h: hgt, dpr }
}

/** A stat: a quiet label over a tabular number */
export function stat(label: string): { el: HTMLElement; set(text: string): void } {
  const value = h('span', { class: 'sim-stat-value' }, '–')
  return {
    el: h('div', { class: 'sim-stat' }, h('span', { class: 'sim-stat-label' }, label), value),
    set: (text) => {
      if (value.textContent !== text) value.textContent = text
    }
  }
}

/** Marks one element as the part a tour step is pointing at */
export function ring(el: Element | null | undefined, on: boolean): void {
  el?.classList.toggle('sim-hl', on)
}
