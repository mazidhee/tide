import { describe, expect, it } from 'vitest'
import { appendLabCards, labCommands } from '../src/shared/labCards'

describe('lab commands to flashcards', () => {
  it('finds the commands run at a prompt, skipping trivial ones and repeats', () => {
    const t = [
      'root@lab:~# ls',
      'notes.txt',
      'root@lab:~# grep -n error /var/log/app.log',
      '3: error: disk full',
      'root@lab:/tmp# chmod 640 secret.txt',
      'root@lab:~# grep -n error /var/log/app.log',
      'root@lab:~# clear',
      'root@lab:~# ',
      'some output with a # in it'
    ].join('\n')
    expect(labCommands(t)).toEqual(['grep -n error /var/log/app.log', 'chmod 640 secret.txt'])
  })

  it('starts a flashcard note and skips cards already in it', () => {
    const first = appendLabCards('', [{ front: 'Show line numbers of matches for "error" in app.log', back: '`grep -n error app.log`' }], 'Permissions, 7 Nov')
    expect(first.added).toBe(1)
    expect(first.text).toContain('tags: [flashcards]')
    expect(first.text).toContain('Show line numbers of matches for "error" in app.log::`grep -n error app.log`')
    const second = appendLabCards(
      first.text,
      [
        { front: 'Find "error" with line numbers', back: '`grep -n error app.log`: -n prints line numbers' },
        { front: 'Let only the owner and group read a file', back: '`chmod 640 file`' }
      ],
      'Permissions, 8 Nov'
    )
    expect(second.added).toBe(1)
    expect(second.text.match(/::/g)?.length).toBe(2)
    expect(second.text).toContain('## Permissions, 8 Nov')
  })
})
