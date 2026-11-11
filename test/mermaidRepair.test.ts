import { describe, expect, it } from 'vitest'
import { repairMermaid } from '../src/shared/mermaidRepair'

describe('repairMermaid', () => {
  it('mends a mindmap opened twice with two roots (as Gemma wrote it live)', () => {
    const code = 'mindmap\n\n```mermaid\nmindmap\n  root_title[Variable Naming Rules]\n  Rules[Rules]\n    No_Spaces[No Spaces Allowed]\n  Examples[Examples]\n    Invalid_Names[Invalid: 1st_user_score]\n'
    expect(repairMermaid(code)).toBe('mindmap\n  root_title[Variable Naming Rules]\n    Rules[Rules]\n      No_Spaces[No Spaces Allowed]\n    Examples[Examples]\n      Invalid_Names[Invalid: 1st_user_score]')
  })
  it('leaves a sound diagram alone', () => {
    const flow = 'flowchart LR\n  A --> B\n  B --> C'
    expect(repairMermaid(flow)).toBe(flow)
    const mm = 'mindmap\n  root((Types))\n    int\n    str'
    expect(repairMermaid(mm)).toBe(mm)
  })
})
