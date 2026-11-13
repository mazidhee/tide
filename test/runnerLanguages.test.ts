import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-runl-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { runCode, pathCleaner } = await import('../src/main/runner')
const { LANGUAGES, detect, isSql, languageOf, languagesStatus, missingText, stripTypes, toolFor, versionNumber } = await import('../src/main/languages')

const lang = (id: string) => LANGUAGES.find((l) => l.id === id)!
const here = async (id: string) => !!(await toolFor(lang(id)))
const [rust, swift, go, java, ruby] = await Promise.all(['rust', 'swift', 'go', 'java', 'ruby'].map(here))
const LONG = 90_000

/** No folder of this Mac in a message */
const noPaths = (text: string) => {
  expect(text).not.toContain(dir)
  expect(text).not.toContain('tide-run-')
  expect(text).not.toMatch(/\/Users\/|\/var\/folders\//)
}

describe('the language table', () => {
  it('knows each language by its name, its other names and its file extension', () => {
    for (const [said, id] of [['Rust', 'rust'], ['rs', 'rust'], ['golang', 'go'], ['ts', 'typescript'], ['sh', 'bash'], ['shell', 'bash'], ['zsh', 'zsh'], ['rb', 'ruby'], ['c++', 'cpp'], ['py', 'python'], ['.swift', 'swift'], ['java', 'java']]) expect(languageOf(said)?.id).toBe(id)
    expect(languageOf('cobol')).toBeNull()
    expect(isSql('SQL')).toBe(true)
    expect(isSql('python')).toBe(false)
  })

  it('gives every language a file, a run command and, when it needs a toolchain, what to install', () => {
    const c = { tool: '/x/tool', entry: 'file', cache: '/cache', python: ['/x/python'], node: '/x/node' }
    for (const l of LANGUAGES) {
      expect(l.entry).toMatch(/^[Mm]ain\.\w+$/)
      expect(l.run({ ...c, entry: l.entry }).length).toBeGreaterThan(0)
      if (l.tool) {
        // A pack's toolchain is found in Tide's tools folder at run time (locate) rather than at a fixed path
        expect(l.tool.paths.length + (l.tool.locate ? 1 : 0)).toBeGreaterThan(0)
        expect(l.tool.version.length).toBeGreaterThan(0)
        expect(missingText(l)).toMatch(new RegExp(`^${l.name.replace(/\+/g, '\\+')} isn't installed on this Mac`))
        expect(missingText(l)).not.toContain('\n')
      }
    }
  })

  it('builds the compile and run commands from the table', () => {
    const c = (id: string) => ({ tool: `/tools/${id}`, entry: lang(id).entry, cache: '/cache', python: ['/x/python'], node: '/x/node' })
    expect(lang('rust').compile!(c('rust'))).toEqual(['/tools/rust', '--edition', '2021', '-g', '-o', 'prog', 'main.rs'])
    expect(lang('rust').run(c('rust'))).toEqual(['./prog'])
    expect(lang('go').compile!(c('go'))).toEqual(['/tools/go', 'build', '-o', 'prog', 'main.go'])
    // Go builds from a cache kept between runs and may fetch nothing
    expect(lang('go').env!(c('go'))).toMatchObject({ GOCACHE: '/cache/go-build', GOPROXY: 'off', GOTOOLCHAIN: 'local' })
    expect(lang('swift').compile!(c('swift'))).toEqual(['/tools/swift', '-module-cache-path', '/cache/swift', '-o', 'prog', 'main.swift'])
    expect(lang('java').compile).toBeUndefined()
    expect(lang('java').run(c('java'))).toEqual(['/tools/java', '-XX:-UsePerfData', 'Main.java'])
    expect(lang('ruby').run(c('ruby'))).toEqual(['/tools/ruby', 'main.rb'])
    expect(lang('bash').run(c('bash'))).toEqual(['/tools/bash', 'main.sh'])
    expect(lang('c').compile!(c('c')).slice(0, 2)).toEqual(['/usr/bin/clang', '-std=c17'])
    expect(lang('typescript').run({ ...c('typescript'), entry: 'main.js' })).toEqual(['/x/node', 'main.js'])
  })
})

describe('finding a toolchain', () => {
  const probe = (files: string[], answers: Record<string, string | null>) => {
    const asked: string[] = []
    return { asked, exists: (p: string) => files.includes(p), run: async (cmd: string[]) => (asked.push(cmd.join(' ')), answers[cmd.join(' ')] ?? null) }
  }

  it('takes the first place that exists and answers its version probe', async () => {
    const p = probe(['/usr/local/go/bin/go'], { '/usr/local/go/bin/go version': 'go version go1.25.3 darwin/arm64' })
    expect(await detect(lang('go').tool!, p)).toEqual({ path: '/usr/local/go/bin/go', version: 'go version go1.25.3 darwin/arm64' })
    expect(versionNumber('go version go1.25.3 darwin/arm64')).toBe('1.25.3')
  })

  it('is not fooled by a stand-in that exists but cannot run', async () => {
    const p = probe(['/opt/homebrew/bin/go'], {})
    expect(await detect(lang('go').tool!, p)).toBeNull()
  })

  it('finds Java through the JDK the Mac reports, never the stand-in at /usr/bin/java', async () => {
    const jdk = '/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home'
    const p = probe([`${jdk}/bin/java`, '/usr/bin/java'], { '/usr/libexec/java_home': jdk, [`${jdk}/bin/java -version`]: 'openjdk version "25.0.1" 2026-10-20' })
    expect(await detect(lang('java').tool!, p)).toEqual({ path: `${jdk}/bin/java`, version: 'openjdk version "25.0.1" 2026-10-20' })
    expect(lang('java').tool!.paths).not.toContain('/usr/bin/java')
    const none = probe(['/usr/bin/java'], {})
    expect(await detect(lang('java').tool!, none)).toBeNull()
    expect(none.asked).toEqual(['/usr/libexec/java_home'])
  })

  it('uses the real rustc behind rustup, which the sandbox can run without the home folder', async () => {
    const root = '/Users/x/.rustup/toolchains/stable-aarch64-apple-darwin'
    const p = probe(['/Users/x/.cargo/bin/rustc', `${root}/bin/rustc`], { '/Users/x/.cargo/bin/rustc --print sysroot': root, [`${root}/bin/rustc --version`]: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' })
    expect(await detect(lang('rust').tool!, p, '/Users/x')).toEqual({ path: `${root}/bin/rustc`, version: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' })
  })

  it('does not run Apple’s stand-ins when the command line tools are missing: they open a dialog', async () => {
    const p = probe(['/usr/bin/swiftc', '/usr/bin/clang'], {})
    expect(await detect(lang('swift').tool!, p)).toBeNull()
    expect(await detect(lang('c').tool!, p)).toBeNull()
    expect(p.asked).toEqual(['/usr/bin/xcode-select -p', '/usr/bin/xcode-select -p'])
  })

  it('says in one line what a missing language needs, and does not run it', async () => {
    for (const [id, was] of [['go', go], ['java', java]] as const) {
      if (was) continue
      const r = await runCode(id, 'whatever')
      expect(r.exitCode).toBe(1)
      expect(r.stderr).toBe(missingText(lang(id)))
      expect(r.stderr).toMatch(/isn't installed on this Mac.*brew install/)
    }
    expect(missingText(lang('go'))).toBe("Go isn't installed on this Mac, so it was not run. It needs Go. Install it with: brew install go")
  })

  it('lists what runs here for Settings', async () => {
    const s = await languagesStatus()
    expect(s.detail).toMatch(/^Python, JavaScript, TypeScript/)
    expect(s.detail).toContain('run here.')
    if (!go) expect(s.detail).toContain('Go needs Go. Install it with: brew install go')
  })

  it('sends SQL to the data lab instead', async () => {
    const r = await runCode('sql', 'select 1')
    expect(r.stderr).toContain('run_sql')
  })
})

describe('messages carry no folder of this Mac', () => {
  it('strips the scratch folder in both its forms and shortens the home folder', () => {
    const clean = pathCleaner('/var/folders/ab/T/tide-run-x1', '/Users/me/Library/Application Support/Tide/runcache', '/Users/me')
    expect(clean('error: /private/var/folders/ab/T/tide-run-x1/work/main.rs:3:5')).toBe('error: main.rs:3:5')
    expect(clean('at /var/folders/ab/T/tide-run-x1/site/x.py and /Users/me/.rustup/lib.rs')).toBe('at site/x.py and ~/.rustup/lib.rs')
    expect(clean('/Users/me/Library/Application Support/Tide/runcache/swift/A.pcm')).toBe('swift/A.pcm')
  })
})

describe('TypeScript', () => {
  it('blanks the types out in place, so lines and columns stay where they were', async () => {
    const out = await stripTypes('const n: number = 2\nfunction twice(x: number): number { return x * 2 }\n')
    expect(out.entry).toBe('main.js')
    expect(out.code.split('\n')[1]).toBe('function twice(x        )         { return x * 2 }')
  })

  it('runs a program with its input', async () => {
    const code = `import { readFileSync } from 'node:fs'
interface Point { x: number; y: number }
const [x, y]: number[] = readFileSync(0, 'utf8').trim().split(' ').map(Number)
const p: Point = { x, y }
console.log(\`sum \${p.x + p.y}\`)`
    const r = await runCode('typescript', code, '3 4', 30_000)
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('sum 7\n')
  }, LONG)

  it('runs what stripping alone cannot: an enum', async () => {
    const r = await runCode('ts', 'enum Colour { Red, Green }\nconsole.log(Colour[Colour.Green])', '', 30_000)
    expect(r.stdout).toBe('Green\n')
  }, LONG)

  it('shows a syntax error with its line, in the file the learner wrote', async () => {
    const r = await runCode('typescript', 'const x: number = 1\nconst y: number = ;\nconsole.log(x)', '', 30_000)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.ts:2/)
    expect(r.stderr).toContain('SyntaxError')
    noPaths(r.stderr)
  }, LONG)

  it('shows a runtime error with its line', async () => {
    const r = await runCode('typescript', 'type T = { a?: { b: number } }\nconst t: T = {}\nconsole.log(t.a!.b)', '', 30_000)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.ts:3/)
    expect(r.stderr).toContain('TypeError')
    noPaths(r.stderr)
  }, LONG)
})

describe.skipIf(!rust)('Rust', () => {
  it('compiles and runs a program, with its input', async () => {
    const code = `use std::io::Read;
fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let total: i64 = s.split_whitespace().map(|n| n.parse::<i64>().unwrap()).sum();
    println!("total {}", total);
}`
    const r = await runCode('rust', code, '1 2 39')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('total 42\n')
    expect(r.exitCode).toBe(0)
  }, LONG)

  it('shows a compile error with its line, and no path from this Mac', async () => {
    const r = await runCode('rust', 'fn main() {\n    let x: i32 = "one";\n    println!("{}", x);\n}')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('error[E0308]: mismatched types')
    expect(r.stderr).toMatch(/--> main\.rs:2:18/)
    noPaths(r.stderr)
  }, LONG)

  it('shows warnings beside the output of a program that still runs', async () => {
    const r = await runCode('rust', 'fn main() {\n    let unused = 5;\n    println!("ran");\n}')
    expect(r.stdout).toBe('ran\n')
    expect(r.stderr).toMatch(/warning: unused variable: `unused`\n\s*--> main\.rs:2:9/)
  }, LONG)

  it('reports a panic with its line: here an index past the end', async () => {
    const r = await runCode('rs', 'fn main() {\n    let v = vec![1, 2, 3];\n    let i = v.len();\n    println!("{}", v[i]);\n}')
    expect(r.exitCode).toBe(101)
    expect(r.stderr).toMatch(/panicked at main\.rs:4:\d+:\nindex out of bounds: the len is 3 but the index is 3/)
    noPaths(r.stderr)
  }, LONG)

  it('uses the 2021 edition', async () => {
    // Closures capture single fields in 2021; in 2018 this borrow is an error
    const r = await runCode('rust', 'struct P { a: String, b: String }\nfn main() {\n    let mut p = P { a: "a".into(), b: "b".into() };\n    let r = &mut p.a;\n    let c = || println!("{}", p.b);\n    r.push(\'!\');\n    c();\n    println!("{}", p.a);\n}')
    expect(r.stdout).toBe('b\na!\n')
  }, LONG)
})

describe.skipIf(!swift)('Swift', () => {
  it('compiles and runs a program, with its input', async () => {
    const r = await runCode('swift', 'import Foundation\nlet name = readLine() ?? "nobody"\nprint("hello, \\(name.uppercased())")', 'tide')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('hello, TIDE\n')
  }, LONG)

  it('shows a compile error with its line, and no path from this Mac', async () => {
    const r = await runCode('swift', 'let n: Int = 1\nlet s: String = n\nprint(s)')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.swift:2:17: error: cannot convert value of type 'Int' to specified type 'String'/)
    noPaths(r.stderr)
  }, LONG)

  it('reports a crash at run time: an index past the end', async () => {
    const r = await runCode('swift', 'let a = [1, 2, 3]\nlet i = a.count\nprint(a[i])')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('Fatal error: Index out of range')
    noPaths(r.stderr)
  }, LONG)
})

describe.skipIf(!ruby)('Ruby', () => {
  it('runs a program, with its input', async () => {
    const r = await runCode('ruby', 'words = STDIN.read.split\nputs words.map(&:capitalize).join(" ")', 'hello from ruby')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('Hello From Ruby\n')
  }, LONG)

  it('shows a syntax error with its line', async () => {
    const r = await runCode('ruby', 'x = 1\nif x > 0\n  puts "yes"\n')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.rb:\d+: syntax error/)
    noPaths(r.stderr)
  }, LONG)

  it('shows a runtime error with its line', async () => {
    const r = await runCode('rb', 'x = nil\nputs x.upcase')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.rb:2:in .*undefined method .upcase' for nil/)
    noPaths(r.stderr)
  }, LONG)
})

// Not installed on the Mac these were written on: they run wherever Go or a JDK is
describe.skipIf(!go)('Go', () => {
  it('compiles and runs a program, with its input', async () => {
    const r = await runCode('go', 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int\n\tfmt.Scan(&a, &b)\n\tfmt.Println("sum", a+b)\n}', '40 2')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('sum 42\n')
  }, LONG)

  it('shows a compile error with its line, and no path from this Mac', async () => {
    const r = await runCode('go', 'package main\n\nfunc main() {\n\tvar x int = "one"\n\t_ = x\n}')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.go:4:\d+: cannot use "one"/)
    noPaths(r.stderr)
  }, LONG)

  it('reports a panic with its line: an index past the end', async () => {
    const r = await runCode('go', 'package main\n\nimport "fmt"\n\nfunc main() {\n\ta := []int{1, 2, 3}\n\ti := len(a)\n\tfmt.Println(a[i])\n}')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('index out of range [3] with length 3')
    expect(r.stderr).toMatch(/main\.go:8/)
    noPaths(r.stderr)
  }, LONG)
})

describe.skipIf(!java)('Java', () => {
  it('runs one file, with its input', async () => {
    const r = await runCode('java', 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.println("hello, " + in.nextLine().toUpperCase());\n    }\n}', 'tide')
    expect(r.stdout).toBe('hello, TIDE\n')
    expect(r.exitCode).toBe(0)
  }, LONG)

  it('shows a compile error with its line, and no path from this Mac', async () => {
    const r = await runCode('java', 'public class Main {\n    public static void main(String[] args) {\n        int x = "one";\n    }\n}')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/Main\.java:3: error: incompatible types/)
    noPaths(r.stderr)
  }, LONG)

  it('shows an exception with its line', async () => {
    const r = await runCode('java', 'public class Main {\n    public static void main(String[] args) {\n        int[] a = {1, 2, 3};\n        System.out.println(a[a.length]);\n    }\n}')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3')
    expect(r.stderr).toMatch(/Main\.java:4/)
    noPaths(r.stderr)
  }, LONG)
})

describe('shell scripts', () => {
  it('runs Bash, with its input', async () => {
    const r = await runCode('bash', 'read -r a b\necho "$((a + b))"\nfor f in one two; do printf "%s " "$f"; done; echo', '20 22')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('42\none two \n')
  }, LONG)

  it('shows a Bash syntax error with its line', async () => {
    const r = await runCode('sh', 'echo start\nif true; then\necho "never closed"\n')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.sh: line 4: syntax error: unexpected end of file/)
    noPaths(r.stderr)
  }, LONG)

  it('shows a failing command with its line and the script’s exit code', async () => {
    const r = await runCode('bash', 'set -e\necho before\nnosuchcommand --flag\necho after')
    expect(r.stdout).toBe('before\n')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toMatch(/main\.sh: line 3: nosuchcommand: command not found/)
  }, LONG)

  it('runs zsh as zsh', async () => {
    const r = await runCode('zsh', 'typeset -A age\nage[ada]=36\nread who\nprint "${(U)who} is $age[$who]"', 'ada')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('ADA is 36\n')
  }, LONG)

  it('shows a zsh error with its line', async () => {
    const r = await runCode('zsh', 'print ok\nprint ${nosuch:?is not set}')
    expect(r.stdout).toBe('ok\n')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/main\.zsh:2: nosuch: is not set/)
  }, LONG)

  it('cannot write outside the scratch folder or reach the internet', async () => {
    const r = await runCode('bash', `echo x > ${JSON.stringify(join(dir, 'escape.txt'))} || echo "write refused"\n/usr/bin/curl -s -m 5 http://1.1.1.1 >/dev/null || echo "network refused"`)
    expect(r.stdout).toBe('write refused\nnetwork refused\n')
  }, LONG)

  it('stops a script and everything it started when its time is up', async () => {
    const t = Date.now()
    const r = await runCode('bash', 'echo waiting\nsleep 60 &\nsleep 60\necho never', '', 1500)
    expect(r.timedOut).toBe(true)
    expect(r.stdout).toBe('waiting\n')
    expect(Date.now() - t).toBeLessThan(8000)
  }, LONG)

  it('does not wait for something a finished script left running', async () => {
    const t = Date.now()
    const r = await runCode('bash', 'sleep 30 &\necho done')
    expect(r.stdout).toBe('done\n')
    expect(Date.now() - t).toBeLessThan(8000)
  }, LONG)
})
