---
learning_status: learning
tags: [flashcards]
---
# Hash maps

#flashcards

A hash map stores key–value pairs in an array of buckets. A hash function turns each key into a bucket index, so a lookup goes straight to one bucket: **O(1) on average**.

Two keys can land in the same bucket (a collision). Chaining keeps a small list per bucket; open addressing probes for the next free slot.

When the load factor (entries ÷ buckets) passes about 0.75, the map doubles its buckets and rehashes everything. One resize is O(n), but spread over all the inserts it stays O(1) amortised.

The worst case is O(n): every key in one bucket, from a bad hash or an attack.

What is the average lookup cost of a hash map::O(1), because the hash points straight at one bucket
What is the load factor::entries divided by buckets
Why is insertion O(1) amortised::resizing costs O(n) but happens rarely, so the cost per insert averages out
