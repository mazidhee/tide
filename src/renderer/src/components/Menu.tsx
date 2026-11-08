import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
  separatorBefore?: boolean
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) })
    ref.current.querySelector<HTMLButtonElement>('button')?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {menu.items.map((item) => (
        <div key={item.label}>
          {item.separatorBefore && <div className="menu-sep" />}
          <button
            role="menuitem"
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
