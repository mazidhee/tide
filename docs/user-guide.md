# Tide user guide

Tide is a Mac study app that turns your Obsidian vault into a place to learn deeply. You read and write your notes, and an AI tutor questions your thinking, quizzes you, and teaches you step by step.

Three ideas shape everything in it:

- **Your notes stay yours.** Tide reads and edits the Markdown files in your vault directly. Nothing is locked in, and every note still opens in Obsidian. Tide keeps its own data (highlights, review history, quiz results) in a hidden `.tide` folder.
- **The tutor probes, it doesn't just answer.** It asks you to predict before it explains, questions the paragraph you just wrote, and gives the smallest hint that gets you unstuck.
- **It runs on your own model.** Tide works with any OpenAI-compatible AI server, including models on your Mac such as Gemma through MLX. Your notes only go to the server you choose.

## The window at a glance

- **Sidebar, on the left:** Home, Learn, Library, Review and Graph, then your notebooks (the folders in your vault). Hide it with ⌘\.
- **Main area:** whatever you are working on: a note, a PDF, a notebook page, a learning session.
- **Tutor panel, on the right:** a chat that answers from your notes with citations. Toggle it with ⌘J.

## Getting started

Install the app, point it at your vault, and connect a model. It takes about five minutes.

1. **Install.** Open `Tide-0.1.0-arm64.dmg` and drag Tide to Applications. The app isn't signed, so the first time, right-click Tide and choose **Open**.
2. **Choose your notes folder.** On first launch, pick your Obsidian vault, for example `~/Documents/Study Notes`. You can change it later in **Settings → Notes folder**.
3. **Start your model server.** For Gemma on MLX, start the server you already use, for example `mlx_vlm.server --model mlx-community/gemma-4-12B-it-4bit --port 8080`.
4. **Connect it.** In **Settings → AI tutor**, choose the **MLX** preset (`http://localhost:8080/v1`) and press **Test connection**. Leave **Model** empty to use whichever model the server has loaded.
5. **Optional, wider web search.** The tutor searches Wikipedia without a key. For the general web, add a free Brave Search key (or Tavily, or your own SearXNG) under **Web search** on the same screen.

### Other AI servers

| Preset | Address | Needs a key |
| --- | --- | --- |
| MLX | `http://localhost:8080/v1` | No |
| Ollama | `http://localhost:11434/v1` | No |
| LM Studio | `http://localhost:1234/v1` | No |
| OpenAI | `https://api.openai.com/v1` | Yes |

Any other server that speaks the OpenAI API works too: type its address. The tutor's tools (note search, web search, helpers) need a model that supports tool calling. For models that don't, turn off **Let the tutor search my notes and the web**.

## Reading and writing notes

Notes open in reading mode. Press ⌘E, or the pencil, to edit the Markdown; changes save on their own within a second.

- **What renders:** headings, LaTeX math (`$…$` and `$$…$$`), `[[wikilinks|aliases]]` and `![[embeds]]`, callouts (`> [!note]`), `==highlights==`, #tags, task lists, code with a Copy button, YouTube links as players, and Mermaid diagrams.
- **Links:** click a `[[link]]` to open the note. If it doesn't exist yet, Tide offers to create it. Links to PDFs with `#page=12` open the PDF at that page.
- **Outline rail:** long notes show short dashes on the right edge, one per heading. Hover to see the headings, click one to jump there.
- **Linked from:** the bottom of a note lists the notes that link to it, and opens its place in the graph.
- **Edits elsewhere:** if you change a note in Obsidian, Tide picks the change up, unless you have unsaved typing.

### Page settings

The ⋯ button on a note opens its settings. They apply to that note only.

| Setting | Options |
| --- | --- |
| Font | Serif, Sans, Mono |
| Text size | Small, Default, Large |
| Full width | On or off |
| Tutor in this note | Off, When I ask, Questions me when I pause, Challenges every claim |
| Reads as | Tutor, Interviewer, Professor, Staff engineer, Editor, Skeptic |
| Ask the panel | Which reviewers answer together |
| How should the tutor help here? | Free text, such as “Quiz me before Friday” |
| Show resolved tutor threads | On or off |

### Fonts and the sidebar

The interface uses Inter. Under Settings → Appearance → Reading, **Reading font** switches notes, answers and titles between Sans (Inter) and Serif (Source Serif). **Sidebar** lets you untick anything you don't use; hidden items stay in the menu bar and keyboard shortcuts, and Settings is always there.

### Themes

**Settings → Appearance** has seven themes: Match system, Light, Sepia, Graphite (a neutral, editor-style dark), Slate, Midnight (true black) and Ember (warm dark). It also sets the line width and text size for all notes.

## Notebooks and outlines

Every top-level folder in your vault is a notebook. It shows as a cover on Home and has its own page with an outline, its notes and its reading shelf. A notebook can start empty, with just an outline.

### Starting a new topic

The quickest way: say it in Chat, starting with "I want to learn…" or "Teach me…", for example "I want to learn how to build a local LLM from scratch". Tide starts planning straight away. You can also click the **+** next to Notebooks or press ⌘⇧N for the full form.

**Plan it for me** (the default) works in two steps:

1. **Sizing.** Tide searches the web for how the subject is learned and how long it really takes, reads the best guides, and decides how big it is. A single tool like Metabase or Docker gets a few weeks; a skill a few months; a field like stablecoins and payments infrastructure most of a year; a whole career two years or more. It adjusts for what you already know, your **hours a week**, and a **finish by** date if you give one (and says so if that date is unrealistic).
2. **The roadmap.** One part per phase, each with its dates, chapters of topics with the best book, course or docs for each, two or three practice exercises, a project and an exam on the phase's last day.

Before you create it you see the length, why, a timeline of the phases, and what's included. **Create notebook** then saves:

- the notebook and its dated roadmap (the dates are kept in the file, so they survive edits)
- a **Reading list** note: what to read in each phase, and the pages Tide used to plan
- a goal with the finish date, so the notebook page shows whether you're on pace
- for programming subjects, the exercises as coding challenges in **Practice**
- with Things 4 connected, a Things project (below)

Overview, Course and Deep still draft an undated outline of about 25, 70 or 150 topics, if that's all you want.

### Auditing a roadmap

**Audit** in a notebook's Outline tab reviews the roadmap frankly: how long it really is at your pace, prerequisites that come too late, gaps, what to cut or defer, and a concrete plan for the next four weeks.

### Things 4

With Things 4 open and **Settings › API** turned on in Things, Tide connects to it on your Mac (Settings → Things 4 shows the status):

- **Plans become projects.** A dated plan goes to Things as one project, with a heading per phase, a to-do per chapter whose checklist is its topics, plus the practice, project and exam, each starting and due on the right days. Use **Send to Things** on a plan's Outline tab if you didn't when you created it.
- **Progress comes back.** Ticking checklist steps or finishing to-dos in Things ticks the matching topics in Tide when you open the roadmap. It only ever ticks, never unticks.
- **The tutor sets tasks.** In any chat or session the tutor can add a task (an exercise, a chapter, a revision session before an exam) with steps and a date, and look at what you've finished to decide what to teach next. It asks before adding more than two. Everything Tide adds is tagged **tide**.

### The notebook page

Click a cover, or a top-level folder in the sidebar. The page shows how many notes you've learned, a progress bar, and **Continue with …**, the last note you opened there. Ask, Quiz, Review and Graph all work on just that notebook. Type a description under the title.

**Covers.** Hover any notebook cover (on Home or on its page) and click the picture button, or right-click it, to choose an image, remove it, or pick a colour. You can also drag an image file straight onto a cover. Images are copied into `.tide/covers`, so moving the original doesn't break the cover.

The **Reading** tab shows every book, PDF, article and video in your Library filed under the notebook's name. See Subjects, under Library.

### The outline

The **Outline** tab is the notebook's syllabus: parts, chapters and topics, each topic linked to its note. It shows the roadmap and nothing else: the file's title, divider lines, notes written between topics and the books listed with them stay in the file but are hidden. **Notes** and **Sources** at the top show them again (a book icon also appears when you point at a topic that has sources). A label like **Performance** on its own line becomes a small subheading, and a section title ending in "— CORE" or "— OPTIONAL" shows that as a tag. **Collapse all** folds the roadmap to its section titles with their progress.

It is saved as a plain Markdown checklist, so it works in Obsidian too:

```markdown
## Part I — Numbers
### Chapter 1: Numbers
- [x] [[2. The Invention of Zero|The invention of zero]]
- [ ] Prime numbers
```

- **Start one** with **Start an outline**, or reuse a roadmap note you already have, such as `RM_MATH`. Tide finds notes with checklists and offers them.
- **Edit like an outliner:** Enter adds a topic, Tab and Shift-Tab change the indent, ⌥↑ and ⌥↓ move a topic, ⌘Enter ticks it, Backspace on an empty topic deletes it. Sections fold, and each shows its done count.
- **Link topics to notes.** A topic whose title matches a note shows a dashed suggestion, and **Link N matching notes** applies them all. Otherwise hover a topic and choose **Note** to create one in the right chapter folder, or the link button to pick an existing note.
- **Linked topics** show the note's mastery and an **Open** chip. Click the mastery pill to quiz yourself on that note.
- **Sources.** A topic written as `Topic — _Book, Author_` shows the book quietly after the topic, and a bullet that's only `_Book — Author_` shows as a reading suggestion. Renaming or linking the topic keeps its source.
- **Contents.** Long outlines have short marks on the right edge, one per part and chapter. Hover them for the full contents with each section's progress; the section you're in is highlighted. Click a section to jump there (folded sections open on the way), type to find any section or topic, and use − and + to fold or unfold everything.

Renaming or moving a notebook folder keeps its outline, description, goals and cover.

### Learning status

Each note has a status: **Not started**, **Learning**, **Reviewing** or **Learned**. Set it from the pill in the note's toolbar, or beside the note on the notebook page. It is stored in the note's frontmatter as `learning_status`.

## The tutor in your notes

The tutor works inside your notes the way a good teacher reads over your shoulder: it asks questions next to the exact paragraph you're thinking about.

### Test my thinking, while you write

Press **Test me** in a note's toolbar. The tutor takes the paragraph you're on (or the one you last wrote, or the last paragraph of the note) and, reading it in the context of the whole note, asks one pointed question beside it: why it works, what happens at an edge case, how it connects to something else. It never explains first. Answer in the margin and it pushes back or goes deeper.

### Writing coach

Turn on **Coach** in a note's toolbar and write in your own words; it switches the note to editing. Each time you pause for a few seconds, the coach reads the paragraph you just wrote (a line under **Coach is reading your paragraph…** shows it working) and leaves one note beside it:

| Note | Means |
| --- | --- |
| Question | Probes your reasoning: why, what if, how does it connect |
| Check this | Something you wrote looks wrong, with what to check |
| Missing piece | A step or idea your explanation skips |
| Clearer | A tighter way to say it |

When the note comes with a rewrite, **Apply** puts it in your note in place of the original sentence and **Keep mine** dismisses it. Notes stay with their paragraph: if you rewrite it, the note goes away. The coach reads paragraphs of a line or more, including bullet lists; a heading on the line above counts as a break, so you don't need blank lines. Click **Coach on** to turn it off, or turn it off for good under **Settings → Writing coach**.

### Read-along modes

Set **Tutor in this note** in the ⋯ menu:

| Mode | What happens |
| --- | --- |
| Off | No tutor in this note |
| When I ask | The tutor only answers when you call it (⌘⇧T, ✦, selections) |
| Questions me when I pause | After you stop typing, it may leave a margin question, a missing piece, or a correction |
| Challenges every claim | Like the above, but strict: it questions shorter paragraphs and every vague or unjustified claim |

### Threads in reading mode

Hover any paragraph, equation or code block and click the ✦ beside it. A thread opens right under that block, with quick actions:

- **Question me:** one probing question, no explanation.
- **Explain**, **Example** and **Quiz me**: quiz mode asks one question at a time and marks your answers.
- **Draw it:** a diagram (recursion tree, graph, flow) or a step-by-step trace table under your words.
- **Ask the panel:** several reviewers critique the passage, each in a few bullets.

Any answer can be written into the note with **Add to note**, as a `> [!tutor]` callout. Selecting text gives you the same actions in a small popover.

### Personas

Pick who reads your note in **Reads as**:

| Persona | Good for | Looks for |
| --- | --- | --- |
| Tutor | Learning anything | Gaps in understanding, missing intuition |
| Interviewer | LeetCode and algorithms | Complexity, edge cases, off-by-one errors, better approaches |
| Professor | Maths and proofs | Unjustified steps, loose definitions, missing cases |
| Staff engineer | System design | Behaviour at scale and under failure, trade-offs |
| Editor | Articles and essays | Vague wording, unsupported claims, buried points |
| Skeptic | Arguments | Overconfident claims and counterexamples |

## Your week

**Your week** (from **Today** on Home) is your coach. Tell it once where all this is heading ("a strong software engineer with solid maths, ready for trading-firm interviews next summer"), which notebooks to focus on in order of importance, your hours a week and the days you study.

**Plan my week** plans the next seven days towards that goal. Tide gathers the facts itself (the next unfinished topics in each focus roadmap, your weak topics, flashcards due, overdue tasks, mock interview scores) and the tutor decides what comes first and says why, for example which topics unlock the others. Each study day gets a few items, sized to your hours: topics to **learn** (straight from your roadmaps, never invented), **practice**, a short **quiz** on earlier topics, **review** of weak spots, a **take-home** or two and a **test** at the end. Topics come with what to read, checked online so the links are real.

- The page reads at a glance: why the week is shaped the way it is (in a sentence, **More** for the rest), how the time splits between subjects, a strip of seven days (dots for each item, today circled), and the chosen day's items as a checklist with what to read as small links. Your goal, focus, hours and days fold into one row; **Edit** opens them.
- **Today** on Home shows today's items; click one to start it (a lesson, a quiz, a test, Practice or Review).
- **Send to Things** puts the week in Things 4: a heading per day, each item a dated task with what to read and a link back into Tide.
- The week is also saved as a note, **Coach/This week**, you can read and edit.
- Ask the tutor "what should I study today?" or "am I on track?" in any chat: it checks your plan.

### Your learner profile

Tide keeps a short note, **Coach/Learner profile**: your goal, focus, where you are, strengths, weak spots and how you learn best. It's rewritten from your progress each time you plan a week, and it's what the tutor carries into every conversation instead of your whole history, which keeps answers quick on a local model. Edit anything that's wrong; your edits to "How they learn best" are kept.

## Your day on Home

The top of Home is a small living pixel world where your tutor spends the day, drawn for the time it is: tea in the garden in the morning (a neighbour walks their dog past), the study in the afternoon (a sunbeam crosses the floor, a student drops by), fishing at the pond at sunset (ducks, fireflies) and the fireside at night (the cat asleep, an owl at the window). Weekend afternoons are a field trip to Mars. Hover it to see where you are; the × hides it (click the little figure by the greeting to bring it back).

Under the greeting, Home says what you studied on your last study day, with **Quiz me on it**, and what's due.

**Today** is a checklist: mistakes to retest first, then the coach's plan for the day. Tick things off here or in Things 4 (they stay in step); finishing a lesson, quiz or test you started from Today ticks it for you. After 5pm, **Wrap up the day** appears; on Sundays, **Look back on your week**.

### Goals

A goal is a deadline on a roadmap (**Set a goal** on Home, or on a notebook's outline). Each shows on Home as a card: how far along you are, the days left, whether you're on pace (a mark on the bar shows where an even pace would be today), and the next topic, one click from a lesson. Click the card to open the roadmap. The coach plans each week around your deadlines, giving the tight ones more time.

### Wrapping up the day

Four short steps: the day in a sentence (from what you actually did), three quick questions on today's topics, moving what's left to your next study day (in Things 4 too), and a line for your journal (**Coach/Journal**).

### Looking back on the week

Your week in numbers (each day's activity, notebook by notebook, your journal lines), then three questions: what went well, what got in the way, what to change. **Save and plan next week** saves it as a note (**Coach/Reviews**) and plans the next week with it in mind: a plan you didn't finish makes the next one lighter.

### The mistake journal

Every answer you get wrong or partly wrong in a lesson or quiz, and every mark you lose in an exam, goes into **Coach/Mistakes** with what you said and the right idea. Each comes back as a quick retest: the next day, then in three days; two right answers on different days puts it right. Retests sit at the top of Today.

## Practice

Practice is where you learn by doing. The tabs across the top are the kinds of practice: **Coding**, **Problems**, **Quant**, **System design** and **Companies**; Tide remembers the one you used last. Each starts from one box: type what you want, pick the options from the pills along its bottom (what to draw on, the level, the language, the firm's style…) and press the button at the end (or Enter). **Playground** and **Linux lab** (top right) open those tools.

### Quant

For trading and quant interviews. **Speed drills** are mental maths against the clock, generated and marked by Tide itself: the **Arithmetic sprint** (two minutes of + − × ÷, as many as you can, like Zetamac) and **80 in 8** (eighty questions with decimals, fractions and percentages in eight minutes). Type the answer; a right one moves on by itself, Enter or Tab skips. The end screen shows your score against your best and your slowest kind of question.

A **Quant interview drill** asks one question at a time in the area you pick (probability, expected value, statistics, brainteasers, market making, options and finance, or mixed), in a firm's style if you choose one (Jane Street, Optiver, SIG…), timed at 30 minutes if you like. The interviewer checks every answer with real maths or a simulation before grading it, asks how you got it, and ends with a scorecard on accuracy, speed, reasoning and composure.

### Coding challenges

Name something you've been learning, like async Python, generators or B-tree indexes, choose which notebook to draw on and how hard, and **Start**. The tutor writes an original challenge on it (a practical task, not a puzzle, unless the topic is algorithms) and runs a mock interview: you explain your approach, write the code, and it runs your code against real test cases, asks follow-ups and gives you a scorecard. Challenges are saved under **Topic challenges** and come back for another go like any problem, with a fresh challenge each time. In a book's reading guide, the terminal button on a chapter starts a challenge on just that chapter.

### Interview problems

Paste a LeetCode link or type a problem's name to track it by pattern. Each has a mock interview with real test cases. Struggled problems come back in two days; clean solves in a week, then two weeks, a month and two months.

### Company prep

Type a company in the box, with the role and any notes (an interview date, what you already know) in the small fields under it, and **Research**. Tide reads recent interview reports on the web and drafts a plan: the interview loop round by round, checklists for coding patterns, system design, behavioural themes and domain knowledge, practice problems, questions to ask them, and the sources it used. **Save plan** keeps it in **Interview prep**. Each saved plan has three mock rounds in that company's style: **Coding round**, **System design** (on a canvas, below) and **Behavioural** (STAR stories, probed like a hiring manager would).

With **Timed, 45 min, no hints** ticked (the default), a round runs like the real thing: a clock counts down in the header (amber for the last five minutes), there's no hint button, the interviewer paces the round, and at zero it stops and scores you. Every round's score and verdict is saved (in `.tide/interviews.jsonl`), and each plan shows your latest score per round, how it changed since the last try and the last verdict, so you can see whether you're closing in on their bar.

### System design

**System design** opens a canvas beside the tutor. Add components from the palette on the left (client, load balancer, service, database, cache, queue and more), drag from a component's dot to another to connect them, double-click to rename (Shift+Enter adds a details line, like "Postgres, read replicas"), double-click an arrow to label it, Delete to remove, ⌘Z to undo. Adding a component while another is selected places it beside and connects it.

The tutor sees your diagram on every message and can draw on it:

- **Teach me to design…** builds a design with you step by step, asking you to predict each component before it adds it.
- **Interview me** runs a design interview: requirements and numbers first, you draw, it probes the hard parts and ends with a scorecard.
- **Review my design**, **Quiz me on my design**, **What breaks at 10x the load?** critique what you drew.

**Redraw from memory** (once a design has a few components) opens a blank canvas: redraw what you learned without looking, then press **Check my drawing**. Tide compares the two (components matched by kind and name, then the connections between them), gives you a score, and the tutor explains each piece you missed and why it's there. It won't name missing pieces while you're still drawing.

On an empty canvas, **Open a finished example** adds a worked design (a real-time market data feed, the kind of system trading firms ask about) to study, quiz yourself on or redraw.

Designs are saved as `.canvas` files in **Designs**, the same JSON Canvas format Obsidian uses, so they open there too.

### Linux lab

A real terminal running a throwaway Ubuntu container (it needs Docker Desktop). Choose a topic, such as permissions or grep and pipes, and the tutor teaches by doing: it asks what you know, gives you a command to try, sets up exercise files in the lab, and checks what you typed by looking at the terminal. Commands it shows have a **Run in terminal** button. You're root, so experiment freely: nothing in the lab can touch your Mac, and **Fresh lab** gives you a clean one. The container is removed when you leave the page or quit Tide. **Cards** turns the commands you ran into flashcards (the task on the front, the command and its flags on the back), saved in **Linux/Lab commands** so they come back in Review.

There's also a terminal on your own Mac (Practice → Playground → Terminal, or the lab page's Mac option). The tutor can read it to explain output, but never types into it; its buttons only type a command, so you check it and press Enter yourself.

### Playground

A small IDE using the editor from VS Code: syntax highlighting for every common language, multi-cursor, find and replace, and IntelliSense for JavaScript and TypeScript. Files live in the **Code** folder of your notes. **Run** (⌘Enter) runs Python and JavaScript in a sandbox with the rest of the file's folder beside it, so a project can import its own modules and read its CSV or JSON files (write `bot/main.py` in the file name box to start a folder). Python has NumPy, pandas and Matplotlib once you set them up (the output offers to, or **Settings → Data libraries**), and charts you draw appear under the output. **Data project** starts a folder with a CSV and a pandas script, and **Example: portfolio analysis** (in Files) adds a finished three-file project: price data, a `stats.py` module (returns, Sharpe ratio, drawdown) and a `main.py` that uses it and charts the portfolio. There's an optional input box for your program; **Terminal** opens a shell on your Mac for everything else. The tutor beside it pair-programs with you: it sees the file you're on and what it printed.

## Study time and breaks

You don't need to start a timer. While you're on something to study (a lesson, quiz or exam, a note or PDF you're reading, flashcards, practice, a chat with the tutor) and actually at it (typing, scrolling, the tutor replying), Tide logs the time against it. Three quiet minutes stop the clock until you're back. The time shows on Home (**Today: 1 h 20 studied**) and feeds the evening wrap-up, the weekly review and the coach's planning.

**Breaks.** After a good stretch (about 25 minutes of lessons and quizzes, 45 of reading or coding) the tutor offers a break: **Take a break** or **Keep going** (it asks again in ten minutes). During a break he goes fishing (in the menu bar too) with a countdown; a chime says when it's over. A quiet five minutes counts as a break. Exams and timed interviews are never interrupted. Change the pace, or turn the reminders off, in **Settings → Appearance → Study timers**.

**Focus timer.** If you'd like a fixed session, **Focus** at the bottom of the sidebar still times one (25, 50 or 90 minutes, or no limit); while it runs, the automatic tracking steps aside so nothing is counted twice. Notes, PDFs and practice sessions also have a **Timer** button showing the time spent on each.

## Chat and memory

**Chat** in the sidebar is a full-page conversation with the tutor. Past conversations are in the **History** panel on the right, grouped by day; close it with its × or ⌘J and bring it back with the panel button at the top right, next to New chat. Search them, and use ⋯ (or right-click) to rename, pin or delete one. Conversations you have in the tutor panel are saved here too; the list button in the panel's header opens the current one on this page. Conversations are saved as you go, in `.tide/chats/` in your notes folder, so closing the app never loses one.

Under the message box, choose what the tutor answers from (all your notes, one notebook, or nothing) and whether it may search the web. Answers show what the tutor did (searched your notes, read pages, ran code) as a line you can open, and their sources as numbered chips; click one to open it.

**Long conversations stay fast.** Tide estimates how much of the model's context a conversation uses. When it grows past a third or so of it, the older turns are folded into a running summary right after an answer (cancelled if you send another message first), and the model gets the summary plus the latest turns. A divider shows where the summary starts. Set your model's context size in Settings if it isn't 16,000 tokens.

**Memory.** The tutor remembers lasting things about you across conversations: goals and deadlines, what you already know, what you find hard, how you like to learn. Say "remember that I'm interviewing at Bloomberg in March" and it's saved straight away; "forget that…" removes it. The tutor also saves things on its own when you mention them. Open **Memory** at the bottom of the chat list to read, edit, add or delete what it remembers. It lives in `.tide/memory.json` and goes into every conversation and session.

## Getting around

- **Back and forward** arrows sit at the top of the sidebar (⌘[ and ⌘]).
- Lessons, quizzes, interviews and exams keep their place when you leave them: come back with Back or from **In progress** in the sidebar and carry on where you were (a reply still being written keeps arriving while you're away).
- **Study** folds Learn, Practice, Review and Your week together; **+** at the top makes a note, a new topic, saves a link or adds files; Tide's own folders (your week, journal, mistakes, exams, designs) fold away under **Tide's files**.
- **Own window** (the ↔ button in a lesson) moves the lesson into a window of its own with nothing else on screen.

## Your tutor, and talking

Choose who your tutor is in **Settings → AI tutor → Your tutor and voice**: **The Professor** (an Oxford don), **Ada** (a young engineer), **Coach Marcus** or **Hoot** the owl. Each has a face around Tide and in the menu bar, a voice, and a way of talking.

**Natural voice.** Set it up once (about 1 GB): Tide installs Kokoro, a small, natural-sounding speech model, and Parakeet for dictation, in its own Python environment, and they run on your Mac. Speech starts within about a second; dictation writes down what you said in a tenth of a second.

**Talk** (in lessons and Chat): the tutor opens each reply with a short spoken part, in its own style, and reads the question out; the full answer stays on screen, so long answers aren't read word for word. Answer with **Speak** (click, talk, click), or turn on **Hands-free** and just talk: Tide hears when you stop. Space or Esc interrupts the tutor.

**In the menu bar** your tutor acts out what you're doing: at the board in a lesson, tea while it's your turn, a book while you read, flashcards in Review, a laptop in Practice, the stopwatch in an exam (with the time left), fishing on a break. Its menu lists today's plan, starts a 25-minute focus and opens the wrap-up. Settings can keep it to study time or turn it off.

## Learning sessions

A session is a focused, one-question-at-a-time conversation with the tutor. Start one from **Learn** in the sidebar, the **Learn** menu on a note, or the buttons on a notebook or PDF.

On the Learn page, type what you want to learn ("Metabase", "two pointers", or a pasted LeetCode problem) or pick a note or notebook from the suggestions. Then choose a mode and press **Start**.

### Modes

| Mode | How it runs |
| --- | --- |
| Teach me | Asks 2 or 3 questions to find what you already know, shows a plan, then teaches each step: you predict, it explains, then it checks you. Ends with a summary of what is still shaky. |
| Quiz me | 5 to 20 adaptive questions of mixed types. A right answer makes the next one harder; a wrong one goes back and probes the gap. Ends with strengths and misconceptions. |
| Mock interview | A coding interview in the language you pick: problem, approach and complexity first, then code in the editor, then review and follow-ups. Ends with a scorecard and a hire or no-hire verdict. |
| Review my writing | Grades a note you wrote (clarity, accuracy, depth, structure, argument), then challenges specific sentences and starts a discussion. |
| Mixed | A quiz that interleaves questions from several notes or notebooks. Switching between topics is harder in the moment but makes what you learn stick better than one topic at a time. |

### Answering

- **Question types:** predict, short answer, multiple choice, explain it back, spot the error, worked problem, and code.
- **Confidence:** mark each answer **Guessing**, **Unsure** or **Sure**. Being confidently wrong is treated as a misconception and counts in your mastery.
- **Hints:** the hint button climbs a ladder (Nudge, Hint, Show a step, Show the answer), so you only get as much help as you need.
- **I don't know:** the tutor teaches the idea briefly and asks an easier question.
- **Submit** with ⌘↵. In interviews, ⌘↵ in the code editor submits too.

### Notes as you learn

In **Teach me**, a notes pane sits beside the lesson: the tutor's key ideas are written into the topic's note under **From the lesson** as it teaches, and you write your own explanation under **In my words**. **Check my words** has the tutor check your explanation against the lesson. It's an ordinary note; hide the pane with **Notes**.

### Grading and flashcards

Each answer gets a verdict: **Correct**, **Partly right** or **Not quite**, with feedback. When you miss something, the tutor writes a flashcard for the idea you missed. **Add to flashcards** saves it next to the note, in the Spaced Repetition plugin's format.

### Web search in sessions

With **Web** on (top right of a session, or next to the tutor panel's input), the tutor looks things up when a topic may be newer than its training data or when it's unsure of a fact, and cites what it read. The step log shows each search and page as it happens. It knows today's date, so for anything that changes (rates, regulation, markets, crypto, releases, news) it searches recent results instead of trusting what it remembers.

It can search the whole web, only the news, or only the last day, week, month or year; search research papers on arXiv; and read web pages and online PDFs, including arXiv papers.

**Setting up web search.** In Settings → AI tutor, choose **Private search on this Mac** and click **Set up**. Tide starts a private search engine (SearXNG) in Docker Desktop, reachable only from this Mac, and starts it again whenever Tide opens. It needs Docker Desktop installed and running; the first setup downloads about 200 MB. If it's ever unreachable, the tutor falls back to Wikipedia and says so. To remove it, delete the `tide-search` container in Docker Desktop. Brave Search, Tavily or your own SearXNG address work too.

## Flashcards and review

Tide reads flashcards from your notes in the Obsidian Spaced Repetition plugin's format, so the same cards work in both apps.

### Writing cards

| Format | Example |
| --- | --- |
| One line | `What is a log?::The inverse of an exponent` |
| Both directions | `Big O of binary search:::O(log n)` |
| Multi-line | Question lines, then a line with just `?`, then answer lines |
| Cloze | `The {{c1::Pythagoreans}} proved √2 is irrational` |
| Highlight cloze | `A ==hash map== maps keys to values` (in notes tagged #flashcards) |

Notes tagged `#flashcards` feed your decks. You can also have the tutor write cards: **Flashcards** in a note's toolbar, **Flashcard** on a selection, or misses in a quiz.

### Reviewing

Open **Review** in the sidebar. At the top, **Study** starts every card due now. Below it are your streak, cards reviewed, how much you remembered over the last 30 days and what's due, then a heatmap of up to a year of reviews (it fits the window), and one row per deck with New, Learning and Due counts.

- Press **Space** to show the answer, then grade it **1** (Again) to **4** (Easy). Each button shows when you'll see the card next.
- **Type my answer first** makes you commit to an answer before you flip.
- **Explain** on a flipped card asks the tutor to explain it with an example.
- Cards you keep forgetting are flagged as leeches, with **Re-learn this**, which starts a Teach me session on the idea.

Scheduling uses FSRS, the algorithm modern Anki uses. It spaces reviews based on how well you know each card.

## Library, PDFs and the web

The Library is your reading list. Everything saved there is a file in the `Library` folder of your vault.

### Saving things

- **Links:** paste a link on Home, in the Library, or with ⌘⇧S. Articles are saved as clean Markdown, with maths kept as LaTeX. Pages that aren't articles are saved as bookmarks.
- **YouTube:** saved with the title, channel, description and full transcript. Each paragraph has a timestamp link back to the video.
- **Files:** **Add files** (⌘⇧O), or drag PDFs, Word documents, Markdown and images anywhere into the window.

### Subjects

File anything in the Library under one or more subjects: hover a cover and click the tag button (or right-click it), then tick subjects or type a new one. Your notebooks are offered first, so a statistics book can go under Mathematics and Finance at once. The row under the kinds filter narrows the Library to one subject, or to what isn't filed yet. Items filed under a notebook's name show on that notebook's **Reading** tab.

### Covers

The Library shows everything as a wall of covers. PDFs show their first page, articles and links show the picture the site gives for link previews, and videos show their YouTube thumbnail with the length in the corner. Items with no picture, such as Word documents, get a cover with their title on it. Click any cover to open it. The two buttons next to Filter switch between covers and a plain list.

Covers are fetched once and kept in the hidden `.tide/thumbs` folder of your notes, so they show up offline. If a site has no preview picture, Tide remembers that and doesn't ask again.

### Reading a book chapter by chapter

Open a PDF and click **Guide**. **Find the chapters** reads the book's bookmarks (instant for most published PDFs) or, without them, its printed contents page, and lists every part and chapter with its page. The chapter you're reading is highlighted as you scroll. For each chapter:

- tick it off when you've read it,
- click its title to jump there,
- ✎ opens your notes on it: a `## Chapter` section in the book's notes, linked to the page,
- the tutor and quiz buttons teach or quiz you on that chapter's pages only.

Scanned books have no text, so Tide can't find their chapters; use **Chapter starts on page N** as you reach each one. The guide is a checklist at the top of the book's notes (`<Book> (Notes).md`), so your progress is plain Markdown.

### Reading PDFs

- Pages render as you scroll. Use − and + to zoom.
- Select text to **highlight** it in yellow, green, blue or pink. **Highlights** lists them all, and **Save highlights as a note** writes them into a note with page numbers.
- **Notes** opens a notes pane beside the PDF: the PDF's own note, `<name> (Notes).md`, editable right there.
- **Add to notes** on a selection puts the quote into that note with a page link such as `[[paper.pdf#page=12|p. 12]]`. Clicking the link reopens the PDF at that page.
- **Teach me**, **Quiz** and the tutor panel all work on the PDF's text.

Saved articles in the Library have **Add to notes** on selections too.

## Mastery, graph and search

### Mastery

Every answer you give in a session, and every flashcard review, is recorded. Each note gets a level: **Weak**, **Shaky**, **Solid** or **Mastered**. The level combines three things:

- recent answers, with newer ones counting more
- how well you remember the note's flashcards (counted less, since recall isn't understanding)
- the learning status you set

Confidently wrong answers are counted separately as misconceptions. Levels appear on outline topics and notebook pages, and **Learn → Worth revisiting** lists your weakest notes with one-click Quiz and Teach.

### Graph

**Graph** shows how your notes link to each other. Notes cluster by notebook, the view fits itself to the screen, and you can drag, zoom and click to open a note. Filter by notebook, hide unlinked notes, or open a note's own neighbourhood from **See it in the graph** at the bottom of the note.

- **Notebooks / Mastery** switches the colours. In Mastery, each note is coloured by its level; click a level in the legend to light up only those notes, so your weak spots stand out.
- Click a note to see its card: **Open**, **Quiz me**, or **Show around**, which narrows the graph to that note and what's within two links of it. Double-click opens the note directly.

The tutor uses the graph too. When you ask about a note, it also reads the best-matching passage from notes linked to it, and it can look up a note's links, backlinks, notes two steps away and notes with the same tags, each with your mastery level, to connect new ideas to what you already know or spot the weak prerequisite.

### Search

Press ⌘K to search note titles, the full text of notes, PDFs and saved pages, and quick actions. The last row asks the tutor your search as a question.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘K | Search |
| ⌘N | New note |
| ⌘⇧N | New topic |
| ⌘E | Toggle read and edit |
| ⌘⇧T | Test my thinking (in the editor) |
| ⌘\ | Toggle the sidebar |
| ⌘J | Toggle the tutor panel |
| ⌘⇧S | Save a link |
| ⌘⇧O | Add files |
| ⌘⇧R | Review flashcards |
| ⌘⇧Q | Quiz me on this |
| ⌘[ | Back |
| ⌘↵ | Submit an answer in a session |
| Space, then 1–4 | Flip and grade a flashcard |
| Enter, Tab, ⌥↑ ⌥↓, ⌘Enter | Add, indent, move and tick topics in an outline |

## Your data and privacy

Your notes are ordinary files in your vault, and Tide writes its own data next to them in a hidden `.tide` folder that Obsidian ignores.

| What | Where |
| --- | --- |
| Notes, outlines, saved articles, transcripts, PDFs | In your vault, as ordinary files |
| Flashcards | In your notes, in the Spaced Repetition format |
| Review schedules | `.tide/srs.json` |
| Review history | `.tide/reviews.jsonl` |
| Quiz and session answers | `.tide/attempts.jsonl` |
| Tutor threads | `.tide/threads/` |
| PDF highlights | `.tide/highlights/` |
| Notebook covers and outline choice | `.tide/notebooks.json`, `.tide/covers/` |
| Search cache for PDFs | `.tide/pdftext/` |
| App settings (theme, AI server) | `~/Library/Application Support/Tide/settings.json` |

**What leaves your Mac:** the text the tutor needs (your question, the relevant passages of your notes, the conversation so far) goes to the AI server you set. With a local server it stays on your Mac. Web searches go to the provider you choose (Wikipedia by default). Nothing else is sent anywhere.

### Speed on your Mac

Tide keeps each conversation append-only and marks per-turn context as request-only, so a local mlx-vlm server continues from its cached state instead of rereading the whole prompt each turn (follow-up replies start in a second or two); lessons share one cached system prompt, warmed when Tide starts.

With a local mlx-vlm server, Tide switches on two speed-ups each time it starts (they reset when the server restarts): a prompt cache, so follow-ups start in about a second, and, if you've downloaded it, Gemma 4's small draft model, which writes code and structured answers about 30% faster with the same results. **Settings → Model speed-ups** shows whether both are on and turns them back on if your server restarted while Tide was open.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| “Can't reach the AI server” | Start your model server, then press **Test connection** in Settings → AI tutor. Check the address and port. |
| Answers are slow | Local models answer at your Mac's speed: a question usually takes 10–40 seconds; research with web search or helpers can take a couple of minutes. A smaller model is faster. |
| The tutor ignores tools or errors on them | Your model may not support tool calling. Turn off **Let the tutor search my notes and the web**. |
| Web search only finds Wikipedia | That is the default. Add a Brave Search or Tavily key, or a SearXNG address, in Settings. |
| A YouTube video saved without a transcript | The video has no captions YouTube will share. The title and description are still saved. |
| macOS says Tide can't be opened | Right-click Tide in Applications and choose **Open**, once. |
| A note changed in Obsidian doesn't show | Switch away from the note and back. Tide won't overwrite a note while you have unsaved typing. |

Gemma 4 on MLX has one known quirk: on long notes it can get stuck producing empty hidden “thinking”. Tide prevents this automatically by blocking that token for Gemma 4 on local servers, and it stops and retries any answer that starts repeating itself.
