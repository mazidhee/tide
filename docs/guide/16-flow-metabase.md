---
title: Learn your Metabase
group: Walkthroughs
card: no
summary: Connect Tide to your Metabase and ask the tutor what dashboards measure and how charts are built, with real numbers. Read-only, taught by Claude.
---
1. **Make an API key.** In Metabase, **Admin › Settings › Authentication › API keys**.
2. **Connect.** In Tide, **Settings → Tools**, enter your Metabase address and the key. The key is kept in your Mac's Keychain.
3. **Ask about it.** “Teach me our Metabase”, “what does the Collections dashboard measure?”, “how is the repayments chart built?”, “quiz me on which question answers X”.

The tutor searches Metabase, opens dashboards, questions and tables, reads a question's SQL, and runs a saved question or a SELECT to show real numbers.

> [!info] Read-only and local
> Tide only ever sends reading requests. SQL must be a single SELECT; anything that writes, locks or runs a second statement is refused before it leaves your Mac. Claude answers Metabase questions like any other (it reads Metabase through Tide's read-only tool); Gemma on your Mac takes over when Claude can't.

“Teach me Metabase” on its own builds a roadmap for learning Metabase in general. Mention *your* Metabase (“our”, “my”, a dashboard or question) and the tutor looks inside it.
