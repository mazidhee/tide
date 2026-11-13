/**
 * The files a planned project starts with: the plan's own starting files, the toolchain's files for
 * its language when the plan didn't write them, a README with the plan, and, when the plan has no
 * tests (a plan from Gemma or written by hand), one failing test per "done when" line of the first
 * milestone, saying what to write. Pure; main/ide/scaffold.ts writes them and makes the repository.
 */
import { isTestFile, planMarkdown, slugOf, type IdeaLanguage, type ProjectPlan, type ScaffoldFile } from './ideaProject'
import { CHECK_HPP, cppBuildFiles, FOUNDRY_FILES } from './ideTemplates'

const ident = (s: string, sep = '_') =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    .replace(/^(\d)/, `${sep}$1`)
    .slice(0, 60) || 'project'

/** The Python package (or crate, module) name the project uses */
export const packageName = (plan: Pick<ProjectPlan, 'slug'>) => ident(plan.slug)

const quote = (s: string) => JSON.stringify(s)

/** The toolchain's own files for a language, by path */
export function toolchainFiles(plan: Pick<ProjectPlan, 'slug' | 'language'>): ScaffoldFile[] {
  const pkg = packageName(plan)
  const name = slugOf(plan.slug)
  const by: Record<IdeaLanguage, ScaffoldFile[]> = {
    python: [
      { path: 'pyproject.toml', content: `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n\n[tool.pytest.ini_options]\npythonpath = ["."]\ntestpaths = ["tests"]\n` },
      { path: 'requirements.txt', content: 'pytest>=8\n' },
      { path: '.gitignore', content: '__pycache__/\n.pytest_cache/\n.venv/\n*.pyc\n' },
      { path: `${pkg}/__init__.py`, content: '' }
    ],
    rust: [
      { path: 'Cargo.toml', content: `[package]\nname = "${pkg}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n` },
      { path: 'src/lib.rs', content: '//! The project’s library: the tests in tests/ use it.\n' },
      { path: '.gitignore', content: 'target/\n' }
    ],
    go: [
      { path: 'go.mod', content: `module ${name}\n\ngo 1.22\n` },
      { path: '.gitignore', content: '/bin/\n' }
    ],
    javascript: [
      { path: 'package.json', content: JSON.stringify({ name, version: '0.1.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n' },
      { path: '.gitignore', content: 'node_modules/\n' }
    ],
    // CMake, clangd's flags and the test helper; src/ and tests/ come from the plan
    cpp: [...Object.entries(cppBuildFiles(name)).map(([path, content]) => ({ path, content })), { path: 'tests/check.hpp', content: CHECK_HPP }],
    solidity: Object.entries(FOUNDRY_FILES).map(([path, content]) => ({ path, content })),
    typescript: [
      { path: 'package.json', content: JSON.stringify({ name, version: '0.1.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n' },
      { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true, erasableSyntaxOnly: true }, include: ['src', 'test'] }, null, 2) + '\n' },
      { path: '.gitignore', content: 'node_modules/\n' }
    ]
  }
  return by[plan.language]
}

/**
 * Tests that fail until the learner writes them: one per line of what says the first milestone is
 * done. Used when the plan came without real tests; each says what to test.
 */
export function placeholderTests(plan: Pick<ProjectPlan, 'slug' | 'language' | 'milestones'>, index = 0): ScaffoldFile[] {
  const m = plan.milestones[index]
  const n = index + 1
  if (!m) return []
  const lines = m.doneWhen.length ? m.doneWhen : [m.title]
  const pkg = packageName(plan)
  const fns = lines.map((d, i) => ({ d, fn: ident(d).slice(0, 50) || `case_${i + 1}` }))
  const by: Record<IdeaLanguage, ScaffoldFile> = {
    python: { path: `tests/test_${ident(m.title).slice(0, 30) || `milestone_${n}`}.py`, content: `"""Milestone ${n}: ${m.title}.\n\nEach test fails until you write it: replace the fail() with the real check.\n"""\nimport pytest\n\n${fns.map(({ d, fn }) => `\ndef test_${fn}():\n    pytest.fail(${quote(`Write this test: ${d}`)})\n`).join('\n')}` },
    rust: { path: `tests/milestone_${n}.rs`, content: `//! Milestone ${n}: ${m.title}. Each test fails until you write it.\n#[allow(unused_imports)]\nuse ${pkg}::*;\n${fns.map(({ d, fn }) => `\n#[test]\nfn ${fn}() {\n    panic!(${quote(`Write this test: ${d}`)});\n}\n`).join('')}` },
    go: { path: `milestone${n}_test.go`, content: `package main\n\nimport "testing"\n\n// Milestone ${n}: ${m.title}. Each test fails until you write it.\n${fns.map(({ d, fn }) => `\nfunc Test${fn.replace(/(^|_)([a-z0-9])/g, (_x, _a, c: string) => c.toUpperCase())}(t *testing.T) {\n\tt.Fatal(${quote(`Write this test: ${d}`)})\n}\n`).join('')}` },
    javascript: { path: `test/milestone-${n}.test.js`, content: `// Milestone ${n}: ${m.title}. Each test fails until you write it.\nimport { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${fns.map(({ d }) => `\ntest(${quote(d)}, () => {\n  assert.fail(${quote(`Write this test: ${d}`)})\n})\n`).join('')}` },
    cpp: { path: `tests/test_milestone_${n}.cpp`, content: `// Milestone ${n}: ${m.title}. Each test fails until you write it.\n#include "check.hpp"\n${fns.map(({ d, fn }) => `\nTEST(${fn}) {\n    FAIL(${quote(`Write this test: ${d}`)});\n}\n`).join('')}\nint main() { return check::run_all(); }\n` },
    solidity: { path: `test/Milestone${n}.t.sol`, content: `// SPDX-License-Identifier: UNLICENSED\n// Milestone ${n}: ${m.title}. Each test fails until you write it.\npragma solidity ^0.8.20;\n\nimport {Test} from "forge-std/Test.sol";\n\ncontract Milestone${n}Test is Test {\n${fns.map(({ d, fn }) => `    function test_${fn}() public pure {\n        revert(${quote(`Write this test: ${d}`)});\n    }\n`).join('\n')}}\n` },
    typescript: { path: `test/milestone-${n}.test.ts`, content: `// Milestone ${n}: ${m.title}. Each test fails until you write it.\nimport { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${fns.map(({ d }) => `\ntest(${quote(d)}, () => {\n  assert.fail(${quote(`Write this test: ${d}`)})\n})\n`).join('')}` }
  }
  const out = [by[plan.language]]
  if (plan.language === 'go' && index === 0) out.push({ path: 'main.go', content: 'package main\n\nfunc main() {}\n' })
  return out
}

/** Every file the project folder starts with, by path (the plan's own files win) */
export function scaffoldFiles(plan: ProjectPlan): ScaffoldFile[] {
  const out = new Map<string, string>()
  const own = plan.scaffold.filter((f) => f.path.toLowerCase() !== 'readme.md')
  // The plan's own Python package, when it has one, stands for the toolchain's
  const hasPackage = own.some((f) => /^[^/]+\/__init__\.py$/.test(f.path))
  for (const f of toolchainFiles(plan)) if (!(hasPackage && f.path.endsWith('/__init__.py'))) out.set(f.path, f.content)
  for (const f of own) out.set(f.path, f.content)
  if (!own.some((f) => isTestFile(f.path, f.content))) for (const f of placeholderTests(plan)) if (!out.has(f.path)) out.set(f.path, f.content)
  // A Rust crate's tests need the library; a Python project's tests need the package
  out.set('README.md', planMarkdown(plan))
  return [...out].map(([path, content]) => ({ path, content }))
}

/** The files a project folder starts with before its first ready check: everything but the tests */
export const filesBeforeReady = (files: ScaffoldFile[]) => files.filter((f) => !isTestFile(f.path, f.content))

/** A milestone's tests, released when its ready check passes: the plan's own for the first, else one failing test per "done when" */
export function testsForMilestone(plan: ProjectPlan, index: number): ScaffoldFile[] {
  if (index === 0) return scaffoldFiles(plan).filter((f) => isTestFile(f.path, f.content))
  return placeholderTests(plan, index)
}

/** The test files among them */
export const testFilesOf = (files: ScaffoldFile[]) => files.filter((f) => isTestFile(f.path, f.content)).map((f) => f.path)
