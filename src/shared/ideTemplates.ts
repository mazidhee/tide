/** The new-project sheet's templates: small, runnable, each with a test where the language has a runner */
import type { ProjectTemplate } from './ide'

const PY_GITIGNORE = '__pycache__/\n.pytest_cache/\n.venv/\n*.pyc\n'

/**
 * A tiny test helper for C++ projects, Tide's own (no framework to install): TEST(name) blocks
 * with CHECK, CHECK_EQ and CHECK_THROWS, run by check::run_all(), which prints cargo-style lines
 * (test name ... ok) that the test explorer reads.
 */
export const CHECK_HPP = `// check.hpp: a tiny test helper. Write TEST(name) { CHECK(...); CHECK_EQ(a, b); CHECK_THROWS(f()); FAIL("why"); }
// and end the file with int main() { return check::run_all(); }
#pragma once
#include <exception>
#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace check {
struct Failure {
    std::string message;
};
using Case = std::pair<std::string, std::function<void()>>;
inline std::vector<Case>& cases() {
    static std::vector<Case> all;
    return all;
}
struct Register {
    Register(const char* name, std::function<void()> body) { cases().emplace_back(name, std::move(body)); }
};
inline int run_all() {
    std::vector<std::pair<std::string, std::string>> failed;
    for (auto& [name, body] : cases()) {
        try {
            body();
            std::cout << "test " << name << " ... ok\\n";
        } catch (const Failure& f) {
            failed.emplace_back(name, f.message);
            std::cout << "test " << name << " ... FAILED\\n";
        } catch (const std::exception& e) {
            failed.emplace_back(name, std::string("threw ") + e.what());
            std::cout << "test " << name << " ... FAILED\\n";
        }
    }
    if (!failed.empty()) {
        std::cout << "\\nfailures:\\n\\n";
        for (auto& [name, why] : failed) std::cout << "---- " << name << " stdout ----\\n" << why << "\\n\\n";
        std::cout << "failures:\\n";
    }
    std::cout << "\\ntest result: " << (failed.empty() ? "ok" : "FAILED") << ". " << cases().size() - failed.size() << " passed; " << failed.size() << " failed\\n";
    return failed.empty() ? 0 : 1;
}
}  // namespace check

#define CHECK_JOIN2(a, b) a##b
#define CHECK_JOIN(a, b) CHECK_JOIN2(a, b)
#define TEST(name) \\
    static void name(); \\
    static ::check::Register CHECK_JOIN(check_register_, name)(#name, name); \\
    static void name()
#define CHECK(cond) \\
    do { \\
        if (!(cond)) { \\
            std::ostringstream check_o; \\
            check_o << __FILE__ << ":" << __LINE__ << ": CHECK(" #cond ") failed"; \\
            throw ::check::Failure{check_o.str()}; \\
        } \\
    } while (0)
#define CHECK_EQ(a, b) \\
    do { \\
        /* copies, so a value read from a temporary (*opt()) outlives the expression */ \\
        const auto check_a = (a); \\
        const auto check_b = (b); \\
        if (!(check_a == check_b)) { \\
            std::ostringstream check_o; \\
            check_o << __FILE__ << ":" << __LINE__ << ": CHECK_EQ(" #a ", " #b ") failed: " << check_a << " != " << check_b; \\
            throw ::check::Failure{check_o.str()}; \\
        } \\
    } while (0)
#define FAIL(msg) throw ::check::Failure{std::string(__FILE__) + ":" + std::to_string(__LINE__) + ": " + (msg)}
#define CHECK_THROWS(expr) \\
    do { \\
        bool check_threw = false; \\
        try { \\
            (void)(expr); \\
        } catch (...) { \\
            check_threw = true; \\
        } \\
        if (!check_threw) { \\
            std::ostringstream check_o; \\
            check_o << __FILE__ << ":" << __LINE__ << ": CHECK_THROWS(" #expr ") did not throw"; \\
            throw ::check::Failure{check_o.str()}; \\
        } \\
    } while (0)
`

/**
 * A C++ project's build files: CMake for the terminal and ctest (it finds src/, include/ and
 * tests/test_*.cpp by itself, so files added later build too), and compile_flags.txt for clangd,
 * Run and the test explorer.
 */
export function cppBuildFiles(name: string): Record<string, string> {
  const target = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'app'
  return {
    'CMakeLists.txt': [
      'cmake_minimum_required(VERSION 3.20)',
      `project(${target} LANGUAGES CXX)`,
      '',
      'set(CMAKE_CXX_STANDARD 20)',
      'set(CMAKE_CXX_STANDARD_REQUIRED ON)',
      'set(CMAKE_EXPORT_COMPILE_COMMANDS ON)',
      'add_compile_options(-Wall -Wextra -fsanitize=address,undefined -fno-omit-frame-pointer)',
      'add_link_options(-fsanitize=address,undefined)',
      'include_directories(include tests)',
      '',
      '# Everything in src/ but main.cpp is the library the program and the tests share',
      'file(GLOB_RECURSE CORE_SOURCES CONFIGURE_DEPENDS src/*.cpp)',
      'list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/main\\.cpp$")',
      'if(CORE_SOURCES)',
      `  add_library(${target}_core STATIC \${CORE_SOURCES})`,
      'else()',
      `  add_library(${target}_core INTERFACE)`,
      'endif()',
      '',
      'if(EXISTS ${CMAKE_SOURCE_DIR}/src/main.cpp)',
      `  add_executable(${target} src/main.cpp)`,
      `  target_link_libraries(${target} PRIVATE ${target}_core)`,
      'endif()',
      '',
      'enable_testing()',
      'file(GLOB TEST_SOURCES CONFIGURE_DEPENDS tests/test_*.cpp)',
      'foreach(test_source ${TEST_SOURCES})',
      '  get_filename_component(test_name ${test_source} NAME_WE)',
      '  add_executable(${test_name} ${test_source})',
      `  target_link_libraries(\${test_name} PRIVATE ${target}_core)`,
      '  add_test(NAME ${test_name} COMMAND ${test_name})',
      'endforeach()',
      ''
    ].join('\n'),
    'compile_flags.txt': '-std=c++20\n-Wall\n-Wextra\n-Iinclude\n-Itests\n',
    '.gitignore': 'build/\n*.o\n*.dSYM/\n.cache/\n'
  }
}

/** A Foundry project's files: foundry.toml, and forge-std from Tide's tools folder (no git submodule) */
export const FOUNDRY_FILES = {
  'foundry.toml': '[profile.default]\nsrc = "src"\ntest = "test"\nscript = "script"\nout = "out"\nlibs = ["lib"]\noptimizer = true\noptimizer_runs = 200\n\n[fmt]\nline_length = 100\n',
  '.gitignore': 'out/\ncache/\nbroadcast/\n'
}

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
    label: 'Python + pytest',
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
    id: 'cpp',
    label: 'C++',
    about: 'C++20 with CMake, clangd and tests (C++ pack)',
    language: 'C++',
    defaultName: 'cpp-project',
    open: 'src/money.cpp',
    files: (name) => ({
      ...cppBuildFiles(name),
      'include/money.hpp': '#pragma once\n#include <cstdint>\n#include <string>\n\n// An amount in minor units (pence, cents): never a float\nclass Money {\npublic:\n    explicit Money(std::int64_t minor = 0) : minor_(minor) {}\n    std::int64_t minor() const { return minor_; }\n    Money operator+(Money other) const;\n    bool operator==(const Money&) const = default;\n    std::string str() const;\n\nprivate:\n    std::int64_t minor_;\n};\n',
      'src/money.cpp': '#include "money.hpp"\n\n#include <cstdio>\n\nMoney Money::operator+(Money other) const { return Money(minor_ + other.minor_); }\n\nstd::string Money::str() const {\n    char buf[32];\n    std::snprintf(buf, sizeof buf, "%lld.%02lld", static_cast<long long>(minor_ / 100), static_cast<long long>(minor_ % 100));\n    return buf;\n}\n',
      'src/main.cpp': '#include <iostream>\n\n#include "money.hpp"\n\nint main() {\n    Money a(1250), b(399);\n    std::cout << a.str() << " + " << b.str() << " = " << (a + b).str() << "\\n";\n}\n',
      'tests/check.hpp': CHECK_HPP,
      'tests/test_money.cpp': '#include "check.hpp"\n#include "money.hpp"\n\nTEST(adds_minor_units) { CHECK_EQ((Money(1250) + Money(399)).minor(), 1649); }\n\nTEST(prints_pounds_and_pence) { CHECK_EQ(Money(1649).str(), std::string("16.49")); }\n\nint main() { return check::run_all(); }\n',
      'README.md': `# ${name}\n\nRun src/main.cpp with Run, and the tests from the Testing view. In the terminal: \`cmake -S . -B build && cmake --build build && ctest --test-dir build\`.\n`
    })
  },
  {
    id: 'foundry',
    label: 'Solidity (Foundry)',
    about: 'A contract with forge tests (Foundry pack)',
    language: 'Solidity',
    defaultName: 'solidity-project',
    open: 'src/Vault.sol',
    files: (name) => ({
      ...FOUNDRY_FILES,
      'src/Vault.sol': '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n/// @notice Holds ether for each depositor; each withdraws only their own\ncontract Vault {\n    mapping(address => uint256) public balanceOf;\n\n    event Deposited(address indexed who, uint256 amount);\n    event Withdrawn(address indexed who, uint256 amount);\n\n    error Insufficient(uint256 have, uint256 want);\n\n    function deposit() external payable {\n        balanceOf[msg.sender] += msg.value;\n        emit Deposited(msg.sender, msg.value);\n    }\n\n    function withdraw(uint256 amount) external {\n        uint256 have = balanceOf[msg.sender];\n        if (have < amount) revert Insufficient(have, amount);\n        // Effects before the interaction: the balance is reduced before ether leaves\n        balanceOf[msg.sender] = have - amount;\n        (bool ok,) = msg.sender.call{value: amount}("");\n        require(ok, "transfer failed");\n        emit Withdrawn(msg.sender, amount);\n    }\n}\n',
      'test/Vault.t.sol': '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\nimport {Test} from "forge-std/Test.sol";\nimport {Vault} from "../src/Vault.sol";\n\ncontract VaultTest is Test {\n    Vault vault;\n    address alice = makeAddr("alice");\n\n    function setUp() public {\n        vault = new Vault();\n        vm.deal(alice, 10 ether);\n    }\n\n    function test_DepositThenWithdraw() public {\n        vm.startPrank(alice);\n        vault.deposit{value: 1 ether}();\n        vault.withdraw(0.4 ether);\n        vm.stopPrank();\n        assertEq(vault.balanceOf(alice), 0.6 ether);\n        assertEq(alice.balance, 9.4 ether);\n    }\n\n    function test_CannotWithdrawMoreThanDeposited() public {\n        vm.prank(alice);\n        vm.expectRevert(abi.encodeWithSelector(Vault.Insufficient.selector, 0, 1));\n        vault.withdraw(1);\n    }\n\n    function testFuzz_BalanceMatchesDeposits(uint96 amount) public {\n        vm.deal(alice, amount);\n        vm.prank(alice);\n        vault.deposit{value: amount}();\n        assertEq(vault.balanceOf(alice), amount);\n    }\n}\n',
      'README.md': `# ${name}\n\nRun the tests from the Testing view (forge test in Tide's sandbox, offline). forge-std comes from Tide's Foundry pack.\n`
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
