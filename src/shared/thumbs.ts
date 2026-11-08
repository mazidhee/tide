/** Where a library item's cover is cached, inside the vault's private .tide folder */
export function thumbPath(rel: string): string {
  let h = 2166136261
  for (let i = 0; i < rel.length; i++) h = Math.imul(h ^ rel.charCodeAt(i), 16777619)
  return `.tide/thumbs/${(h >>> 0).toString(36)}.jpg`
}
