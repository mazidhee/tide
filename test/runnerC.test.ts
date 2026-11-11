import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-runc-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { runCode } = await import('../src/main/runner')

describe.skipIf(!existsSync('/usr/bin/clang'))('running C in a lesson', () => {
  it('compiles and runs a program, with its input', async () => {
    const r = await runCode('c', '#include <stdio.h>\nint main(void) { int n; scanf("%d", &n); printf("%d in hex is %x\\n", n, n); return 0; }', '255', 30_000)
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('255 in hex is ff\n')
    expect(r.exitCode).toBe(0)
  }, 40_000)

  it('shows a compile error with its line, and no path from this Mac', async () => {
    const r = await runCode('c', 'int main(void) { return x; }', '', 30_000)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.c:1:\d+: error: use of undeclared identifier 'x'/)
    expect(r.stderr).not.toContain(dir)
    expect(r.stderr).not.toContain('tide-run-')
  }, 40_000)

  it('reports reading past the end of an array instead of printing rubbish', async () => {
    const r = await runCode('c', '#include <stdio.h>\nint main(void) { int a[3] = {1, 2, 3}; int i = 3; printf("%d\\n", a[i]); return 0; }', '', 30_000)
    expect(r.stderr).toMatch(/index 3 out of bounds for type 'int\[3\]'/)
  }, 40_000)

  it('runs C++ too', async () => {
    const r = await runCode('cpp', '#include <iostream>\n#include <vector>\nint main() { std::vector<int> v{1, 2, 3}; int s = 0; for (int x : v) s += x; std::cout << s << "\\n"; }', '', 30_000)
    expect(r.stdout).toBe('6\n')
  }, 40_000)
})
