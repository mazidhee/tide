import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts. SQL here: each test runs in the data lab's SQLite and is rolled back after.

const SCHEMA_STARTER = `-- Stage 1: the tables of a double-entry ledger. See STAGE-1.md.

-- CREATE TABLE accounts (...);
-- CREATE TABLE transactions (...);
-- CREATE TABLE entries (...);
`

const POSTING_STARTER = `-- Stage 2: the rules for posting a transaction. See STAGE-2.md.
`

const BALANCES_STARTER = `-- Stage 3: balances, the trial balance and profit. See STAGE-3.md.
`

const HISTORY_STARTER = `-- Stage 4: posted history is permanent; a statement with a running balance. See STAGE-4.md.
`

const SCHEMA = String.raw`PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'income', 'expense'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL CHECK (date(at) IS at),
  memo TEXT NOT NULL DEFAULT '',
  posted INTEGER NOT NULL DEFAULT 0 CHECK (posted IN (0, 1))
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount <> 0)
);
`

const POSTING = String.raw`-- A transaction is written as a draft, its entries added, then posted in one step.
CREATE TRIGGER born_draft BEFORE INSERT ON transactions
WHEN NEW.posted <> 0
BEGIN SELECT RAISE(ABORT, 'a transaction starts as a draft'); END;

CREATE TRIGGER post_only_balanced BEFORE UPDATE OF posted ON transactions
WHEN NEW.posted = 1 AND OLD.posted = 0
 AND ((SELECT count(*) FROM entries WHERE txn_id = NEW.id) < 2
      OR (SELECT coalesce(sum(amount), 0) FROM entries WHERE txn_id = NEW.id) <> 0)
BEGIN SELECT RAISE(ABORT, 'a transaction is posted only when it has two entries and they sum to zero'); END;

CREATE TRIGGER entries_insert_frozen BEFORE INSERT ON entries
WHEN (SELECT posted FROM transactions WHERE id = NEW.txn_id) = 1
BEGIN SELECT RAISE(ABORT, 'the transaction is posted'); END;

CREATE TRIGGER entries_update_frozen BEFORE UPDATE ON entries
WHEN (SELECT posted FROM transactions WHERE id = OLD.txn_id) = 1 OR (SELECT posted FROM transactions WHERE id = NEW.txn_id) = 1
BEGIN SELECT RAISE(ABORT, 'the transaction is posted'); END;

CREATE TRIGGER entries_delete_frozen BEFORE DELETE ON entries
WHEN (SELECT posted FROM transactions WHERE id = OLD.txn_id) = 1
BEGIN SELECT RAISE(ABORT, 'the transaction is posted'); END;
`

const BALANCES = String.raw`CREATE VIEW posted_entries AS
SELECT e.* FROM entries AS e JOIN transactions AS t ON t.id = e.txn_id WHERE t.posted = 1;

CREATE VIEW account_balances AS
SELECT a.name AS account, a.kind, coalesce(sum(p.amount), 0) AS balance
FROM accounts AS a LEFT JOIN posted_entries AS p ON p.account_id = a.id
GROUP BY a.id;

CREATE VIEW trial_balance AS
SELECT coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) AS debits,
       coalesce(sum(CASE WHEN amount < 0 THEN -amount END), 0) AS credits
FROM posted_entries;

CREATE VIEW profit AS
SELECT income, expenses, income - expenses AS net
FROM (SELECT coalesce(-sum(CASE WHEN kind = 'income' THEN balance END), 0) AS income,
             coalesce(sum(CASE WHEN kind = 'expense' THEN balance END), 0) AS expenses
      FROM account_balances);
`

const HISTORY = String.raw`CREATE TRIGGER posted_unchanged BEFORE UPDATE ON transactions
WHEN OLD.posted = 1
BEGIN SELECT RAISE(ABORT, 'a posted transaction cannot be changed; post a correcting one'); END;

CREATE TRIGGER posted_kept BEFORE DELETE ON transactions
WHEN OLD.posted = 1
BEGIN SELECT RAISE(ABORT, 'a posted transaction cannot be deleted; post a correcting one'); END;

CREATE VIEW account_statement AS
SELECT a.name AS account, t.id AS txn_id, t.at, t.memo, e.amount,
       sum(e.amount) OVER (PARTITION BY a.id ORDER BY t.at, t.id, e.id ROWS UNBOUNDED PRECEDING) AS running_balance
FROM entries AS e
JOIN transactions AS t ON t.id = e.txn_id
JOIN accounts AS a ON a.id = e.account_id
WHERE t.posted = 1;
`

/** Accounts and transactions the tests of stages 3 and 4 start from: four posted, one still a draft */
const BOOKS = String.raw`INSERT INTO accounts (id, name, kind) VALUES (1, 'Bank', 'asset'), (2, 'Loan', 'liability'), (3, 'Capital', 'equity'), (4, 'Sales', 'income'), (5, 'Rent', 'expense'), (6, 'Unused', 'asset');
INSERT INTO transactions (id, at, memo) VALUES (1, '2024-01-01', 'owner pays in'), (2, '2024-01-02', 'bank loan'), (3, '2024-01-10', 'a sale'), (4, '2024-01-31', 'January rent'), (5, '2024-02-01', 'a sale not yet posted');
INSERT INTO entries (id, txn_id, account_id, amount) VALUES (1, 1, 1, 100000), (2, 1, 3, -100000), (3, 2, 1, 50000), (4, 2, 2, -50000), (5, 3, 4, -25000), (6, 3, 1, 25000), (7, 4, 5, 40000), (8, 4, 1, -40000), (9, 5, 1, 99900), (10, 5, 4, -99900);
UPDATE transactions SET posted = 1 WHERE id IN (1, 2, 3, 4);
`

const TWO_ACCOUNTS = `INSERT INTO accounts (id, name, kind) VALUES (1, 'Bank', 'asset'), (2, 'Sales', 'income');
INSERT INTO transactions (id, at, memo) VALUES (1, '2024-03-01', 'a sale');
`

export const ledger: WorkshopProject = {
  id: 'ledger',
  title: 'A double-entry ledger that cannot be unbalanced',
  outcome: 'The core of an accounting system in SQLite, with the rules in the database rather than in application code: money as whole pence, transactions that can only be posted when their entries sum to zero, posted history that can never be changed, balances, a trial balance, profit, and a statement with a running balance.',
  area: 'databases',
  prerequisites: ['SQL SELECT and GROUP BY', 'Primary and foreign keys'],
  languages: ['sql'],
  stages: [
    {
      id: 'schema',
      title: 'Accounts, transactions, entries',
      goal: 'Write the three tables with constraints that refuse impossible data.',
      brief: `In \`schema.sql\`, create three tables. Every rule below is a constraint in the schema: the tests insert rows straight into your tables and expect bad ones to be refused.

**\`accounts(id, name, kind)\`**: \`id\` an \`INTEGER PRIMARY KEY\`; \`name\` text, required and unique; \`kind\` one of \`'asset'\`, \`'liability'\`, \`'equity'\`, \`'income'\`, \`'expense'\`.

**\`transactions(id, at, memo)\`**: \`id\` an \`INTEGER PRIMARY KEY\`; \`at\` a required ISO date (\`YYYY-MM-DD\`) that really exists; \`memo\` text, \`''\` when not given.

**\`entries(id, txn_id, account_id, amount)\`**: \`id\` an \`INTEGER PRIMARY KEY\`; \`txn_id\` a transaction and \`account_id\` an account that exist (foreign keys; start the file with \`PRAGMA foreign_keys = ON;\`); \`amount\` in **whole pence**, positive for a debit and negative for a credit, never 0. A fractional amount such as \`10.5\` is refused, not rounded.

Money is never stored as a floating-point number: 0.1 + 0.2 is not 0.3 in binary.`,
      read: { concept: 'Double-entry bookkeeping', source: 'Martin Fowler, Analysis Patterns, ch. 6 “Inventory and Accounting” (Account, Transaction, Entry); SQLite documentation, “CREATE TABLE”: CHECK constraints and “SQLite Foreign Key Support”' },
      files: [{ path: 'schema.sql', content: SCHEMA_STARTER }],
      tests: [
        {
          name: 'a well-formed transaction is stored',
          code: `${TWO_ACCOUNTS}INSERT INTO transactions (id, at) VALUES (2, '2024-03-02');
INSERT INTO entries (txn_id, account_id, amount) VALUES (1, 1, 1999), (1, 2, -1999);
SELECT 'two entries were inserted for transaction 1, but ' || count(*) || ' are stored' FROM entries WHERE txn_id = 1 HAVING count(*) <> 2
UNION ALL SELECT 'a transaction inserted without a memo should have the memo '''', got ' || quote(memo) FROM transactions WHERE id = 2 AND memo IS NOT ''`
        },
        {
          name: 'account names are unique and kinds are one of five',
          code: `INSERT OR IGNORE INTO accounts (id, name, kind) VALUES (1, 'Bank', 'asset'), (2, 'Bank', 'asset'), (3, 'Cash', 'money'), (4, 'Till', NULL), (5, NULL, 'asset');
SELECT 'accounts should hold only Bank (the second Bank, the kind ''money'', a missing kind and a missing name are all refused); it holds ' || count(*) || ' rows' FROM accounts HAVING count(*) <> 1`
        },
        {
          name: 'an amount is a whole, non-zero number of pence',
          code: `${TWO_ACCOUNTS}INSERT OR IGNORE INTO entries (txn_id, account_id, amount) VALUES (1, 1, 10.5), (1, 1, 0), (1, 1, NULL), (1, 1, 250);
SELECT 'only the amount 250 should be stored (10.5, 0 and NULL are refused); stored: ' || group_concat(quote(amount), ', ') FROM entries HAVING count(*) <> 1 OR max(amount) <> 250`
        },
        {
          name: 'a transaction date must be a real date',
          code: `INSERT OR IGNORE INTO transactions (id, at) VALUES (1, '2024-02-29'), (2, '2024-02-30'), (3, 'yesterday'), (4, '01/03/2024'), (5, NULL);
SELECT 'only 2024-02-29 is a real ISO date; transactions holds ' || group_concat(quote(at), ', ') FROM transactions HAVING count(*) <> 1`
        },
        {
          name: 'an entry must name a real account',
          code: `-- expect error: an entry for account 99, which does not exist, was accepted
${TWO_ACCOUNTS}INSERT INTO entries (txn_id, account_id, amount) VALUES (1, 99, 500)`
        },
        {
          name: 'an entry must belong to a real transaction',
          code: `-- expect error: an entry for transaction 42, which does not exist, was accepted
${TWO_ACCOUNTS}INSERT INTO entries (txn_id, account_id, amount) VALUES (42, 1, 500)`
        }
      ],
      hints: [
        'Every rule in the brief maps to one SQL constraint: PRIMARY KEY, NOT NULL, UNIQUE, CHECK, DEFAULT or REFERENCES.',
        'CHECK (kind IN (…)) limits the kinds. date(at) gives the date back unchanged only when it is a real ISO date, so CHECK (date(at) IS at) refuses the rest. For whole pence, CHECK on typeof(amount): a column declared INTEGER stores 10.5 as a real, because it cannot convert it without losing something.',
        'accounts: id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN (five kinds)). transactions: id INTEGER PRIMARY KEY, at TEXT NOT NULL CHECK (date(at) IS at), memo TEXT NOT NULL DEFAULT \'\'. entries: id INTEGER PRIMARY KEY, txn_id INTEGER NOT NULL REFERENCES transactions (id), account_id INTEGER NOT NULL REFERENCES accounts (id), amount INTEGER NOT NULL CHECK (typeof(amount) = \'integer\' AND amount <> 0). PRAGMA foreign_keys = ON at the top.'
      ],
      teaches: ['Double-entry bookkeeping', 'Integrity constraints'],
      recall: 'Why are amounts stored as whole pence in an INTEGER column rather than as pounds in a REAL one?'
    },
    {
      id: 'posting',
      title: 'Only balanced transactions are posted',
      goal: 'Make it impossible to post a transaction whose entries do not sum to zero, or to change it afterwards.',
      brief: `The rule of double entry: every transaction's entries sum to zero. It can't be checked as each entry is inserted (the first entry alone never balances), so a transaction has two states.

In \`schema.sql\`, add to \`transactions\` a column \`posted\`, \`0\` or \`1\`, default \`0\`. In \`posting.sql\`, write triggers so that:

- A transaction is always inserted as a draft (\`posted = 0\`); inserting one with \`posted = 1\` is refused.
- \`UPDATE transactions SET posted = 1 WHERE id = …\` is refused unless the transaction has **at least two entries** and they **sum to zero**.
- Once a transaction is posted, inserting, updating or deleting any of its entries is refused (moving an entry into a posted transaction too).
- Drafts can be changed freely.

Refuse with \`SELECT RAISE(ABORT, 'message')\` in a \`BEFORE\` trigger.`,
      read: { concept: 'Database triggers', source: 'SQLite documentation, “CREATE TRIGGER” (BEFORE triggers, WHEN clauses, the RAISE function); Fowler, Analysis Patterns, 6.3 “Transactions”' },
      files: [{ path: 'posting.sql', content: POSTING_STARTER }],
      tests: [
        {
          name: 'a balanced transaction can be posted',
          code: `${TWO_ACCOUNTS}INSERT INTO entries (txn_id, account_id, amount) VALUES (1, 1, 1999), (1, 2, -1999);
UPDATE transactions SET posted = 1 WHERE id = 1;
SELECT 'transaction 1 balances and should now be posted; posted is ' || quote(posted) FROM transactions WHERE id = 1 AND posted IS NOT 1`
        },
        {
          name: 'a new transaction is a draft',
          code: `INSERT INTO transactions (id, at) VALUES (7, '2024-03-01');
SELECT 'a transaction inserted without posted should be a draft (0), got ' || quote(posted) FROM transactions WHERE id = 7 AND posted IS NOT 0`
        },
        {
          name: 'one that does not sum to zero cannot be posted',
          code: `-- expect error: entries of 1999 and -1000 do not sum to zero, and the transaction was posted
${TWO_ACCOUNTS}INSERT INTO entries (txn_id, account_id, amount) VALUES (1, 1, 1999), (1, 2, -1000);
UPDATE transactions SET posted = 1 WHERE id = 1`
        },
        {
          name: 'one with fewer than two entries cannot be posted',
          code: `-- expect error: a transaction with no entries was posted
${TWO_ACCOUNTS}UPDATE transactions SET posted = 1 WHERE id = 1`
        },
        {
          name: 'a transaction cannot be inserted already posted',
          code: `-- expect error: a transaction was inserted with posted = 1, skipping the check that it balances
INSERT INTO transactions (id, at, posted) VALUES (9, '2024-03-01', 1)`
        },
        {
          name: 'the entries of a posted transaction cannot be changed',
          code: `-- expect error: an entry of a posted transaction was changed from 1999 to 5
${TWO_ACCOUNTS}INSERT INTO entries (id, txn_id, account_id, amount) VALUES (1, 1, 1, 1999), (2, 1, 2, -1999);
UPDATE transactions SET posted = 1 WHERE id = 1;
UPDATE entries SET amount = 5 WHERE id = 1`
        },
        {
          name: 'no entry can be added to a posted transaction',
          code: `-- expect error: transaction 1 is posted, yet a third entry was added to it
${TWO_ACCOUNTS}INSERT INTO entries (id, txn_id, account_id, amount) VALUES (1, 1, 1, 1999), (2, 1, 2, -1999);
UPDATE transactions SET posted = 1 WHERE id = 1;
INSERT INTO entries (id, txn_id, account_id, amount) VALUES (3, 1, 1, 10)`
        },
        {
          name: 'no entry can be removed from a posted transaction',
          code: `-- expect error: an entry was deleted from posted transaction 1, which then no longer balances
${TWO_ACCOUNTS}INSERT INTO entries (id, txn_id, account_id, amount) VALUES (1, 1, 1, 1999), (2, 1, 2, -1999);
UPDATE transactions SET posted = 1 WHERE id = 1;
DELETE FROM entries WHERE id = 2`
        },
        {
          name: 'drafts can still be edited',
          code: `${TWO_ACCOUNTS}INSERT INTO entries (id, txn_id, account_id, amount) VALUES (1, 1, 1, 1999), (2, 1, 2, -1000);
UPDATE entries SET amount = -1999 WHERE id = 2;
DELETE FROM entries WHERE id = 1;
INSERT INTO entries (id, txn_id, account_id, amount) VALUES (3, 1, 1, 1999);
UPDATE transactions SET posted = 1 WHERE id = 1;
SELECT 'a draft may be edited and then posted; transaction 1 has posted = ' || quote(posted) FROM transactions WHERE id = 1 AND posted IS NOT 1`
        }
      ],
      hints: [
        'The balance can only be checked at one moment: when the transaction changes from draft to posted. Everything else follows from treating that moment as a gate.',
        'A BEFORE UPDATE OF posted ON transactions trigger, WHEN the new value is 1 and the old 0, can count and sum the transaction’s entries with subqueries and RAISE(ABORT, …) when the count is under 2 or the sum is not 0. Three more triggers on entries (insert, update, delete) look up whether the transaction is posted.',
        'Add posted INTEGER NOT NULL DEFAULT 0 CHECK (posted IN (0, 1)). Triggers: BEFORE INSERT ON transactions WHEN NEW.posted <> 0 → RAISE. BEFORE UPDATE OF posted ON transactions WHEN NEW.posted = 1 AND OLD.posted = 0 AND ((SELECT count(*) …) < 2 OR (SELECT coalesce(sum(amount), 0) …) <> 0) → RAISE. BEFORE INSERT ON entries WHEN (SELECT posted FROM transactions WHERE id = NEW.txn_id) = 1 → RAISE; the same for UPDATE (checking OLD.txn_id and NEW.txn_id) and DELETE (OLD.txn_id).'
      ],
      teaches: ['Database triggers', 'Invariants enforced by the database'],
      recall: 'Why can’t “the entries sum to zero” be a CHECK constraint on the entries table?'
    },
    {
      id: 'balances',
      title: 'Balances, the trial balance, profit',
      goal: 'Report what each account holds, prove the books balance, and work out profit, from posted entries only.',
      brief: `In \`balances.sql\`, create three views. Only **posted** transactions count; drafts are invisible here.

**\`account_balances(account, kind, balance)\`**: one row for **every** account (an account with no posted entries has balance 0): its name, its kind, and the sum of its posted amounts in pence (debits positive).

**\`trial_balance(debits, credits)\`**: one row: the total of all positive posted amounts and the total of all negative ones made positive. If the posting rule holds, the two are always equal.

**\`profit(income, expenses, net)\`**: one row. Income accounts are credited, so their balances are negative: \`income\` is the total balance of the income accounts with its sign flipped; \`expenses\` is the total balance of the expense accounts; \`net\` is \`income − expenses\`. All three are 0 when there is nothing.`,
      read: { concept: 'Trial balance and the accounting equation', source: 'Martin Kleppmann, “Accounting for Computer Scientists” (blog post, 2011); SQLite documentation, “Aggregate Functions” (sum and total over no rows)' },
      files: [{ path: 'balances.sql', content: BALANCES_STARTER }],
      tests: [
        {
          name: 'each account’s balance counts posted entries only',
          code: `${BOOKS}SELECT w.account || ' should have balance ' || w.balance || ', got ' || coalesce((SELECT quote(b.balance) FROM account_balances AS b WHERE b.account = w.account), 'no row')
FROM (SELECT 'Bank' AS account, 135000 AS balance UNION ALL SELECT 'Loan', -50000 UNION ALL SELECT 'Capital', -100000 UNION ALL SELECT 'Sales', -25000 UNION ALL SELECT 'Rent', 40000) AS w
WHERE NOT EXISTS (SELECT 1 FROM account_balances AS b WHERE b.account = w.account AND b.balance = w.balance)`
        },
        {
          name: 'an account with nothing posted shows a balance of 0',
          code: `${BOOKS}SELECT 'the account Unused has no entries and should appear with balance 0 and kind asset, got ' || coalesce((SELECT quote(balance) || ' and ' || quote(kind) FROM account_balances WHERE account = 'Unused'), 'no row')
WHERE NOT EXISTS (SELECT 1 FROM account_balances WHERE account = 'Unused' AND balance = 0 AND kind = 'asset')
UNION ALL SELECT 'account_balances should have one row per account (6), got ' || count(*) FROM account_balances HAVING count(*) <> 6`
        },
        {
          name: 'the trial balance balances',
          code: `${BOOKS}SELECT 'trial_balance should be debits 215000 and credits 215000, got ' || coalesce((SELECT debits || ' and ' || credits FROM trial_balance), 'no row')
WHERE NOT EXISTS (SELECT 1 FROM trial_balance WHERE debits = 215000 AND credits = 215000)`
        },
        {
          name: 'profit is income less expenses',
          code: `${BOOKS}SELECT 'profit should be income 25000, expenses 40000, net -15000, got ' || coalesce((SELECT income || ', ' || expenses || ', ' || net FROM profit), 'no row')
WHERE NOT EXISTS (SELECT 1 FROM profit WHERE income = 25000 AND expenses = 40000 AND net = -15000)`
        },
        {
          name: 'empty books give zeros, not NULLs',
          code: `SELECT 'with no entries trial_balance should be 0 and 0, got ' || coalesce((SELECT quote(debits) || ' and ' || quote(credits) FROM trial_balance), 'no row') WHERE NOT EXISTS (SELECT 1 FROM trial_balance WHERE debits = 0 AND credits = 0)
UNION ALL SELECT 'with no entries profit should be 0, 0, 0, got ' || coalesce((SELECT quote(income) || ', ' || quote(expenses) || ', ' || quote(net) FROM profit), 'no row') WHERE NOT EXISTS (SELECT 1 FROM profit WHERE income = 0 AND expenses = 0 AND net = 0)`
        }
      ],
      hints: [
        'Every view here starts from the same set of rows: entries whose transaction is posted. Name that set once.',
        'A view of posted entries (entries joined to transactions, WHERE posted = 1) feeds the others. Start account_balances from accounts with a LEFT JOIN so that accounts without entries survive, and coalesce the sum to 0. sum over no rows is NULL in SQL; coalesce turns it into 0.',
        'posted_entries: SELECT e.* FROM entries e JOIN transactions t ON t.id = e.txn_id WHERE t.posted = 1. account_balances: SELECT a.name AS account, a.kind, coalesce(sum(p.amount), 0) AS balance FROM accounts a LEFT JOIN posted_entries p ON p.account_id = a.id GROUP BY a.id. trial_balance: coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) and the same for the negatives with -amount. profit: from account_balances, -sum of income balances and sum of expense balances (each coalesced), then net as their difference in an outer SELECT.'
      ],
      teaches: ['Trial balance and the accounting equation', 'Outer joins and NULL in aggregates'],
      recall: 'Why does the trial balance have to balance when every posted transaction sums to zero, and what would it mean if it didn’t?'
    },
    {
      id: 'history',
      title: 'History that cannot be rewritten',
      goal: 'Forbid changing or deleting posted transactions, and give each account a statement with a running balance.',
      brief: `An auditor must be able to trust that what was posted stays posted: mistakes are corrected by posting a new transaction, never by editing an old one. In \`history.sql\`:

- A posted transaction cannot be updated at all (not its date, its memo, nor \`posted\` back to 0) and cannot be deleted. Refuse with \`RAISE(ABORT, …)\`.
- A **draft** can still be deleted, and deleting it deletes its entries with it (in \`schema.sql\`, make the entries' foreign key \`ON DELETE CASCADE\`).

Then create the view **\`account_statement(account, txn_id, at, memo, amount, running_balance)\`**: one row per posted entry, with the account's name, its transaction's id, date and memo, the amount, and the account's balance after this entry. For each account the running balance accumulates in the order of \`at\`, then transaction id, then entry id.`,
      read: { concept: 'Append-only logs and immutability', source: 'Pat Helland, “Immutability Changes Everything” (CIDR 2015); SQLite documentation, “Window Functions”: frames and ROWS UNBOUNDED PRECEDING' },
      files: [{ path: 'history.sql', content: HISTORY_STARTER }],
      tests: [
        {
          name: 'a posted transaction cannot be edited',
          code: `-- expect error: the date of posted transaction 1 was changed
${BOOKS}UPDATE transactions SET at = '2023-12-31' WHERE id = 1`
        },
        {
          name: 'a posted transaction cannot be unposted',
          code: `-- expect error: posted transaction 1 was set back to a draft
${BOOKS}UPDATE transactions SET posted = 0 WHERE id = 1`
        },
        {
          name: 'a posted transaction cannot be deleted',
          code: `-- expect error: posted transaction 3 was deleted
${BOOKS}DELETE FROM transactions WHERE id = 3`
        },
        {
          name: 'a draft can be deleted, and its entries go with it',
          code: `${BOOKS}DELETE FROM transactions WHERE id = 5;
SELECT 'draft transaction 5 was deleted, but ' || count(*) || ' of its entries are still there' FROM entries WHERE txn_id = 5 HAVING count(*) > 0`
        },
        {
          name: 'the statement runs the balance in date order',
          code: `${BOOKS}SELECT 'the Bank statement should run 100000, 150000, 175000, 135000 over transactions 1, 2, 3, 4; got ' || coalesce((SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM (SELECT * FROM account_statement WHERE account = 'Bank' ORDER BY at, txn_id)), 'nothing')
WHERE (SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM (SELECT * FROM account_statement WHERE account = 'Bank' ORDER BY at, txn_id)) IS NOT '1:100000, 2:150000, 3:175000, 4:135000'`
        },
        {
          name: 'each account has a balance of its own, and drafts are left out',
          code: `${BOOKS}SELECT 'the Sales statement should have one posted row ending at -25000 (the draft sale is left out); got ' || coalesce((SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM account_statement WHERE account = 'Sales'), 'nothing')
WHERE (SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM account_statement WHERE account = 'Sales') IS NOT '3:-25000'`
        },
        {
          name: 'a correction is a new transaction, and the statement shows both',
          code: `${BOOKS}INSERT INTO transactions (id, at, memo) VALUES (6, '2024-01-15', 'refund part of the sale');
INSERT INTO entries (txn_id, account_id, amount) VALUES (6, 4, 5000), (6, 1, -5000);
UPDATE transactions SET posted = 1 WHERE id = 6;
SELECT 'a refund posted on 2024-01-15 belongs between the sale and the rent: the Bank statement should run 1:100000, 2:150000, 3:175000, 6:170000, 4:130000; got ' || coalesce((SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM (SELECT * FROM account_statement WHERE account = 'Bank' ORDER BY at, txn_id)), 'nothing')
WHERE (SELECT group_concat(txn_id || ':' || running_balance, ', ') FROM (SELECT * FROM account_statement WHERE account = 'Bank' ORDER BY at, txn_id)) IS NOT '1:100000, 2:150000, 3:175000, 6:170000, 4:130000'`
        }
      ],
      hints: [
        'Two separate things: two triggers that guard transactions, and one view with a running sum. The running sum is a window function with an ORDER BY inside its OVER.',
        'BEFORE UPDATE and BEFORE DELETE triggers on transactions WHEN OLD.posted = 1. For the cascade, the REFERENCES clause takes ON DELETE CASCADE. sum(amount) OVER (PARTITION BY the account ORDER BY at, txn id, entry id) gives each row the total so far.',
        'Triggers: BEFORE UPDATE ON transactions WHEN OLD.posted = 1 → RAISE(ABORT, …); BEFORE DELETE ON transactions WHEN OLD.posted = 1 → RAISE. Note the update trigger also covers your stage 2 posting UPDATE only when OLD.posted is already 1, so posting a draft still works. View: SELECT a.name AS account, t.id AS txn_id, t.at, t.memo, e.amount, sum(e.amount) OVER (PARTITION BY a.id ORDER BY t.at, t.id, e.id ROWS UNBOUNDED PRECEDING) AS running_balance FROM entries e JOIN transactions t … JOIN accounts a … WHERE t.posted = 1.'
      ],
      teaches: ['Append-only logs and immutability', 'Window functions (running totals)'],
      recall: 'Why do accounting systems correct a mistake with a new transaction rather than by editing the wrong one?'
    }
  ],
  solution: [
    { path: 'schema.sql', content: SCHEMA },
    { path: 'posting.sql', content: POSTING },
    { path: 'balances.sql', content: BALANCES },
    { path: 'history.sql', content: HISTORY }
  ]
}
