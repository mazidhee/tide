# C++ Roadmap

From the basics to modern C++: the language, how objects live and die, templates and the standard library, performance, then concurrency and systems work. Write and run every example with clang on this Mac (`clang++ -std=c++20 -Wall -Wextra -fsanitize=address,undefined`), and keep the sanitizers on. The C++ pack (Settings › Tools) adds CMake; clangd, the debugger and the projects' tests then work in Tide's IDE.

## 1. The language core — CORE

### Basics

- [ ] Compilation and linking: translation units, headers and the one-definition rule
- [ ] Types, values and initialisation: brace initialisation, narrowing and auto
- [ ] Functions, overloading and default arguments
- [ ] References and const correctness
- [ ] Pointers and arrays, and why arrays decay
- [ ] Namespaces, scope and linkage
    - _A Tour of C++ (3rd edition) — Bjarne Stroustrup_
    - _Learn C++ — learncpp.com_

### Classes

- [ ] Classes, constructors and member initialiser lists
- [ ] Destructors and RAII
- [ ] Operator overloading
- [ ] Inheritance, virtual functions and the vtable
- [ ] Interfaces, and when not to use inheritance
    - _C++ Core Guidelines — Bjarne Stroustrup and Herb Sutter_

### Practice

- [ ] Practice: Problem set, a fixed-point decimal type with operators and tests, sanitizers on

**Capstone**

- [ ] Project: A command-line ledger in C++ with classes, RAII file handling and unit tests (project: cpp-ledger)

## 2. Memory and object lifetime — CORE

### Ownership

- [ ] Stack, heap and storage duration
- [ ] new and delete, and why you rarely write them
- [ ] unique_ptr, shared_ptr and weak_ptr
- [ ] The rules of zero, three and five
- [ ] Copy and move semantics, rvalue references
- [ ] std::move and perfect forwarding
- [ ] Exception safety guarantees
    - _Effective Modern C++ — Scott Meyers_

### Undefined behaviour

- [ ] Undefined behaviour: dangling references, use after free, out of bounds
- [ ] AddressSanitizer and UndefinedBehaviorSanitizer
- [ ] Object layout, alignment and padding
    - _AddressSanitizer — Clang documentation_

### Practice

- [ ] Practice: Problem set, a small vector with correct copy, move and exception safety

**Capstone**

- [ ] Project: A memory pool allocator and a smart-pointer library, fuzzed and sanitizer-clean

## 3. Templates and the standard library — CORE

### Generic programming

- [ ] Function and class templates
- [ ] Template argument deduction and CTAD
- [ ] Concepts and requires clauses
- [ ] Variadic templates and fold expressions
- [ ] constexpr and compile-time computation
- [ ] SFINAE and type traits, for reading older code
    - _C++ Templates: The Complete Guide (2nd edition) — David Vandevoorde, Nicolai Josuttis and Douglas Gregor_

### The standard library

- [ ] Containers and their costs: vector, deque, map, unordered_map
- [ ] Iterators and iterator invalidation
- [ ] Algorithms and ranges
- [ ] std::optional, std::variant and std::expected
- [ ] std::string, string_view and std::span
- [ ] Lambdas and closures
    - _cppreference.com — cppreference contributors_

### Practice

- [ ] Practice: Problem set, a generic ring buffer constrained by concepts, with ranges-based tests

**Capstone**

- [ ] Project: A header-only container library (a flat map and a small vector) with concepts and benchmarks

## 4. Performance — CORE

### Measuring

- [ ] Benchmarking properly: Google Benchmark, warm-up and noise
- [ ] Profiling with perf and Instruments
- [ ] Reading compiler output in Compiler Explorer
    - _Performance Analysis and Tuning on Modern CPUs — Denis Bakhvalov_

### Making it fast

- [ ] Caches, locality and data-oriented design
- [ ] Avoiding allocations: reserve, small-buffer optimisation and arenas
- [ ] Inlining and branch prediction
- [ ] Copy elision and return value optimisation
- [ ] SIMD and auto-vectorisation
    - _What Every Programmer Should Know About Memory — Ulrich Drepper_

### Practice

- [ ] Practice: Case study, speed up an order-book update loop tenfold and back every gain with a measurement

**Capstone**

- [ ] Project: A limit order book in C++ matching a million orders a second, with benchmarks and a profile (project: cpp-order-book)

## 5. Concurrency and systems — CORE

Courses: BusTub, the CMU 15-445 projects in C++ (bustub); CMU 15-445 lectures (yt-cmu-15-445)

### Concurrency

- [ ] std::thread, jthread and stop tokens
- [ ] Mutexes, locks and condition variables
- [ ] Atomics and the C++ memory model
- [ ] Data races and ThreadSanitizer
- [ ] A lock-free single-producer single-consumer queue
- [ ] Futures, async and thread pools
    - _C++ Concurrency in Action (2nd edition) — Anthony Williams_

### Systems

- [ ] CMake: targets and dependencies
- [ ] Static and shared libraries, symbols and the ABI
- [ ] Sockets and non-blocking I/O
- [ ] Debugging with lldb
- [ ] Errors: exceptions, error codes and noexcept
    - _Professional CMake — Craig Scott_

### Practice

- [ ] Practice: Problem set, a thread-safe bounded queue checked under ThreadSanitizer

**Capstone**

- [ ] Project: A buffer pool manager and a B+ tree index for a teaching database (BusTub)

## 6. Modern C++ in practice — SUPPORTING

### Newer standards

- [ ] Modules
- [ ] Coroutines
- [ ] std::format and std::print
- [ ] Three-way comparison
    - _C++20: The Complete Guide — Nicolai Josuttis_

### Craft

- [ ] Reading a large codebase: Abseil and LLVM
- [ ] Code review against the Core Guidelines
- [ ] Static analysis with clang-tidy
    - _Abseil C++ Tips of the Week — Abseil team_

**Capstone**

- [ ] Project: A small key-value server in C++20 with coroutines over sockets, built with CMake and tested
