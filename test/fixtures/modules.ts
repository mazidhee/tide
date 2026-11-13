/** A small module catalogue and the old roadmap it came from, for the module tests */

export const OLD_SWE = `# Software Engineering

## 1. Foundations of Computation — CORE

### How Computers Work

- [x] [[Binary, hexadecimal, number representations|Binary, hexadecimal, number representations]]
- [ ] Boolean algebra and logic gates

### Assembly Language

- [ ] Stack frames
- [ ] A topic dropped on purpose

## 2. Python & Practical Software Engineering — CORE

### Python — Core Language

- [ ] Generators and iterators
- [ ] Decorators — _Fluent Python_
- [ ] Something nobody placed

## 3. Operating Systems — CORE

### Processes

- [ ] Processes and threads
- [ ] Scheduling
`

export const OLD_MATH = `# Mathematics

## Chapter 2: Logic and Proof

- [ ] What a mathematical proof is
- [ ] Boolean algebra and logic gates
`

export const MOD_FOUNDATIONS = `---
module: computation-foundations
title: Computation Foundations
track: shared
requires: []
level: core
interview: [swe, core-infra]   # bars it serves
hours: 30
replaces: ["RM_SWE#1"]
---
# Computation Foundations

Depth goal: convert bases and build an adder from gates unaided.

## 1. How computers work — CORE
### Numbers
- [ ] Binary, hexadecimal, number representations
- [ ] Boolean algebra and logic gates — _Nisan and Schocken_
### Practice
- [ ] Practice: build a half adder

Gate: convert between bases unaided, and build a full adder from gates.
`

export const MOD_PYTHON = `---
module: python-core
title: Python Core
track: software-engineering
requires: [computation-foundations]
level: core
interview:
  - swe
  - data
hours: 40
---
# Python Core

## 1. The language — CORE
### Iteration
- [ ] Generators and iterators
- [ ] Decorators — _Fluent Python_

Gate: write a generator pipeline and a decorator from memory.
`

export const MOD_C = `---
module: c-language
title: C
track: software-engineering
requires: [computation-foundations]
level: core
interview: [core-infra]
hours: 50
---
# C

## 1. Memory — CORE
### The stack
- [ ] Stack frames

## 2. Pointers — CORE
- [ ] Pointer arithmetic
`

export const MOD_OS = `---
module: operating-systems
title: Operating Systems
track: software-engineering
requires: [c-language, computation-foundations]
helps: [python-core]
level: core
interview: [swe, core-infra]
hours: 120
---
# Operating Systems

## 1. Processes and threads — CORE
### Processes
- [ ] Processes and threads
- [ ] Scheduling
### Projects
- [ ] Project: a tiny shell
`

export const MOD_PROOF = `---
module: proof
title: Proof
track: mathematics
level: core
interview: [quant]
hours: 20
---
# Proof

## 1. Logic — CORE
- [ ] What a mathematical proof is
`

export const TRACK_SWE = `---
track: software-engineering
title: Software Engineering
modules: [computation-foundations, python-core, c-language, operating-systems]
---
# Software Engineering
From the machine up.
`

export const TRACK_MATH = `---
track: mathematics
title: Mathematics
modules: [computation-foundations, proof]
---
# Mathematics
Proof first.
`

export const MOVES = {
  'RM_SWE#Binary, hexadecimal, number representations': 'computation-foundations',
  'RM_SWE#Boolean algebra and logic gates': 'computation-foundations',
  'RM_SWE#Stack frames': 'c-language',
  'RM_SWE#A topic dropped on purpose': null,
  'RM_SWE#Generators and iterators': 'python-core',
  'RM_SWE#Decorators': 'python-core',
  'RM_SWE#Processes and threads': 'operating-systems',
  'RM_SWE#Scheduling': 'operating-systems',
  'RM_MATH#What a mathematical proof is': 'proof',
  'RM_MATH#Boolean algebra and logic gates': 'computation-foundations'
}

export const MODULE_FILES: Record<string, string> = {
  'Roadmaps/Modules/computation-foundations.md': MOD_FOUNDATIONS,
  'Roadmaps/Modules/python-core.md': MOD_PYTHON,
  'Roadmaps/Modules/c-language.md': MOD_C,
  'Roadmaps/Modules/operating-systems.md': MOD_OS,
  'Roadmaps/Modules/proof.md': MOD_PROOF
}

export const TRACK_FILES: Record<string, string> = {
  'Roadmaps/Tracks/software-engineering.md': TRACK_SWE,
  'Roadmaps/Tracks/mathematics.md': TRACK_MATH
}
