/** The new-project sheet's templates: small, runnable, each with a test where the language has a runner */
import type { ProjectTemplate } from './ide'

const PY_GITIGNORE = '__pycache__/\n.pytest_cache/\n.venv/\n*.pyc\n'

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'python',
    label: 'Python',
    about: 'A script with a main function',
    language: 'Python',
    defaultName: 'python-project',
    open: 'main.py',
    files: (name) => ({
      'main.py': `def main() -> None:\n    print("Hello from ${name}")\n\n\nif __name__ == "__main__":\n    main()\n`,
      'README.md': `# ${name}\n`,
      '.gitignore': PY_GITIGNORE
    })
  },
  {
    id: 'python-tests',
    label: 'Python package with tests',
    about: 'A package, pytest tests and a pyproject',
    language: 'Python',
    defaultName: 'python-package',
    open: 'src/core.py',
    files: (name) => ({
      'src/__init__.py': '',
      'src/core.py': 'def add(a: int, b: int) -> int:\n    """Adds two numbers."""\n    return a + b\n',
      'tests/test_core.py': 'from src.core import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_add_negative():\n    assert add(-2, 1) == -1\n',
      'pyproject.toml': `[project]\nname = "${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n\n[tool.pytest.ini_options]\npythonpath = ["."]\n`,
      'README.md': `# ${name}\n\nRun the tests from the Testing view, or \`python -m pytest\`.\n`,
      '.gitignore': PY_GITIGNORE
    })
  },
  {
    id: 'data',
    label: 'Data analysis',
    about: 'pandas reading a CSV, with a chart',
    language: 'Python',
    defaultName: 'analysis',
    open: 'main.py',
    files: () => ({
      'data.csv': 'day,price,volume\n1,101.2,3400\n2,102.8,2900\n3,101.9,4100\n4,104.5,5200\n5,105.1,3800\n6,103.7,4600\n7,106.4,6100\n',
      'main.py': 'import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("data.csv")\ndf["return"] = df["price"].pct_change()\nprint(df.describe())\n\ndf.plot(x="day", y="price", title="Price")\nplt.show()\n',
      '.gitignore': PY_GITIGNORE
    })
  },
  {
    id: 'node',
    label: 'Node.js',
    about: 'An ES module with node --test',
    language: 'JavaScript',
    defaultName: 'node-project',
    open: 'src/index.js',
    files: (name) => ({
      'package.json': JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), version: '0.1.0', type: 'module', scripts: { start: 'node src/index.js', test: 'node --test' } }, null, 2) + '\n',
      'src/index.js': 'export function slug(text) {\n  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")\n}\n\nconsole.log(slug("Hello from Tide"))\n',
      'test/index.test.js': 'import { test } from "node:test"\nimport assert from "node:assert/strict"\nimport { slug } from "../src/index.js"\n\ntest("slug lowercases and joins words", () => {\n  assert.equal(slug("Hello World"), "hello-world")\n})\n',
      '.gitignore': 'node_modules/\n'
    })
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    about: 'Strict TypeScript, run by Node',
    language: 'TypeScript',
    defaultName: 'ts-project',
    open: 'src/main.ts',
    files: (name) => ({
      'package.json': JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), version: '0.1.0', type: 'module' }, null, 2) + '\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ['src'] }, null, 2) + '\n',
      'src/main.ts': 'export interface Point {\n  x: number\n  y: number\n}\n\nexport const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)\n\nconsole.log(distance({ x: 0, y: 0 }, { x: 3, y: 4 }))\n',
      '.gitignore': 'node_modules/\n'
    })
  },
  {
    id: 'c',
    label: 'C',
    about: 'A C program and a Makefile',
    language: 'C',
    defaultName: 'c-project',
    open: 'main.c',
    files: () => ({
      'main.c': '#include <stdio.h>\n\nint square(int x) { return x * x; }\n\nint main(void) {\n    for (int i = 1; i <= 5; i++) printf("%d squared is %d\\n", i, square(i));\n    return 0;\n}\n',
      Makefile: 'CFLAGS = -std=c17 -Wall -Wextra -g\n\nmain: main.c\n\t$(CC) $(CFLAGS) -o main main.c\n\nclean:\n\trm -f main\n',
      '.gitignore': 'main\n*.o\n*.dSYM/\n'
    })
  },
  {
    id: 'rust',
    label: 'Rust',
    about: 'A Cargo binary with a unit test',
    language: 'Rust',
    defaultName: 'rust-project',
    open: 'src/main.rs',
    files: (name) => ({
      'Cargo.toml': `[package]\nname = "${name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^(\d)/, '_$1')}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
      'src/main.rs': 'fn fib(n: u64) -> u64 {\n    let (mut a, mut b) = (0, 1);\n    for _ in 0..n {\n        (a, b) = (b, a + b);\n    }\n    a\n}\n\nfn main() {\n    println!("fib(10) = {}", fib(10));\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn fib_ten() {\n        assert_eq!(fib(10), 55);\n    }\n}\n',
      '.gitignore': 'target/\n'
    })
  },
  {
    id: 'go',
    label: 'Go',
    about: 'A module with a test',
    language: 'Go',
    defaultName: 'go-project',
    open: 'main.go',
    files: (name) => ({
      'go.mod': `module ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\n\ngo 1.22\n`,
      'main.go': 'package main\n\nimport "fmt"\n\nfunc Reverse(s string) string {\n\tr := []rune(s)\n\tfor i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {\n\t\tr[i], r[j] = r[j], r[i]\n\t}\n\treturn string(r)\n}\n\nfunc main() {\n\tfmt.Println(Reverse("Hello from Tide"))\n}\n',
      'main_test.go': 'package main\n\nimport "testing"\n\nfunc TestReverse(t *testing.T) {\n\tif got := Reverse("abc"); got != "cba" {\n\t\tt.Fatalf("got %q", got)\n\t}\n}\n'
    })
  },
  {
    id: 'empty',
    label: 'Empty folder',
    about: 'Nothing but a README',
    language: '—',
    defaultName: 'project',
    open: 'README.md',
    files: (name) => ({ 'README.md': `# ${name}\n` })
  }
]
