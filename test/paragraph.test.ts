import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { paragraphAt } from '../src/renderer/src/components/Editor'

const at = (doc: string, marker: string) => {
  const pos = doc.indexOf(marker)
  return paragraphAt(EditorState.create({ doc: doc.replace(marker, ''), selection: { anchor: pos } }))
}

describe('the paragraph the coach reads', () => {
  it('stops at headings written right above or below the text', () => {
    const doc = '# TCP\n\n## Handshake\nTCP opens with SYN, SYN-ACK, ACK.\n## Closing\nEither side sends FIN.|\n'
    expect(at(doc, '|')).toEqual({ text: 'Either side sends FIN.', line: 5 })
  })
  it('reads a bullet list as one block and returns nothing on a heading', () => {
    expect(at('## Lists\n- one\n- two|\n', '|')?.text).toBe('- one\n- two')
    expect(at('## Lis|ts\n\ntext\n', '|')).toBeNull()
  })
})
