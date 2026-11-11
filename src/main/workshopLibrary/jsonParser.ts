import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts.

const STARTER = String.raw`"""A JSON parser and writer from first principles. Built in four stages; see STAGE-1.md."""


class JSONError(ValueError):
    """Raised for text that is not JSON. pos is the offset in the text where the problem was found."""

    def __init__(self, message, pos):
        super().__init__("%s at position %d" % (message, pos))
        self.msg = message
        self.pos = pos


def tokenize(text):
    # Stage 1: the list of (kind, value, pos) tokens in text.
    raise NotImplementedError("stage 1: tokenize")


def loads(text):
    # Stage 2: the Python value the JSON text stands for.
    raise NotImplementedError("stage 2: loads")


def dumps(value):
    # Stage 4: compact JSON text for a Python value.
    raise NotImplementedError("stage 4: dumps")
`

const SOLUTION = String.raw`"""A JSON parser and writer from first principles: a tokeniser, a recursive-descent parser, and a serialiser."""
import re


class JSONError(ValueError):
    """Raised for text that is not JSON. pos is the offset in the text where the problem was found."""

    def __init__(self, message, pos):
        super().__init__("%s at position %d" % (message, pos))
        self.msg = message
        self.pos = pos


PUNCT = "{}[]:,"
WS = " \t\n\r"
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
WORD = re.compile(r"[A-Za-z]+")
LITERALS = {"true": True, "false": False, "null": None}
ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
MAX_DEPTH = 200


def _hex4(text, j):
    h = text[j:j + 4]
    if len(h) != 4 or any(c not in "0123456789abcdefABCDEF" for c in h):
        raise JSONError("invalid \\u escape", j - 2)
    return int(h, 16)


def _string(text, start):
    out = []
    j = start + 1
    n = len(text)
    while True:
        if j >= n:
            raise JSONError("unterminated string", start)
        c = text[j]
        if c == '"':
            return "".join(out), j + 1
        if c == "\\":
            if j + 1 >= n:
                raise JSONError("unterminated string", start)
            e = text[j + 1]
            if e in ESCAPES:
                out.append(ESCAPES[e])
                j += 2
                continue
            if e == "u":
                code = _hex4(text, j + 2)
                j += 6
                if 0xD800 <= code <= 0xDBFF and text[j:j + 2] == "\\u":
                    low = _hex4(text, j + 2)
                    if 0xDC00 <= low <= 0xDFFF:
                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                        j += 6
                out.append(chr(code))
                continue
            raise JSONError("invalid escape \\%s" % e, j)
        if ord(c) < 0x20:
            raise JSONError("control character in a string", j)
        out.append(c)
        j += 1


def tokenize(text):
    tokens = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in WS:
            i += 1
        elif c in PUNCT:
            tokens.append((c, None, i))
            i += 1
        elif c == '"':
            s, end = _string(text, i)
            tokens.append(("string", s, i))
            i = end
        elif c == "-" or c.isdigit():
            m = NUMBER.match(text, i)
            if not m:
                raise JSONError("bad number", i)
            end = m.end()
            if end < n and (text[end].isdigit() or text[end] == "."):
                raise JSONError("bad number", i)
            tokens.append(("number", m.group(), i))
            i = end
        else:
            m = WORD.match(text, i)
            if m and m.group() in LITERALS:
                tokens.append(("literal", LITERALS[m.group()], i))
                i = m.end()
            else:
                raise JSONError("unexpected character %r" % c, i)
    return tokens


class _Parser:
    def __init__(self, tokens, end):
        self.tokens = tokens
        self.i = 0
        self.end = end

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else ("end", None, self.end)

    def expect(self, kind, what):
        t = self.peek()
        if t[0] != kind:
            raise JSONError("expected %s" % what, t[2])
        self.i += 1
        return t

    def value(self, depth):
        t = self.peek()
        if depth > MAX_DEPTH:
            raise JSONError("nested too deeply", t[2])
        kind = t[0]
        if kind == "{":
            return self.obj(depth)
        if kind == "[":
            return self.arr(depth)
        if kind == "string" or kind == "literal":
            self.i += 1
            return t[1]
        if kind == "number":
            self.i += 1
            s = t[1]
            return float(s) if any(c in s for c in ".eE") else int(s)
        raise JSONError("expected a value", t[2])

    def obj(self, depth):
        self.i += 1
        out = {}
        if self.peek()[0] == "}":
            self.i += 1
            return out
        while True:
            key = self.expect("string", "a string key")[1]
            self.expect(":", "':'")
            out[key] = self.value(depth + 1)
            t = self.peek()
            if t[0] == ",":
                self.i += 1
                continue
            if t[0] == "}":
                self.i += 1
                return out
            raise JSONError("expected ',' or '}'", t[2])

    def arr(self, depth):
        self.i += 1
        out = []
        if self.peek()[0] == "]":
            self.i += 1
            return out
        while True:
            out.append(self.value(depth + 1))
            t = self.peek()
            if t[0] == ",":
                self.i += 1
                continue
            if t[0] == "]":
                self.i += 1
                return out
            raise JSONError("expected ',' or ']'", t[2])


def loads(text):
    if not isinstance(text, str):
        raise TypeError("loads takes a str")
    p = _Parser(tokenize(text), len(text))
    v = p.value(0)
    if p.i < len(p.tokens):
        raise JSONError("extra data after the value", p.tokens[p.i][2])
    return v


_OUT = {'"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f"}


def _quote(s):
    out = []
    for c in s:
        if c in _OUT:
            out.append(_OUT[c])
        elif ord(c) < 0x20:
            out.append("\\u%04x" % ord(c))
        else:
            out.append(c)
    return '"' + "".join(out) + '"'


def dumps(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("%r has no JSON form" % value)
        return repr(value)
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(dumps(x) for x in value) + "]"
    if isinstance(value, dict):
        parts = []
        for k, x in value.items():
            if not isinstance(k, str):
                raise TypeError("object keys must be strings, got %s" % type(k).__name__)
            parts.append(_quote(k) + ":" + dumps(x))
        return "{" + ",".join(parts) + "}"
    raise TypeError("cannot write a %s as JSON" % type(value).__name__)
`

const HELPERS = String.raw`import json_parser as jp
from json_parser import JSONError, tokenize, loads, dumps

def outcome(f, *args):
    """What calling f(*args) did, in words for a message, and the exception if one was raised."""
    try:
        r = f(*args)
    except Exception as e:
        return "it raised %s: %s" % (type(e).__name__, e), e
    return "it returned %r" % (r,), None
`

export const jsonParser: WorkshopProject = {
  id: 'json-parser',
  title: 'A JSON parser from first principles',
  outcome: 'A JSON reader and writer in plain Python, without the json module: a tokeniser, a recursive-descent parser that says where malformed input goes wrong, full string escapes including surrogate pairs, and a serialiser whose output Python’s own json module agrees with.',
  area: 'python',
  prerequisites: ['Recursion', 'Strings and Unicode'],
  languages: ['python'],
  stages: [
    {
      id: 'tokens',
      title: 'Cut the text into tokens',
      goal: 'Turn JSON text into a list of tokens, each with its kind, its value and where it starts.',
      brief: `In \`json_parser.py\`, write \`tokenize(text)\`. It returns a list of tuples \`(kind, value, pos)\`, where \`pos\` is the offset in \`text\` where the token starts.

| text | kind | value |
|---|---|---|
| \`{ } [ ] : ,\` | the character itself | \`None\` |
| \`true\`, \`false\`, \`null\` | \`"literal"\` | \`True\`, \`False\`, \`None\` |
| a number such as \`-12.5e3\` | \`"number"\` | the number's text, unchanged (\`"-12.5e3"\`) |
| a string such as \`"hi"\` | \`"string"\` | the characters between the quotes (\`"hi"\`) |

- Whitespace (space, tab, newline, carriage return) between tokens is skipped.
- A number is an optional \`-\`, then \`0\` or a digit 1–9 followed by digits, then optionally \`.\` and digits, then optionally \`e\` or \`E\`, an optional sign and digits. A number directly followed by another digit or a dot (\`01\`, \`1.\`) is malformed.
- For this stage strings have no backslashes in them (stage 3 adds escapes), but a string with no closing quote is an error.
- Anything else raises \`JSONError(message, pos)\` (already in the file) with \`pos\` at the offending character; for a malformed number, at its first character; for an unterminated string, at its opening quote.`,
      read: { concept: 'Lexical analysis', source: 'RFC 8259, “The JavaScript Object Notation (JSON) Data Interchange Format”, sections 2 to 7; Crafting Interpreters (Nystrom), ch. 4 “Scanning”' },
      files: [{ path: 'json_parser.py', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'punctuation and the three literals',
          code: String.raw`what, e = outcome(tokenize, "{}[]:,")
assert e is None, "tokenize('{}[]:,') failed: " + what
got = tokenize('[true, false,null]')
want = [("[", None, 0), ("literal", True, 1), (",", None, 5), ("literal", False, 7), (",", None, 12), ("literal", None, 13), ("]", None, 17)]
assert got == want, "tokenize('[true, false,null]') should be %r, got %r" % (want, got)`
        },
        {
          name: 'numbers keep their text',
          code: String.raw`for src in ["0", "-0", "42", "-12.5", "3e8", "6.02E+23", "1e-9"]:
    what, e = outcome(tokenize, src)
    assert e is None, "tokenize(%r) failed: %s" % (src, what)
    got = tokenize(src)
    assert got == [("number", src, 0)], "tokenize(%r) should be [('number', %r, 0)], got %r" % (src, src, got)`
        },
        {
          name: 'strings, whitespace and positions',
          code: String.raw`src = ' {\n  "name" :\t"Ada" }'
what, e = outcome(tokenize, src)
assert e is None, "tokenize(%r) failed: %s" % (src, what)
got = tokenize(src)
want = [("{", None, 1), ("string", "name", 5), (":", None, 12), ("string", "Ada", 14), ("}", None, 20)]
assert got == want, "tokenize(%r) should be %r, got %r" % (src, want, got)`
        },
        {
          name: 'what is not JSON is refused, and says where',
          code: String.raw`for src, pos in [("[1, @]", 4), ("tru", 0), ("nul l", 0), ('["open', 1), ("-", 0), ("1.", 0), ("01", 0), ("'single'", 0)]:
    what, e = outcome(tokenize, src)
    assert isinstance(e, JSONError), "tokenize(%r) should raise JSONError; %s" % (src, what)
    assert e.pos == pos, "tokenize(%r) raised JSONError with pos %r; the problem starts at %d" % (src, e.pos, pos)`
        }
      ],
      hints: [
        'Walk the text one position at a time and decide, by the character under you, what kind of token starts there.',
        'Punctuation is one character; a string runs to the next double quote; a literal is a word you look up; a number is easiest with a regular expression matched at the current position. Remember where each token started before you move past it.',
        'Loop while i < len(text): skip whitespace; for punctuation append (c, None, i); for a quote, find the closing quote (none: JSONError at the opening one); for - or a digit, match the number pattern at i and refuse it when a digit or a dot follows the match; otherwise match a run of letters and look it up in {"true": True, "false": False, "null": None}; anything else raises JSONError at i.'
      ],
      teaches: ['Lexical analysis', 'Regular expressions'],
      recall: 'Why does a tokeniser record where each token started, when the parser only needs its kind and value?'
    },
    {
      id: 'values',
      title: 'Values, arrays and objects',
      goal: 'Parse tokens into Python values by recursive descent, refusing malformed input with its position.',
      brief: `Write \`loads(text)\` in \`json_parser.py\`: the Python value the text stands for.

- Objects become \`dict\`, arrays \`list\`, strings \`str\`, the literals \`True\`/\`False\`/\`None\`. A number with a \`.\`, \`e\` or \`E\` becomes a \`float\`; any other number an \`int\`. When a key appears twice, the last one wins.
- The text must hold exactly one value. An empty text, a trailing comma (\`[1,]\`), a missing colon or comma, a key that is not a string, or anything after the value (\`[1] 2\`) raises \`JSONError\` with \`pos\` at the token where the problem is found, or at \`len(text)\` when the text ends too soon.
- Nesting deeper than 200 arrays or objects raises \`JSONError\`, never Python's \`RecursionError\`.
- A non-\`str\` argument raises \`TypeError\`.`,
      read: { concept: 'Recursive descent parsing', source: 'Crafting Interpreters (Nystrom), ch. 6 “Parsing Expressions”; the grammar on json.org' },
      files: [],
      tests: [
        {
          name: 'scalars and nested values',
          code: String.raw`for src, want in [("1", 1), ("-2.5", -2.5), ("1e3", 1000.0), ('"x"', "x"), ("true", True), ("null", None), ("[]", []), ("{}", {}),
                  ('{"a": [1, {"b": null}], "c": "d"}', {"a": [1, {"b": None}], "c": "d"}), ("[[[]], [1, 2]]", [[[]], [1, 2]])]:
    what, e = outcome(loads, src)
    assert e is None, "loads(%r) failed: %s" % (src, what)
    got = loads(src)
    assert got == want, "loads(%r) should be %r, got %r" % (src, want, got)`
        },
        {
          name: 'integers stay integers',
          code: String.raw`what, e = outcome(loads, "[10, 10.0, 1e1, -0]")
assert e is None, "loads('[10, 10.0, 1e1, -0]') failed: " + what
got = loads("[10, 10.0, 1e1, -0]")
assert [type(x).__name__ for x in got] == ["int", "float", "float", "int"], "loads('[10, 10.0, 1e1, -0]') should give int, float, float, int; got %r" % ([type(x).__name__ for x in got],)
big = loads("12345678901234567890123")
assert big == 12345678901234567890123, "a large integer should come back exactly, got %r" % (big,)`
        },
        {
          name: 'the last of two equal keys wins',
          code: String.raw`what, e = outcome(loads, '{"a": 1, "a": 2}')
assert e is None, "loads('{\"a\": 1, \"a\": 2}') failed: " + what
got = loads('{"a": 1, "a": 2}')
assert got == {"a": 2}, "loads('{\"a\": 1, \"a\": 2}') should be {'a': 2}, got %r" % (got,)`
        },
        {
          name: 'malformed input is refused at the right place',
          code: String.raw`for src, pos in [("", 0), ("[1,]", 3), ('{"a" 1}', 5), ('{"a": 1,}', 8), ("[1 2]", 3), ("[1] 2", 4), ("{1: 2}", 1), ("[", 1), ("]", 0)]:
    what, e = outcome(loads, src)
    assert isinstance(e, JSONError), "loads(%r) should raise JSONError; %s" % (src, what)
    assert e.pos == pos, "loads(%r) raised JSONError at pos %r; the problem is at %d" % (src, e.pos, pos)`
        },
        {
          name: 'deep nesting is an error, not a crash',
          code: String.raw`ok = "[" * 150 + "]" * 150
what, e = outcome(loads, ok)
assert e is None, "150 nested arrays are allowed; %s" % what
deep = "[" * 5000 + "]" * 5000
what, e = outcome(loads, deep)
assert isinstance(e, JSONError), "5000 nested arrays should raise JSONError; %s" % what`
        },
        {
          name: 'only text is parsed',
          code: String.raw`what, e = outcome(loads, b"[1]")
assert isinstance(e, TypeError), "loads(b'[1]') should raise TypeError; %s" % what`
        }
      ],
      hints: [
        'JSON’s grammar is recursive: an array holds values, and a value may be an array. Let your functions be recursive in the same way.',
        'Keep an index into the token list. One function parses “a value” and looks at the next token to decide which kind; arrays and objects call it for each element. After the outermost value, any token left over is an error. Count the depth as you recurse.',
        'Write a small parser object holding the tokens and an index, with peek() (a pretend ("end", None, len(text)) token past the end) and expect(kind). value(depth): refuse depth > 200; "{" → object, "[" → array, string or literal → its value, number → int or float by its text, anything else → JSONError at that token. object: after "{", an immediate "}" is empty; otherwise loop: expect a string key, expect ":", parse a value, then "," continues and "}" ends, anything else is an error. Arrays the same with "]".'
      ],
      teaches: ['Recursive descent parsing', 'Grammars'],
      recall: 'In a recursive-descent parser, why does a trailing comma like [1,] fail without any special rule for it?'
    },
    {
      id: 'escapes',
      title: 'Strings, properly',
      goal: 'Decode every JSON string escape, including surrogate pairs, and refuse what JSON forbids in strings.',
      brief: `Strings may now contain backslash escapes. In \`tokenize\`, decode them so the token's value is the real text:

- \`\\"\` \`\\\\\` \`\\/\` \`\\b\` \`\\f\` \`\\n\` \`\\r\` \`\\t\` stand for those characters.
- \`\\uXXXX\` (four hex digits, either case) is that UTF-16 code unit. A high surrogate (D800–DBFF) directly followed by \`\\u\` and a low surrogate (DC00–DFFF) is one character: \`"\\ud83d\\ude00"\` is 😀.
- A backslash followed by anything else, or \`\\u\` without four hex digits after it, raises \`JSONError\` at the backslash.
- A raw control character (below U+0020, such as a real newline or tab) inside a string raises \`JSONError\` at that character.
- An escaped quote does not end the string; a string that ends in a lone backslash is unterminated.`,
      read: { concept: 'Unicode and UTF-16 surrogate pairs', source: 'RFC 8259, section 7 “Strings”; The Unicode Standard, ch. 3.9 “Unicode Encoding Forms” (UTF-16)' },
      files: [],
      tests: [
        {
          name: 'the simple escapes',
          code: String.raw`src = r'"a\"b\\c\/d\n\t\r\b\f"'
what, e = outcome(loads, src)
assert e is None, "loads(%r) failed: %s" % (src, what)
got = loads(src)
want = 'a"b\\c/d\n\t\r\b\f'
assert got == want, "loads(%r) should be %r, got %r" % (src, want, got)`
        },
        {
          name: 'an escaped quote does not end the string',
          code: String.raw`src = r'["say \"hi\"", 1]'
what, e = outcome(loads, src)
assert e is None, "loads(%r) failed: %s" % (src, what)
assert loads(src) == ['say "hi"', 1], "loads(%r) should be ['say \"hi\"', 1], got %r" % (src, loads(src))`
        },
        {
          name: 'unicode escapes and surrogate pairs',
          code: String.raw`for src, want in [(r'"\u00e9"', "\u00e9"), (r'"\u00E9t\u00e9"', "\u00e9t\u00e9"), (r'"\ud83d\ude00"', "\U0001F600"), (r'"x\u0041y"', "xAy")]:
    what, e = outcome(loads, src)
    assert e is None, "loads(%r) failed: %s" % (src, what)
    got = loads(src)
    assert got == want, "loads(%r) should be %r (%d characters), got %r (%d characters)" % (src, want, len(want), got, len(got))`
        },
        {
          name: 'bad escapes and raw control characters are refused',
          code: String.raw`for src, pos in [(r'"\x41"', 1), (r'"ab\u12"', 3), (r'"\uZZZZ"', 1), ('"line\nbreak"', 5), ('"tab\there"', 4)]:
    what, e = outcome(loads, src)
    assert isinstance(e, JSONError), "loads(%r) should raise JSONError; %s" % (src, what)
    assert e.pos == pos, "loads(%r) raised JSONError at pos %r; the problem is at %d" % (src, e.pos, pos)`
        },
        {
          name: 'a backslash at the very end is an unterminated string',
          code: String.raw`what, e = outcome(loads, '"abc\\')
assert isinstance(e, JSONError), "a string ending in a lone backslash should raise JSONError; %s" % what
assert e.pos == 0, "an unterminated string is reported at its opening quote, 0; got %r" % (e.pos,)`
        }
      ],
      hints: [
        'The scan for the closing quote has to understand backslashes: the character after one is never the end of the string.',
        'Build the string’s value character by character. On a backslash, look at the next character: a table maps the eight simple escapes; u means read four hex digits. A code unit in D800–DBFF is half a character: look for a second \\u with a low half and combine the two.',
        'Loop from the character after the opening quote. Quote: done. Backslash: look up the next character in a table of the eight simple escapes; for u, check four hex digits and convert with int(…, 16); if it is a high surrogate and \\u plus a low one follows, the character is 0x10000 + ((high − 0xD800) << 10) + (low − 0xDC00). Anything else after a backslash: JSONError at the backslash. A character below 0x20: JSONError at it. Running off the end: JSONError at the opening quote.'
      ],
      teaches: ['Unicode and UTF-16 surrogate pairs', 'Escape sequences'],
      recall: 'Why does JSON need two \\u escapes for an emoji, and how do the two halves become one character?'
    },
    {
      id: 'dumps',
      title: 'And back again',
      goal: 'Write Python values out as compact JSON that round-trips through your parser and agrees with Python’s.',
      brief: `Write \`dumps(value)\` in \`json_parser.py\`: compact JSON, no spaces.

- \`None\`, \`True\`, \`False\` → \`null\`, \`true\`, \`false\`. An \`int\` → its digits. A \`float\` → \`repr(x)\`; \`nan\` and the infinities have no JSON form and raise \`ValueError\`.
- A \`str\` → quoted, escaping \`"\` and \`\\\` with a backslash, \`\\n \\r \\t \\b \\f\` by those escapes, any other character below U+0020 as \`\\u00XX\` (lower-case hex). Everything else, non-ASCII included, is written as it is.
- \`list\` and \`tuple\` → \`[a,b]\`; \`dict\` → \`{"k":v}\` in the dict's own order. A key that is not a \`str\` raises \`TypeError\`, and so does a value of any other type.

For these inputs your output is exactly what \`json.dumps(value, ensure_ascii=False, separators=(",", ":"))\` gives, and \`loads(dumps(v)) == v\`.`,
      read: { concept: 'Serialisation', source: 'Python documentation, json module: “Basic Usage” (separators, ensure_ascii)' },
      files: [],
      tests: [
        {
          name: 'the same text Python’s json module writes',
          code: String.raw`import json
cases = [None, True, False, 0, -7, 2.5, 1e100, "", "plain", 'q"b\\', "tab\tnl\nbell\x07", "caf\u00e9 \U0001F600", [], [1, [2, [3]]], {}, {"b": 1, "a": [True, None]}, (1, 2)]
for v in cases:
    what, e = outcome(dumps, v)
    assert e is None, "dumps(%r) failed: %s" % (v, what)
    want = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    got = dumps(v)
    assert got == want, "dumps(%r) should be %r, got %r" % (v, want, got)`
        },
        {
          name: 'booleans are not written as numbers',
          code: String.raw`what, e = outcome(dumps, [True, 1, False, 0])
assert e is None, "dumps([True, 1, False, 0]) failed: " + what
got = dumps([True, 1, False, 0])
assert got == "[true,1,false,0]", "dumps([True, 1, False, 0]) should be '[true,1,false,0]', got %r" % (got,)`
        },
        {
          name: 'what has no JSON form is refused',
          code: String.raw`for v, err in [(float("nan"), ValueError), (float("inf"), ValueError), ({1: "x"}, TypeError), ({"a": {2}}, TypeError), (object(), TypeError)]:
    what, e = outcome(dumps, v)
    assert isinstance(e, err) and not isinstance(e, NotImplementedError), "dumps(%r) should raise %s; %s" % (v, err.__name__, what)`
        },
        {
          name: 'what dumps writes, loads reads back the same',
          code: String.raw`import random
rng = random.Random(7)
def make(d):
    k = rng.randrange(7 if d < 4 else 5)
    if k == 0: return None
    if k == 1: return rng.random() < 0.5
    if k == 2: return rng.randrange(-10**6, 10**6)
    if k == 3: return "".join(chr(rng.choice([9, 10, 34, 92, 65, 233, 0x1F600, 31])) for _ in range(rng.randrange(6)))
    if k == 4: return rng.uniform(-1e6, 1e6)
    if k == 5: return [make(d + 1) for _ in range(rng.randrange(4))]
    return {"k%d" % i: make(d + 1) for i in range(rng.randrange(4))}
for _ in range(200):
    v = make(0)
    what, e = outcome(lambda: loads(dumps(v)))
    assert e is None, "loads(dumps(%r)) failed: %s" % (v, what)
    back = loads(dumps(v))
    assert back == v, "loads(dumps(v)) should give v back; v = %r came back as %r (dumps wrote %r)" % (v, back, dumps(v))`
        }
      ],
      hints: [
        'The order of your type checks matters in Python: think about what isinstance(True, int) returns.',
        'dumps is recursive over the same shapes loads produces. Strings are the only delicate part: go character by character, with a table for the seven characters that have short escapes and \\u00XX for the other control characters.',
        'Check None, True and False by identity first, then int, then float (refuse x != x and the infinities, else repr), then str (each character: table lookup, else "\\\\u%04x" below 0x20, else as it is), then list or tuple (the dumps of each item joined with ","), then dict (refuse non-str keys; quoted key + ":" + dumps(value), joined). Anything else: TypeError.'
      ],
      teaches: ['Serialisation', 'Round-trip testing'],
      recall: 'Why must dumps test for True and False before it tests for int in Python?'
    }
  ],
  solution: [{ path: 'json_parser.py', content: SOLUTION }]
}
