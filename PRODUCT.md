# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(An Electron desktop app for macOS: web technology, a desktop window, keyboard-first, used for hours at a time.)

## Users

Primary: one self-taught engineer, studying for hours every day on a Mac (M4 Pro), heading into distributed systems, blockchain infrastructure, payments and fintech, data and ML engineering, agentic engineering and C++. They plan weeks against their aims, take lessons with an AI tutor, write notes, read PDFs and articles, practise problems and code, and review with flashcards.

Secondary, later: friends, colleagues, or other learners who might pick Tide up. The owner wants them to feel the same care in every detail that Notion or Craft users feel: Tide should impress a discerning newcomer without a guided tour, while never compromising the heavy daily user.

## Product Purpose

Tide is a local-first study system: it decides what to learn next from the learner's aims, teaches it like a strong human tutor (Socratic when asked, checked against sources), keeps the notes and history, and plans the week. Success is the learner learning hard, technical material faster and more deeply, with less admin and more trust in what they're taught.

## Positioning

A tutor that runs on the learner's own Mac (Gemma 4 12B through a local MLX server), with free cloud models brought in only to check the hard parts. It plans from the learner's own roadmaps and aims, teaches from cited sources, verifies its own claims, and keeps everything as plain files in the learner's Obsidian vault.

## Operating Context

- Daily, long sessions: lessons, reading, notes, practice, review. Often with Talk and dictation (Kokoro voice, Parakeet/Deepgram/Wispr Flow).
- Lives beside Obsidian (the vault), Things 4 (the week as to-dos), and a terminal.
- Many services, local and cloud: the local model server, free cloud model providers (Groq, General Compute, Kilo, OVH and others), web search (Wikipedia, SearXNG, Brave, Tavily, You.com), page reading (Firecrawl), arXiv, Open Library, voice services, Metabase (read-only), a Study data API. The learner wants to see at a glance which are connected, in use, and how much they've used.
- Seven themes (light, dark, sepia and others), chosen by the learner.

## Capabilities and Constraints

- Electron + React + TypeScript; CSS custom properties in src/renderer/src/styles/theme.css drive seven themes; component styles in app.css.
- Custom icon set (src/renderer/src/components/Icon.tsx) the owner wants kept for app chrome; third-party services shown with their real logos.
- Performance matters: Gemma shares the Mac's GPU, so the interface avoids heavy continuous animation while a model is working (data-model-busy).
- Claude for everything: Claude takes every lesson and job, Metabase included; Gemma is the fallback when Claude can't answer. The interface states where each service runs.
- Undecided: whether to adopt a full visual redesign of the whole app (a prototype is to be shown first).

## Brand Commitments

- Name: Tide. App icon: a dark blue rounded square with a light wave mark.
- Voice: plain, direct, British spelling; no hype, no jokes or analogies by default.
- Design taste the owner holds up: Craft (craft.do), Notion, Linear-class detail; every pixel considered. They have rejected plain, template-looking screens.

## Evidence on Hand

- Real data on the learner's own Mac: usage logs, connections, roadmaps, lessons. No customers, testimonials or metrics to show; none may be invented.

## Product Principles

1. Trust is the product: show where things run, what was checked, and where facts come from.
2. Built for hours a day: calm, fast, keyboard-friendly, no noise; detail rewards long use.
3. The learner's aims decide; the interface explains why.
4. Local first: the Mac does the work; the cloud is a visible, bounded helper.
5. Craft a newcomer would notice: nothing that only makes sense to its maker.
