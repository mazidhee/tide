import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts.

const STARTER = String.raw`"""A byte-level BPE tokeniser, trained from scratch. Built in four stages; see STAGE-1.md."""
import re

# Stage 4: how text is cut into chunks before training and encoding (a simplified GPT-2 pattern).
SPLIT_PATTERN = r"""'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^\sA-Za-z0-9]+|\s+(?!\S)|\s+"""


def get_stats(ids, counts=None):
    # Stage 1: how often each adjacent pair occurs.
    raise NotImplementedError("stage 1: get_stats")


def merge(ids, pair, new_id):
    # Stage 1: a new list with every occurrence of pair replaced by new_id.
    raise NotImplementedError("stage 1: merge")


def train(text, vocab_size, split=False):
    # Stage 2: the merges, {(a, b): new_id}, in the order they were made.
    raise NotImplementedError("stage 2: train")


class Tokenizer:
    def __init__(self, merges, split=False, special=None):
        # Stage 3 (merges); stage 4 (split, special)
        raise NotImplementedError("stage 3: Tokenizer")

    def encode(self, text):
        raise NotImplementedError("stage 3: encode")

    def decode(self, ids):
        raise NotImplementedError("stage 3: decode")
`

const SOLUTION = String.raw`"""A byte-level BPE tokeniser, trained from scratch: pairs, merges, encoding, and chunking."""
import re

SPLIT_PATTERN = r"""'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^\sA-Za-z0-9]+|\s+(?!\S)|\s+"""


def get_stats(ids, counts=None):
    counts = {} if counts is None else counts
    for pair in zip(ids, ids[1:]):
        counts[pair] = counts.get(pair, 0) + 1
    return counts


def merge(ids, pair, new_id):
    out = []
    i = 0
    while i < len(ids):
        if i + 1 < len(ids) and ids[i] == pair[0] and ids[i + 1] == pair[1]:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


def _chunks(text, split):
    return re.findall(SPLIT_PATTERN, text) if split else [text]


def train(text, vocab_size, split=False):
    if vocab_size < 256:
        raise ValueError("vocab_size must be at least 256, the single bytes")
    chunks = [list(c.encode("utf-8")) for c in _chunks(text, split)]
    merges = {}
    for new_id in range(256, vocab_size):
        stats = {}
        for ids in chunks:
            get_stats(ids, stats)
        if not stats:
            break
        pair = max(stats, key=stats.get)
        if stats[pair] < 2:
            break
        merges[pair] = new_id
        chunks = [merge(ids, pair, new_id) for ids in chunks]
    return merges


class Tokenizer:
    def __init__(self, merges, split=False, special=None):
        self.merges = dict(merges)
        self.split = split
        self.vocab = {i: bytes([i]) for i in range(256)}
        for (a, b), i in self.merges.items():
            self.vocab[i] = self.vocab[a] + self.vocab[b]
        self.special = dict(special or {})
        for s, i in self.special.items():
            if i in self.vocab:
                raise ValueError("special token %r has id %d, which a byte or a merge already uses" % (s, i))
        self.special_by_id = {i: s for s, i in self.special.items()}

    def _encode_chunk(self, text):
        ids = list(text.encode("utf-8"))
        while len(ids) >= 2:
            stats = get_stats(ids)
            pair = min(stats, key=lambda p: self.merges.get(p, float("inf")))
            if pair not in self.merges:
                break
            ids = merge(ids, pair, self.merges[pair])
        return ids

    def _encode_ordinary(self, text):
        out = []
        for chunk in _chunks(text, self.split):
            out.extend(self._encode_chunk(chunk))
        return out

    def encode(self, text):
        if not self.special:
            return self._encode_ordinary(text)
        pattern = "(" + "|".join(re.escape(s) for s in sorted(self.special, key=len, reverse=True)) + ")"
        out = []
        for part in re.split(pattern, text):
            if part in self.special:
                out.append(self.special[part])
            elif part:
                out.extend(self._encode_ordinary(part))
        return out

    def decode(self, ids):
        parts = []
        for i in ids:
            if i in self.special_by_id:
                parts.append(self.special_by_id[i].encode("utf-8"))
            else:
                parts.append(self.vocab[i])
        return b"".join(parts).decode("utf-8", errors="replace")
`

const HELPERS = String.raw`import re
import bpe
from bpe import get_stats, merge

def try_call(f, *args, **kw):
    try:
        return f(*args, **kw), None
    except Exception as e:
        return None, "it raised %s: %s" % (type(e).__name__, e)

TEXT = """The quick brown fox jumps over the lazy dog. The dog was not amused, and the fox was not sorry.
A tokeniser learns which pieces of text come up again and again, and gives each piece a number of its own.
Byte pair encoding starts from single bytes and merges the most frequent pair, over and over, until the vocabulary is full.
The the the: repetition makes merges. Café, naïve, über and 日本語 are bytes too, and so is \U0001F600.
In 2024 there were 365 days; in 2025, 365 again. Numbers like 12345 and 67890 are split from the words around them.
"""

def _ref_stats(ids, counts):
    for p in zip(ids, ids[1:]):
        counts[p] = counts.get(p, 0) + 1
    return counts

def _ref_merge(ids, pair, idx):
    out, i = [], 0
    while i < len(ids):
        if i + 1 < len(ids) and (ids[i], ids[i + 1]) == pair:
            out.append(idx); i += 2
        else:
            out.append(ids[i]); i += 1
    return out

def ref_train(text, vocab_size, split=False):
    chunks = [list(c.encode("utf-8")) for c in (re.findall(bpe.SPLIT_PATTERN, text) if split else [text])]
    merges = {}
    for idx in range(256, vocab_size):
        stats = {}
        for c in chunks:
            _ref_stats(c, stats)
        if not stats:
            break
        pair = max(stats, key=stats.get)
        if stats[pair] < 2:
            break
        merges[pair] = idx
        chunks = [_ref_merge(c, pair, idx) for c in chunks]
    return merges
`

const SAMPLES = String.raw`SAMPLES = ["", "a", "hello world", "The the THE", "Café naïve über", "日本語のテキスト", "\U0001F600 \U0001F680!", "tabs\tand\nnewlines\r\n", "  leading and trailing  ", "12345 + 67890 = 80235", TEXT]
`

export const bpeTokeniser: WorkshopProject = {
  id: 'bpe-tokeniser',
  title: 'A byte-level BPE tokeniser',
  outcome: 'The tokeniser a language model reads through, built from scratch in Python as GPT-2’s is: byte pair encoding trained on your own text, an encoder and decoder that round-trip any Unicode exactly, chunking so that merges never cross word boundaries, and special tokens that can never be produced by ordinary text.',
  area: 'ml',
  prerequisites: ['Strings and Unicode', 'Dictionaries'],
  languages: ['python'],
  stages: [
    {
      id: 'pairs',
      title: 'Pairs and merges',
      goal: 'Count adjacent pairs in a list of token ids and replace a pair with a new id.',
      brief: `A tokeniser works on lists of integer ids; at the start they are the UTF-8 bytes of the text (0 to 255). In \`bpe.py\`, write the two operations everything else is built from:

- \`get_stats(ids, counts=None)\`: a \`dict\` mapping each adjacent pair \`(a, b)\` to how many times it occurs in \`ids\`. Keys appear in the order of each pair's **first occurrence** (Python dicts keep insertion order; stage 2 relies on it). When \`counts\` is given, add into it and return it, so counts can be summed over many lists.
- \`merge(ids, pair, new_id)\`: a **new** list with every occurrence of \`pair\` replaced by \`new_id\`, scanning left to right: \`merge([5, 5, 5], (5, 5), 9)\` is \`[9, 5]\`. \`ids\` itself is not changed.`,
      read: { concept: 'Byte pair encoding', source: 'Sennrich, Haddow and Birch, “Neural Machine Translation of Rare Words with Subword Units” (ACL 2016), section 3.2; Andrej Karpathy, “Let’s build the GPT Tokenizer” (video lecture) and the minbpe repository' },
      files: [{ path: 'bpe.py', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'pairs are counted, in order of first appearance',
          code: String.raw`got, why = try_call(get_stats, [1, 2, 3, 1, 2])
assert why is None, "get_stats([1, 2, 3, 1, 2]) failed: " + str(why)
want = {(1, 2): 2, (2, 3): 1, (3, 1): 1}
assert got == want, "get_stats([1, 2, 3, 1, 2]) should be %r, got %r" % (want, got)
assert list(got) == [(1, 2), (2, 3), (3, 1)], "the keys should be in order of first occurrence, [(1, 2), (2, 3), (3, 1)], got %r" % (list(got),)
assert get_stats([7]) == {} and get_stats([]) == {}, "a list of fewer than two ids has no pairs"`
        },
        {
          name: 'counts can be added up over several lists',
          code: String.raw`counts = {}
r, why = try_call(get_stats, [1, 2, 1], counts)
assert why is None, "get_stats with counts failed: " + str(why)
get_stats([2, 1, 2], counts)
assert r is counts, "get_stats(ids, counts) should return the dict it was given"
assert counts == {(1, 2): 2, (2, 1): 2}, "counting [1, 2, 1] then [2, 1, 2] into one dict should give {(1, 2): 2, (2, 1): 2}, got %r" % (counts,)`
        },
        {
          name: 'merge replaces every occurrence, left to right, without overlap',
          code: String.raw`for ids, pair, want in [([1, 2, 3, 1, 2], (1, 2), [99, 3, 99]), ([5, 5, 5], (5, 5), [9, 5]), ([5, 5, 5, 5], (5, 5), [9, 9]), ([1, 2, 3], (3, 1), [1, 2, 3]), ([], (1, 2), [])]:
    new_id = want[0] if want and want[0] > 8 else 9
    got, why = try_call(merge, ids, pair, new_id)
    assert why is None, "merge(%r, %r, %d) failed: %s" % (ids, pair, new_id, why)
    assert got == want, "merge(%r, %r, %d) should be %r, got %r" % (ids, pair, new_id, want, got)`
        },
        {
          name: 'merge leaves its input alone',
          code: String.raw`ids = [1, 2, 1, 2]
got, why = try_call(merge, ids, (1, 2), 7)
assert why is None, "merge failed: " + str(why)
assert ids == [1, 2, 1, 2], "merge must return a new list and leave ids as it was; ids is now %r" % (ids,)`
        }
      ],
      hints: [
        'Both functions are one pass over the list. merge has one decision to make at each position: does a pair start here?',
        'zip(ids, ids[1:]) gives every adjacent pair in order. For merge, walk an index: when the id here and the next one make the pair, write the new id and skip two; otherwise copy one id and move one.',
        'get_stats: if counts is None make a new dict; for pair in zip(ids, ids[1:]): counts[pair] = counts.get(pair, 0) + 1; return counts. merge: out = [], i = 0; while i < len(ids): if i + 1 < len(ids) and ids[i] == pair[0] and ids[i + 1] == pair[1]: append new_id, i += 2; else append ids[i], i += 1; return out.'
      ],
      teaches: ['Byte pair encoding', 'Run-length thinking over sequences'],
      recall: 'Why does merge([5, 5, 5], (5, 5), 9) give [9, 5] and not [9, 9]?'
    },
    {
      id: 'train',
      title: 'Learning the merges',
      goal: 'Train a vocabulary by repeatedly merging the most frequent pair.',
      brief: `Write \`train(text, vocab_size, split=False)\` in \`bpe.py\` (\`split\` is for stage 4; ignore it for now).

1. Start from the UTF-8 bytes of \`text\` as a list of ints.
2. For \`new_id\` = 256, 257, … up to \`vocab_size − 1\`: count the pairs; pick the pair with the **highest count**, and on a tie the one that **occurs first** in the current list; record \`merges[pair] = new_id\`; replace the pair everywhere with \`new_id\`.
3. Stop early when no pair occurs at least twice (merging a pair seen once compresses nothing).

Return \`merges\`, a dict from pair to new id in the order the merges were made. A \`vocab_size\` below 256 raises \`ValueError\`.`,
      read: { concept: 'Subword vocabularies', source: 'Radford et al., “Language Models are Unsupervised Multitask Learners” (GPT-2, 2019), section 2.2 “Input Representation”; Hugging Face course, chapter 6, “Byte-Pair Encoding tokenization”' },
      files: [],
      tests: [
        {
          name: 'the merges of a small example',
          code: String.raw`got, why = try_call(bpe.train, "aaabdaaabac", 259)
assert why is None, "train failed: " + str(why)
want = {(97, 97): 256, (256, 97): 257, (257, 98): 258}
assert got == want, "train('aaabdaaabac', 259) should merge aa, then (aa)a, then (aaa)b: %r; got %r" % (want, got)`
        },
        {
          name: 'ties go to the pair that occurs first',
          code: String.raw`got, why = try_call(bpe.train, "xyzxyz", 257)
assert why is None, "train failed: " + str(why)
assert got == {(120, 121): 256}, "in 'xyzxyz' the pairs xy and yz both occur twice; xy comes first, so the merge is {(120, 121): 256}; got %r" % (got,)`
        },
        {
          name: 'the merges of a real paragraph',
          code: String.raw`got, why = try_call(bpe.train, TEXT, 320)
assert why is None, "train failed: " + str(why)
want = ref_train(TEXT, 320)
assert isinstance(got, dict) and len(got) == len(want), "training to 320 should make %d merges, got %r" % (len(want), len(got) if isinstance(got, dict) else got)
for k, ((p, i), (q, j)) in enumerate(zip(want.items(), got.items())):
    assert (p, i) == (q, j), "merge %d should be %r -> %d, got %r -> %d" % (k + 1, p, i, q, j)`
        },
        {
          name: 'training stops when nothing repeats',
          code: String.raw`got, why = try_call(bpe.train, "abcdefg", 300)
assert why is None, "train failed: " + str(why)
assert got == {}, "no pair in 'abcdefg' occurs twice, so there are no merges; got %r" % (got,)
got = bpe.train("abab", 300)
assert got == {(97, 98): 256}, "'abab' allows one merge (ab), after which nothing repeats; got %r" % (got,)`
        },
        {
          name: 'a vocabulary smaller than the bytes is refused',
          code: String.raw`got, why = try_call(bpe.train, "hello", 200)
assert why is not None and "ValueError" in why, "train with vocab_size 200 should raise ValueError; %s" % (why or "it returned %r" % (got,))`
        }
      ],
      hints: [
        'Training is a loop around the two functions you have: count, choose, record, merge.',
        'max(stats, key=stats.get) returns the first key with the highest count in the dict’s order, which is first occurrence: exactly the tie-break needed. Check the winning count before recording: below 2, stop.',
        'Refuse vocab_size < 256. ids = list(text.encode("utf-8")); merges = {}. For new_id in range(256, vocab_size): stats = get_stats(ids); if not stats, stop; pair = max(stats, key=stats.get); if stats[pair] < 2, stop; merges[pair] = new_id; ids = merge(ids, pair, new_id). Return merges.'
      ],
      teaches: ['Subword vocabularies', 'Greedy algorithms'],
      recall: 'Why does byte-level BPE start from 256 byte ids rather than from the characters of the training text?'
    },
    {
      id: 'codec',
      title: 'Encoding and decoding',
      goal: 'Turn any text into ids with the learnt merges and back again exactly.',
      brief: `Finish \`Tokenizer\` in \`bpe.py\` (\`split\` and \`special\` are for stage 4).

- \`Tokenizer(merges)\` builds \`vocab\`, a dict from every id to its **bytes**: ids 0 to 255 are single bytes, and each merge's id is the bytes of its two parts joined.
- \`encode(text)\`: start from the UTF-8 bytes; while some adjacent pair is in \`merges\`, merge the pair whose id is **lowest** (it was learnt first, and later merges were learnt on top of it). Return the list of ids.
- \`decode(ids)\`: join the bytes of each id and decode as UTF-8, with \`errors="replace"\`, so a sequence that is not valid UTF-8 (a lone byte 128, say) gives the replacement character instead of failing.

\`decode(encode(text)) == text\` for every string, whatever its script, and merges learnt on a text compress it: encoding the training paragraph to a vocabulary of 320 needs well under two thirds of its bytes.`,
      read: { concept: 'UTF-8 and tokenisation', source: 'Joel Spolsky, “The Absolute Minimum Every Software Developer Absolutely, Positively Must Know About Unicode and Character Sets”; minbpe, basic.py (encode and decode)' },
      files: [],
      setup: SAMPLES,
      tests: [
        {
          name: 'the vocabulary holds the bytes of each id',
          code: String.raw`t, why = try_call(bpe.Tokenizer, {(97, 97): 256, (256, 97): 257, (257, 98): 258})
assert why is None, "Tokenizer(merges) failed: " + str(why)
for i, want in [(0, b"\x00"), (97, b"a"), (255, b"\xff"), (256, b"aa"), (257, b"aaa"), (258, b"aaab")]:
    got = t.vocab.get(i)
    assert got == want, "vocab[%d] should be %r, got %r" % (i, want, got)`
        },
        {
          name: 'encode applies merges in the order they were learnt',
          code: String.raw`t = bpe.Tokenizer({(97, 97): 256, (256, 97): 257, (257, 98): 258})
got, why = try_call(t.encode, "aaabdaaabac")
assert why is None, "encode failed: " + str(why)
assert got == [258, 100, 258, 97, 99], "encode('aaabdaaabac') should be [258, 100, 258, 97, 99], got %r" % (got,)
t2 = bpe.Tokenizer({(98, 99): 256, (97, 98): 257})
got = t2.encode("abc")
assert got == [97, 256], "with bc learnt before ab, 'abc' should encode as [97, 256] (bc first), got %r" % (got,)`
        },
        {
          name: 'decode(encode(text)) gives the text back, in any script',
          code: String.raw`t = bpe.Tokenizer(ref_train(TEXT, 320))
for s in SAMPLES:
    ids, why = try_call(t.encode, s)
    assert why is None, "encode(%r) failed: %s" % (s[:40], why)
    back, why = try_call(t.decode, ids)
    assert why is None, "decode failed for %r: %s" % (s[:40], why)
    assert back == s, "decode(encode(%r)) gave %r" % (s[:60], back[:60] if isinstance(back, str) else back)`
        },
        {
          name: 'bytes that are not UTF-8 decode to the replacement character',
          code: String.raw`t = bpe.Tokenizer({})
got, why = try_call(t.decode, [104, 128, 105])
assert why is None, "decode([104, 128, 105]) should not fail on a stray byte; " + str(why)
assert got == "h�i", "decode([104, 128, 105]) should be 'h\\ufffdi', got %r" % (got,)`
        },
        {
          name: 'the learnt merges compress the text they were learnt on',
          code: String.raw`t = bpe.Tokenizer(ref_train(TEXT, 320))
n_bytes = len(TEXT.encode("utf-8"))
n_ids = len(t.encode(TEXT))
assert n_ids < n_bytes * 2 / 3, "with 64 merges the training text (%d bytes) should encode to under two thirds as many ids; it took %d" % (n_bytes, n_ids)`
        }
      ],
      hints: [
        'Decoding is a lookup and a join; encoding is the training loop again, except that the choice of pair is fixed by the merges rather than by counts.',
        'Build vocab in the order of the merges, so both parts of a merge are already in it. When encoding, count pairs, and among them pick the one with the smallest merge id (pairs not in merges count as infinity); if even that one isn’t a merge, you are done.',
        'vocab = {i: bytes([i]) for i in range(256)}; for (a, b), i in merges.items(): vocab[i] = vocab[a] + vocab[b]. encode: ids = list(text.encode("utf-8")); while len(ids) >= 2: stats = get_stats(ids); pair = min(stats, key=lambda p: merges.get(p, float("inf"))); if pair not in merges: break; ids = merge(ids, pair, merges[pair]). decode: b"".join(vocab[i] for i in ids).decode("utf-8", errors="replace").'
      ],
      teaches: ['UTF-8 and tokenisation', 'Encoding and decoding'],
      recall: 'Why must encode apply merges in the order they were learnt, rather than the most frequent pair in the text being encoded?'
    },
    {
      id: 'chunks',
      title: 'Chunks and special tokens',
      goal: 'Keep merges inside words by chunking first, and add special tokens ordinary text can never produce.',
      brief: `Trained on raw text, BPE learns tokens like \`"e t"\` or \`"g."\` that glue the end of one word to the start of the next. GPT-2 first cuts text into chunks with a regular expression and never merges across chunks. \`SPLIT_PATTERN\` in \`bpe.py\` is a simplified version of its pattern.

**\`split=True\`**:
- \`train(text, vocab_size, split=True)\`: cut \`text\` into chunks with \`re.findall(SPLIT_PATTERN, text)\`; each chunk is its own list of bytes. Count pairs summed over all chunks (ties: first occurrence, chunk by chunk); merge in every chunk. No pair spans two chunks.
- \`Tokenizer(merges, split=True)\`: \`encode\` cuts the text the same way and encodes each chunk on its own.

**\`special\`**: \`Tokenizer(merges, split, special={"<|endoftext|>": 1000})\`: in \`encode\`, each exact occurrence of a special string becomes its id (the text around it is encoded as usual), and \`decode\` turns the id back into the string. A special id that a byte or a merge already uses raises \`ValueError\`.`,
      read: { concept: 'Pre-tokenisation and special tokens', source: 'OpenAI GPT-2 source, encoder.py (the pattern and bytes_to_unicode); tiktoken documentation on special tokens; Karpathy’s minbpe, regex.py' },
      files: [],
      tests: [
        {
          name: 'with chunks, the merges match the reference',
          code: String.raw`got, why = try_call(bpe.train, TEXT, 320, split=True)
assert why is None, "train(..., split=True) failed: " + str(why)
want = ref_train(TEXT, 320, split=True)
assert isinstance(got, dict) and len(got) == len(want), "training with chunks to 320 should make %d merges, got %r" % (len(want), len(got) if isinstance(got, dict) else got)
for k, ((p, i), (q, j)) in enumerate(zip(want.items(), got.items())):
    assert (p, i) == (q, j), "merge %d should be %r -> %d, got %r -> %d" % (k + 1, p, i, q, j)`
        },
        {
          name: 'no learnt token spans two chunks',
          code: String.raw`merges = bpe.train(TEXT, 330, split=True)
t = bpe.Tokenizer(merges, split=True)
for i in range(256, 256 + len(merges)):
    piece = t.vocab[i].decode("utf-8", errors="replace")
    parts = re.findall(bpe.SPLIT_PATTERN, piece)
    assert len(parts) <= 1, "token %d is %r, which crosses a chunk boundary: %r" % (i, piece, parts)`
        },
        {
          name: 'encoding with chunks round-trips and never merges across words',
          code: String.raw`t = bpe.Tokenizer(ref_train(TEXT, 330, split=True), split=True)
for s in SAMPLES:
    ids, why = try_call(t.encode, s)
    assert why is None, "encode(%r) failed: %s" % (s[:40], why)
    assert t.decode(ids) == s, "decode(encode(%r)) with chunks gave %r" % (s[:60], t.decode(ids)[:60])
plain = bpe.Tokenizer({(101, 32): 256}, split=False)
chunked = bpe.Tokenizer({(101, 32): 256}, split=True)
assert plain.encode("the cat") == [116, 104, 256, 99, 97, 116], "without chunks the merge 'e ' applies inside 'the cat'"
got = chunked.encode("the cat")
assert got == [116, 104, 101, 32, 99, 97, 116], "with chunks 'the' and ' cat' are encoded apart, so the merge 'e ' can't apply: expected [116, 104, 101, 32, 99, 97, 116], got %r" % (got,)`
        },
        {
          name: 'a special token is one id, and ordinary text never makes it',
          code: String.raw`merges = ref_train(TEXT, 300, split=True)
t, why = try_call(bpe.Tokenizer, merges, split=True, special={"<|endoftext|>": 1000})
assert why is None, "Tokenizer with a special token failed: " + str(why)
ids = t.encode("hello<|endoftext|>world<|endoftext|>")
assert ids.count(1000) == 2, "two <|endoftext|> in the text should give id 1000 twice, got %r" % (ids,)
assert t.decode(ids) == "hello<|endoftext|>world<|endoftext|>", "decode should give the special string back, got %r" % (t.decode(ids),)
plain = t.encode("<|endoftext") + t.encode("|>")
assert 1000 not in plain, "text that only resembles the special token must not produce its id"
_, why = try_call(bpe.Tokenizer, merges, split=True, special={"<|endoftext|>": 260})
assert why is not None and "ValueError" in why, "a special id of 260, which a merge already uses, should raise ValueError; %s" % (why or "it was accepted")`
        }
      ],
      hints: [
        'Chunking is a wrapper: training and encoding work as before on each chunk, with the counts of training added up over all of them.',
        'Keep a list of id lists, one per chunk. get_stats with a shared counts dict sums them in chunk order, which keeps the first-occurrence tie-break. For special tokens, re.split with a capturing group of the escaped special strings keeps them as separate parts.',
        'train: chunks = [list(c.encode("utf-8")) for c in re.findall(SPLIT_PATTERN, text)] (or [text] without split); each step: stats = {}; for ids in chunks: get_stats(ids, stats); choose as before; chunks = [merge(ids, pair, new_id) for ids in chunks]. encode: for each chunk, run the stage 3 loop and extend the result. Special: refuse ids already in vocab; in encode, re.split("(" + "|".join(re.escape(s) for s in special) + ")", text), mapping parts that are special strings to their ids and encoding the rest; in decode, map special ids back to their strings’ bytes.'
      ],
      teaches: ['Pre-tokenisation and special tokens', 'Regular expressions'],
      recall: 'Why does GPT-2 cut text into chunks before applying BPE, and what kind of tokens would it learn without that step?'
    }
  ],
  solution: [{ path: 'bpe.py', content: SOLUTION }]
}
