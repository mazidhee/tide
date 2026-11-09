---
title: Understand a system at work
group: Walkthroughs
summary: Give Tide a design doc or spec. It maps the system's parts and flows, and teaches you each one using your system's own names and data.
animation: map
---
1. **Make it a project.** On a notebook's **⋯** menu choose **Make it a project…** and pick **Understand a system**. Or say “help me understand our reconciliation system” on Home.
2. **Add the documents.** Drop the design doc (PDF or Markdown) on the **Project** tab, or file it under the project's name in the Library.
3. **Map it.** **Map it** reads the structure, not every page: headings and contents give the parts and flows, a list of known tools finds what it uses (MongoDB, n8n, Docker…), and one short model call names the components and writes an overview. It takes a few seconds.
4. **Walk through a flow.** Click a flow such as “Settlement flow”. A canvas opens beside the lesson with the system's parts laid out. The tutor traces one record through it step by step, asks you to predict each next step, and connects the parts as the flow moves.
5. **Learn a tool only as far as you need it.** **Learn it for this** on MongoDB teaches it through the project's own use of it. **Go deeper** turns it into a full roadmap later, building on what the project taught you.
6. **Ask anything.** The box at the bottom of the Project tab answers from the project's documents.

```animation
map: Bank file, Parser, Matcher, Ledger, Exceptions, Report
```

## Work stays on your Mac

**Private** is on for every project by default. Everything about a private project is answered by Gemma on your Mac, never a cloud model, even with the cloud helper turned on. Turn it off only for projects that aren't confidential.

## Building something yourself instead

Choose **Build it myself** for something new you'll build to learn, like a tiny shell in C.

- **Draft the brief with me** writes the goal, scope, how it's put together, milestones (each a small thing that runs), what to learn first for each, and the hard parts, saved as a note in the project.
- **What to learn first** makes a roadmap from it.
- **Work on it** on a milestone starts a session with a mentor that plans the next step with you, asks how you'd do it and reviews what you write, but never writes it for you.

## How the lesson is taught

Tide picks the approach before the model says a word, from what you asked, what the material is, where it comes from, how well you know it and what it can do right now.

| Approach | Chosen when |
| --- | --- |
| Walkthrough on a canvas | “Walk me through the settlement flow”, or a flow from a design doc |
| Think it through together | “Let's think through how matching should handle duplicates” |
| Problem sets | The default, and whenever you say “quiz me” or “give me problems” |
| Write and run code | “Implement a hash map in C”, or part of something you're building |
| Hands-on in the lab | Command-line tools like Docker or Linux permissions |
| Derive it | Maths, with every step checked by SymPy |
| Guided reading | A chapter or section to read |

When two approaches are close, Gemma breaks the tie in about a second. Change it from the lesson's toolbar, or just say so mid-lesson (“can we just talk it through?”).
