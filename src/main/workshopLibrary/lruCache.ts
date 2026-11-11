import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts. C++ here: the tests #include the learner's lru.hpp.

const STARTER = String.raw`// An LRU cache. Built in four stages; see STAGE-1.md.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <list>
#include <stdexcept>
#include <unordered_map>
#include <utility>
#include <vector>

template <class K, class V>
class LRUCache {
 public:
  using Clock = std::function<std::int64_t()>;
  using Evicted = std::function<void(const K&, const V&)>;

  // Stage 1 (capacity); stage 3 (clock)
  explicit LRUCache(std::size_t capacity, Clock clock = nullptr) : cap_(capacity), clock_(std::move(clock)) {}

  // Stage 1: the value, or nullptr. Stage 3: ttl
  V* get(const K& key) { (void)key; return nullptr; }
  void put(const K& key, V value, std::int64_t ttl = 0) { (void)key; (void)value; (void)ttl; }
  bool contains(const K& key) const { (void)key; return false; }
  std::size_t size() const { return 0; }
  std::size_t capacity() const { return cap_; }
  std::vector<K> keys() const { return {}; }

  // Stage 2
  bool erase(const K& key) { (void)key; return false; }
  void resize(std::size_t capacity) { (void)capacity; }
  void on_evict(Evicted callback) { (void)callback; }

  // Stage 3
  std::size_t purge_expired() { return 0; }

 private:
  std::size_t cap_;
  Clock clock_;
};
`

const SOLUTION = String.raw`// An LRU cache: a list in recency order and a hash map into it, so every operation is O(1).
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <list>
#include <stdexcept>
#include <unordered_map>
#include <utility>
#include <vector>

template <class K, class V>
class LRUCache {
 public:
  using Clock = std::function<std::int64_t()>;
  using Evicted = std::function<void(const K&, const V&)>;

  explicit LRUCache(std::size_t capacity, Clock clock = nullptr) : cap_(capacity), clock_(std::move(clock)) {
    if (capacity == 0) throw std::invalid_argument("capacity must be at least 1");
  }

  V* get(const K& key) {
    auto it = index_.find(key);
    if (it == index_.end()) return nullptr;
    if (expired(*it->second)) {
      order_.erase(it->second);
      index_.erase(it);
      return nullptr;
    }
    order_.splice(order_.begin(), order_, it->second);
    return &it->second->value;
  }

  void put(const K& key, V value, std::int64_t ttl = 0) {
    if (ttl > 0 && !clock_) throw std::logic_error("a ttl needs a clock");
    const std::int64_t deadline = ttl > 0 ? clock_() + ttl : 0;
    auto it = index_.find(key);
    if (it != index_.end()) {
      it->second->value = std::move(value);
      it->second->deadline = deadline;
      order_.splice(order_.begin(), order_, it->second);
      return;
    }
    if (index_.size() >= cap_) evict_one();
    order_.push_front(Node{key, std::move(value), deadline});
    index_.emplace(key, order_.begin());
  }

  bool contains(const K& key) const {
    auto it = index_.find(key);
    return it != index_.end() && !expired(*it->second);
  }

  std::size_t size() const { return index_.size(); }
  std::size_t capacity() const { return cap_; }

  std::vector<K> keys() const {
    std::vector<K> out;
    out.reserve(order_.size());
    for (const Node& n : order_) out.push_back(n.key);
    return out;
  }

  bool erase(const K& key) {
    auto it = index_.find(key);
    if (it == index_.end()) return false;
    order_.erase(it->second);
    index_.erase(it);
    return true;
  }

  void resize(std::size_t capacity) {
    if (capacity == 0) throw std::invalid_argument("capacity must be at least 1");
    cap_ = capacity;
    while (index_.size() > cap_) evict_one();
  }

  void on_evict(Evicted callback) { evicted_ = std::move(callback); }

  std::size_t purge_expired() {
    std::size_t n = 0;
    for (auto it = order_.begin(); it != order_.end();) {
      if (expired(*it)) {
        index_.erase(it->key);
        it = order_.erase(it);
        n++;
      } else ++it;
    }
    return n;
  }

 private:
  struct Node {
    K key;
    V value;
    std::int64_t deadline;  // 0: never
  };

  bool expired(const Node& n) const { return n.deadline != 0 && clock_ && clock_() >= n.deadline; }

  void evict_one() {
    Node& last = order_.back();
    if (evicted_) evicted_(last.key, last.value);
    index_.erase(last.key);
    order_.pop_back();
  }

  std::size_t cap_;
  Clock clock_;
  Evicted evicted_;
  std::list<Node> order_;  // most recently used first
  std::unordered_map<K, typename std::list<Node>::iterator> index_;
};
`

const HELPERS = String.raw`#include "lru.hpp"
#include <memory>
#include <string>
#include <vector>
#define HELPER static __attribute__((unused))

HELPER std::string show(const std::vector<std::string>& v) {
  std::string s = "[";
  for (std::size_t i = 0; i < v.size(); i++) s += (i ? ", " : "") + v[i];
  return s + "]";
}

HELPER std::string show(const std::vector<int>& v) {
  std::string s = "[";
  for (std::size_t i = 0; i < v.size(); i++) s += (i ? ", " : "") + std::to_string(v[i]);
  return s + "]";
}

using SV = std::vector<std::string>;
using IV = std::vector<int>;
`

const CLOCK = String.raw`static std::int64_t fake_now = 0;
HELPER std::int64_t tick() { return fake_now; }
`

const TRACKED = String.raw`struct Tracked {
  static inline int copies = 0;
  int v = 0;
  Tracked() = default;
  explicit Tracked(int x) : v(x) {}
  Tracked(const Tracked& o) : v(o.v) { copies++; }
  Tracked(Tracked&& o) noexcept : v(o.v) {}
  Tracked& operator=(const Tracked& o) { v = o.v; copies++; return *this; }
  Tracked& operator=(Tracked&& o) noexcept { v = o.v; return *this; }
};
`

export const lruCache: WorkshopProject = {
  id: 'lru-cache',
  title: 'An LRU cache in C++',
  outcome: 'A generic least-recently-used cache in modern C++, with every operation in constant time: a linked list in recency order and a hash map into it, eviction callbacks and resizing, expiry against an injected clock, and values that are moved and never copied, so it can hold std::unique_ptr.',
  area: 'c-cpp',
  prerequisites: ['Hash tables', 'Linked lists', 'C++ classes and templates'],
  languages: ['cpp'],
  stages: [
    {
      id: 'recency',
      title: 'Most recent first',
      goal: 'Keep at most capacity entries and evict the least recently used one, with get and put in constant time.',
      brief: `In \`lru.hpp\`, finish the class template \`LRUCache<K, V>\` (the signatures are there; the tests \`#include\` the file).

- \`LRUCache(capacity)\`: a capacity of 0 throws \`std::invalid_argument\`.
- \`V* get(const K& key)\`: a pointer to the value, or \`nullptr\` when absent. A hit makes the entry the **most recently used**. The pointer is valid until the cache is next changed.
- \`void put(const K& key, V value)\`: stores or replaces the value and makes the entry the most recently used. Adding a new key to a full cache first **evicts the least recently used** entry. Replacing an existing key never evicts.
- \`bool contains(const K& key) const\`: whether the key is held. It does **not** count as a use.
- \`size()\`, \`capacity()\`, and \`keys()\`: the keys from most to least recently used.

\`get\` and \`put\` must not walk the entries: keep a \`std::list\` in recency order and a \`std::unordered_map\` from key to the list iterator. \`std::list::splice\` moves a node to the front without copying it.`,
      read: { concept: 'LRU caches', source: 'cppreference: std::list::splice and std::unordered_map; Bélády, “A study of replacement algorithms for a virtual-storage computer” (IBM Systems Journal, 1966)' },
      files: [{ path: 'lru.hpp', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'a value put can be got back, and replaced',
          code: String.raw`LRUCache<std::string, int> c(2);
c.put("a", 1);
int* v = c.get("a");
CHECK(v && *v == 1, "after put(\"a\", 1), get(\"a\") should point at 1, got %s", v ? std::to_string(*v).c_str() : "nullptr");
c.put("a", 5);
v = c.get("a");
CHECK(v && *v == 5, "after put(\"a\", 5) on an existing key, get(\"a\") should point at 5, got %s", v ? std::to_string(*v).c_str() : "nullptr");
CHECK(c.size() == 1, "replacing a value should leave size() at 1, got %zu", c.size());`
        },
        {
          name: 'a missing key gives nullptr',
          code: String.raw`LRUCache<int, int> c(3);
c.put(1, 10);
CHECK(c.get(2) == nullptr, "get of a key never put should be nullptr");
CHECK(c.size() == 1, "size() should be 1 after one put, got %zu", c.size());`
        },
        {
          name: 'the least recently used entry is evicted when full',
          code: String.raw`LRUCache<std::string, int> c(2);
c.put("a", 1); c.put("b", 2); c.put("c", 3);
CHECK(c.get("a") == nullptr, "capacity 2, put a, b, c: a was least recently used and should be gone");
CHECK(c.size() == 2, "size() should stay at the capacity, 2, got %zu", c.size());
CHECK(c.keys() == SV({"c", "b"}), "keys() should be [c, b] (most recent first), got %s", show(c.keys()).c_str());`
        },
        {
          name: 'a get counts as a use',
          code: String.raw`LRUCache<std::string, int> c(2);
c.put("a", 1); c.put("b", 2);
c.get("a");
c.put("c", 3);
CHECK(c.get("b") == nullptr && c.get("a") != nullptr, "put a, put b, get a, put c: b was least recently used and should be the one evicted; keys() is %s", show(c.keys()).c_str());`
        },
        {
          name: 'replacing a value counts as a use and never evicts',
          code: String.raw`LRUCache<std::string, int> c(2);
c.put("a", 1); c.put("b", 2); c.put("a", 10);
CHECK(c.size() == 2 && c.contains("b"), "replacing a in a full cache should evict nothing; keys() is %s", show(c.keys()).c_str());
c.put("c", 3);
CHECK(c.keys() == SV({"c", "a"}), "after put a, b, a again, c: b should be evicted and keys() be [c, a], got %s", show(c.keys()).c_str());`
        },
        {
          name: 'contains does not count as a use',
          code: String.raw`LRUCache<int, int> c(2);
c.put(1, 1); c.put(2, 2);
CHECK(c.contains(1) && !c.contains(3), "contains(1) should be true and contains(3) false");
c.put(3, 3);
CHECK(!c.contains(1), "contains(1) must not make 1 recently used: after put 1, 2, contains(1), put 3, key 1 should be evicted; keys() is %s", show(c.keys()).c_str());`
        },
        {
          name: 'a capacity of zero is refused',
          code: String.raw`bool thrown = false;
try { LRUCache<int, int> c(0); } catch (const std::invalid_argument&) { thrown = true; }
CHECK(thrown, "LRUCache(0) should throw std::invalid_argument");`
        }
      ],
      hints: [
        'Two questions must each be answered in constant time: “where is this key?” and “which entry was used least recently?”. One container can’t answer both.',
        'A doubly linked list keeps recency order, with the most recent at the front; moving a node to the front, given an iterator to it, is constant time with splice. A hash map from key to that iterator finds the node. The list node must hold the key too, so the map entry can be erased when the back is evicted.',
        'Members: std::list<Node> where Node holds key and value, and std::unordered_map<K, list iterator>. get: find in the map; if absent nullptr; else splice the node to the front and return its value’s address. put: if present, assign the value and splice to the front; else, if full, erase the back node’s key from the map and pop_back, then push_front the new node and store begin() in the map. keys walks the list.'
      ],
      teaches: ['LRU caches', 'Hash tables', 'Doubly linked lists'],
      recall: 'Why does an LRU cache need both a hash map and a linked list, and what does the list node have to store for eviction to stay O(1)?'
    },
    {
      id: 'evict',
      title: 'Erase, resize, and being told',
      goal: 'Erase entries, shrink or grow the cache, and report every eviction through a callback.',
      brief: `Add to \`LRUCache\` in \`lru.hpp\`:

- \`bool erase(const K& key)\`: removes the entry; \`true\` if it was there. Erasing is not an eviction.
- \`void on_evict(Evicted callback)\`: from now on, every entry evicted for lack of room is passed to \`callback(key, value)\` **before** it is removed, least recently used first. Only evictions: not \`erase\`, not replacing a value.
- \`void resize(std::size_t capacity)\`: changes the capacity. Shrinking evicts least recently used entries (through the callback) until the cache fits. A capacity of 0 throws \`std::invalid_argument\` and changes nothing.`,
      read: { concept: 'Eviction policies', source: 'cppreference: std::function; Redis documentation, “Key eviction” (maxmemory policies)' },
      files: [],
      tests: [
        {
          name: 'erase removes an entry and says whether it was there',
          code: String.raw`LRUCache<int, int> c(2);
c.put(1, 1); c.put(2, 2);
CHECK(c.erase(1), "erase(1) of a held key should return true");
CHECK(!c.erase(1), "a second erase(1) should return false");
CHECK(c.size() == 1 && !c.contains(1), "after erase(1) the cache should hold only 2; keys() is %s", show(c.keys()).c_str());
c.put(3, 3);
CHECK(c.contains(2) && c.contains(3), "erase made room, so put(3) should evict nothing; keys() is %s", show(c.keys()).c_str());`
        },
        {
          name: 'the callback hears each eviction with its key and value',
          code: String.raw`LRUCache<std::string, int> c(2);
std::vector<std::string> heard;
c.on_evict([&](const std::string& k, const int& v) { heard.push_back(k + "=" + std::to_string(v)); });
c.put("a", 1); c.put("b", 2); c.get("a"); c.put("c", 3); c.put("d", 4);
CHECK(heard == SV({"b=2", "a=1"}), "put a, b, get a, put c, put d with capacity 2 evicts b then a; the callback heard %s", show(heard).c_str());`
        },
        {
          name: 'erase and replacing a value are not evictions',
          code: String.raw`LRUCache<int, int> c(2);
int calls = 0;
c.on_evict([&](const int&, const int&) { calls++; });
c.put(1, 1); c.put(1, 2); c.erase(1); c.put(2, 2);
CHECK(calls == 0, "replacing a value and erasing should not call the eviction callback; it was called %d times", calls);`
        },
        {
          name: 'shrinking evicts the least recently used, through the callback',
          code: String.raw`LRUCache<int, int> c(4);
IV heard;
c.on_evict([&](const int& k, const int&) { heard.push_back(k); });
for (int i = 1; i <= 4; i++) c.put(i, i);
c.get(1);
c.resize(2);
CHECK(c.capacity() == 2 && c.size() == 2, "after resize(2), capacity() and size() should both be 2, got %zu and %zu", c.capacity(), c.size());
CHECK(heard == IV({2, 3}), "put 1 to 4, get 1, resize(2): 2 then 3 should be evicted; the callback heard %s", show(heard).c_str());
CHECK(c.keys() == IV({1, 4}), "keys() after the resize should be [1, 4], got %s", show(c.keys()).c_str());`
        },
        {
          name: 'growing keeps everything, and a capacity of zero is refused',
          code: String.raw`LRUCache<int, int> c(2);
c.put(1, 1); c.put(2, 2);
c.resize(3);
c.put(3, 3);
CHECK(c.size() == 3, "after resize(3) three entries should fit, size() is %zu", c.size());
bool thrown = false;
try { c.resize(0); } catch (const std::invalid_argument&) { thrown = true; }
CHECK(thrown && c.capacity() == 3 && c.size() == 3, "resize(0) should throw std::invalid_argument and change nothing (capacity %zu, size %zu)", c.capacity(), c.size());`
        }
      ],
      hints: [
        'There is already one place that evicts. Make it the only one, and have resize use it.',
        'Pull eviction into a private function that calls the callback (if one is set) with the back node, then removes it from the map and the list. put calls it when full; resize calls it in a loop. The callback must run before the node is destroyed, since it is given references into it.',
        'Store an Evicted member; on_evict moves the argument into it. evict_one: take a reference to order_.back(); if the callback is set, call it with the node’s key and value; erase the key from the map; pop_back. erase: find, then erase from both containers. resize: refuse 0 first, set the capacity, then evict while size exceeds it.'
      ],
      teaches: ['Eviction policies', 'Callbacks and std::function'],
      recall: 'Why must the eviction callback be called before the node is removed from the list, and not after?'
    },
    {
      id: 'expiry',
      title: 'Entries that expire',
      goal: 'Let an entry expire after a time to live, read against an injected clock rather than the real one.',
      brief: `A cache often holds things that go stale. In \`lru.hpp\`:

- The constructor's second argument is a \`Clock\`: a function returning the current time as a number (the tests use milliseconds and move time by hand). It may be absent.
- \`put(key, value, ttl)\`: with \`ttl > 0\` the entry expires at *now + ttl*, read from the clock when \`put\` is called; with \`ttl\` 0 (the default) it never expires. Putting the key again sets a new deadline (or none). A \`ttl > 0\` on a cache with no clock throws \`std::logic_error\`.
- An entry is expired once the clock reads **at or after** its deadline. \`get\` of an expired entry returns \`nullptr\` and removes it. \`contains\` returns \`false\` for it but removes nothing (it is \`const\`).
- \`size()\` and \`keys()\` count expired entries until something removes them.
- \`std::size_t purge_expired()\`: removes every expired entry and returns how many. Expiry is not an eviction: the callback is not called.`,
      read: { concept: 'Time to live (TTL) and testable clocks', source: 'Michael Feathers, Working Effectively with Legacy Code, ch. 3 “Sensing and Separation” (fakes); Memcached documentation, “Expiration”' },
      files: [],
      setup: CLOCK,
      tests: [
        {
          name: 'an entry expires when the clock reaches its deadline',
          code: String.raw`fake_now = 1000;
LRUCache<std::string, int> c(4, tick);
c.put("a", 1, 50);
fake_now = 1049;
CHECK(c.get("a") != nullptr, "put at 1000 with ttl 50: at 1049 it should still be there");
fake_now = 1050;
CHECK(c.get("a") == nullptr, "put at 1000 with ttl 50: at 1050 it has expired, so get should be nullptr");
CHECK(c.size() == 0, "get of an expired entry should remove it; size() is %zu", c.size());`
        },
        {
          name: 'no ttl means no expiry',
          code: String.raw`fake_now = 0;
LRUCache<int, int> c(4, tick);
c.put(1, 1);
fake_now = 1000000000;
CHECK(c.get(1) != nullptr, "an entry put without a ttl should never expire");`
        },
        {
          name: 'putting again sets a new deadline',
          code: String.raw`fake_now = 0;
LRUCache<int, int> c(4, tick);
c.put(1, 1, 10);
fake_now = 5;
c.put(1, 2, 10);
fake_now = 12;
int* v = c.get(1);
CHECK(v && *v == 2, "put at 0 with ttl 10, put again at 5 with ttl 10: at 12 the value 2 should still be there");
c.put(1, 3);
fake_now = 1000;
CHECK(c.get(1) != nullptr, "putting again with no ttl should remove the deadline");`
        },
        {
          name: 'contains says no to an expired entry without removing it; purge_expired removes them all',
          code: String.raw`fake_now = 0;
LRUCache<int, int> c(8, tick);
c.put(1, 1, 10); c.put(2, 2, 20); c.put(3, 3); c.put(4, 4, 5);
fake_now = 15;
CHECK(!c.contains(1) && c.contains(2) && c.contains(3), "at 15, key 1 (ttl 10) has expired and 2 (ttl 20) and 3 (none) have not");
CHECK(c.size() == 4, "contains is const and must not remove anything; size() should still be 4, got %zu", c.size());
std::size_t n = c.purge_expired();
CHECK(n == 2 && c.size() == 2, "purge_expired at 15 should remove keys 1 and 4 and return 2; it returned %zu and size() is %zu", n, c.size());
CHECK(c.keys() == IV({3, 2}), "after the purge keys() should be [3, 2], got %s", show(c.keys()).c_str());`
        },
        {
          name: 'expiry is not an eviction, and a ttl needs a clock',
          code: String.raw`fake_now = 0;
LRUCache<int, int> c(2, tick);
int calls = 0;
c.on_evict([&](const int&, const int&) { calls++; });
c.put(1, 1, 5);
fake_now = 10;
c.get(1);
c.put(2, 2, 5);
fake_now = 20;
c.purge_expired();
CHECK(calls == 0, "expired entries removed by get and purge_expired should not call the eviction callback; it was called %d times", calls);
LRUCache<int, int> plain(2);
bool thrown = false;
try { plain.put(1, 1, 10); } catch (const std::logic_error&) { thrown = true; }
CHECK(thrown, "put with a ttl on a cache with no clock should throw std::logic_error");`
        }
      ],
      hints: [
        'Each entry needs one more field. Time comes only from the clock you were given, so the tests can move it.',
        'Store an absolute deadline in the node (0 for none), computed from the clock in put. One small function answers “is this node expired now?”; get, contains and purge_expired all ask it. get may remove; contains may not.',
        'Add a deadline to Node. put: if ttl > 0 and there is no clock, throw std::logic_error; deadline = ttl > 0 ? clock() + ttl : 0; set it on both the replace and the insert paths. expired(node): deadline != 0 and clock() >= deadline. get: if expired, erase from list and map and return nullptr. purge_expired: walk the list with an iterator, erasing expired nodes (and their keys from the map) and counting them; list::erase returns the next iterator.'
      ],
      teaches: ['Time to live (TTL) and testable clocks', 'Dependency injection'],
      recall: 'Why does the cache take a clock as an argument instead of reading the system time itself?'
    },
    {
      id: 'moves',
      title: 'Moved, never copied',
      goal: 'Move values into and through the cache so that it never copies one and can hold move-only types.',
      brief: `A cache may hold large buffers or \`std::unique_ptr\`s, which must never be copied. In \`lru.hpp\`:

- \`put(key, value)\` takes the value **by value** and moves it into the list node, and on a replace moves it over the old one. A caller who writes \`put(k, std::move(x))\` or \`put(k, V(...))\` causes no copy at all.
- \`get\`, moving a node to the front, evicting (with or without the callback), \`resize\`, \`erase\` and \`purge_expired\` never copy or move a value.
- \`LRUCache<int, std::unique_ptr<int>>\` must compile and work: anything in your code that copies a value will not compile with it.

The tests count copies with a type that counts its own copy constructions and copy assignments.`,
      read: { concept: 'Move semantics', source: 'Scott Meyers, Effective Modern C++, items 23 to 25 (std::move, rvalue references) and item 41 (pass by value for copyable parameters that are always moved)' },
      files: [],
      setup: TRACKED,
      tests: [
        {
          name: 'putting, replacing and getting never copy a value',
          code: String.raw`LRUCache<int, Tracked> c(4);
Tracked::copies = 0;
c.put(1, Tracked(1));
Tracked t(2);
c.put(2, std::move(t));
c.put(1, Tracked(10));
Tracked* v = c.get(1);
c.get(2);
CHECK(v && v->v == 10, "get(1) should point at the replacing value 10");
CHECK(Tracked::copies == 0, "put of a temporary or a moved value, a replace and two gets should copy nothing; %d copies were made", Tracked::copies);`
        },
        {
          name: 'evicting, resizing and erasing never copy a value',
          code: String.raw`LRUCache<int, Tracked> c(2);
int seen = 0;
c.on_evict([&](const int&, const Tracked& x) { seen += x.v; });
Tracked::copies = 0;
for (int i = 1; i <= 5; i++) c.put(i, Tracked(i));
c.resize(1);
c.erase(5);
CHECK(seen == 1 + 2 + 3 + 4, "the callback should have seen values 1 to 4 evicted (sum 10), it saw a sum of %d", seen);
CHECK(Tracked::copies == 0, "five puts with evictions, a resize and an erase should copy nothing; %d copies were made", Tracked::copies);`
        },
        {
          name: 'a move-only value can be held',
          code: String.raw`LRUCache<int, std::unique_ptr<int>> c(2);
c.put(1, std::make_unique<int>(7));
c.put(2, std::make_unique<int>(8));
c.get(1);
c.put(3, std::make_unique<int>(9));
std::unique_ptr<int>* p = c.get(1);
CHECK(p && *p && **p == 7, "a cache of unique_ptr<int> should hand back the pointer put for key 1 (7)");
CHECK(c.get(2) == nullptr, "key 2 was least recently used and should have been evicted");
c.put(1, std::make_unique<int>(70));
p = c.get(1);
CHECK(p && *p && **p == 70, "replacing a unique_ptr value should hold the new pointer (70)");`
        }
      ],
      hints: [
        'Look for every place a V is named without std::move: a parameter taken by const reference, a Node built from a named value, a value assigned from a named variable.',
        'A by-value parameter is already the caller’s copy or move; from there on, it should only ever be moved. Building the node with Node{key, std::move(value), …} and assigning with = std::move(value) are the two moves needed. splice relinks nodes and never touches the values.',
        'Check put: the parameter is V value; on replace, node.value = std::move(value); on insert, push_front(Node{key, std::move(value), deadline}). Check that get returns a pointer into the node rather than a V, that the eviction callback receives const V&, and that nothing builds a std::vector<V> or a pair holding V by copy.'
      ],
      teaches: ['Move semantics', 'Value categories (lvalues and rvalues)'],
      recall: 'Why does taking a parameter by value and then moving it give a caller with a temporary zero copies, when taking it by const reference forces one?'
    }
  ],
  solution: [{ path: 'lru.hpp', content: SOLUTION }]
}
