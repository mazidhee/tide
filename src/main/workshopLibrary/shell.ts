import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts. C here: the tests #include the learner's shell.c, so it must not define main.

const DECLS = String.raw`#include <ctype.h>
#include <stdio.h>
#include <string.h>

#define MAX_ARGS 32   /* words in one command */
#define MAX_WORD 256  /* bytes in one word, the terminating 0 included */
#define MAX_CMDS 8    /* commands in one pipeline */

/* What the functions return when the line can't be parsed */
enum { ERR_QUOTE = -1, ERR_TOO_MANY = -2, ERR_TOO_LONG = -3, ERR_SYNTAX = -4 };

/* Looks a variable up by name: its value, or NULL when it is not set */
typedef const char *(*Lookup)(const char *name);

typedef struct {
  int argc;
  char argv[MAX_ARGS][MAX_WORD];
} Words;

typedef struct {
  Words words;
  char in[MAX_WORD];   /* the file after <, or "" */
  char out[MAX_WORD];  /* the file after > or >>, or "" */
  int append;          /* 1 when it was >> */
} Command;

typedef struct {
  int n;
  Command cmds[MAX_CMDS];
} Pipeline;
`

const STARTER = String.raw`/* A shell's command-line parser. Built in four stages; see STAGE-1.md.
   The tests include this file, so it must not define main. */
${DECLS}
/* Stages 1 to 3: the words of line. Returns how many, or an ERR_ code. */
int split_words(const char *line, Words *w, Lookup lookup) {
  (void)line;
  (void)lookup;
  w->argc = 0;
  return 0;
}

/* Stage 4: line as a pipeline of commands. Returns how many commands, or an ERR_ code. */
int parse_line(const char *line, Pipeline *p, Lookup lookup) {
  (void)line;
  (void)lookup;
  p->n = 0;
  return 0;
}
`

const SOLUTION = String.raw`/* A shell's command-line parser: words, quotes, variables, pipes and redirections. */
${DECLS}
typedef struct {
  char text[MAX_WORD];
  int op; /* 0 for a word; '|', '<', '>', or 'A' for >> */
} Token;

static int is_name_start(char c) { return c == '_' || isalpha((unsigned char)c); }
static int is_name_char(char c) { return c == '_' || isalnum((unsigned char)c); }
static int is_op(char c) { return c == '|' || c == '<' || c == '>'; }

#define PUT(ch) do { if (len + 1 >= MAX_WORD) return ERR_TOO_LONG; t->text[len++] = (ch); } while (0)

/* $NAME at s[*i] (s[*i] is the $): appends the value, moves *i past the name */
static int expand(const char *s, size_t *i, Token *t, size_t *lenp, Lookup lookup) {
  char name[MAX_WORD];
  size_t k = 0, len = *lenp;
  (*i)++;
  while (is_name_char(s[*i])) {
    if (k + 1 < sizeof name) name[k++] = s[*i];
    (*i)++;
  }
  name[k] = 0;
  const char *v = lookup(name);
  for (; v && *v; v++) PUT(*v);
  *lenp = len;
  return 0;
}

/* The tokens of a line; operators only when ops is set. Returns how many, or an ERR_ code */
static int lex(const char *s, Token *toks, int max, Lookup lookup, int ops) {
  int n = 0;
  size_t i = 0;
  for (;;) {
    while (s[i] == ' ' || s[i] == '\t') i++;
    if (!s[i]) return n;
    if (n >= max) return ERR_TOO_MANY;
    Token *t = &toks[n];
    t->op = 0;
    if (ops && is_op(s[i])) {
      if (s[i] == '>' && s[i + 1] == '>') {
        t->op = 'A';
        i += 2;
      } else t->op = s[i++];
      t->text[0] = 0;
      n++;
      continue;
    }
    size_t len = 0;
    int quoted = 0;
    while (s[i] && s[i] != ' ' && s[i] != '\t' && !(ops && is_op(s[i]))) {
      char c = s[i];
      if (c == '\'') {
        quoted = 1;
        i++;
        while (s[i] && s[i] != '\'') PUT(s[i++]);
        if (!s[i]) return ERR_QUOTE;
        i++;
      } else if (c == '"') {
        quoted = 1;
        i++;
        while (s[i] && s[i] != '"') {
          if (s[i] == '\\' && (s[i + 1] == '"' || s[i + 1] == '\\' || s[i + 1] == '$')) {
            PUT(s[i + 1]);
            i += 2;
          } else if (s[i] == '$' && lookup && is_name_start(s[i + 1])) {
            int r = expand(s, &i, t, &len, lookup);
            if (r) return r;
          } else PUT(s[i++]);
        }
        if (!s[i]) return ERR_QUOTE;
        i++;
      } else if (c == '\\') {
        if (!s[i + 1]) return ERR_QUOTE;
        quoted = 1;
        PUT(s[i + 1]);
        i += 2;
      } else if (c == '$' && lookup && is_name_start(s[i + 1])) {
        int r = expand(s, &i, t, &len, lookup);
        if (r) return r;
      } else PUT(s[i++]);
    }
    /* An unquoted variable that expanded to nothing leaves no word at all */
    if (len == 0 && !quoted) continue;
    t->text[len] = 0;
    n++;
  }
}

int split_words(const char *line, Words *w, Lookup lookup) {
  static Token toks[MAX_ARGS];
  w->argc = 0;
  int n = lex(line, toks, MAX_ARGS, lookup, 0);
  if (n < 0) return n;
  for (int i = 0; i < n; i++) strcpy(w->argv[i], toks[i].text);
  w->argc = n;
  return n;
}

static int fail(Pipeline *p, int code) {
  memset(p, 0, sizeof *p);
  return code;
}

int parse_line(const char *line, Pipeline *p, Lookup lookup) {
  static Token toks[MAX_ARGS * MAX_CMDS];
  memset(p, 0, sizeof *p);
  int n = lex(line, toks, MAX_ARGS * MAX_CMDS, lookup, 1);
  if (n < 0) return fail(p, n);
  if (n == 0) return 0;
  Command *c = &p->cmds[0];
  p->n = 1;
  for (int i = 0; i < n; i++) {
    Token *t = &toks[i];
    if (t->op == '|') {
      if (c->words.argc == 0) return fail(p, ERR_SYNTAX);
      if (p->n == MAX_CMDS) return fail(p, ERR_TOO_MANY);
      c = &p->cmds[p->n++];
    } else if (t->op) {
      if (i + 1 >= n || toks[i + 1].op) return fail(p, ERR_SYNTAX);
      if (t->op == '<') strcpy(c->in, toks[i + 1].text);
      else {
        strcpy(c->out, toks[i + 1].text);
        c->append = t->op == 'A';
      }
      i++;
    } else {
      if (c->words.argc == MAX_ARGS) return fail(p, ERR_TOO_MANY);
      strcpy(c->words.argv[c->words.argc++], t->text);
    }
  }
  if (c->words.argc == 0) return fail(p, ERR_SYNTAX);
  return p->n;
}
`

const HELPERS = String.raw`#include "shell.c"
#define HELPER static __attribute__((unused))

/* Appends s to b as a C string literal, as far as it fits */
HELPER void q(char *b, size_t cap, size_t *n, const char *s) {
  if (*n + 2 < cap) b[(*n)++] = '"';
  for (; *s && *n + 6 < cap; s++) {
    if (*s == '"' || *s == '\\') { b[(*n)++] = '\\'; b[(*n)++] = *s; }
    else if (*s == '\t') { b[(*n)++] = '\\'; b[(*n)++] = 't'; }
    else b[(*n)++] = *s;
  }
  if (*s && *n + 4 < cap) { b[(*n)++] = '.'; b[(*n)++] = '.'; b[(*n)++] = '.'; }
  if (*n + 1 < cap) b[(*n)++] = '"';
  b[*n] = 0;
}

HELPER const char *qline(const char *s) {
  static char b[700];
  size_t n = 0;
  q(b, sizeof b, &n, s);
  return b;
}

HELPER const char *errname(int r) {
  switch (r) {
    case ERR_QUOTE: return "ERR_QUOTE";
    case ERR_TOO_MANY: return "ERR_TOO_MANY";
    case ERR_TOO_LONG: return "ERR_TOO_LONG";
    case ERR_SYNTAX: return "ERR_SYNTAX";
  }
  return "an unknown error code";
}

HELPER const char *list(const Words *w, char *b, size_t cap) {
  size_t n = 0;
  b[n++] = '[';
  for (int i = 0; i < w->argc && i < MAX_ARGS; i++) {
    if (i && n + 3 < cap) { b[n++] = ','; b[n++] = ' '; }
    q(b, cap, &n, w->argv[i]);
  }
  if (n + 2 < cap) b[n++] = ']';
  b[n] = 0;
  return b;
}

HELPER const char *got_words(int r, const Words *w) {
  static char b[1200];
  if (r < 0) { snprintf(b, sizeof b, "%s (%d)", errname(r), r); return b; }
  list(w, b, sizeof b);
  if (r != w->argc) snprintf(b + strlen(b), sizeof b - strlen(b), ", but it returned %d", r);
  return b;
}

HELPER const char *want_words(const char *const *want, int k) {
  static Words w;
  static char b[1200];
  w.argc = k;
  for (int i = 0; i < k; i++) snprintf(w.argv[i], MAX_WORD, "%s", want[i]);
  return list(&w, b, sizeof b);
}

HELPER int same(int r, const Words *w, const char *const *want, int k) {
  if (r != k || w->argc != k) return 0;
  for (int i = 0; i < k; i++) if (strcmp(w->argv[i], want[i]) != 0) return 0;
  return 1;
}

/* split_words(line, lookup) gives exactly the words listed */
#define EXPECT_WORDS(line, lookup, ...) do { \
    const char *const want_[] = { __VA_ARGS__ }; \
    int k_ = (int)(sizeof want_ / sizeof want_[0]); \
    static Words w_; memset(&w_, 0, sizeof w_); \
    int r_ = split_words(line, &w_, lookup); \
    CHECK(same(r_, &w_, want_, k_), "split_words(%s) should give %s, got %s", qline(line), want_words(want_, k_), got_words(r_, &w_)); \
  } while (0)

/* split_words(line, lookup) returns the error code */
#define EXPECT_ERROR(line, lookup, code) do { \
    static Words w_; memset(&w_, 0, sizeof w_); \
    int r_ = split_words(line, &w_, lookup); \
    CHECK(r_ == code, "split_words(%s) should return %s (%d), got %s", qline(line), errname(code), code, got_words(r_, &w_)); \
  } while (0)
`

const VARS = String.raw`HELPER const char *vars(const char *name) {
  if (strcmp(name, "HOME") == 0) return "/home/ada";
  if (strcmp(name, "USER") == 0) return "ada";
  if (strcmp(name, "EMPTY") == 0) return "";
  if (strcmp(name, "TWO") == 0) return "a  b";
  if (strcmp(name, "Q") == 0) return "'\"";
  return NULL;
}
`

const PIPES = String.raw`HELPER const char *show_cmd(const Command *c) {
  static char b[1500];
  char words[1200];
  list(&c->words, words, sizeof words);
  snprintf(b, sizeof b, "{words %s, in \"%s\", out \"%s\", append %d}", words, c->in, c->out, c->append);
  return b;
}

HELPER int cmd_is(const Command *c, const char *const *want, int k, const char *in, const char *out, int append) {
  return same(c->words.argc, &c->words, want, k) && strcmp(c->in, in) == 0 && strcmp(c->out, out) == 0 && c->append == append;
}

/* Command i of the pipeline p is these words, with these redirections */
#define EXPECT_CMD(line, p, i, in, out, append, ...) do { \
    const char *const want_[] = { __VA_ARGS__ }; \
    int k_ = (int)(sizeof want_ / sizeof want_[0]); \
    CHECK((p).n > (i) && cmd_is(&(p).cmds[i], want_, k_, in, out, append), "parse_line(%s): command %d should be {words %s, in \"%s\", out \"%s\", append %d}, got %s", qline(line), (i) + 1, want_words(want_, k_), in, out, append, (p).n > (i) ? show_cmd(&(p).cmds[i]) : "no such command"); \
  } while (0)

#define EXPECT_N(line, p, r, want) CHECK((r) == (want) && (p).n == (want), "parse_line(%s) should give %d command(s), it returned %d with n = %d", qline(line), want, r, (p).n)
`

export const shell: WorkshopProject = {
  id: 'shell-parser',
  title: 'A shell’s command-line parser in C',
  outcome: 'The part of a Unix shell that turns a typed line into commands, in C with fixed-size buffers and no overflow: words, single and double quotes, backslash escapes, $VARIABLE expansion, pipelines and redirections, with every malformed line refused by an error code instead of a crash.',
  area: 'systems',
  prerequisites: ['C strings and arrays', 'Pointers'],
  languages: ['c'],
  stages: [
    {
      id: 'words',
      title: 'Words',
      goal: 'Split a line into words on spaces and tabs, refusing lines that would overflow the buffers.',
      brief: `Everything is in \`shell.c\`, which already has the types and error codes. The tests \`#include\` it, so it must not define \`main\`.

Write \`int split_words(const char *line, Words *w, Lookup lookup)\`. For now ignore \`lookup\` (the tests pass \`NULL\`; stage 3 uses it).

- Words are separated by runs of spaces and tabs; leading and trailing blanks make no words. Every other character, \`$\` included, is part of a word.
- Fill \`w->argv[0]\` … \`w->argv[n-1]\` with the words (each a 0-terminated string), set \`w->argc = n\`, and return \`n\`. A blank line gives 0.
- A line with more than \`MAX_ARGS\` (32) words returns \`ERR_TOO_MANY\`; a word longer than \`MAX_WORD - 1\` (255) bytes returns \`ERR_TOO_LONG\`. Neither may write past the arrays: the bounds checker is on.`,
      read: { concept: 'C strings and buffer bounds', source: 'The C Programming Language (Kernighan and Ritchie), ch. 5 “Pointers and Arrays”; POSIX Shell Command Language, 2.3 “Token Recognition”' },
      files: [{ path: 'shell.c', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'words are split on spaces and tabs',
          code: String.raw`EXPECT_WORDS("ls -la  /tmp", NULL, "ls", "-la", "/tmp");
EXPECT_WORDS("\tgrep  -n\tmain  ", NULL, "grep", "-n", "main");
EXPECT_WORDS("one", NULL, "one");`
        },
        {
          name: 'a blank line has no words',
          code: String.raw`static Words w;
w.argc = 99;
int r = split_words("   \t ", &w, NULL);
CHECK(r == 0 && w.argc == 0, "split_words(\"   \\t \") should return 0 with argc 0, got %d with argc %d", r, w.argc);
r = split_words("", &w, NULL);
CHECK(r == 0 && w.argc == 0, "split_words(\"\") should return 0 with argc 0, got %d with argc %d", r, w.argc);`
        },
        {
          name: 'without a lookup, $ is an ordinary character',
          code: String.raw`EXPECT_WORDS("echo $HOME costs $5", NULL, "echo", "$HOME", "costs", "$5");`
        },
        {
          name: 'thirty-two words fit; thirty-three are refused',
          code: String.raw`static char line[200];
line[0] = 0;
for (int i = 0; i < 32; i++) strcat(line, "w ");
static Words w;
int r = split_words(line, &w, NULL);
CHECK(r == 32 && w.argc == 32, "a line of 32 words should give 32, got %s", got_words(r, &w));
strcat(line, "extra");
EXPECT_ERROR(line, NULL, ERR_TOO_MANY);`
        },
        {
          name: 'a word of 255 bytes fits; 256 is refused',
          code: String.raw`static char line[300];
memset(line, 'x', 255);
line[255] = 0;
static Words w;
int r = split_words(line, &w, NULL);
CHECK(r == 1 && strlen(w.argv[0]) == 255, "a single word of 255 bytes should fit, got %s", r < 0 ? errname(r) : "a different word");
line[255] = 'x';
line[256] = 0;
EXPECT_ERROR(line, NULL, ERR_TOO_LONG);`
        }
      ],
      hints: [
        'Two indices do all the work: where you are in the line, and where you are in the word being built. Think about what each check must look at before a byte is written.',
        'Skip blanks; if you are at the end, stop. Otherwise you are at the start of a word: before writing its first byte, check there is room for another word; before writing each byte, check there is room for that byte and the 0 after it.',
        'Loop: skip spaces and tabs; at the terminating 0 return the count. If the count is already MAX_ARGS, return ERR_TOO_MANY. Copy bytes into argv[count] until a blank or the end, returning ERR_TOO_LONG when the length reaches MAX_WORD - 1 and another byte is coming; terminate with 0; count it and set argc as you go.'
      ],
      teaches: ['C strings and buffer bounds', 'Lexical analysis'],
      recall: 'Why does a 255-byte word need a 256-byte array, and what happens in C when that last byte is forgotten?'
    },
    {
      id: 'quotes',
      title: 'Quotes and backslashes',
      goal: 'Honour single quotes, double quotes and backslash escapes, joining quoted pieces into one word.',
      brief: `Extend \`split_words\` in \`shell.c\` the way \`sh\` reads quotes:

- **Single quotes**: everything up to the next \`'\` is taken literally, backslashes included.
- **Double quotes**: everything up to the next unescaped \`"\` is taken literally, except that a backslash before \`"\`, \`\\\` or \`$\` stands for that character. Before anything else the backslash is kept (\`"a\\tb"\` is the four characters \`a\`, \`\\\`, \`t\`, \`b\`).
- **A backslash outside quotes** takes the next character literally, whatever it is (\`a\\ b\` is one word, \`a b\`).
- Quotes don't end a word: \`a"b c"'d'e\` is the single word \`ab cde\`. A word made only of quotes, \`""\` or \`''\`, is an empty word, and counts.
- A quote that is never closed, or a backslash at the very end of the line, returns \`ERR_QUOTE\`.`,
      read: { concept: 'Shell quoting', source: 'POSIX Shell Command Language, 2.2 “Quoting” (Escape Character, Single-Quotes, Double-Quotes)' },
      files: [],
      tests: [
        {
          name: 'single quotes keep everything as it is',
          code: String.raw`EXPECT_WORDS("echo 'a  b'", NULL, "echo", "a  b");
EXPECT_WORDS("'\\n $x \"q\"'", NULL, "\\n $x \"q\"");`
        },
        {
          name: 'double quotes, and the three escapes inside them',
          code: String.raw`EXPECT_WORDS("say \"hi  there\"", NULL, "say", "hi  there");
EXPECT_WORDS("\"say \\\"hi\\\"\"", NULL, "say \"hi\"");
EXPECT_WORDS("\"a\\\\b\" \"tab\\t\"", NULL, "a\\b", "tab\\t");`
        },
        {
          name: 'a backslash outside quotes takes the next character literally',
          code: String.raw`EXPECT_WORDS("a\\ b c", NULL, "a b", "c");
EXPECT_WORDS("\\'x \\\\", NULL, "'x", "\\");`
        },
        {
          name: 'quoted pieces join into one word',
          code: String.raw`EXPECT_WORDS("a\"b c\"'d'e f", NULL, "ab cde", "f");`
        },
        {
          name: 'empty quotes are an empty word',
          code: String.raw`EXPECT_WORDS("echo \"\" ''", NULL, "echo", "", "");`
        },
        {
          name: 'an unclosed quote or a trailing backslash is an error',
          code: String.raw`EXPECT_ERROR("echo \"abc", NULL, ERR_QUOTE);
EXPECT_ERROR("'x", NULL, ERR_QUOTE);
EXPECT_ERROR("a\\", NULL, ERR_QUOTE);
EXPECT_ERROR("\"it's\" 'fine", NULL, ERR_QUOTE);`
        }
      ],
      hints: [
        'A word now ends only at an unquoted blank. Inside a word you are in one of three modes: plain, in single quotes, in double quotes.',
        'Handle each mode with its own small loop that runs until its closing quote, then carry on building the same word. An empty word is possible now, so “the word has no bytes” no longer means “there was no word”: remember whether you saw a quote.',
        'In the word loop: on \' copy bytes until the next \' (end of line first: ERR_QUOTE); on " copy until the next ", but on a backslash followed by " \\ or $ copy that character instead; on a backslash outside quotes copy the next byte (none: ERR_QUOTE); otherwise copy the byte. Keep the length checks on every copy. A word is kept if it has bytes or contained a quote or an escape.'
      ],
      teaches: ['Shell quoting', 'State machines'],
      recall: 'Why does the shell need two kinds of quotes, and what can a double-quoted string contain that a single-quoted one cannot?'
    },
    {
      id: 'variables',
      title: 'Variables',
      goal: 'Expand $NAME from a lookup function, except inside single quotes.',
      brief: `When \`lookup\` is not \`NULL\`, \`split_words\` in \`shell.c\` expands variables.

- \`$\` followed by a letter or \`_\` starts a name, which runs over letters, digits and \`_\`. The name is replaced by \`lookup(name)\`'s value, or by nothing when \`lookup\` returns \`NULL\`. \`$\` followed by anything else (\`$5\`, a \`$\` at the end) is an ordinary character.
- Expansion happens outside quotes and inside double quotes, never inside single quotes or after a backslash.
- The value is inserted as it is: it is never split into words and its quotes are not quotes (unlike a real \`sh\`, which splits on blanks).
- A word that was only an unquoted variable and expanded to nothing disappears (\`a $NOPE b\` is two words); \`"$NOPE"\` is still one empty word.
- An expanded word longer than 255 bytes returns \`ERR_TOO_LONG\`, like any other.
- With \`lookup\` \`NULL\`, \`$\` stays an ordinary character, as before.`,
      read: { concept: 'Parameter expansion', source: 'POSIX Shell Command Language, 2.6.2 “Parameter Expansion” and 2.6.5 “Field Splitting”' },
      files: [],
      setup: VARS,
      tests: [
        {
          name: 'a variable is replaced by its value',
          code: String.raw`EXPECT_WORDS("cd $HOME/bin", vars, "cd", "/home/ada/bin");
EXPECT_WORDS("echo $USER.txt x$USER", vars, "echo", "ada.txt", "xada");`
        },
        {
          name: 'a name runs over letters, digits and underscores',
          code: String.raw`EXPECT_WORDS("$USER_1 $USER-1", vars, "ada-1");`
        },
        {
          name: 'expanded in double quotes, not in single quotes or after a backslash',
          code: String.raw`EXPECT_WORDS("\"$USER's\" '$USER' \\$USER", vars, "ada's", "$USER", "$USER");`
        },
        {
          name: 'an unset or empty variable leaves no word unless quoted',
          code: String.raw`EXPECT_WORDS("a $NOPE b $EMPTY", vars, "a", "b");
EXPECT_WORDS("a \"$NOPE\" b", vars, "a", "", "b");`
        },
        {
          name: 'a value is never split, and its quotes are not quotes',
          code: String.raw`EXPECT_WORDS("x$TWO $Q", vars, "xa  b", "'\"");`
        },
        {
          name: 'a $ that starts no name is an ordinary character',
          code: String.raw`EXPECT_WORDS("cost $5 $ a$", vars, "cost", "$5", "$", "a$");`
        },
        {
          name: 'an expansion that overflows the word is refused',
          code: String.raw`static char line[300];
memset(line, 'x', 250);
strcpy(line + 250, "$HOME");
EXPECT_ERROR(line, vars, ERR_TOO_LONG);`
        }
      ],
      hints: [
        'Expansion is one more thing that can happen while a word is being built, in two of your three modes. It changes how a word can end up empty.',
        'When you meet $ and the next character can start a name, read the name into a small buffer, call lookup, and copy the value into the word through the same length check as any other byte. Decide afterwards whether an empty word counts: only if it was quoted.',
        'Write a helper: given the position of the $, collect name characters into a buffer, advance past them, call lookup, and append each byte of the value (NULL means nothing) with the bounds check. Call it in plain mode and in double-quote mode when lookup is not NULL and the next byte is a letter or _. Single quotes and escaped characters never call it. At the end of a word, drop it if it has no bytes and nothing in it was quoted.'
      ],
      teaches: ['Parameter expansion', 'Function pointers in C'],
      recall: 'Why does a shell treat "$EMPTY" and $EMPTY differently when the variable is empty?'
    },
    {
      id: 'pipelines',
      title: 'Pipes and redirections',
      goal: 'Parse a line into a pipeline of commands with their input and output files, refusing malformed syntax.',
      brief: `Write \`int parse_line(const char *line, Pipeline *p, Lookup lookup)\` in \`shell.c\`. Words, quotes and variables work exactly as in \`split_words\`, and the result is a \`Pipeline\` of up to \`MAX_CMDS\` commands.

- Unquoted \`|\`, \`<\`, \`>\` and \`>>\` are operators even without blanks round them (\`a|b\` is two commands). Quoted or escaped, they are ordinary characters.
- \`|\` ends one command and starts the next.
- \`< file\` sets the command's \`in\`; \`> file\` sets its \`out\` with \`append = 0\`; \`>> file\` sets \`out\` with \`append = 1\`. The file is the next word; a later redirection of the same kind replaces an earlier one.
- Return the number of commands and set \`p->n\` to it. An empty line returns 0.
- \`ERR_SYNTAX\` for a command with no words (\`| ls\`, \`ls |\`, \`ls || wc\`, \`> out\`) and for an operator with no word after it (\`cat <\`, \`cat > | wc\`). \`ERR_TOO_MANY\` for more than \`MAX_CMDS\` commands or more than \`MAX_ARGS\` words in one. Quote errors as before.
- After any error \`p->n\` is 0.`,
      read: { concept: 'Pipelines and redirection', source: 'POSIX Shell Command Language, 2.7 “Redirection” and 2.9.2 “Pipelines”; The Linux Programming Interface (Kerrisk), ch. 44 “Pipes and FIFOs”' },
      files: [],
      setup: PIPES,
      tests: [
        {
          name: 'a single command',
          code: String.raw`static Pipeline p;
int r = parse_line("ls -l", &p, NULL);
EXPECT_N("ls -l", p, r, 1);
EXPECT_CMD("ls -l", p, 0, "", "", 0, "ls", "-l");`
        },
        {
          name: 'a pipeline of three, with and without spaces',
          code: String.raw`static Pipeline p;
const char *line = "cat f | grep x|wc -l";
int r = parse_line(line, &p, NULL);
EXPECT_N(line, p, r, 3);
EXPECT_CMD(line, p, 0, "", "", 0, "cat", "f");
EXPECT_CMD(line, p, 1, "", "", 0, "grep", "x");
EXPECT_CMD(line, p, 2, "", "", 0, "wc", "-l");`
        },
        {
          name: 'redirections take the next word',
          code: String.raw`static Pipeline p;
const char *line = "sort -r <in.txt > out.txt";
int r = parse_line(line, &p, NULL);
EXPECT_N(line, p, r, 1);
EXPECT_CMD(line, p, 0, "in.txt", "out.txt", 0, "sort", "-r");
line = "grep x < a | wc -l >> log";
r = parse_line(line, &p, NULL);
EXPECT_N(line, p, r, 2);
EXPECT_CMD(line, p, 0, "a", "", 0, "grep", "x");
EXPECT_CMD(line, p, 1, "", "log", 1, "wc", "-l");`
        },
        {
          name: 'quoted operators are ordinary characters',
          code: String.raw`static Pipeline p;
const char *line = "echo \"a|b\" '>' x\\|y";
int r = parse_line(line, &p, NULL);
EXPECT_N(line, p, r, 1);
EXPECT_CMD(line, p, 0, "", "", 0, "echo", "a|b", ">", "x|y");`
        },
        {
          name: 'variables are expanded in commands and file names',
          code: String.raw`static Pipeline p;
const char *line = "cat $HOME/notes > $USER.txt";
int r = parse_line(line, &p, vars);
EXPECT_N(line, p, r, 1);
EXPECT_CMD(line, p, 0, "", "ada.txt", 0, "cat", "/home/ada/notes");`
        },
        {
          name: 'malformed pipelines and redirections are refused',
          code: String.raw`const char *bad[] = { "| ls", "ls |", "ls || wc", "cat <", "cat > | wc", "> out", "a | | b" };
static Pipeline p;
for (int i = 0; i < 7; i++) {
  p.n = 99;
  int r = parse_line(bad[i], &p, NULL);
  CHECK(r == ERR_SYNTAX && p.n == 0, "parse_line(%s) should return ERR_SYNTAX (%d) and leave n at 0, got %d with n = %d", qline(bad[i]), ERR_SYNTAX, r, p.n);
}`
        },
        {
          name: 'an empty line is no commands, and too many commands are refused',
          code: String.raw`static Pipeline p;
int r = parse_line("   ", &p, NULL);
EXPECT_N("   ", p, r, 0);
const char *line = "a|b|c|d|e|f|g|h|i";
r = parse_line(line, &p, NULL);
CHECK(r == ERR_TOO_MANY && p.n == 0, "parse_line(%s) has 9 commands, more than MAX_CMDS: it should return ERR_TOO_MANY, got %d with n = %d", qline(line), r, p.n);
r = parse_line("echo \"unclosed | wc", &p, NULL);
CHECK(r == ERR_QUOTE && p.n == 0, "an unclosed quote in a pipeline should return ERR_QUOTE, got %d with n = %d", r, p.n);`
        }
      ],
      hints: [
        'Don’t parse the line twice. Let the code that reads words also report operators, then build commands from that stream of words and operators.',
        'Teach the word reader that, when operators are on, an unquoted | < > ends a word and is a token of its own (>> is one token). Then walk the tokens: a word goes into the current command, | moves to the next command, < > >> consume the word after them. Check for an empty command at every | and at the end.',
        'Turn your word reader into one that fills an array of tokens, each with its text and an op field (0 for a word, else the operator). split_words calls it with operators off. parse_line: zero the pipeline; read tokens with operators on; on |, refuse if the current command has no words, else move on; on a redirection, refuse if the next token is missing or is an operator, else copy it into in or out (setting append) and skip it; on a word, append it. Refuse a final command with no words. On every error, zero the pipeline before returning.'
      ],
      teaches: ['Pipelines and redirection', 'Parsing'],
      recall: 'Why must the parser decide whether a | was quoted before it decides where one command ends?'
    }
  ],
  solution: [{ path: 'shell.c', content: SOLUTION }]
}
