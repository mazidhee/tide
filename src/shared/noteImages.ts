/** Pictures in a note, as the tutor sees them: Obsidian embeds (![[shot.png]]) and Markdown images */

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/** The images a note or message embeds, in order and without repeats; web images are left out */
export function imageRefs(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(\s*<?([^)>\s]+(?:\s[^)>"']+)*?)>?(?:\s+["'][^)]*["'])?\s*\)/g)) {
    const raw = (m[1] ?? m[2] ?? '').trim()
    let target = raw
    try {
      target = decodeURIComponent(raw)
    } catch {
      // Keep it as written
    }
    if (!target || /^[a-z]+:/i.test(target) || !IMAGE.test(target) || out.includes(target)) continue
    out.push(target)
  }
  return out
}

/** A vault path as a Markdown image that renders from any note or chat (spaces and all) */
export const imageMarkdown = (path: string) => `![${path.split('/').pop()!.replace(IMAGE, '')}](/${path.split('/').map(encodeURIComponent).join('/')})`
