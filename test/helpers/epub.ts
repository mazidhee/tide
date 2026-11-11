import { makeZip } from './zip'

/**
 * Small EPUBs built in memory for tests: an EPUB 3 with a navigation document, front matter, a
 * part heading, footnotes, endnotes and verse; and an EPUB 2 with only an NCX, wrapped the way
 * Project Gutenberg wraps its texts.
 */

const xhtml = (title: string, body: string, type = '') => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head>
<body${type ? ` epub:type="${type}"` : ''}>${body}</body></html>`

const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`

export interface FixtureChapter {
  file: string
  title: string
  body: string
  type?: string
  linear?: boolean
  /** Left out of the navigation */
  hidden?: boolean
}

export function epub3(chapters: FixtureChapter[], meta: { title: string; author: string; subjects?: string[] }): Buffer {
  const manifest = chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((c, i) => `<itemref idref="c${i}"${c.linear === false ? ' linear="no"' : ''}/>`).join('')
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:1234</dc:identifier><dc:title>${meta.title}</dc:title><dc:creator>${meta.author}</dc:creator><dc:language>en</dc:language>${(meta.subjects ?? []).map((s) => `<dc:subject>${s}</dc:subject>`).join('')}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest>
<spine>${spine}</spine></package>`
  const nav = xhtml('Contents', `<nav epub:type="toc"><ol>${chapters.filter((c) => !c.hidden).map((c) => `<li><a href="${c.file}">${c.title}</a></li>`).join('')}</ol></nav>`)
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    ...chapters.map((c) => ({ name: `OEBPS/${c.file}`, data: xhtml(c.title, c.body, c.type) }))
  ])
}

/** A nested contents (part › chapters) pointing into one file by fragment, EPUB 2 style with an NCX */
export function epub2Nested(): Buffer {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">gutenberg-1</dc:identifier><dc:title>The Small Brothers</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine toc="ncx"><itemref idref="text"/></spine></package>`
  const point = (id: string, label: string, src: string, inner = '') => `<navPoint id="${id}"><navLabel><text>${label}</text></navLabel><content src="${src}"/>${inner}</navPoint>`
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
${point('p1', 'Book One: A Family', 'text.xhtml#book1', point('c1', 'I. The Father', 'text.xhtml#ch1') + point('c2', 'II. The Eldest Son', 'text.xhtml#ch2'))}
${point('p2', 'Book Two: A Meeting', 'text.xhtml#book2', point('c3', 'I. At the Monastery', 'text.xhtml#ch3'))}
</navMap></ncx>`
  const body = `<p>The Project Gutenberg eBook of The Small Brothers</p>
<p>*** START OF THE PROJECT GUTENBERG EBOOK THE SMALL BROTHERS ***</p>
<h2 id="book1">Book One: A Family</h2>
<h3 id="ch1">I. The Father</h3>
<p>Fyodor was a strange man, and the father of three sons.</p>
<p>He lived in the town by the river.</p>
<h3 id="ch2">II. The Eldest Son</h3>
<p>Dmitri, the eldest, grew up apart from his father.</p>
<h2 id="book2">Book Two: A Meeting</h2>
<h3 id="ch3">I. At the Monastery</h3>
<p>They met at last in the elder's cell, where Zosima received them.</p>
<p>*** END OF THE PROJECT GUTENBERG EBOOK THE SMALL BROTHERS ***</p>
<p>Updated editions will replace the previous one.</p>`
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/text.xhtml', data: xhtml('The Small Brothers', body) }
  ])
}

/** A three-chapter treatise-like book with front matter, notes and verse */
export function sampleBook(): Buffer {
  return epub3(
    [
      { file: 'cover.xhtml', title: 'Cover', body: '<p>Cover image</p>', type: 'cover', linear: false },
      { file: 'titlepage.xhtml', title: 'Titlepage', body: '<h1>Meditations</h1><p>Marcus Aurelius</p>', type: 'frontmatter titlepage' },
      { file: 'preface.xhtml', title: 'Translator’s Preface', body: '<h2>Translator’s Preface</h2><p>This translation follows the Greek closely.</p>' },
      {
        file: 'book1.xhtml',
        title: 'Book I',
        body: `<section epub:type="bodymatter chapter"><h2>Book I</h2>
<p>From my grandfather Verus I learned good morals and the government of my temper.<a href="endnotes.xhtml#note-1" epub:type="noteref">1</a></p>
<p>From the reputation and remembrance of my father, modesty and a manly character.</p>
<aside epub:type="footnote" id="fn-a"><p>Verus was consul three times.</p></aside>
</section>`
      },
      {
        file: 'book2.xhtml',
        title: 'Book II',
        body: `<section epub:type="bodymatter chapter"><h2>Book II</h2>
<p>Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant.</p>
<p class="verse"><span>Short is the life,</span><br/><span>and small the corner where we live.</span></p>
<p>* * *</p>
</section>`
      },
      { file: 'book3.xhtml', title: 'Book III', body: '<h2>Book III</h2><p>We ought to consider that life is daily wasting away, as Rusticus taught.</p>' },
      { file: 'endnotes.xhtml', title: 'Endnotes', body: '<section epub:type="backmatter endnotes"><ol><li id="note-1" epub:type="endnote"><p>Annius Verus, his grandfather. <a href="book1.xhtml">↩</a></p></li></ol></section>' },
      { file: 'colophon.xhtml', title: 'Colophon', body: '<p>This ebook was produced by volunteers.</p>', type: 'backmatter colophon' }
    ],
    { title: 'Meditations', author: 'Marcus Aurelius', subjects: ['Philosophy', 'Stoics'] }
  )
}
