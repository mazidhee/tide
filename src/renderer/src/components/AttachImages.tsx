import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { imageMarkdown } from '@shared/noteImages'
import { CHAT_IMAGES, pastedImageFiles, savePastedImage } from '../lib/pastedImages'
import { vaultUrl } from '../lib/markdown'
import { Icon } from './Icon'

/** Pictures one message may carry (main/imagePrep sends this many) */
export const MAX_ATTACHED = 4

/**
 * Pictures added to an answer or a question before it is sent: a photo of handwritten working, a
 * screenshot of an error. Pasted, dropped or picked; saved to the vault's chat images folder and
 * sent as Markdown images, which the tutor (Claude, or Gemma when Claude can't) sees.
 */
export function useAttachedImages(folder = CHAT_IMAGES) {
  const [paths, setPaths] = useState<string[]>([])
  const [adding, setAdding] = useState(0)
  const [error, setError] = useState('')
  const add = (files: File[]) => {
    const pics = pastedImageFiles(files)
    if (!pics.length) return false
    setError('')
    for (const f of pics) {
      setAdding((n) => n + 1)
      savePastedImage(folder, f)
        .then((embed) => {
          const name = /^!\[\[(.+)\]\]$/.exec(embed)?.[1]
          if (name) setPaths((p) => (p.length >= MAX_ATTACHED ? p : [...p, `${folder}/${name}`]))
        })
        .catch((e) => setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
        .finally(() => setAdding((n) => n - 1))
    }
    return true
  }
  return {
    paths,
    adding: adding > 0,
    error,
    full: paths.length >= MAX_ATTACHED,
    add,
    remove: (path: string) => setPaths((p) => p.filter((x) => x !== path)),
    clear: () => (setPaths([]), setError('')),
    /** The message with its pictures after it, as Markdown images that resolve from anywhere */
    withPictures: (text: string) => (paths.length ? `${text}${text ? '\n\n' : ''}${paths.map(imageMarkdown).join('\n')}` : text),
    /** For the text box: a picture pasted or dropped in is added, not pasted as text */
    handlers: {
      onPaste: (e: ClipboardEvent) => add([...e.clipboardData.files]) && e.preventDefault(),
      onDragOver: (e: DragEvent) => e.dataTransfer.types.includes('Files') && e.preventDefault(),
      onDrop: (e: DragEvent) => add([...e.dataTransfer.files]) && e.preventDefault()
    }
  }
}

export type AttachedImages = ReturnType<typeof useAttachedImages>

/** The picture button: picks photos or screenshots from the Mac */
export function AttachImageButton({ images, label }: { images: AttachedImages; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="tool-btn" disabled={images.full} title={images.full ? `Up to ${MAX_ATTACHED} pictures a message` : 'Add a photo of your working or a screenshot (or paste or drop one in)'} onClick={() => input.current?.click()}>
        <Icon name="image" size={14} />
        {label && <span>{label}</span>}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) images.add([...e.target.files])
          e.target.value = ''
        }}
      />
    </>
  )
}

/** The pictures waiting to go with the message, each removable */
export function AttachedStrip({ images }: { images: AttachedImages }) {
  if (!images.paths.length && !images.adding && !images.error) return null
  return (
    <div className="attached-strip" aria-label="Pictures to send">
      {images.paths.map((p) => (
        <div key={p} className="attached-pic">
          <img src={vaultUrl(p)} alt={`Attached: ${p.split('/').pop()}`} />
          <button type="button" className="icon-btn small" title="Remove picture" onClick={() => images.remove(p)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      {images.adding && <div className="attached-pic loading" aria-busy="true" />}
      {images.error && <span className="muted small">{images.error}</span>}
    </div>
  )
}
