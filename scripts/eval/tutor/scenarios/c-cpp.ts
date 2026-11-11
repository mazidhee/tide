/**
 * C and C++: one scenario for each kind of situation. Every program here was compiled and run
 * (Apple clang, arm64, with -Wall and the address and undefined-behaviour sanitisers where they
 * apply); sizes and offsets are those of a typical 64-bit platform, which each problem states.
 * String.raw keeps backslashes ('\0', "\n") as typed; ~~~ stands for a code fence.
 */
import type { Scenario } from '../types'

const r = String.raw
const code = (s: string) => s.replace(/~~~/g, '```')

export const CCPP: Scenario[] = [
  {
    id: 'c-cpp-open-move-semantics',
    subject: 'c-cpp',
    situation: 'open',
    setup: { mode: 'teach', topic: 'Move semantics and rvalue references' },
    history: [],
    expect: { ends: 'ask', askTypes: ['short', 'predict', 'choice', 'explain'], heading: 'Why this matters', forbid: ['grade', 'summary', 'solution'] },
    good: r`**Why this matters**

Copying a std::vector of a million elements allocates a new buffer and copies a million elements; moving it copies three pointers. Move semantics is how C++ hands a resource over instead of duplicating it. It is why returning a large container by value is cheap, why a std::unique_ptr can be stored in a vector at all, and why push_back of a temporary string makes no second allocation. Every class that owns memory, a file or a socket has to get it right, and it is the ground under the rule of five and perfect forwarding.

<ask type="predict">Given std::string s = "hello" and a std::vector<std::string> v, the line v.push_back(std::move(s)) runs. What does std::move itself do to s, and what may s contain afterwards?</ask>`,
    bad: [
      {
        reply: r`Hello! Move semantics is one of the most exciting features of modern C++. Let's dive in.

Have you used std::move before? What do you think an rvalue is?`,
        fails: ['no-preamble', 'heading'],
        repaired: ['ask']
      }
    ],
    judge: 'The opening names concrete places where moving matters, and its question probes what the learner believes std::move does rather than teaching it.'
  },
  {
    id: 'c-cpp-after-correct-integer-promotion',
    subject: 'c-cpp',
    situation: 'after-correct',
    setup: { mode: 'teach', topic: 'Integer promotion in C', options: { difficulty: 'hard' } },
    history: [
      {
        tutor: code(r`<plan>
- Promotion in arithmetic
- Promotion with bitwise operators and comparisons
</plan>

In C, an operand whose type is narrower than int (char, short, uint8_t, uint16_t) is converted to int before any arithmetic. The operation is done in int; the value is narrowed only if the result is stored back in a small type.

**Problem 1 · hard**

~~~c
uint8_t a = 200, b = 100;
uint8_t c = a + b;
int d = a + b;
~~~

Give the values of c and d on a platform with 32-bit int.

<solution>Both operands are promoted to int, so a + b is 300 in both lines. d = 300. Storing 300 in a uint8_t reduces it modulo 256: c = 44.</solution>

<ask type="problem">The values of c and d, with the reason for each.</ask>`)
      },
      { learner: { answer: 'd is 300 and c is 44. a and b are both promoted to int before the addition, so the sum is 300 and nothing wraps. d keeps it. c is a uint8_t, so the 300 is converted modulo 256 when it is stored: 300 - 256 = 44.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'correct', setsProblem: true, askTypes: ['problem', 'error', 'explain', 'code'], mustNot: [r`c (is|=) 300`] },
    good: code(r`<grade verdict="correct" score="1">"promoted to int before the addition, so the sum is 300" and "converted modulo 256 when it is stored" are the two facts: the wrap happens at the store, not in the addition.</grade>

**Problem 2 · harder**

~~~c
uint8_t x = 0x0F;
if (~x == 0xF0) puts("equal");
else puts("different");
~~~

Say what this prints on a platform with 32-bit int, and give the value of ~x.

<solution>x is promoted to int before ~ is applied, so ~x is ~0x0000000F = 0xFFFFFFF0, which is -16 as an int. 0xF0 is 240. They differ, so it prints "different". Casting back, (uint8_t)~x == 0xF0, is true.</solution>

<ask type="problem">What it prints, and the value of ~x, with your reasoning.</ask>`),
    bad: [
      {
        reply: code(r`<grade verdict="partial" score="0.5">You are on the right track with promotion.</grade>

**Problem 2 · harder**

~~~c
uint8_t x = 0x0F;
if (~x == 0xF0) puts("equal");
~~~

<ask type="problem">Does it print equal?</ask>`),
        fails: ['verdict'],
        repaired: ['solution']
      }
    ]
  },
  {
    id: 'c-cpp-after-wrong-array-decay',
    subject: 'c-cpp',
    situation: 'after-wrong',
    setup: { mode: 'teach', topic: 'Arrays decaying to pointers in C', options: { strategy: 'code' } },
    history: [
      {
        tutor: code(r`An array passed to a function is the next thing to test.

~~~c
#include <stdio.h>

void f(int a[10]) { printf("%zu\n", sizeof(a)); }

int main(void) {
    int a[10];
    printf("%zu\n", sizeof(a));
    f(a);
}
~~~

<ask type="predict">On a 64-bit machine with 4-byte int, which two numbers does this print? Say why.</ask>`)
      },
      { learner: { answer: '40 and 40. The parameter is declared as int a[10], so f receives the whole array of ten ints, and sizeof gives 10 × 4 = 40 in both places.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: ['pointer', r`\b8\b|int\s*\*|decay`], need: ['card'] },
    good: code(r`<grade verdict="wrong" score="0.2">"f receives the whole array of ten ints" is the step that fails. It prints 40 then 8: inside f, a is a pointer, and sizeof(a) is the size of an int *.</grade>

C never passes an array by value. In a parameter list, int a[10] is rewritten by the compiler to int *a, and the 10 is ignored. At the call f(a) the array decays to a pointer to its first element, so the length does not travel with it. That is why a function that takes an array also takes a count. The compiler says so here: "sizeof on array function parameter will return size of 'int *'".

<note>An array parameter is a pointer: void f(int a[10]) means void f(int *a). sizeof(a) inside f is the pointer's size (8 on 64-bit), not the array's. Pass the length separately.</note>

<card>What is sizeof(a) inside void f(int a[10]) on a 64-bit machine? :: 8, the size of an int *. An array parameter is adjusted to a pointer, and the length is not passed.</card>

<ask type="code" lang="c">Write int sum(const int *a, size_t n) that adds up n ints. In main, declare int a[10] holding 1 to 10, work out n with sizeof there, and print sum(a, n). It should print 55.</ask>

<solution>int sum(const int *a, size_t n) { int t = 0; for (size_t i = 0; i < n; i++) t += a[i]; return t; } In main: size_t n = sizeof a / sizeof a[0]; which is 40 / 4 = 10, and printf("%d\n", sum(a, n)); prints 55.</solution>`),
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Yes, sizeof gives 10 × 4 = 40 for an array of ten ints.</grade>

<ask type="short">What would it print for an array of 20 ints?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The learner is sure an array parameter receives the whole array. The reply must say the parameter is a pointer, give 8 as the second number, and move to a task that passes the length.'
  },
  {
    id: 'c-cpp-idk-virtual-dispatch',
    subject: 'c-cpp',
    situation: 'idk',
    setup: { mode: 'teach', topic: 'Virtual dispatch and vtables', options: { why: true } },
    history: [
      {
        tutor: code(r`**Why this matters**

Virtual dispatch is how one call site runs different code depending on the object behind it. It is what a plugin interface, a GUI widget hierarchy and a compiler's tree of node classes are built on. It costs an indirect call and usually blocks inlining, so knowing the mechanism tells you when it is worth paying for.

~~~cpp
struct Shape { virtual double area() const { return 0; } };
struct Circle : Shape {
    double r = 1;
    double area() const override { return 3.14159 * r * r; }
};

double measure(const Shape *s) { return s->area(); }
~~~

<ask type="short">measure is compiled once, knowing only that s points at some Shape. Passed a Circle, it still runs Circle::area. How can the compiled call find the right function at run time?</ask>`)
      },
      { learner: { idk: true } }
    ],
    expect: { ends: 'ask', must: ['v-?table|virtual (function )?table|vptr'], askMustNot: [r`\b16\b`] },
    good: r`Start from what measure has to work with. It was compiled before any Circle was passed to it, so the choice of function cannot be in its code. The only thing that differs between a call with a Shape and a call with a Circle is the object s points at, so the information has to be inside the object.

That is what the compiler arranges. For each class with virtual functions it builds one table of function addresses, the vtable: Shape's holds the address of Shape::area, and Circle's holds the address of Circle::area in the same slot. Every object of such a class carries a hidden pointer to its class's table, the vptr, set by the constructor. The call s->area() compiles to three steps: load the vptr from the object, load the function address from the slot for area, call it.

<ask type="predict">struct A { int x; void f(); }; has sizeof 4 on a 64-bit machine. Make f virtual and change nothing else. Does sizeof(A) stay 4? Say why or why not.</ask>`,
    judge: 'It reasons from "the information must be in the object" to the hidden pointer and table rather than only naming them, and asks something easier that follows from that.'
  },
  {
    id: 'c-cpp-show-me-strlen-terminator',
    subject: 'c-cpp',
    situation: 'show-me',
    setup: { mode: 'teach', topic: 'C strings and the terminator' },
    history: [
      {
        tutor: code(r`A C string has no stored length. It is an array of char that ends with a byte of value 0, written '\0', and every string function finds the end by looking for that byte. This is strlen written out:

~~~c
size_t my_strlen(const char *s) {
    const char *p = s;
    while (*p) p++;
    return (size_t)(p - s);
}
~~~

For "cat" the array holds four bytes: 'c', 'a', 't', '\0'. p starts at s, the loop advances it while the byte it points at is non-zero, and it stops on the terminator at index 3. p - s is then 3. The length does not count the terminator, but the array needs room for it.

<note>A C string is a char array ending in '\0'. strlen counts the bytes before the terminator: strlen("cat") is 3, but "cat" occupies 4 bytes.</note>

<continue/>`)
      },
      { learner: { showMe: true } }
    ],
    // A trace table, or the array drawn cell by cell with its terminator: both show where strlen stops
    expect: { ends: 'nothing', visual: [{ kind: 'table' }, { kind: 'mermaid', diagram: ['flowchart'] }], forbid: ['grade'], must: [r`\\0|NUL|terminator`] },
    good: r`| Step | p - s | *p | *p non-zero | Action |
|---|---|---|---|---|
| 1 | 0 | 'c' | yes | p++ |
| 2 | 1 | 'a' | yes | p++ |
| 3 | 2 | 't' | yes | p++ |
| 4 | 3 | '\0' | no | stop, return 3 |

Look at the last row: the loop ends on the fourth byte, the terminator, so a string of length 3 occupies 4 bytes.`,
    bad: [
      {
        reply: r`The pointer p starts at 'c', moves to 'a', then to 't', and then reaches the zero byte, where the loop stops and the function returns 3.

<ask type="short">How many bytes does "cat" occupy?</ask>`,
        fails: ['ends', 'visual']
      }
    ]
  },
  {
    id: 'c-cpp-mark-planted-error-struct-padding',
    subject: 'c-cpp',
    situation: 'mark-planted-error',
    setup: { mode: 'teach', topic: 'Struct layout, padding and alignment' },
    history: [
      {
        tutor: code(r`**Problem 2 · same level**

~~~c
struct S {
    char tag;
    double value;
    int count;
};
~~~

On a typical 64-bit platform (char is 1 byte; int is 4 bytes, aligned to 4; double is 8 bytes, aligned to 8), give the offset of each member and sizeof(struct S).

<solution>tag at offset 0. value must start at a multiple of 8: 7 bytes of padding, offset 8, ending at 16. count at offset 16, ending at 20. The struct's alignment is that of its strictest member, 8, and its size must be a multiple of that, so 4 bytes of tail padding follow count: sizeof(struct S) is 24.</solution>

<ask type="problem">The three offsets and the size, with your working.</ask>`)
      },
      { learner: { answer: 'tag is at offset 0 and takes 1 byte. value is a double, so it has to start at a multiple of 8: 7 padding bytes, then value at offset 8, ending at byte 16. count needs a multiple of 4 and 16 is one, so count is at offset 16 and ends at byte 20. Nothing comes after count, so sizeof(struct S) is 20.', confidence: 'sure' } }
    ],
    expect: { ends: 'ask', verdict: 'partial', accept: ['wrong'], names: [r`\b24\b`, r`tail|trailing|multiple of (8|its|the)|round(ed|s|ing)? up|padding (at the end|after)`], must: [r`\b24\b`] },
    good: code(r`<grade verdict="partial" score="0.7">The offsets 0, 8 and 16 are right. The last step, "Nothing comes after count, so sizeof(struct S) is 20", is wrong: a struct's size must be a multiple of its alignment, which is 8 here because of the double, so 4 bytes of tail padding follow count and sizeof is 24.</grade>

The reason is arrays. In struct S arr[2], the second element starts sizeof(struct S) bytes after the first. At 20, its value member would sit at byte 28, which is not a multiple of 8. At 24, it sits at 32.

<card>Why is sizeof(struct { char tag; double value; int count; }) 24 and not 20? :: A struct's size is rounded up to a multiple of its strictest member's alignment (8), so 4 bytes of tail padding follow count. Otherwise array elements would be misaligned.</card>

**Problem 3 · same level**

~~~c
struct T {
    double value;
    int count;
    char tag;
};
~~~

Same platform, same three members in a different order. Give each offset and sizeof(struct T).

<solution>value at 0, ending at 8. count at 8, ending at 12. tag at 12, ending at 13. Alignment is 8, so the size rounds up from 13 to 16: 3 bytes of tail padding. sizeof(struct T) is 16.</solution>

<ask type="problem">The three offsets and the size, with your working.</ask>`),
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your steps "7 padding bytes", "value at offset 8" and "count is at offset 16" are all right, and the size follows.</grade>

<ask type="short">What changes if count is declared before value?</ask>`,
        fails: ['verdict', 'names', 'must']
      }
    ],
    judge: 'Every offset is right and only the missing tail padding is wrong. The reply must say the size is 24 and why the struct is padded at the end.'
  },
  {
    id: 'c-cpp-mark-unusual-correct-pointer-difference',
    subject: 'c-cpp',
    situation: 'mark-unusual-correct',
    setup: { mode: 'teach', topic: 'Pointers and pointer arithmetic' },
    history: [
      {
        tutor: code(r`**Problem 1 · warm-up**

~~~c
int a[6] = {10, 20, 30, 40, 50, 60};
int *p = &a[1];
int *q = &a[5];
~~~

With 4-byte int, give the value of q - p and the number of bytes between the two addresses.

<solution>Pointer subtraction counts elements, so q - p = 5 - 1 = 4. In bytes: 4 × sizeof(int) = 4 × 4 = 16.</solution>

<ask type="problem">q - p and the distance in bytes, with how you got them.</ask>`)
      },
      { learner: { answer: 'I put numbers on it. Say a starts at address 1000. Then p is 1000 + 1×4 = 1004 and q is 1000 + 5×4 = 1020. The addresses are 1020 - 1004 = 16 bytes apart. Subtracting two int pointers gives the byte difference divided by sizeof(int), so q - p = 16 / 4 = 4.' } }
    ],
    expect: { ends: 'ask', verdict: 'correct' },
    good: r`<grade verdict="correct" score="1">"16 bytes apart" and "q - p = 16 / 4 = 4" are both right, and "the byte difference divided by sizeof(int)" is exactly what the compiler does. The starting address of 1000 cancels out, so the answer does not depend on it.</grade>

<ask type="short">Using the same p and q, what is the value of (char *)q - (char *)p, and why does it differ from q - p?</ask>`,
    bad: [
      {
        reply: r`<grade verdict="partial" score="0.5">The array is not really at address 1000, so the working is not valid. You should subtract the indices: 5 - 1.</grade>

<ask type="short">What is 5 - 1?</ask>`,
        fails: ['verdict']
      }
    ],
    judge: 'The learner worked from an assumed base address and divided by the element size: a complete, correct method that looks nothing like subtracting indices.'
  },
  {
    id: 'c-cpp-tangent-make-shared',
    subject: 'c-cpp',
    situation: 'tangent',
    setup: { mode: 'teach', topic: 'Smart pointers: shared_ptr and reference cycles' },
    history: [
      {
        tutor: code(r`**Why this matters**

std::shared_ptr frees an object when the last owner lets go, which removes most manual delete calls from graph, cache and callback code. It counts owners and nothing else, so two objects that own each other are never freed. That leak is silent, and it is the usual reason std::weak_ptr appears in a design.

~~~cpp
struct Node { std::shared_ptr<Node> next; };

void build() {
    auto a = std::make_shared<Node>();
    auto b = std::make_shared<Node>();
    a->next = b;
    b->next = a;
}
~~~

<ask type="predict">When build returns and a and b go out of scope, are the two Node objects destroyed? Say what each reference count is at that point.</ask>`)
      },
      { learner: { question: 'Quick one first: is make_shared just a shorter way to write shared_ptr<Node>(new Node)?' } }
    ],
    expect: { ends: 'ask', forbid: ['grade'], must: ['control block|one allocation|single allocation'], words: { max: 170 } },
    good: r`Not quite. Both give a shared_ptr that owns a new Node, but std::shared_ptr<Node>(new Node) makes two heap allocations, one for the Node and one for the control block that holds the reference counts, while std::make_shared<Node>() makes one allocation holding both. That is cheaper and keeps the counts next to the object. The cost is that the Node's memory cannot be returned until the last weak_ptr to it has gone as well, and make_shared cannot take a custom deleter.

Back to the two nodes, which use the counts in that control block.

<ask type="predict">a and b have each been stored in the other's next. When build returns and both local variables are gone, what is each Node's reference count, and is either Node destroyed?</ask>`,
    judge: 'It answers the make_shared question briefly and exactly (one allocation against two), then returns to the pending cycle question without grading anything.'
  },
  {
    id: 'c-cpp-recall-open-raii',
    subject: 'c-cpp',
    situation: 'recall-open',
    setup: { mode: 'recall', topic: 'RAII and destructors' },
    history: [],
    expect: { ends: 'ask', askTypes: ['explain'], forbid: ['grade', 'summary', 'card'], mustNot: ['scope', 'acquir|releas', 'unwind|exception'], words: { max: 60 } },
    good: r`<ask type="explain">Explain RAII and destructors from memory, as fully as you can.</ask>`,
    bad: [
      {
        reply: r`RAII ties a resource to an object's lifetime: it is acquired in the constructor and released when the object goes out of scope.

<ask type="short">Which destructors run during stack unwinding?</ask>`,
        fails: ['ask-type', 'must-not']
      }
    ]
  },
  {
    id: 'c-cpp-code-bug-erase-in-loop',
    subject: 'c-cpp',
    situation: 'code-bug',
    setup: { mode: 'teach', topic: 'Iterator invalidation in std::vector', options: { strategy: 'code' } },
    history: [
      {
        tutor: r`v.erase removes an element and shifts every later element down one place. Any iterator at or after the erased position is invalidated: it no longer refers to what it did, and using it is undefined behaviour.

<note>v.erase(it) invalidates it and every iterator after it. Iterators before the erased position stay valid.</note>

<ask type="code" lang="cpp">Write void remove_evens(std::vector<int>& v) that erases every even element in place, using a loop and v.erase. Test it on {1, 2, 4, 5, 7}: it should leave 1 5 7.</ask>

<solution>void remove_evens(std::vector<int>& v) { for (auto it = v.begin(); it != v.end(); ) { if (*it % 2 == 0) it = v.erase(it); else ++it; } } On {1, 2, 4, 5, 7} it leaves 1 5 7.</solution>`
      },
      {
        learner: {
          answer: code(r`~~~cpp
#include <iostream>
#include <vector>

void remove_evens(std::vector<int>& v) {
    for (auto it = v.begin(); it != v.end(); ++it) {
        if (*it % 2 == 0) v.erase(it);
    }
}

int main() {
    std::vector<int> v{1, 2, 4, 5, 7};
    remove_evens(v);
    for (int x : v) std::cout << x << ' ';
    std::cout << '\n';
}
~~~`)
        }
      }
    ],
    expect: { ends: 'ask', verdict: 'wrong', accept: ['partial'], names: ['invalid', r`=\s*v\.erase|erase_if|remove_if|returns|returned|return value`], need: ['card'] },
    good: r`<grade verdict="wrong" score="0.2">The line "if (*it % 2 == 0) v.erase(it);" is the one that fails. erase invalidates it, and the loop then does ++it on the invalidated iterator, which is undefined behaviour. On your test it prints 1 4 5 7: once 2 is erased, 4 slides into its place and ++it steps over it.</grade>

erase returns an iterator to the element that followed the erased one, and that is the valid position to carry on from. So the loop has to assign it = v.erase(it) when it erases, and do ++it only when it does not. When the last element is even, your version also steps past end() and reads beyond the vector.

<card>How do you erase from a std::vector while iterating over it? :: Assign the result: it = v.erase(it), and only ++it when nothing was erased. erase invalidates it and returns the next valid iterator.</card>

<ask type="code" lang="cpp">Fix remove_evens so the loop carries on from the iterator that erase returns. Test it on {1, 2, 4, 5, 7} and on {2, 4, 6}: it should leave 1 5 7, and an empty vector.</ask>

<solution>void remove_evens(std::vector<int>& v) { for (auto it = v.begin(); it != v.end(); ) { if (*it % 2 == 0) it = v.erase(it); else ++it; } } {1, 2, 4, 5, 7} becomes 1 5 7 and {2, 4, 6} becomes empty.</solution>`,
    bad: [
      {
        reply: r`<grade verdict="correct" score="1">Your loop visits each element and erases the even ones in place.</grade>

<ask type="short">What is the time complexity of erasing from the middle of a vector?</ask>`,
        fails: ['verdict', 'names', 'need:card']
      }
    ],
    judge: 'The submitted loop uses the iterator after erase invalidated it and prints 1 4 5 7. The reply must point at that line and give the fix of continuing from what erase returns.'
  }
]
