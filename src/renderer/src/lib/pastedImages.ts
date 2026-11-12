/** Where pictures you paste into Tide's chat are kept, folded away under "Tide's files" */
export const CHAT_IMAGES = 'Chat images'

const HEIC = (f: File) => /^image\/hei[cf]$/.test(f.type) || /\.hei[cf]$/i.test(f.name)

/** The pictures among pasted or dropped files: PNG, JPEG, WebP, and an iPhone's HEIC */
export const pastedImageFiles = (files: FileList | File[] | null | undefined) => [...(files ?? [])].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type) || HEIC(f))

const readDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

/** A picture file as a data: URL the page can show: a HEIC is turned into a JPEG first (the main process does it) */
export async function readImageFile(file: File): Promise<string> {
  const url = await readDataUrl(file)
  if (!HEIC(file)) return url
  const jpeg = await window.tide.vault.prepareImage(url)
  if (!jpeg) throw new Error('That photo couldn’t be read')
  return jpeg
}

/**
 * Saves a pasted or dropped picture into a vault folder, named like Obsidian's ("Pasted image
 * 20261109143002.png"), and returns the embed that shows it: by name, so Obsidian shows it too.
 */
export async function savePastedImage(folder: string, file: File): Promise<string> {
  const dataUrl = await readImageFile(file)
  const type = /^data:(image\/\w+)/.exec(dataUrl)?.[1] ?? file.type
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
  const d = new Date()
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('')
  const base = file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.\w+$/, '') : 'Pasted image'
  const name = `${base} ${stamp}${Math.random().toString(36).slice(2, 4)}.${ext}`
  await window.tide.vault.writeImage(`${folder}/${name}`, dataUrl)
  return `![[${name}]]`
}
