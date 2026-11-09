---
title: Your data and privacy
group: Reference
summary: Your notes are ordinary files. Tide's own data sits beside them in a hidden folder.
---
| What | Where |
| --- | --- |
| Notes, outlines, articles, transcripts, PDFs | In your vault, as ordinary files |
| Flashcards | In your notes, Spaced Repetition format |
| Review schedules and history | `.tide/srs.json`, `.tide/reviews.jsonl` |
| Lesson and quiz answers | `.tide/attempts.jsonl` |
| Conversations | `.tide/chats/` |
| Tutor threads | `.tide/threads/` |
| PDF highlights | `.tide/highlights/` |
| What the tutor remembers | `.tide/memory.json` |
| Library covers | `.tide/thumbs/` |
| Settings and the voice models | `~/Library/Application Support/Tide/` |

## What leaves your Mac

The text the tutor needs (your question, the relevant passages, the conversation so far) goes to the model server you set. With a local server it stays on your Mac. Web searches go to the provider you choose. The cloud helper, if you turn it on, gets only the jobs you let it take, and never private projects, Metabase or pictures. Nothing else is sent anywhere.
