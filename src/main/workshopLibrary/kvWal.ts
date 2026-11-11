import type { WorkshopProject } from '@shared/workshop'

/**
 * Authoring notes (they hold for every project in the library):
 * - Code (starting files, tests, the solution) is written with String.raw so backslashes stay as
 *   they are; it must not contain a backtick or "${". Briefs and hints are ordinary strings.
 * - Every test's message says what was expected and what happened, never how to fix it.
 * - test/workshopLibrary.test.ts runs the solution against every test, and the starting files
 *   against every stage (each must fail somewhere), in the app's own sandbox.
 */

const STARTER = String.raw`"""A key-value store that survives a crash. Built in five stages; see STAGE-1.md."""


class KV:
    def __init__(self, path):
        # path is where the log will live. Stage 1 only needs to remember it.
        self.path = path
        raise NotImplementedError("stage 1: set up the in-memory table")

    def set(self, key, value):
        raise NotImplementedError

    def get(self, key, default=None):
        raise NotImplementedError

    def delete(self, key):
        raise NotImplementedError

    def keys(self):
        raise NotImplementedError

    def close(self):
        pass
`

const SOLUTION = String.raw`"""A key-value store that survives a crash: an in-memory table in front of a write-ahead log."""
import json
import os
import zlib


def encode_record(op, key, value=None):
    body = json.dumps([op, key, value], separators=(",", ":"))
    return ("%08x %s\n" % (zlib.crc32(body.encode("utf-8")), body)).encode("utf-8")


def decode_record(line):
    try:
        text = line.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if len(text) < 10 or not text.endswith("\n") or text[8] != " ":
        return None
    body = text[9:-1]
    try:
        if int(text[:8], 16) != zlib.crc32(body.encode("utf-8")):
            return None
        op, key, value = json.loads(body)
    except (ValueError, TypeError):
        return None
    if op not in ("set", "del") or not isinstance(key, str):
        return None
    return (op, key, value)


class KV:
    def __init__(self, path):
        self.path = path
        self._data = {}
        self._recover()
        self._log = open(path, "ab")

    def _recover(self):
        if not os.path.exists(self.path):
            return
        good = 0
        with open(self.path, "rb") as f:
            for line in f:
                record = decode_record(line)
                if record is None:
                    break
                self._apply(record)
                good += len(line)
        if good != os.path.getsize(self.path):
            with open(self.path, "r+b") as f:
                f.truncate(good)

    def _apply(self, record):
        op, key, value = record
        if op == "set":
            self._data[key] = value
        else:
            self._data.pop(key, None)

    def _append(self, op, key, value=None):
        self._log.write(encode_record(op, key, value))
        self._log.flush()
        os.fsync(self._log.fileno())

    def set(self, key, value):
        if not isinstance(key, str) or not isinstance(value, str):
            raise TypeError("keys and values are strings")
        self._append("set", key, value)
        self._data[key] = value

    def get(self, key, default=None):
        return self._data.get(key, default)

    def delete(self, key):
        if key not in self._data:
            return False
        self._append("del", key)
        del self._data[key]
        return True

    def keys(self):
        return sorted(self._data)

    def __len__(self):
        return len(self._data)

    def __contains__(self, key):
        return key in self._data

    def compact(self):
        tmp = self.path + ".compact"
        try:
            with open(tmp, "wb") as f:
                for key in sorted(self._data):
                    f.write(encode_record("set", key, self._data[key]))
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
        self._log.close()
        self._log = open(self.path, "ab")

    def close(self):
        self._log.close()
`

const HELPERS = String.raw`import os, tempfile
import kv as _kv
from kv import KV

def fresh():
    return os.path.join(tempfile.mkdtemp(), "store.log")

def lines(path):
    with open(path, "rb") as f:
        return f.read().splitlines(keepends=True)
`

export const kvWal: WorkshopProject = {
  id: 'kv-wal',
  title: 'A key-value store with a write-ahead log',
  outcome: 'A small durable key-value store in Python: every write goes to a checksummed log before it is acknowledged, the store rebuilds itself from that log after a crash (including a crash halfway through a write), and the log is compacted without ever being left half-written.',
  area: 'databases',
  prerequisites: ['Hash tables', 'Files and file descriptors'],
  languages: ['python'],
  stages: [
    {
      id: 'memtable',
      title: 'The table in memory',
      goal: 'Build the in-memory table the log will later protect.',
      brief: `In \`kv.py\`, finish the class \`KV\`.

- \`KV(path)\` makes an empty store. Keep \`path\`; nothing is written to it yet.
- \`set(key, value)\` stores a value. Keys and values are strings: anything else raises \`TypeError\`.
- \`get(key, default=None)\` returns the value, or \`default\` when the key is absent.
- \`delete(key)\` removes a key and returns \`True\`; returns \`False\` when it wasn't there.
- \`keys()\` returns the keys as a sorted list.
- \`len(store)\` is the number of keys, and \`key in store\` works.
- \`close()\` does nothing yet.`,
      read: { concept: 'Hash tables', source: 'Designing Data-Intensive Applications, ch. 3: “Hash indexes”' },
      files: [{ path: 'kv.py', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'a value that was set can be read back',
          code: String.raw`s = KV(fresh())
s.set("a", "1")
assert s.get("a") == "1", "after set('a', '1'), get('a') returned %r" % (s.get("a"),)
s.set("a", "2")
assert s.get("a") == "2", "a second set on the same key should replace the value; get returned %r" % (s.get("a"),)`
        },
        {
          name: 'a missing key gives the default',
          code: String.raw`s = KV(fresh())
assert s.get("nope") is None, "get of a missing key should return None, got %r" % (s.get("nope"),)
assert s.get("nope", "x") == "x", "get('nope', 'x') should return the default 'x', got %r" % (s.get("nope", "x"),)`
        },
        {
          name: 'delete removes the key and says whether it was there',
          code: String.raw`s = KV(fresh())
s.set("a", "1")
r = s.delete("a")
assert r is True, "deleting a key that exists should return True, got %r" % (r,)
assert s.get("a") is None, "the key is still readable after delete: get returned %r" % (s.get("a"),)
r = s.delete("a")
assert r is False, "deleting a key that is not there should return False, got %r" % (r,)`
        },
        {
          name: 'keys are sorted, and len and in agree with them',
          code: String.raw`s = KV(fresh())
for k in ["pear", "apple", "fig"]:
    s.set(k, k.upper())
assert s.keys() == ["apple", "fig", "pear"], "keys() should be the sorted list ['apple', 'fig', 'pear'], got %r" % (s.keys(),)
assert len(s) == 3, "len(store) should be 3 after three sets, got %r" % (len(s),)
assert "fig" in s and "plum" not in s, "'fig' in store should be True and 'plum' in store False"`
        },
        {
          name: 'keys and values must be strings',
          code: String.raw`s = KV(fresh())
for key, value in [(1, "x"), ("x", 1), ("x", None), (b"x", "y")]:
    try:
        s.set(key, value)
    except TypeError:
        continue
    assert False, "set(%r, %r) should raise TypeError; it was accepted" % (key, value)
assert len(s) == 0, "a refused set must not store anything; the store has %d keys" % len(s)`
        }
      ],
      hints: ['Python already has the data structure this stage needs.', 'A dict holds the pairs; every method here is one or two lines over it. Check the types before you store anything.', 'Keep a dict on the instance. set: refuse non-strings with TypeError, then assign. get: the dict’s own get. delete: test membership first so you can return False without raising. keys: sorted. Define __len__ and __contains__ so len() and in work.'],
      teaches: ['Hash tables', 'In-memory tables (memtables)'],
      recall: 'A store that keeps everything in a dict is fast. What exactly is lost if the process dies, and why does that decide what the next stage must add?'
    },
    {
      id: 'wal',
      title: 'Write it down first',
      goal: 'Append every change to a checksummed log on disc before changing the table.',
      brief: `Still in \`kv.py\`. Add two module-level functions and use them from \`KV\`.

**The record format.** One record per line:

\`\`\`
cccccccc BODY\\n
\`\`\`

\`BODY\` is the JSON array \`[op, key, value]\` with no spaces (\`json.dumps(..., separators=(",", ":"))\`); \`op\` is \`"set"\` or \`"del"\` (for \`"del"\`, value is \`null\`). \`cccccccc\` is the CRC-32 of BODY's UTF-8 bytes (\`zlib.crc32\`), as eight lower-case hex digits, then one space.

- \`encode_record(op, key, value=None) -> bytes\` returns that line, newline included.
- \`decode_record(line: bytes)\` returns the tuple \`(op, key, value)\`, or \`None\` when the line is not a whole, valid record (cut short, checksum wrong, not this format at all). It never raises.

**The store.** \`KV(path)\` opens the file at \`path\` for appending (creating it). \`set\` and a \`delete\` that removes something append one record, and the record must be on its way to disc (flushed) *before* the table changes and the call returns. \`get\`, and a \`delete\` of a missing key, write nothing. \`close()\` closes the file.`,
      read: { concept: 'Write-ahead logging', source: 'Designing Data-Intensive Applications, ch. 3: “Making B-trees reliable”; the PostgreSQL manual, “Write-Ahead Logging (WAL)”' },
      files: [],
      tests: [
        {
          name: 'encode_record writes one checksummed line',
          code: String.raw`import zlib, json
assert hasattr(_kv, "encode_record"), "kv.py has no function called encode_record"
line = _kv.encode_record("set", "a", "1")
assert isinstance(line, bytes), "encode_record should return bytes, got %s" % type(line).__name__
assert line.endswith(b"\n") and line.count(b"\n") == 1, "a record is exactly one line ending in a newline, got %r" % (line,)
body = b'["set","a","1"]'
want = ("%08x " % zlib.crc32(body)).encode() + body + b"\n"
assert line == want, "encode_record('set', 'a', '1') should be %r, got %r" % (want, line)`
        },
        {
          name: 'decode_record reads back what encode_record wrote',
          code: String.raw`for op, key, value in [("set", "a", "1"), ("set", "two words", "line\nbreak"), ("set", "é", "ü→"), ("del", "a", None)]:
    got = _kv.decode_record(_kv.encode_record(op, key, value))
    assert got == (op, key, value), "decode_record(encode_record(%r, %r, %r)) should give the same three back as a tuple, got %r" % (op, key, value, got)`
        },
        {
          name: 'decode_record refuses a record whose bytes were changed',
          code: String.raw`line = bytearray(_kv.encode_record("set", "balance", "100"))
line[-4] = ord("9")
got = _kv.decode_record(bytes(line))
assert got is None, "one byte of the body was changed, so the checksum no longer matches: expected None, got %r" % (got,)`
        },
        {
          name: 'decode_record refuses a record cut short, and never raises',
          code: String.raw`whole = _kv.encode_record("set", "key", "value")
for bad in [whole[:-1], whole[:12], whole[:5], b"", b"\n", b"not a record\n", b"zzzzzzzz []\n", b"\xff\xfe\n"]:
    try:
        got = _kv.decode_record(bad)
    except Exception as e:
        assert False, "decode_record(%r) raised %s; it should return None" % (bad, type(e).__name__)
    assert got is None, "decode_record(%r) should be None (not a whole valid record), got %r" % (bad, got)`
        },
        {
          name: 'every set and delete adds one record to the log',
          code: String.raw`p = fresh()
s = KV(p)
assert os.path.exists(p), "KV(path) should create the log file; nothing is at the path"
s.set("a", "1"); s.set("b", "2"); s.delete("a")
got = [_kv.decode_record(l) for l in lines(p)]
assert got == [("set", "a", "1"), ("set", "b", "2"), ("del", "a", None)], "after set a, set b, delete a the log should hold those three records in order; it holds %r" % (got,)`
        },
        {
          name: 'reads, and deleting a key that is not there, write nothing',
          code: String.raw`p = fresh()
s = KV(p)
s.set("a", "1")
before = os.path.getsize(p)
s.get("a"); s.get("zzz"); s.delete("zzz"); s.keys(); len(s)
after = os.path.getsize(p)
assert after == before, "the log grew from %d to %d bytes on calls that change nothing" % (before, after)`
        },
        {
          name: 'the record is in the file by the time set returns',
          code: String.raw`p = fresh()
s = KV(p)
s.set("a", "1")
n = len(lines(p))
assert n == 1, "another reader opening the file straight after set() sees %d records, expected 1 (is the write still sitting in a buffer?)" % n`
        }
      ],
      hints: ['Two questions decide this stage: in what order do “write the record” and “change the dict” happen, and when do bytes written to a file object actually reach the file?', 'Python buffers writes: until the buffer is flushed, another reader of the file sees nothing. decode_record should treat every surprise (wrong length, bad hex, bad JSON, wrong shape) as “not a record” rather than let an exception out.', 'encode: dump the JSON body, checksum its bytes, format eight hex digits, a space, the body, a newline, and encode. decode: decode the bytes, check it ends in a newline and has a space at index 8, compare the checksum of the body with the hex, parse the JSON, check the shape, return a tuple; any failure returns None. In KV: open the file in append-binary mode; in set and delete, write the record and flush before touching the dict.'],
      teaches: ['Write-ahead logging', 'Checksums'],
      recall: 'Why must the record reach the log before the in-memory table changes, rather than after?'
    },
    {
      id: 'recovery',
      title: 'Come back from the log',
      goal: 'Rebuild the table by replaying the log when the store is opened.',
      brief: `\`KV(path)\` on a file that already holds records must come up with the table those records describe: replay them in order (a \`"set"\` stores, a \`"del"\` removes), then carry on appending to the same file.

Opening must not write: a store that is opened and closed leaves the log exactly as it found it. A path with no file yet still starts an empty store.`,
      read: { concept: 'Crash recovery by log replay', source: 'Database Internals (Petrov), ch. 5: “Recovery”' },
      files: [],
      tests: [
        {
          name: 'a reopened store has what was set',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("b", "2"); s.close()
t = KV(p)
assert t.keys() == ["a", "b"], "after reopening, keys() should be ['a', 'b'], got %r" % (t.keys(),)
assert t.get("b") == "2", "after reopening, get('b') should be '2', got %r" % (t.get("b"),)`
        },
        {
          name: 'deletes are replayed too',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("b", "2"); s.delete("a"); s.close()
t = KV(p)
assert "a" not in t, "'a' was deleted before the store closed, but it is back after reopening"
assert len(t) == 1, "one key should be left after reopening, found %d" % len(t)`
        },
        {
          name: 'the last write to a key wins',
          code: String.raw`p = fresh()
s = KV(p)
for v in ["1", "2", "3"]:
    s.set("a", v)
s.delete("a"); s.set("a", "4"); s.close()
got = KV(p).get("a")
assert got == "4", "set 1, 2, 3, delete, set 4: after reopening get('a') should be '4', got %r" % (got,)`
        },
        {
          name: 'opening and closing leaves the log untouched',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("b", "2"); s.close()
before = open(p, "rb").read()
KV(p).close(); KV(p).close()
after = open(p, "rb").read()
assert after == before, "the log changed from %d to %d bytes just by opening the store twice" % (len(before), len(after))`
        },
        {
          name: 'writes after a reopen are appended, not written over',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.close()
t = KV(p); t.set("b", "2"); t.close()
u = KV(p)
assert u.keys() == ["a", "b"], "a was written before a reopen and b after it; a third open should see both, got %r" % (u.keys(),)`
        }
      ],
      hints: ['Everything needed to rebuild the table is already in the file, in the order it happened.', 'Read the file line by line before opening it for appending, and apply each decoded record to the dict the same way set and delete would, without logging it again.', 'In __init__: start with an empty dict; if the file exists, open it for reading in binary, decode each line, and apply it (set stores, del removes) directly to the dict. Only then open the file in append mode for new writes. Replaying must not call your own set(), or every reopen would double the log.'],
      teaches: ['Crash recovery by log replay', 'Write-ahead logging'],
      recall: 'During replay, why must recovered records be applied to the table without being appended to the log again?'
    },
    {
      id: 'torn',
      title: 'A crash halfway through a write',
      goal: 'Recover cleanly when the log ends in a torn or corrupted record.',
      brief: `A crash can leave the last record half-written, and a bad disc can corrupt one in the middle. On open:

- Replay records in order and **stop at the first one \`decode_record\` refuses**. Nothing after it is applied, even if later lines look valid: once the log is broken you no longer know the order of what follows.
- **Cut the file back** to the end of the last good record, so the next append starts on a clean boundary.
- A log with nothing wrong is left byte for byte as it was (the test from stage 3 still runs).`,
      read: { concept: 'Torn writes and log truncation', source: 'SQLite documentation, “Atomic Commit in SQLite” (sections on torn pages and journal checks)' },
      files: [],
      tests: [
        {
          name: 'a record cut short at the end is ignored',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("b", "2"); s.close()
with open(p, "ab") as f:
    f.write(_kv.encode_record("set", "c", "3")[:-7])
t = KV(p)
assert t.keys() == ["a", "b"], "the log ends in half a record for 'c'; the store should hold ['a', 'b'], got %r" % (t.keys(),)`
        },
        {
          name: 'the torn tail is cut off the file',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.close()
good = os.path.getsize(p)
with open(p, "ab") as f:
    f.write(b"0badc0de [\"set\",\"x\"")
KV(p).close()
size = os.path.getsize(p)
assert size == good, "after opening a log with a torn tail the file should be cut back to its %d good bytes; it is %d bytes" % (good, size)`
        },
        {
          name: 'a write after recovering from a torn tail survives the next reopen',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.close()
with open(p, "ab") as f:
    f.write(_kv.encode_record("set", "lost", "x")[:10])
t = KV(p); t.set("b", "2"); t.close()
u = KV(p)
assert u.keys() == ["a", "b"], "b was written after recovery, yet a later open sees %r (did the new record land on the end of the torn one?)" % (u.keys(),)`
        },
        {
          name: 'a corrupted record in the middle stops the replay there',
          code: String.raw`p = fresh()
s = KV(p)
for k in ["a", "b", "c", "d"]:
    s.set(k, k)
s.close()
recs = lines(p)
broken = bytearray(recs[1]); broken[-3] ^= 0x01
with open(p, "wb") as f:
    f.write(recs[0] + bytes(broken) + recs[2] + recs[3])
t = KV(p)
assert t.keys() == ["a"], "the second of four records is corrupt, so only the first can be trusted: expected ['a'], got %r" % (t.keys(),)
t.close()
assert os.path.getsize(p) == len(recs[0]), "the file should be cut back to the one good record (%d bytes); it is %d bytes" % (len(recs[0]), os.path.getsize(p))`
        },
        {
          name: 'a log that is only rubbish opens as an empty store',
          code: String.raw`p = fresh()
with open(p, "wb") as f:
    f.write(b"\x00\x01\x02 this was never a log")
t = KV(p)
assert len(t) == 0, "nothing in the file is a record, so the store should be empty; it has %d keys" % len(t)
t.set("a", "1"); t.close()
assert KV(p).get("a") == "1", "a value written after opening a rubbish file was not there on the next open"`
        }
      ],
      hints: ['decode_record already tells you which records to trust. The question is what to do with the file from the first refusal onwards.', 'Count the bytes of the records you accept. Where that count is less than the file’s size, everything beyond it is the tear: a new record appended after it would be glued to the rubbish and lost.', 'While replaying, add up the length of each line that decodes; stop at the first that doesn’t. After the loop, if that total differs from the file’s size, truncate the file to the total (open it for update and call truncate) before opening it for appending. Don’t truncate when nothing is wrong, or the “untouched” test fails.'],
      teaches: ['Torn writes and log truncation', 'Checksums', 'Crash recovery by log replay'],
      recall: 'After a corrupt record in the middle of a log, later records may decode perfectly well. Why is it still wrong to apply them?'
    },
    {
      id: 'compact',
      title: 'Compaction that cannot half-happen',
      goal: 'Rewrite the log to one record per live key, swapped in atomically.',
      brief: `The log only grows: a key set a thousand times has a thousand records. Add \`compact()\` to \`KV\`.

- It writes a new log holding exactly one \`"set"\` record per live key (sorted by key), into a temporary file **in the same folder** as the log, then moves it over the log with \`os.replace\`, which swaps it in one step.
- Afterwards the store carries on appending to the new log.
- If anything fails before the swap, the old log is untouched, the error is raised to the caller, and no temporary file is left behind.`,
      read: { concept: 'Log compaction', source: 'Designing Data-Intensive Applications, ch. 3: “Hash indexes” (segments and compaction); rename(2): “If newpath already exists, it will be atomically replaced”' },
      files: [],
      tests: [
        {
          name: 'compact leaves one record per live key',
          code: String.raw`p = fresh()
s = KV(p)
for i in range(50):
    s.set("counter", str(i))
s.set("b", "2"); s.set("gone", "x"); s.delete("gone")
s.compact()
got = [_kv.decode_record(l) for l in lines(p)]
assert got == [("set", "b", "2"), ("set", "counter", "49")], "after compact the log should hold one set per live key, sorted: b then counter; it holds %r" % (got,)`
        },
        {
          name: 'the store reads the same after compact, and after a reopen',
          code: String.raw`p = fresh()
s = KV(p)
for i in range(20):
    s.set("k%d" % (i % 5), str(i))
s.delete("k0")
want = {k: s.get(k) for k in s.keys()}
s.compact()
got = {k: s.get(k) for k in s.keys()}
assert got == want, "compact changed what the open store returns: before %r, after %r" % (want, got)
s.close()
t = KV(p)
got = {k: t.get(k) for k in t.keys()}
assert got == want, "after compact and a reopen the store should hold %r, got %r" % (want, got)`
        },
        {
          name: 'writes after compact go to the new log',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("a", "2"); s.compact(); s.set("b", "3"); s.delete("a"); s.close()
t = KV(p)
assert t.keys() == ["b"], "set b and delete a came after compact; a reopen should see only ['b'], got %r (is the store still writing to the old file?)" % (t.keys(),)`
        },
        {
          name: 'no temporary file is left in the folder',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.compact(); s.close()
left = sorted(os.listdir(os.path.dirname(p)))
assert left == ["store.log"], "after compact the folder should hold only store.log; it holds %r" % (left,)`
        },
        {
          name: 'if the swap fails, the old log is untouched and the error is raised',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.set("a", "2"); s.set("b", "3")
before = open(p, "rb").read()
real = os.replace
def refuse(*a, **k):
    raise OSError("disc says no")
os.replace = refuse
try:
    try:
        s.compact()
        raised = False
    except OSError:
        raised = True
finally:
    os.replace = real
assert raised, "os.replace failed, and compact() returned as if nothing had happened; the OSError should reach the caller"
after = open(p, "rb").read()
assert after == before, "the swap failed, so the log should be exactly as it was (%d bytes); it is now %d bytes" % (len(before), len(after))
left = sorted(os.listdir(os.path.dirname(p)))
assert left == ["store.log"], "after a failed compact the folder should hold only store.log; it holds %r" % (left,)`
        },
        {
          name: 'compacting an empty store leaves an empty log',
          code: String.raw`p = fresh()
s = KV(p); s.set("a", "1"); s.delete("a"); s.compact()
assert os.path.getsize(p) == 0, "no keys are live, so the compacted log should be empty; it is %d bytes" % os.path.getsize(p)
s.set("z", "9"); s.close()
assert KV(p).get("z") == "9", "a value set after compacting an empty store was not there on reopen"`
        }
      ],
      hints: ['Ask what a reader would find if the process died at each line of your compact(). There must be no line where the answer is “half a log”.', 'Writing the new log in place destroys the old one before the new one is complete. Writing it beside the old one and renaming it over is a single step the operating system either does or doesn’t. Your open file object still points at the old file after the rename.', 'Write one set record per key (sorted) to a temporary file next to the log; flush it. os.replace it onto the log’s path. Wrap those steps so that on any failure the temporary file is removed and the exception re-raised. After a successful swap, close the old append handle and open the path for appending again.'],
      teaches: ['Log compaction', 'Atomic file replacement'],
      recall: 'Why is the new log written to a temporary file and renamed over the old one, instead of rewriting the old file in place?'
    }
  ],
  solution: [{ path: 'kv.py', content: SOLUTION }]
}
