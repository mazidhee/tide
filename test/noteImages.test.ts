import { describe, expect, it } from 'vitest'
import { imageMarkdown, imageRefs } from '../src/shared/noteImages'

describe('imageRefs', () => {
  it('finds Obsidian embeds and Markdown images, in order, once each', () => {
    const md = 'Intro ![[Pasted image 2026.png]]\n![Figure 2](attachments/fig%202.jpg "caption")\n![[note.md]] ![[Pasted image 2026.png|300]]\n![web](https://x.org/a.png)\n![](<my shot.webp>)'
    expect(imageRefs(md)).toEqual(['Pasted image 2026.png', 'attachments/fig 2.jpg', 'my shot.webp'])
  })

  it('ignores notes, PDFs and links', () => {
    expect(imageRefs('![[Chapter 1]] ![[book.pdf]] [a](b.png)')).toEqual([])
  })
})

describe('imageMarkdown', () => {
  it('writes a vault path that renders from anywhere, spaces and all', () => {
    expect(imageMarkdown('Maths/attachments/Pasted image 1.png')).toBe('![Pasted image 1](/Maths/attachments/Pasted%20image%201.png)')
  })
})
