import { useState } from 'react'
import type { NotebookMeta } from '@shared/types'
import { vaultUrl } from '../lib/markdown'
import { useApp } from '../state'
import { Icon } from './Icon'
import { ContextMenu, type MenuState } from './Menu'

/** Muted cloth-like cover colors, picked by name so a notebook always looks the same */
export const COVER_COLORS = ['#2f5d50', '#3b4a6b', '#6b3b3b', '#5a4a2f', '#41355e', '#2e4f63', '#5e3a52', '#3f5a2f', '#2b2b2b', '#7a5530']
export const COVER_NAMES = ['Pine', 'Indigo', 'Oxblood', 'Ochre', 'Plum', 'Lake', 'Mulberry', 'Moss', 'Charcoal', 'Rust']

function hashOf(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const coverColor = (nb: Pick<NotebookMeta, 'name' | 'color'>) =>
  nb.color ?? COVER_COLORS[hashOf(nb.name) % COVER_COLORS.length]

/** Tide lines: a few wave strokes whose shape is derived from the notebook name */
function waves(name: string) {
  const h = hashOf(name)
  const count = 5 + (h % 4)
  const amp = 6 + ((h >>> 4) % 10)
  const freq = 1 + ((h >>> 8) % 3)
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    const y = 150 + i * (90 / count)
    const phase = ((h >>> (i + 3)) % 100) / 15
    let d = `M -10 ${y.toFixed(1)}`
    for (let x = 0; x <= 220; x += 10) {
      d += ` L ${x} ${(y + Math.sin((x / 200) * Math.PI * 2 * freq + phase) * amp * (1 - i / (count * 1.6))).toFixed(1)}`
    }
    paths.push(d)
  }
  return paths
}

export function NotebookCover({
  notebook,
  size = 'md',
  onClick
}: {
  notebook: NotebookMeta
  size?: 'sm' | 'md'
  onClick?: () => void
}) {
  const color = coverColor(notebook)
  const total = notebook.noteCount
  const progress = total ? (notebook.mastered + notebook.learning * 0.5) / total : 0
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`nb-cover ${size}`} onClick={onClick} style={{ ['--cover' as string]: color }} aria-label={`Open ${notebook.name}`}>
      {notebook.cover ? (
        <img className="nb-cover-image" src={vaultUrl(notebook.cover)} alt="" />
      ) : (
        <svg className="nb-cover-art" viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {waves(notebook.name).map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.4} />
          ))}
        </svg>
      )}
      <span className="nb-spine" />
      <span className="nb-cover-text">
        <span className="nb-cover-title">{notebook.name}</span>
        <span className="nb-cover-meta">
          {total} note{total === 1 ? '' : 's'}
        </span>
      </span>
      {total > 0 && (
        <span className="nb-cover-progress" title={`${Math.round(progress * 100)}% learned`}>
          <span style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </Tag>
  )
}

/**
 * A notebook cover you can change: drop an image on it, use the button that shows on hover,
 * or right-click for colours. Opening (onClick) still works as before.
 */
export function EditableCover({ notebook, size = 'md', onClick, onChanged }: { notebook: NotebookMeta; size?: 'sm' | 'md'; onClick?: () => void; onChanged(): void }) {
  const app = useApp()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [over, setOver] = useState(false)
  const fail = (e: unknown) => app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })

  const choose = async () => {
    try {
      if (await window.tide.learn.chooseCover(notebook.path)) onChanged()
    } catch (e) {
      fail(e)
    }
  }

  const open = (x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: 'Choose cover image…', run: choose },
        ...(notebook.cover
          ? [
              {
                label: 'Remove cover image',
                run: async () => {
                  await window.tide.learn.clearCover(notebook.path).catch(fail)
                  onChanged()
                }
              }
            ]
          : []),
        ...COVER_COLORS.map((color, i) => ({
          label: `${COVER_NAMES[i]} cover`,
          separatorBefore: i === 0,
          run: async () => {
            await window.tide.learn.updateNotebook(notebook.path, { color }).catch(fail)
            onChanged()
          }
        }))
      ]
    })

  return (
    <div
      className={`nb-cover-wrap ${size}${over ? ' drop' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        open(e.clientX, e.clientY)
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
        if (!file) return
        // Keep the window's own drop handler from importing the image into the library
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const path = window.tideEvents.pathForFile(file)
        if (!path) return
        try {
          await window.tide.learn.setCoverFile(notebook.path, path)
          onChanged()
        } catch (err) {
          fail(err)
        }
      }}
    >
      <NotebookCover notebook={notebook} size={size} onClick={onClick ?? choose} />
      <button
        className="nb-cover-edit"
        title="Change cover"
        aria-label={`Change the cover of ${notebook.name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          open(r.left, r.bottom + 4)
        }}
      >
        <Icon name="image" size={14} />
      </button>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
