/**
 * Computer systems: one scenario for each kind of situation. Tutor turns in a history are written
 * the way the lesson's rules ask (tags, hidden <solution>), since they are what the model saw.
 * String.raw keeps backslashes (LaTeX, C escapes) as typed.
 */
import type { Scenario } from '../types'

const r = String.raw

export const SYSTEMS: Scenario[] = [
  {
    id: 'systems-open-virtual-memory',
    subject: 'systems',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Virtual memory and paging' },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

Every process on a modern machine runs as if it had memory to itself. Virtual memory is the mechanism: the kernel and the CPU's memory management unit translate each address a program uses into a physical one, page by page. It is why one process cannot read another's data, why a program can map a file larger than RAM, and why a database's buffer pool and the kernel's page cache behave as they do. It is the ground under allocators, mmap and every performance question about memory.

<ask type="short">A C program prints the address of a local variable and gets 0x7ffe1000. Is that a location in physical RAM? Say what you think it is.</ask>`,
    bad: [
      {
        reply: r`Hello! Great to be learning about virtual memory with you. Let's get started.

What do you already know about virtual memory? And have you heard of page tables?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'The opening says concretely where virtual memory is used, and its question finds out what the learner knows rather than teaching.'
  },
  {
    id: 'systems-after-correct-twos-complement',
    subject: 'systems',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: "Two's complement arithmetic" },
    history: [
      {
        tutor: r`<plan>
- Negating a number
- Addition and overflow
</plan>

To negate in two's complement, invert every bit and add 1. For 8 bits, 3 is 00000011; inverted it is 11111100; plus 1 gives 11111101, which is -3.

**Problem 1 · warm-up**

Write -5 as an 8-bit two's complement pattern.

<solution>5 = 00000101. Invert: 11111010. Add 1: 11111011.</solution>

<ask type="problem">The 8-bit pattern, with your steps.</ask>`
      },
      { learner: { answer: '11111011. 5 is 00000101, flipping the bits gives 11111010, then adding 1 gives 11111011.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain'], mustNot: ['11111010 is (the|your) (right|correct|final)'] },
    good: r`<grade verdict="correct" score="1">"flipping the bits gives 11111010, then adding 1 gives 11111011" is the method and the result: invert, then add 1.</grade>

**Problem 2 · harder**

Add the 8-bit two's complement numbers 01100100 and 01000110. Give the 8-bit result, the value it represents, and say whether signed overflow occurred.

<solution>100 + 70 = 170, which does not fit in -128..127. Bitwise: 01100100 + 01000110 = 10101010, which reads as -86. Two positive operands gave a negative result, so signed overflow occurred.</solution>

<ask type="problem">The 8-bit sum, its signed value, and whether it overflowed.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">Good effort, you are heading the right way.</grade>

**Problem 2 · harder**

Add 01100100 and 01000110 in 8 bits. Does it overflow?

<ask type="problem">Your answer.</ask>`,
        fails: ['verdict'],
        repaired: ['solution']
      }
    ]
  },
  {
    id: 'systems-after-wrong-cache-locality',
    subject: 'systems',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'CPU caches and locality' },
    history: [
      {
        tutor: r`**Why this matters**

Memory access time, not instruction count, decides the speed of most data-heavy code: a database scan, a matrix multiply, a hash join. Knowing how the cache hierarchy behaves is what lets you predict which of two equivalent loops is faster.

<ask type="predict">An array of 100 million 4-byte ints is summed twice: once walking indices 0, 1, 2, … in order, once visiting the same indices in a random order. Both loops do the same number of additions. Which is faster, and why?</ask>`
      },
      { learner: { answer: 'They take the same time. Both loops do exactly 100 million reads and 100 million additions, so the work is identical and the order cannot matter.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', names: ['cache', 'miss|locality|prefetch|adjacent|neighbour|sequential'], need: ['card'], must: ['cache'] },
    good: r`<grade verdict="wrong" score="0">"the order cannot matter" is the step that fails: it counts instructions and treats every read as costing the same, and reads do not cost the same.</grade>

A read that finds its data in the cache costs about a nanosecond; a read that misses and goes to RAM costs around a hundred times that. The cache loads memory a line at a time, typically 64 bytes, so one miss on the in-order walk brings in 16 adjacent ints and the next 15 reads hit. The random walk lands on a different line almost every time, so nearly every read is a miss.

<card>Why is summing an array in index order faster than in random order? :: Sequential reads share cache lines (16 ints per 64-byte line) and are prefetched; random reads miss the cache on almost every access.</card>

<ask type="short">With 64-byte cache lines and 4-byte ints, roughly what fraction of the reads miss on the in-order walk, ignoring prefetching?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, both loops do the same number of operations.</grade>

<ask type="short">What is a cache?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure that equal instruction counts mean equal time. The reply must name that belief and replace it with the cost of cache misses.'
  },
  {
    id: 'systems-idk-page-fault',
    subject: 'systems',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Page faults and demand paging' },
    history: [
      {
        tutor: r`**Why this matters**

Demand paging is why a 2 GB binary starts in milliseconds and why a program's first touch of fresh memory is slow. Latency spikes in databases and services are often page faults, so reading them is part of performance work.

<ask type="short">A process reads an address whose page is valid but not currently in RAM. What happens next, step by step?</ask>`
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: ['page fault'], words: { max: 200 } },
    good: r`The CPU looks the address up in the page table and finds the entry marked not present. It cannot complete the read, so it raises a page fault: a trap into the kernel. The kernel checks the address is one the process is allowed to use, finds a free physical frame, reads the page into it from disk, marks the entry present, and returns. The CPU then runs the same instruction again, and this time it succeeds. The program never sees any of it, except as time.

<ask type="choice" options="The CPU, when the page table entry says not present|The program, by calling a kernel function before each read|The disk, when it sees a read for that page|The kernel's scheduler, on its next timer tick">Who notices that the page is not in RAM?</ask>`
  },
  {
    id: 'systems-show-me-read-syscall',
    subject: 'systems',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'System calls' },
    history: [
      {
        tutor: r`A system call is how a program asks the kernel to do what it may not do itself. When your code calls read(fd, buf, n), the C library puts the call number and arguments in registers and executes the syscall instruction. The CPU switches to kernel mode and jumps to the kernel's entry point. The kernel checks the file descriptor, asks the file system for the bytes (from the page cache, or from the disk through its driver), copies them into buf in your address space, and returns to user mode with the count in a register.

<note>read(): C library sets registers → syscall instruction → kernel mode → kernel validates fd, gets bytes from page cache or disk → copies into the user buffer → returns the byte count in user mode.</note>

<continue/>`
      },
      { learner: { showMe: true } }
    ],
    expect: { ends: 'nothing', visual: { kind: 'mermaid', diagram: ['sequenceDiagram', 'flowchart'] }, forbid: ['grade'], must: ['kernel'] },
    good: r`~~~mermaid
sequenceDiagram
    participant P as "Program"
    participant L as "C library"
    participant K as "Kernel"
    participant D as "Page cache or disk"
    P->>L: read(fd, buf, n)
    L->>K: syscall instruction (to kernel mode)
    K->>K: validate fd
    K->>D: get the bytes
    D-->>K: bytes
    K-->>L: copy into buf, return count (to user mode)
    L-->>P: count
~~~

Look at the two arrows that cross between the C library and the kernel: those are the only points where the CPU changes mode.`.replace(/~~~/g, '```'),
    bad: [
      {
        reply: r`A system call works like this: the program calls the library, the library traps into the kernel, and the kernel does the work and returns.

<ask type="short">Which instruction switches to kernel mode?</ask>`,
        fails: ['ends', 'visual']
      }
    ]
  },
  {
    id: 'systems-mark-planted-error-page-table-size',
    subject: 'systems',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Page tables' },
    history: [
      {
        tutor: r`**Problem 2 · same level**

A machine has 32-bit virtual addresses and 4 KiB pages. Each page table entry is 4 bytes. How large is a single-level page table for one process?

<solution>Offset bits: 4 KiB = 2^12, so 12. Page number bits: 32 - 12 = 20, so 2^20 entries. Size: 2^20 × 4 bytes = 2^22 bytes = 4 MiB.</solution>

<ask type="problem">The size, with your working.</ask>`
      },
      { learner: { answer: 'A 4 KiB page is 2^12 bytes so the offset takes 12 bits. That leaves 32 - 12 = 20 bits for the page number, so there are 2^20 entries. Each is 4 bytes, so the table is 2^20 × 4 = 2^22 bytes, which is 4 KiB.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: ['Mi?B|megabyte|4,?194,?304'], must: ['4 ?(MiB|MB)|megabyte'] },
    good: r`<grade verdict="partial" score="0.6">The working is right up to "2^20 × 4 = 2^22 bytes"; the last step, "which is 4 KiB", is wrong: 2^22 bytes is 4 MiB, since 2^10 is a KiB and 2^20 is a MiB.</grade>

<card>How many bytes is 2^22? :: 4 MiB (2^20 is 1 MiB, so 2^22 = 4 × 2^20).</card>

**Problem 3 · same level**

The same machine switches to 64 KiB pages; entries stay 4 bytes. How large is the single-level page table now?

<solution>64 KiB = 2^16, so 16 offset bits and 32 - 16 = 16 page number bits: 2^16 entries × 4 bytes = 2^18 bytes = 256 KiB.</solution>

<ask type="problem">The size, with units.</ask>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your steps "12 bits", "2^20 entries" and "2^22 bytes" are all right.</grade>

<ask type="short">What changes with 8-byte entries?</ask>`,
        fails: ['verdict', 'names']
      }
    ]
  },
  {
    id: 'systems-mark-unusual-correct-page-offset',
    subject: 'systems',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Address translation' },
    history: [
      {
        tutor: r`**Problem 1 · warm-up**

A machine has 16-bit virtual addresses and 256-byte pages. Which page number and which offset does the address 0x1A2F fall on?

<solution>256 = 2^8, so the low 8 bits are the offset and the high 8 bits the page number. 0x1A2F: page 0x1A (26), offset 0x2F (47).</solution>

<ask type="problem">Page number and offset, with how you got them.</ask>`
      },
      { learner: { answer: 'I did it in decimal. 0x1A2F is 1×4096 + 10×256 + 2×16 + 15 = 6703. Dividing by the page size, 6703 = 26 × 256 + 47, so it is page 26 with offset 47.' } }
    ],
    expect: { ends: 'ask', verdict: 'correct' },
    good: r`<grade verdict="correct" score="1">"6703 = 26 × 256 + 47, so it is page 26 with offset 47" is right: quotient and remainder by the page size are exactly the page number and the offset, and 26 and 47 are 0x1A and 0x2F.</grade>

<ask type="explain">Your division gave the same answer as reading the hex digits 1A and 2F straight off. Why does that shortcut work for a 256-byte page, and would it still work for a 100-byte page?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="wrong" score="0">You should split the hex digits rather than convert to decimal.</grade>

<ask type="short">What are the high 8 bits of 0x1A2F?</ask>`,
        fails: ['verdict']
      }
    ]
  },
  {
    id: 'systems-tangent-goroutines',
    subject: 'systems',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Processes and threads' },
    history: [
      {
        tutor: r`**Why this matters**

Every server you will build runs many things at once, and whether they are processes or threads decides what they share, what a crash takes down and what a context switch costs.

<ask type="predict">Two threads of one process each call malloc and write to what they get back. Which of these do the two threads share: the heap, the stack, the program counter?</ask>`
      },
      { learner: { question: 'Before I answer: is a goroutine a thread?' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: ['runtime|scheduler|user[- ]space|multiplex'], words: { max: 170 } },
    good: r`Not an operating system thread. A goroutine is scheduled by the Go runtime in user space, which multiplexes many goroutines onto a small number of OS threads; it starts with a stack of a few kilobytes that grows as needed, so a program can have hundreds of thousands of them. The kernel only ever sees the OS threads underneath.

Back to the two threads, which is the same sharing question goroutines inherit.

<ask type="predict">Two threads of one process each call malloc and then write to the memory they were given. Of the heap, the stack and the program counter, which do the two threads share?</ask>`,
    judge: 'It answers the tangent briefly and correctly, then returns to the question it had asked instead of starting a lesson on Go.'
  },
  {
    id: 'systems-recall-open-stack-heap',
    subject: 'systems',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'The stack and the heap' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: ['malloc', 'LIFO|last[- ]in', 'stack frame'], words: { max: 60 } },
    good: r`<ask type="explain">Explain the stack and the heap from memory, as fully as you can.</ask>`,
    bad: [
      {
        reply: r`The stack holds stack frames in LIFO order and the heap is what malloc hands out.

<ask type="short">Which one grows downwards on x86?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'systems-code-bug-byte-swap',
    subject: 'systems',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Endianness and byte order' },
    history: [
      {
        tutor: r`**Problem 2 · harder**

Network byte order is big-endian, so a little-endian machine has to reverse the bytes of a 32-bit value before sending it.

<solution>uint32_t swap32(uint32_t x) { return (x << 24) | ((x << 8) & 0x00FF0000) | ((x >> 8) & 0x0000FF00) | (x >> 24); } For 0x11223344 it returns 0x44332211.</solution>

<ask type="code" lang="c">Write uint32_t swap32(uint32_t x) that reverses the byte order of x, so swap32(0x11223344) is 0x44332211.</ask>`
      },
      {
        learner: {
          answer: r`~~~c
#include <stdint.h>

uint32_t swap32(uint32_t x) {
    return (x << 24) | ((x << 8) & 0x00FF0000) | ((x >> 8) & 0x0000FF00) | (x >> 16);
}
~~~`.replace(/~~~/g, '```')
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: [r`>>\s*24`], need: ['card'] },
    good: r`<grade verdict="partial" score="0.5">Three of the four terms are right; the last, "(x >> 16)", is not. It moves the top two bytes into the low half, so for 0x11223344 it contributes 0x1122 instead of 0x11, and the result is 0x44333322. The top byte has to come down 24 bits: (x >> 24).</grade>

<card>In a 32-bit byte swap, how far does the top byte move? :: Down 24 bits: (x >> 24). Each byte moves to its mirror position: 24, 8, 8, 24.</card>

<ask type="code" lang="c">Fix swap32 so that swap32(0x11223344) returns 0x44332211, and add a line in main that prints the result in hex to prove it.</ask>

<solution>return (x << 24) | ((x << 8) & 0x00FF0000) | ((x >> 8) & 0x0000FF00) | (x >> 24); printing with printf("%08x\n", swap32(0x11223344)) shows 44332211.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your shifts and masks reverse the bytes.</grade>

<ask type="short">What is network byte order?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ]
  }
]
