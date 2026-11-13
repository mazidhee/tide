---
title: Claude as your tutor
group: Everyday
summary: With Claude Code logged in to your Claude plan, Claude teaches your lessons and Tide is its hands: your notes, the code runner, the SQL lab, What you know.
---
Tide runs your own Claude Code (`claude -p`), logged in to your Claude plan. It never reads or copies your login, and any API key in the environment is left out, so your plan is used.

## Setting it up

1. Install Claude Code and log in once in a terminal: run `claude` and follow the steps.
2. Open **Settings → Models**. Under **Claude**, it should say **Set up** with your plan. **Who teaches** is **Claude** by default.

Each notebook can choose too: in a notebook's **⋯** menu, **Have Claude teach it** or **Have Gemma teach it**. In a lesson or chat, the picker beside the box chooses **Claude Sonnet**, **Claude Opus**, **Claude Fable** or **Gemma only**, for that lesson.

## Which model does what

| Job | Model, by default |
| --- | --- |
| Ordinary lesson and chat turns | Sonnet |
| Marking your answers (a short separate call) | Opus |
| Opening a lesson with its plan, roadmaps, maths and proofs, "go deeper" | Opus |
| Roadmap outlines, chat titles and summaries | Haiku |

Change any of them in **Settings → Models**. Fable is there for the hardest material.

## What Claude can do in Tide

Claude uses Tide's tools, and each call shows as a step above its answer:

- search and read your notes, imported courses and saved video transcripts
- run code in Tide's sandbox, and SQL in the lesson's lab
- see your profile, plan, past lessons and the recall questions that are due
- make flashcards and keep questions for recall
- record marks in **What you know**

Lessons can also use Claude's own web search and page reading, while **Web** is on.

Lessons draw the same simulations, diagrams, charts and readings whoever teaches.

> [!warning] What never goes to Claude
> Claude teaches everything, work projects and Metabase included. Gemma on your Mac takes over only when Claude can't answer (not installed, logged out, at its limit, offline, an error or a hang) or when you pick it, and the step above the answer says so.

If Claude Code is missing or logged out, or your plan is at its limit, Gemma takes the turn and the step says why. **Settings → Usage** shows what Claude did: calls by model and job, how much was read from the cache, and how long the first words took.

## Claude Code in your terminal

Tide can give Claude Code in any terminal (Ghostty, Terminal, iTerm) the same tools, so it can teach from your notes, run code in Tide and record your progress there.

1. In **Settings → Models → Claude**, turn on **Claude Code in your terminal**. Tide runs `claude mcp add --scope user --transport http tide http://127.0.0.1:47615/mcp` with a private token, which Tide keeps in your Keychain.
2. In a terminal, run `claude` and ask it to use Tide: "search my Tide notes for Raft", "quiz me and record it in Tide".

The tools only work while Tide is open. Turning the switch off removes Tide from Claude Code (`claude mcp remove --scope user tide`).
