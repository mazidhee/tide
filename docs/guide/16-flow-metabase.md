---
title: Learn your Metabase
group: Walkthroughs
card: no
summary: Connect Tide to your Metabase, map your data, and learn the query builder, MongoDB pipelines (or SQL) and analysis on your real collections, with exercises checked against your data. Read-only, taught by Claude.
---
1. **Make an API key.** In Metabase, **Admin › Settings › Authentication › API keys**.
2. **Connect.** In Tide, **Settings › Connections › Metabase**, enter your Metabase address and the key. The key is kept in your Mac's Keychain.
3. **Map your data.** Press **Map my data**. Tide samples each collection to learn its fields and nested fields, their types, how often each is there (and why one is missing, when it can tell: only on refunds, or only since March), mixed types, how collections link (ids and embedded arrays), how documents arrive over time, and the dashboards people use most. It writes a **Your data** note with an ER diagram, and a roadmap, **Metabase on Your Data**.
4. **Learn.** Start any topic of the roadmap: from the query builder to aggregation pipelines (`$match`, `$group`, `$unwind`, `$lookup`, `$facet`, dates) to cohorts, retention, funnels and a first regression, all on your own collections.
5. **Take apart a dashboard.** Pick one under **Take apart a dashboard**. The tutor goes through it card by card (what each reads, how its query works, why it's built that way), then you rebuild one.

**Checked exercises.** Answer with a pipeline, SQL, or the link of a question you built in Metabase. Tide runs yours and the reference read-only on your Metabase and compares the results, with a tolerance for rounding. When they differ you see where (the rows and values) and the likely reason: a fan-out from `$unwind`, counting instead of summing, a string amount skipped by `$sum`. **Run** in the answer box runs your pipeline there too.

**Metabase beside the lesson.** In a lesson on your Metabase, the **Metabase** button opens it beside the tutor. Sign in once; Tide keeps that sign-in in its own session and never reads it. The tutor sees which question or dashboard is open and what it shows.

> [!info] Read-only
> Tide only ever sends reading requests and queries: nothing that creates or changes a question, dashboard or anything else can be sent. Pipelines that write (`$out`, `$merge`) or run JavaScript, and SQL that isn't a single SELECT, are refused before they leave your Mac. Every query has a row limit and a time limit. Tide keeps only metadata and at most three tiny example documents per collection, with emails masked. Claude teaches; Gemma on your Mac takes over when Claude can't.

“Teach me Metabase” on its own builds a roadmap for learning Metabase in general. Mention *your* Metabase (“our”, “my”, a dashboard or question) and the tutor looks inside it.
