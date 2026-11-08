import type { ReactNode } from 'react'
import type { FormatKind } from '@shared/markdownFormat'
import { Icon } from './Icon'

const GROUPS: { kind: FormatKind; label: ReactNode; title: string; className?: string }[][] = [
  [
    { kind: 'h1', label: 'H1', title: 'Heading 1' },
    { kind: 'h2', label: 'H2', title: 'Heading 2' },
    { kind: 'h3', label: 'H3', title: 'Heading 3' }
  ],
  [
    { kind: 'bold', label: 'B', title: 'Bold (⌘B)', className: 'fmt-bold' },
    { kind: 'italic', label: 'I', title: 'Italic (⌘I)', className: 'fmt-italic' },
    { kind: 'strike', label: 'S', title: 'Strikethrough (⌘⇧X)', className: 'fmt-strike' },
    { kind: 'code', label: '</>', title: 'Code', className: 'fmt-mono' },
    { kind: 'math', label: '∑', title: 'Maths ($…$)' }
  ],
  [
    { kind: 'bullet', label: '•', title: 'Bullet list' },
    { kind: 'numbered', label: '1.', title: 'Numbered list' },
    { kind: 'task', label: '☐', title: 'Checklist' },
    { kind: 'quote', label: '“', title: 'Quote' }
  ],
  [
    { kind: 'link', label: <Icon name="link" size={14} />, title: 'Link (⌘K)' },
    { kind: 'divider', label: '—', title: 'Divider' }
  ]
]

/**
 * The writing tools while you edit a note: formatting on the left (each one toggles, and works on
 * the selection or the lines it touches), the writing coach on the right.
 */
export function FormatBar({ onFormat, coach, onCoach, onTest, testing }: { onFormat(kind: FormatKind): void; coach: boolean; onCoach(): void; onTest(): void; testing: boolean }) {
  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <div className="format-groups">
        {GROUPS.map((group, i) => (
          <div key={i} className="format-group">
            {group.map((b) => (
              <button
                key={b.kind}
                type="button"
                className={`fmt-btn${b.className ? ` ${b.className}` : ''}`}
                title={b.title}
                aria-label={b.title}
                // Keep the editor's selection: act on mousedown, before focus moves
                onMouseDown={(e) => {
                  e.preventDefault()
                  onFormat(b.kind)
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="format-aside">
        <button type="button" className="fmt-text" onMouseDown={(e) => e.preventDefault()} onClick={onTest} disabled={testing} title="One question on the paragraph you’re writing (⌘⇧T)">
          {testing ? 'Thinking…' : 'Test me'}
        </button>
        <button type="button" className={`fmt-text coach${coach ? ' on' : ''}`} aria-pressed={coach} onClick={onCoach} title={coach ? 'The coach checks each paragraph after you pause. Click to turn off.' : 'Coach my writing as I write'}>
          <span className="coach-dot" aria-hidden="true" />
          Coach
        </button>
      </div>
    </div>
  )
}
