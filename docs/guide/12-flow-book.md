---
title: Read a book you own
group: Walkthroughs
summary: Tide maps every book in your vault, points you at the exact pages for what you're learning, and tests you on a chapter when you've read it.
animation: shelf
---
```walkthrough
A book, chapter by chapter
library | 84,14,11,5 | Add the book | **Add the book.** Drag a PDF into the window, or use **Add files** (⌘⇧O). It lands in the Library with its first page as the cover. | library
library | 21,36,73,62 | File it under a subject | **File it under a subject.** Hover the cover and click the tag button. A statistics book can sit under Mathematics and Finance at once. Filed books show on that notebook's Reading tab. | library
shelves | 51,20,38,66 | Tide maps it | **Tide maps it in the background.** Chapters, sections and their pages, from the bookmarks or printed contents, and a line on what each covers. It never reads the whole book. | library
week | 30,64,58,18 | Read the right pages | **It points you at pages.** Your week lists the pages to read for each topic, books you own first: “Designing Data-Intensive Applications: Chapter 9, pp. 374–394”. Lessons show them at the top. | week
library | 36,62,14,32 | Follow the guide | **Open the Guide.** Open the book from its cover. In the PDF, **Guide** lists every part and chapter. Tick chapters off, click to jump, ✎ to write notes on that chapter. | library
shelves | 62,42,8,15 | Test the chapter | **Test yourself on the chapter.** Each chapter has **Teach me**, **Quiz**, a five-question **Test**, **Flashcards** and a coding **Challenge**, all on that chapter's pages only. | library
```

## How Tide knows where things are

A big book is far more text than the model can take in at once, so Tide doesn't try. It builds a map: chapters and the sections inside them, with page ranges, from the PDF's bookmarks or, without them, its printed contents page. Then it writes one line on what each section covers from a glance at its opening page. A few books are mapped at a time in the background.

The map plus the search index are enough to send you to the right pages. When you're learning a topic, Tide matches it against your books' sections and only suggests a section when most of the topic's words are really in it.

## The reading guide

Open a PDF and click **Guide**. **Find the chapters** lists every part and chapter with its page; the chapter you're reading is highlighted as you scroll. For each chapter you can tick it off, jump to it, open your notes on it (a `## Chapter` section in the book's notes, linked to the page), or have the tutor teach or quiz you on that chapter's pages only.

The guide is a checklist at the top of the book's notes (`<Book> (Notes).md`), so your progress is plain Markdown.

> [!warning] Scanned books
> Scanned books have no text, so Tide can't find their chapters. Use **Chapter starts on page N** as you reach each one.

## Reading the PDF

- Pages render as you scroll. Use − and + to zoom.
- Select text to highlight it in yellow, green, blue or pink. **Save highlights as a note** writes them out with page numbers.
- **Notes** opens the book's own note beside it, editable right there.
- **Add to notes** on a selection puts the quote in that note with a page link like `[[paper.pdf#page=12|p. 12]]`. Clicking it reopens the PDF at that page.
- **Teach me**, **Quiz** and the tutor panel all work on the PDF's text.
