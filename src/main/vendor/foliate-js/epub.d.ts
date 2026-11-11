// Types for the parts of the vendored EPUB reader Tide uses (written for Tide; not part of the original)
export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[] | null
}
export interface Section {
  id: string
  linear?: string | null
  resolveHref?(href: string): string
  createDocument(): Promise<Document>
}
type LangMap = string | Record<string, string>
export interface Contributor {
  name: LangMap
}
export class EPUB {
  constructor(loader: { loadText(name: string): Promise<string | null> | string | null; loadBlob(name: string): Promise<Blob> | Blob; getSize(name: string): number; sha1?: (s: string) => Promise<Uint8Array> })
  init(): Promise<EPUB>
  sections: Section[]
  toc?: TocItem[] | null
  landmarks?: { type: string[]; href: string; label: string }[] | null
  metadata: { title?: LangMap; language?: string[]; author?: Contributor[]; subject?: Contributor[] }
  resolveHref(href: string): { index: number; anchor: unknown } | null
  splitTOCHref(href: string): string[]
}
