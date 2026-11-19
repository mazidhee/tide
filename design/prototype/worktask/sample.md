---
title: Weekly Merchant Activations by Region, Before/After Onboarding Change
stakeholder: Ada, Head of Growth
skills: [metric definition, MongoDB aggregation, $lookup joins, date bucketing with $dateTrunc, before/after comparison, data visualization]
kind: new-task
started: 2026-11-19
---

## Brief
"I need numbers for Thursday's leadership review. Show me how many new merchants activated each week since June, split by region. Ops thinks the North has been lagging since we changed onboarding in August. If you can show before and after the change, that would help. A table is fine. Add a chart if it's easy."

## What a good answer contains
- **Activation definition.** "Activated" is defined in writing (for example, first successful transaction, or an activation status or date on the merchant) and applied the same way to every week and region.
- **Grain.** There is one row per week per region. Each merchant is counted once, in the week it first activated. No merchant is double-counted.
- **Week rules.** Weeks start on a stated day and use a stated time zone. The series starts with the week containing 1 June. The current, incomplete week is either left out or clearly marked as partial.
- **Region rules.** Every merchant gets a region by a stated rule. Merchants with no region or an unmapped region are shown as their own bucket, not dropped.
- **Change date.** The onboarding change has an exact date, confirmed with Ada or Ops and not guessed. The before/after split uses that date. Any transition weeks are handled on purpose.
- **Fair comparison.** The before/after test for the North is set against the other regions over the same windows. A drop that affects every region (seasonality, a company-wide dip) can't then be mistaken for a North problem.
- **Presentation.** There is a readable week × region table and a line chart with a marked vertical line at the change date. A short headline answers the question: is the North lagging, and by how much?
- **Caveats.** Small weekly counts, possible late-arriving data, and the fact that before/after shows correlation, not cause, are each stated in one line.

## Steps

### 1. Pin down the ask and find the data
Task: Write down the open questions before you query anything. What counts as "activated"? What is the exact date of the August onboarding change? Which Thursday is the review, and does that make the latest week partial? Then explore the collections and find which fields could carry activation, signup date, and region.
Data: `merchants` (look for created/signup dates, status or activation fields, a region reference), `transactions` (merchant id, timestamp, success/status), `regions` (id, name). The onboarding change date is not in the practice data. Treat it as a question for Ada or Ops, and use a placeholder date while you rehearse.
Skill: Requirements clarification and schema exploration (`findOne`, `distinct`, field profiling)

### 2. Build one activation date per merchant
Task: Using the definition you chose, produce exactly one activation timestamp per merchant. Keep only merchants whose activation falls on or after the start of the week containing 1 June. Check that no merchant appears twice.
Data: `merchants`, plus `transactions` if activation means the first successful transaction
Skill: Aggregation with `$match`, `$group` / `$min` by merchant id

### 3. Attach region and bucket into weeks
Task: Join each activated merchant to its region name. Truncate the activation timestamp to the week, using your chosen week start and time zone. Count merchants per week per region, and include an explicit bucket for missing or unmapped regions.
Data: Output of step 2, `regions`
Skill: `$lookup`, `$dateTrunc` (unit week, `startOfWeek`, `timezone`), `$group`

### 4. Compare before vs after the onboarding change
Task: Split the weeks at the confirmed change date. For each region, compute average weekly activations before and after. Then compare how the North's change looks next to the other regions' changes over the same windows.
Data: Weekly table from step 3, plus the change date confirmed in step 1
Skill: Conditional bucketing (`$cond` / `$switch`) and summary statistics

### 5. Sanity-check the numbers
Task: Reconcile the totals. The sum across regions for each week should equal the total distinct activations for that week. Spot-check a few merchants by hand. Look for empty weeks, sudden spikes, and the size of the unmapped bucket. Confirm how the partial current week is handled.
Data: Outputs of steps 2–4, `merchants`
Skill: Data validation and reconciliation

### 6. Present it for the leadership review
Task: Produce the week × region table and a line chart by region with the change date marked. Write a two- or three-sentence headline and a short caveats list that Ada can read out on Thursday.
Data: Final aggregated results
Skill: Data visualization and executive summary writing

## Decisions

### D1. What counts as "activated"
Step: 1
Ask: Ada says "activated," not "signed up." What exactly will you count, and what timestamp marks the moment a merchant activated?
Decided: Use the company's existing activation definition if there is one (for example, an activation status or date on `merchants`). If there isn't, use the merchant's first successful transaction. Confirm the choice with Ada in one line before Thursday.
Why: "New merchants activated" points to merchants who started trading, not merchants who just registered. Using the first transaction is also observable the same way for every region. Signup date would only be right if Ada confirms she means new registrations. That matters here, because an onboarding change can affect signups and activations differently.
Wrong choices:
- Using signup or created date. This measures the top of the funnel, so it could hide exactly the activation slowdown Ops suspects.
- Counting every transaction, or every merchant with any transaction in a week. This turns the metric into weekly active merchants and counts the same merchant many times.
- Counting failed or refunded first transactions. This inflates activations with merchants who never actually got working.

### D2. Week boundaries, time zone, and the partial week
Step: 3
Ask: How will you define a "week," which time zone will you bucket in, and what will you do with the first and latest weeks?
Decided: Use ISO weeks starting Monday, in the company's reporting time zone, or UTC if there isn't one. State the choice in the table header. Start at the week containing 1 June. Leave out the in-progress current week, or show it greyed out and labelled "partial."
Why: A stated, consistent week makes the trend comparable and matches how leadership usually reads weekly numbers. A partial last week almost always looks like a drop, which would wrongly confirm the "North is lagging" story. Use a different week start only if the company already reports on one, such as Sunday-start weeks.
Wrong choices:
- Bucketing raw UTC timestamps without thinking about time zone. Activations near midnight land in the wrong week, which skews regions far from UTC.
- Keeping the incomplete current week unmarked. This creates a fake dip at the end of the chart right before a leadership review.

### D3. How to judge "the North is lagging since August"
Step: 4
Ask: How will you show before and after the onboarding change so that the result is fair to the North and doesn't mislead?
Decided: Confirm the exact change date. Compare average weekly activations before and after, per region, and judge the North's change against the other regions' changes over the same windows. Optionally exclude one or two transition weeks around the rollout.
Why: A drop in the North alone means little if every region dipped too (late-summer seasonality, a company-wide change). The question is whether the North changed *relative* to the others. A plain before/after for the North alone would only be enough if it were the only region the change applied to.
Wrong choices:
- Guessing "1 August" as the split date. If the change shipped mid-month, the before and after windows are contaminated.
- Comparing total activations in unequal windows, such as June–August against August–November. Window length drives the result, not performance.
- Calling the change the cause. Before/after shows timing, not cause. Say so.

### D4. Which region a merchant belongs to
Step: 3
Ask: Merchants can have missing, unmapped, or changed regions. Which region will you assign each merchant to, and what happens to the ones that don't fit?
Decided: Assign each merchant the region recorded on `merchants` and joined to `regions`. Note whether that is the region at signup or the current one. Show merchants with no matching region as an "Unassigned" bucket, and report its size.
Why: Dropping unmatched merchants quietly shrinks counts, and the losses may be uneven across regions, which could create or hide a North gap. Region-at-activation would be more correct if merchants move between regions often, but only if that history exists.
Wrong choices:
- Using an inner `$lookup` / `$unwind` that drops unmatched merchants. Activations disappear without anyone noticing.
- Folding unknowns into the largest region. This distorts the very regional comparison Ada asked for.

## Defend it
- "What exactly does 'activated' mean here? Would the picture change if we used signup instead?"
- "Is the North actually worse, or did every region dip after August?"
- "What date did you use for the onboarding change, and who confirmed it?"
- "Why does the last week look so low? Is that real?"
- "How many merchants couldn't be assigned a region, and could they change the conclusion?"

## The request as it arrived

> Hey,
> Quick one for Thursday's leadership review: can you pull how many new merchants activated each week since June, split by region? Ops thinks the North is lagging since the onboarding change in August, so if you can show before/after that would help. A table is fine, chart if easy.
> Thanks!
