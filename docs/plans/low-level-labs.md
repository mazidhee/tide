# Low-level labs: Python, then C and C++

Watching memory, bytecode and the stack live, to go with the Python-internals depth (shared/subjects `LANGUAGE_DEPTH`), then C and C++.

## Where it stands (November 2026)

**Python: built.** The Python lab (shared/pyLab, renderer lib/pyLab, components/PyLabView).

- **Trace once, replay freely.** `main/pyTrace.py` in its `ops` mode runs the program once under `sys.settrace` with `f_trace_opcodes`, in the same sandbox as Tide's code runs (scratch folder only, no network, 10 s, 2,000 steps). Each step is the state before one bytecode instruction: the frames (each with its code object and instruction offset), the names in each, and every object they reach (type, id, `sys.getsizeof`, items, attributes, an int's base-2^30 digits, a list's allocated slots). Each code object that runs is disassembled once with `dis.get_instructions`. Stepping back is free because nothing runs again.
- **Four panes that follow each step:** the code (the running line, and each caller's line), the bytecode of the frame you're looking at (the next instruction marked and explained in plain words; click a caller's frame to see the `CALL` it waits on), the call stack (newest on top, names bound to objects, the value a frame returns), and the objects (new ones and changed ones marked, hover links a name to its object, list spare capacity drawn as empty slots, small ints tagged as cached).
- **Step by line or by instruction**, play, scrub, keyboard (← → Home End Space).
- **In lessons:** a ```` ```pylab ```` block in tutor text becomes a lab. A Python lesson's tutor is told to use one per mechanism (shared/pyLab `PYTHON_LAB_LINE`, added by `lessonKit` for Python topics). Every ```` ```python ```` block has **Step through**, which turns it into a lab in place.
- **On its own page:** Practice → Python lab, with ten starter programs on Python's internals (references, frames, ints, list growth, strings, a loop in bytecode, closures, mutable defaults, instances, exceptions). `starterFor(topic)` picks the one for a lesson topic, so a lesson can open the page on the right program (`{ kind: 'pylab', topic }`).

What it does not show: CPython's value stack. The interpreter doesn't expose it to Python code, so the lab explains what each instruction pushes and pops, but cannot draw the stack's live contents. Reference counts are left out for the same reason: `sys.getrefcount` from inside a tracer counts the tracer's own references.

## C and C++: the plan

The same model as Python: **compile, run once under a recorder, replay freely**, with the same four panes and the same block in lessons (```` ```clab ```` / ```` ```cpplab ````, and **Step through** on C and C++ blocks). What changes is what each pane shows:

| Pane | Python lab | C / C++ lab |
| --- | --- | --- |
| Code | source line | source line (built `-g -O0`) |
| Bytecode | CPython bytecode | arm64 assembly of the running function, the next instruction marked and explained; registers that changed (x0–x7, sp, fp, lr, pc) |
| Call stack | frames and names | frames with their addresses: each local's address, size (`sizeof`), type and bytes; the saved fp and lr that link frames |
| Memory | objects | a byte grid of the stack region (sp up to the outermost frame) with each local outlined over its bytes, and heap blocks from `malloc`/`new` (size, address, freed or live); pointers drawn as arrows to the bytes they point at |

### The recorder

**Recommended: lldb's scripting API**, driven by a small Python script like `pyTrace.py` (`cTrace.py`), run with Xcode's command line tools (`xcrun lldb -P` gives the module path). It steps by instruction (`SBThread.StepInstruction`), and at each step records the pc, the line, the registers, each frame's variables (`SBFrame.GetVariables`, with load addresses and sizes) and the bytes of the stack region (`SBProcess.ReadMemory`). Heap blocks come from breakpoints on `malloc`, `free`, `operator new` and `operator delete` (size in x0 on entry, address in x0 on return). Steps outside the learner's own code (libc, libc++) are stepped over, as the Python tracer skips frames outside the snippet. Limits like Python's: 30 lines, 2,000 instructions, 10 s.

Tide already finds `lldb-dap` for the IDE's debugger (main/ide/debug), and the C++ track pack supplies the compiler; the lab adds no new dependency.

**The blocker found while planning:** on this Mac, `DevToolsSecurity -status` says Developer mode is disabled, and `lldb` stalls at `run` waiting for macOS to authorise debugging. Every debugger on macOS needs this, including the IDE's existing C and C++ debugging. It is a one-time switch the learner makes (`sudo DevToolsSecurity -enable`, or accepting macOS's prompt once); Tide should never do it for them. The lab would check it first and, when it is off, say exactly what to run and why.

**The alternative, if enabling Developer mode is unwelcome:** run the compiled code in an emulator instead of under a debugger. Unicorn (CPU emulation, a Python package) can execute an arm64 object built with `-O0 -ffreestanding` and report every instruction, register and memory write with no OS permission at all, and inside Tide's sandbox. The cost: no libc, so `printf` and `malloc` need small stand-ins Tide provides (enough for teaching programs), and the addresses are the emulator's, not a real process's. It suits C better than C++ (exceptions and the standard library are out of reach).

### Order of work

1. `cTrace.py` with lldb: C only, stack and registers, a fixed set of starter programs (locals on the stack, arrays decaying to pointers, pointer arithmetic, a struct's layout and padding, recursion, a buffer over-run caught in the act). Shared trace shape `CTrace` in shared/cLab, cleaned field by field like `cleanTrace`.
2. The renderer: the assembly pane and the byte-grid memory pane, reusing the lab's bar, controls, stack pane and stepping (shared/pyLab `stepFrom` and `startsLine` already work on any steps with a line and a frame depth).
3. The heap: malloc/free breakpoints, live and freed blocks, use-after-free and leaks marked.
4. C++: name demangling, `this`, references shown as the pointers they compile to, a `std::vector`'s three pointers (begin, end, capacity) over its heap block, constructors and destructors as frames, RAII made visible.
5. Lessons: `C_LAB_LINE` for C and C++ topics in `lessonKit`, as Python has.

### Decision needed before step 1

Whether the learner is happy to turn on Developer mode once (lldb: real processes, real addresses, C and C++), or whether the C lab should run in an emulator (no permission, C only, stand-in libc). The recommendation is lldb with Developer mode: it is what any C or C++ developer on a Mac turns on, the IDE's debugger needs it anyway, and it is the only way to show C++ faithfully.
