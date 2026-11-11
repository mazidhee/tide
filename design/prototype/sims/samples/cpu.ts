/** Harness samples for "cpu": [key for ?only=, heading, the sim block's JSON] */
export const samples: [string, string, string][] = [
  ['cpu', 'cpu: the default program (sum 1 to 5)', '{"kind":"cpu","title":"Adding 1 to 5 in a loop"}'],
  [
    'cpu-tour',
    'cpu: a guided tour of one instruction, then a wrap',
    JSON.stringify({
      kind: 'cpu',
      title: 'What 127 + 1 does in 8 bits',
      program: 'LOAD R0, big\nLOADI R1, 1\nADD R0, R1 ; 127 + 1\nSTORE R0, result\nHALT\nbig: DATA 127\nresult: DATA 0',
      tour: [
        { at: 'program', say: 'The program is text, but the machine never sees text: each line was assembled into two bytes of memory.' },
        { at: 'ir', say: 'Fetch copies the two bytes at PC into the instruction register, and PC moves on by two.', do: { run: 1 } },
        { at: 'line:1', say: 'Decode reads the bits: opcode 2 is LOAD, the register field is 0, the second byte is an address.', do: { run: 1 } },
        { at: 'register:0', say: 'Execute does it: R0 now holds 127, the largest value 8 signed bits can hold.', do: { run: 1 } },
        { at: 'flag:v', say: 'Run two more instructions. 127 + 1 does not fit: the bits say 1000 0000, which reads as −128, and the overflow flag is set.', do: { run: 6 } },
        { at: 'memory:result', say: 'The last two instructions store the wrapped result and halt.', do: { run: 6 } }
      ]
    })
  ],
  ['cpu-error', 'cpu: a program that does not assemble', '{"kind":"cpu","program":"LOADI R0, 300\\nLOAD R5, 2\\nloop: ADD R0\\nJMP lop\\nFOO R1\\nHALT"}'],
  ['cpu-runaway', 'cpu: a loop without end, written on one line', '{"kind":"cpu","title":"Counting for ever","program":"loadi r1 1; loop: add r0 r1; jmp loop","limit":40}'],
  ['cpu-multiply', 'cpu: multiplying by repeated addition, with preloaded cells', '{"kind":"cpu","title":"6 × 7 by repeated addition","program":"LOAD R1, a\\nLOAD R2, b\\nLOADI R3, 1\\nloop: ADD R0, R1\\nSUB R2, R3\\nJZ done\\nJMP loop\\ndone: STORE R0, product\\nHALT\\na: DATA 0\\nb: DATA 0\\nproduct: DATA 0","memory":{"a":6,"b":7}}']
]
