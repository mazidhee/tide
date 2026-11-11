(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // ../tide/node_modules/highlight.js/lib/core.js
  var require_core = __commonJS({
    "../tide/node_modules/highlight.js/lib/core.js"(exports, module) {
      function deepFreeze(obj) {
        if (obj instanceof Map) {
          obj.clear = obj.delete = obj.set = function() {
            throw new Error("map is read-only");
          };
        } else if (obj instanceof Set) {
          obj.add = obj.clear = obj.delete = function() {
            throw new Error("set is read-only");
          };
        }
        Object.freeze(obj);
        Object.getOwnPropertyNames(obj).forEach((name) => {
          const prop = obj[name];
          const type = typeof prop;
          if ((type === "object" || type === "function") && !Object.isFrozen(prop)) {
            deepFreeze(prop);
          }
        });
        return obj;
      }
      var Response = class {
        /**
         * @param {CompiledMode} mode
         */
        constructor(mode) {
          if (mode.data === void 0) mode.data = {};
          this.data = mode.data;
          this.isMatchIgnored = false;
        }
        ignoreMatch() {
          this.isMatchIgnored = true;
        }
      };
      function escapeHTML(value) {
        return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
      }
      function inherit$1(original, ...objects) {
        const result = /* @__PURE__ */ Object.create(null);
        for (const key in original) {
          result[key] = original[key];
        }
        objects.forEach(function(obj) {
          for (const key in obj) {
            result[key] = obj[key];
          }
        });
        return (
          /** @type {T} */
          result
        );
      }
      var SPAN_CLOSE = "</span>";
      var emitsWrappingTags = (node) => {
        return !!node.scope;
      };
      var scopeToCSSClass = (name, { prefix }) => {
        if (name.startsWith("language:")) {
          return name.replace("language:", "language-");
        }
        if (name.includes(".")) {
          const pieces = name.split(".");
          return [
            `${prefix}${pieces.shift()}`,
            ...pieces.map((x, i) => `${x}${"_".repeat(i + 1)}`)
          ].join(" ");
        }
        return `${prefix}${name}`;
      };
      var HTMLRenderer = class {
        /**
         * Creates a new HTMLRenderer
         *
         * @param {Tree} parseTree - the parse tree (must support `walk` API)
         * @param {{classPrefix: string}} options
         */
        constructor(parseTree, options) {
          this.buffer = "";
          this.classPrefix = options.classPrefix;
          parseTree.walk(this);
        }
        /**
         * Adds texts to the output stream
         *
         * @param {string} text */
        addText(text2) {
          this.buffer += escapeHTML(text2);
        }
        /**
         * Adds a node open to the output stream (if needed)
         *
         * @param {Node} node */
        openNode(node) {
          if (!emitsWrappingTags(node)) return;
          const className = scopeToCSSClass(
            node.scope,
            { prefix: this.classPrefix }
          );
          this.span(className);
        }
        /**
         * Adds a node close to the output stream (if needed)
         *
         * @param {Node} node */
        closeNode(node) {
          if (!emitsWrappingTags(node)) return;
          this.buffer += SPAN_CLOSE;
        }
        /**
         * returns the accumulated buffer
        */
        value() {
          return this.buffer;
        }
        // helpers
        /**
         * Builds a span element
         *
         * @param {string} className */
        span(className) {
          this.buffer += `<span class="${className}">`;
        }
      };
      var newNode = (opts = {}) => {
        const result = { children: [] };
        Object.assign(result, opts);
        return result;
      };
      var TokenTree = class _TokenTree {
        constructor() {
          this.rootNode = newNode();
          this.stack = [this.rootNode];
        }
        get top() {
          return this.stack[this.stack.length - 1];
        }
        get root() {
          return this.rootNode;
        }
        /** @param {Node} node */
        add(node) {
          this.top.children.push(node);
        }
        /** @param {string} scope */
        openNode(scope) {
          const node = newNode({ scope });
          this.add(node);
          this.stack.push(node);
        }
        closeNode() {
          if (this.stack.length > 1) {
            return this.stack.pop();
          }
          return void 0;
        }
        closeAllNodes() {
          while (this.closeNode()) ;
        }
        toJSON() {
          return JSON.stringify(this.rootNode, null, 4);
        }
        /**
         * @typedef { import("./html_renderer").Renderer } Renderer
         * @param {Renderer} builder
         */
        walk(builder) {
          return this.constructor._walk(builder, this.rootNode);
        }
        /**
         * @param {Renderer} builder
         * @param {Node} node
         */
        static _walk(builder, node) {
          if (typeof node === "string") {
            builder.addText(node);
          } else if (node.children) {
            builder.openNode(node);
            node.children.forEach((child) => this._walk(builder, child));
            builder.closeNode(node);
          }
          return builder;
        }
        /**
         * @param {Node} node
         */
        static _collapse(node) {
          if (typeof node === "string") return;
          if (!node.children) return;
          if (node.children.every((el3) => typeof el3 === "string")) {
            node.children = [node.children.join("")];
          } else {
            node.children.forEach((child) => {
              _TokenTree._collapse(child);
            });
          }
        }
      };
      var TokenTreeEmitter = class extends TokenTree {
        /**
         * @param {*} options
         */
        constructor(options) {
          super();
          this.options = options;
        }
        /**
         * @param {string} text
         */
        addText(text2) {
          if (text2 === "") {
            return;
          }
          this.add(text2);
        }
        /** @param {string} scope */
        startScope(scope) {
          this.openNode(scope);
        }
        endScope() {
          this.closeNode();
        }
        /**
         * @param {Emitter & {root: DataNode}} emitter
         * @param {string} name
         */
        __addSublanguage(emitter, name) {
          const node = emitter.root;
          if (name) node.scope = `language:${name}`;
          this.add(node);
        }
        toHTML() {
          const renderer = new HTMLRenderer(this, this.options);
          return renderer.value();
        }
        finalize() {
          this.closeAllNodes();
          return true;
        }
      };
      function source(re) {
        if (!re) return null;
        if (typeof re === "string") return re;
        return re.source;
      }
      function lookahead(re) {
        return concat("(?=", re, ")");
      }
      function anyNumberOfTimes(re) {
        return concat("(?:", re, ")*");
      }
      function optional(re) {
        return concat("(?:", re, ")?");
      }
      function concat(...args) {
        const joined = args.map((x) => source(x)).join("");
        return joined;
      }
      function stripOptionsFromArgs(args) {
        const opts = args[args.length - 1];
        if (typeof opts === "object" && opts.constructor === Object) {
          args.splice(args.length - 1, 1);
          return opts;
        } else {
          return {};
        }
      }
      function either(...args) {
        const opts = stripOptionsFromArgs(args);
        const joined = "(" + (opts.capture ? "" : "?:") + args.map((x) => source(x)).join("|") + ")";
        return joined;
      }
      function countMatchGroups(re) {
        return new RegExp(re.toString() + "|").exec("").length - 1;
      }
      function startsWith(re, lexeme) {
        const match = re && re.exec(lexeme);
        return match && match.index === 0;
      }
      var BACKREF_RE = new RegExp(either(
        /\[(?:[^\\\]]|\\.)*\]/,
        // a character class, inside which ( and \ lose their meaning
        /\(\?<(?![=!])[^>]+>/,
        // a named capture group `(?<name>` (not a lookbehind `(?<=` / `(?<!`)
        /\(\?'[^']+'/,
        // a named capture group `(?'name'`
        /\(\??/,
        // an opening parenthesis, capturing or non-capturing / lookahead
        /\\([1-9][0-9]*)/,
        // a backreference like `\1`
        /\\./
        // any other escape sequence
      ));
      function _rewriteBackreferences(regexps, { joinWith }) {
        let numCaptures = 0;
        return regexps.map((regex) => {
          numCaptures += 1;
          const offset = numCaptures;
          let re = source(regex);
          let out = "";
          while (re.length > 0) {
            const match = BACKREF_RE.exec(re);
            if (!match) {
              out += re;
              break;
            }
            out += re.substring(0, match.index);
            re = re.substring(match.index + match[0].length);
            if (match[0][0] === "\\" && match[1]) {
              out += "\\" + String(Number(match[1]) + offset);
            } else {
              out += match[0];
              if (match[0] === "(" || /^\(\?[<']/.test(match[0])) {
                numCaptures++;
              }
            }
          }
          return out;
        }).map((re) => `(${re})`).join(joinWith);
      }
      var MATCH_NOTHING_RE = /\b\B/;
      var IDENT_RE = "[a-zA-Z]\\w*";
      var UNDERSCORE_IDENT_RE = "[a-zA-Z_]\\w*";
      var NUMBER_RE = "\\b\\d+(\\.\\d+)?";
      var C_NUMBER_RE = "(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)";
      var BINARY_NUMBER_RE = "\\b(0b[01]+)";
      var RE_STARTERS_RE = "!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~";
      var SHEBANG = (opts = {}) => {
        const beginShebang = /^#![ ]*\//;
        if (opts.binary) {
          opts.begin = concat(
            beginShebang,
            /.*\b/,
            opts.binary,
            /\b.*/
          );
        }
        return inherit$1({
          scope: "meta",
          begin: beginShebang,
          end: /$/,
          relevance: 0,
          /** @type {ModeCallback} */
          "on:begin": (m, resp) => {
            if (m.index !== 0) resp.ignoreMatch();
          }
        }, opts);
      };
      var BACKSLASH_ESCAPE = {
        begin: "\\\\[\\s\\S]",
        relevance: 0
      };
      var APOS_STRING_MODE = {
        scope: "string",
        begin: "'",
        end: "'",
        illegal: "\\n",
        contains: [BACKSLASH_ESCAPE]
      };
      var QUOTE_STRING_MODE = {
        scope: "string",
        begin: '"',
        end: '"',
        illegal: "\\n",
        contains: [BACKSLASH_ESCAPE]
      };
      var PHRASAL_WORDS_MODE = {
        begin: /\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/
      };
      var COMMENT = function(begin, end, modeOptions = {}) {
        const mode = inherit$1(
          {
            scope: "comment",
            begin,
            end,
            contains: []
          },
          modeOptions
        );
        mode.contains.push({
          scope: "doctag",
          // hack to avoid the space from being included. the space is necessary to
          // match here to prevent the plain text rule below from gobbling up doctags
          begin: "[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)",
          end: /(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,
          excludeBegin: true,
          relevance: 0
        });
        const ENGLISH_WORD = either(
          // list of common 1 and 2 letter words in English
          "I",
          "a",
          "is",
          "so",
          "us",
          "to",
          "at",
          "if",
          "in",
          "it",
          "on",
          // note: this is not an exhaustive list of contractions, just popular ones
          /[A-Za-z]+['](d|ve|re|ll|t|s|n)/,
          // contractions - can't we'd they're let's, etc
          /[A-Za-z]+[-][a-z]+/,
          // `no-way`, etc.
          /[A-Za-z][a-z]{2,}/
          // allow capitalized words at beginning of sentences
        );
        mode.contains.push(
          {
            // TODO: how to include ", (, ) without breaking grammars that use these for
            // comment delimiters?
            // begin: /[ ]+([()"]?([A-Za-z'-]{3,}|is|a|I|so|us|[tT][oO]|at|if|in|it|on)[.]?[()":]?([.][ ]|[ ]|\))){3}/
            // ---
            // this tries to find sequences of 3 english words in a row (without any
            // "programming" type syntax) this gives us a strong signal that we've
            // TRULY found a comment - vs perhaps scanning with the wrong language.
            // It's possible to find something that LOOKS like the start of the
            // comment - but then if there is no readable text - good chance it is a
            // false match and not a comment.
            //
            // for a visual example please see:
            // https://github.com/highlightjs/highlight.js/issues/2827
            begin: concat(
              /[ ]+/,
              // necessary to prevent us gobbling up doctags like /* @author Bob Mcgill */
              "(",
              ENGLISH_WORD,
              /[.]?[:]?([.][ ]|[ ])/,
              "){3}"
            )
            // look for 3 words in a row
          }
        );
        return mode;
      };
      var C_LINE_COMMENT_MODE = COMMENT("//", "$");
      var C_BLOCK_COMMENT_MODE = COMMENT("/\\*", "\\*/");
      var HASH_COMMENT_MODE = COMMENT("#", "$");
      var NUMBER_MODE = {
        scope: "number",
        begin: NUMBER_RE,
        relevance: 0
      };
      var C_NUMBER_MODE = {
        scope: "number",
        begin: C_NUMBER_RE,
        relevance: 0
      };
      var BINARY_NUMBER_MODE = {
        scope: "number",
        begin: BINARY_NUMBER_RE,
        relevance: 0
      };
      var REGEXP_MODE = {
        scope: "regexp",
        begin: /\/(?=[^/\n]*\/)/,
        end: /\/[gimuy]*/,
        contains: [
          BACKSLASH_ESCAPE,
          {
            begin: /\[/,
            end: /\]/,
            relevance: 0,
            contains: [BACKSLASH_ESCAPE]
          }
        ]
      };
      var TITLE_MODE = {
        scope: "title",
        begin: IDENT_RE,
        relevance: 0
      };
      var UNDERSCORE_TITLE_MODE = {
        scope: "title",
        begin: UNDERSCORE_IDENT_RE,
        relevance: 0
      };
      var METHOD_GUARD = {
        // excludes method names from keyword processing
        begin: "\\.\\s*" + UNDERSCORE_IDENT_RE,
        relevance: 0
      };
      var END_SAME_AS_BEGIN = function(mode) {
        return Object.assign(
          mode,
          {
            /** @type {ModeCallback} */
            "on:begin": (m, resp) => {
              resp.data._beginMatch = m[1];
            },
            /** @type {ModeCallback} */
            "on:end": (m, resp) => {
              if (resp.data._beginMatch !== m[1]) resp.ignoreMatch();
            }
          }
        );
      };
      var MODES = /* @__PURE__ */ Object.freeze({
        __proto__: null,
        APOS_STRING_MODE,
        BACKSLASH_ESCAPE,
        BINARY_NUMBER_MODE,
        BINARY_NUMBER_RE,
        COMMENT,
        C_BLOCK_COMMENT_MODE,
        C_LINE_COMMENT_MODE,
        C_NUMBER_MODE,
        C_NUMBER_RE,
        END_SAME_AS_BEGIN,
        HASH_COMMENT_MODE,
        IDENT_RE,
        MATCH_NOTHING_RE,
        METHOD_GUARD,
        NUMBER_MODE,
        NUMBER_RE,
        PHRASAL_WORDS_MODE,
        QUOTE_STRING_MODE,
        REGEXP_MODE,
        RE_STARTERS_RE,
        SHEBANG,
        TITLE_MODE,
        UNDERSCORE_IDENT_RE,
        UNDERSCORE_TITLE_MODE
      });
      function skipIfHasPrecedingDot(match, response) {
        const before = match.input[match.index - 1];
        if (before === ".") {
          response.ignoreMatch();
        }
      }
      function scopeClassName(mode, _parent) {
        if (mode.className !== void 0) {
          mode.scope = mode.className;
          delete mode.className;
        }
      }
      function beginKeywords(mode, parent) {
        if (!parent) return;
        if (!mode.beginKeywords) return;
        mode.begin = "\\b(" + mode.beginKeywords.split(" ").join("|") + ")(?!\\.)(?=\\b|\\s)";
        mode.__beforeBegin = skipIfHasPrecedingDot;
        mode.keywords = mode.keywords || mode.beginKeywords;
        delete mode.beginKeywords;
        if (mode.relevance === void 0) mode.relevance = 0;
      }
      function compileIllegal(mode, _parent) {
        if (!Array.isArray(mode.illegal)) return;
        mode.illegal = either(...mode.illegal);
      }
      function compileMatch(mode, _parent) {
        if (!mode.match) return;
        if (mode.begin || mode.end) throw new Error("begin & end are not supported with match");
        mode.begin = mode.match;
        delete mode.match;
      }
      function compileRelevance(mode, _parent) {
        if (mode.relevance === void 0) mode.relevance = 1;
      }
      var beforeMatchExt = (mode, parent) => {
        if (!mode.beforeMatch) return;
        if (mode.starts) throw new Error("beforeMatch cannot be used with starts");
        const originalMode = Object.assign({}, mode);
        Object.keys(mode).forEach((key) => {
          delete mode[key];
        });
        mode.keywords = originalMode.keywords;
        mode.begin = concat(originalMode.beforeMatch, lookahead(originalMode.begin));
        mode.starts = {
          relevance: 0,
          contains: [
            Object.assign(originalMode, { endsParent: true })
          ]
        };
        mode.relevance = 0;
        delete originalMode.beforeMatch;
      };
      var COMMON_KEYWORDS = [
        "of",
        "and",
        "for",
        "in",
        "not",
        "or",
        "if",
        "then",
        "parent",
        // common variable name
        "list",
        // common variable name
        "value"
        // common variable name
      ];
      var DEFAULT_KEYWORD_SCOPE = "keyword";
      function compileKeywords(rawKeywords, caseInsensitive, scopeName = DEFAULT_KEYWORD_SCOPE) {
        const compiledKeywords = /* @__PURE__ */ Object.create(null);
        if (typeof rawKeywords === "string") {
          compileList(scopeName, rawKeywords.split(" "));
        } else if (Array.isArray(rawKeywords)) {
          compileList(scopeName, rawKeywords);
        } else {
          Object.keys(rawKeywords).forEach(function(scopeName2) {
            Object.assign(
              compiledKeywords,
              compileKeywords(rawKeywords[scopeName2], caseInsensitive, scopeName2)
            );
          });
        }
        return compiledKeywords;
        function compileList(scopeName2, keywordList) {
          if (caseInsensitive) {
            keywordList = keywordList.map((x) => x.toLowerCase());
          }
          keywordList.forEach(function(keyword) {
            const pair = keyword.split("|");
            compiledKeywords[pair[0]] = [scopeName2, scoreForKeyword(pair[0], pair[1])];
          });
        }
      }
      function scoreForKeyword(keyword, providedScore) {
        if (providedScore) {
          return Number(providedScore);
        }
        return commonKeyword(keyword) ? 0 : 1;
      }
      function commonKeyword(keyword) {
        return COMMON_KEYWORDS.includes(keyword.toLowerCase());
      }
      var seenDeprecations = {};
      var error = (message) => {
        console.error(message);
      };
      var warn = (message, ...args) => {
        console.log(`WARN: ${message}`, ...args);
      };
      var deprecated = (version2, message) => {
        if (seenDeprecations[`${version2}/${message}`]) return;
        console.log(`Deprecated as of ${version2}. ${message}`);
        seenDeprecations[`${version2}/${message}`] = true;
      };
      var MultiClassError = new Error();
      function remapScopeNames(mode, regexes, { key }) {
        let offset = 0;
        const scopeNames = mode[key];
        const emit = {};
        const positions = {};
        for (let i = 1; i <= regexes.length; i++) {
          positions[i + offset] = scopeNames[i];
          emit[i + offset] = true;
          offset += countMatchGroups(regexes[i - 1]);
        }
        mode[key] = positions;
        mode[key]._emit = emit;
        mode[key]._multi = true;
      }
      function beginMultiClass(mode) {
        if (!Array.isArray(mode.begin)) return;
        if (mode.skip || mode.excludeBegin || mode.returnBegin) {
          error("skip, excludeBegin, returnBegin not compatible with beginScope: {}");
          throw MultiClassError;
        }
        if (typeof mode.beginScope !== "object" || mode.beginScope === null) {
          error("beginScope must be object");
          throw MultiClassError;
        }
        remapScopeNames(mode, mode.begin, { key: "beginScope" });
        mode.begin = _rewriteBackreferences(mode.begin, { joinWith: "" });
      }
      function endMultiClass(mode) {
        if (!Array.isArray(mode.end)) return;
        if (mode.skip || mode.excludeEnd || mode.returnEnd) {
          error("skip, excludeEnd, returnEnd not compatible with endScope: {}");
          throw MultiClassError;
        }
        if (typeof mode.endScope !== "object" || mode.endScope === null) {
          error("endScope must be object");
          throw MultiClassError;
        }
        remapScopeNames(mode, mode.end, { key: "endScope" });
        mode.end = _rewriteBackreferences(mode.end, { joinWith: "" });
      }
      function scopeSugar(mode) {
        if (mode.scope && typeof mode.scope === "object" && mode.scope !== null) {
          mode.beginScope = mode.scope;
          delete mode.scope;
        }
      }
      function MultiClass(mode) {
        scopeSugar(mode);
        if (typeof mode.beginScope === "string") {
          mode.beginScope = { _wrap: mode.beginScope };
        }
        if (typeof mode.endScope === "string") {
          mode.endScope = { _wrap: mode.endScope };
        }
        beginMultiClass(mode);
        endMultiClass(mode);
      }
      function compileLanguage(language) {
        function langRe(value, global) {
          return new RegExp(
            source(value),
            "m" + (language.case_insensitive ? "i" : "") + (language.unicodeRegex ? "u" : "") + (global ? "g" : "")
          );
        }
        class MultiRegex {
          constructor() {
            this.matchIndexes = {};
            this.regexes = [];
            this.matchAt = 1;
            this.position = 0;
          }
          // @ts-ignore
          addRule(re, opts) {
            opts.position = this.position++;
            this.matchIndexes[this.matchAt] = opts;
            this.regexes.push([opts, re]);
            this.matchAt += countMatchGroups(re) + 1;
          }
          compile() {
            if (this.regexes.length === 0) {
              this.exec = () => null;
            }
            const terminators = this.regexes.map((el3) => el3[1]);
            this.matcherRe = langRe(_rewriteBackreferences(terminators, { joinWith: "|" }), true);
            this.lastIndex = 0;
          }
          /** @param {string} s */
          exec(s) {
            this.matcherRe.lastIndex = this.lastIndex;
            const match = this.matcherRe.exec(s);
            if (!match) {
              return null;
            }
            const i = match.findIndex((el3, i2) => i2 > 0 && el3 !== void 0);
            const matchData = this.matchIndexes[i];
            match.splice(0, i);
            return Object.assign(match, matchData);
          }
        }
        class ResumableMultiRegex {
          constructor() {
            this.rules = [];
            this.multiRegexes = [];
            this.count = 0;
            this.lastIndex = 0;
            this.regexIndex = 0;
          }
          // @ts-ignore
          getMatcher(index) {
            if (this.multiRegexes[index]) return this.multiRegexes[index];
            const matcher = new MultiRegex();
            this.rules.slice(index).forEach(([re, opts]) => matcher.addRule(re, opts));
            matcher.compile();
            this.multiRegexes[index] = matcher;
            return matcher;
          }
          resumingScanAtSamePosition() {
            return this.regexIndex !== 0;
          }
          considerAll() {
            this.regexIndex = 0;
          }
          // @ts-ignore
          addRule(re, opts) {
            this.rules.push([re, opts]);
            if (opts.type === "begin") this.count++;
          }
          /** @param {string} s */
          exec(s) {
            const m = this.getMatcher(this.regexIndex);
            m.lastIndex = this.lastIndex;
            let result = m.exec(s);
            if (this.resumingScanAtSamePosition()) {
              if (result && result.index === this.lastIndex) ;
              else {
                const m2 = this.getMatcher(0);
                m2.lastIndex = this.lastIndex + 1;
                result = m2.exec(s);
              }
            }
            if (result) {
              this.regexIndex += result.position + 1;
              if (this.regexIndex === this.count) {
                this.considerAll();
              }
            }
            return result;
          }
        }
        function buildModeRegex(mode) {
          const mm = new ResumableMultiRegex();
          mode.contains.forEach((term) => mm.addRule(term.begin, { rule: term, type: "begin" }));
          if (mode.terminatorEnd) {
            mm.addRule(mode.terminatorEnd, { type: "end" });
          }
          if (mode.illegal) {
            mm.addRule(mode.illegal, { type: "illegal" });
          }
          return mm;
        }
        function compileMode(mode, parent) {
          const cmode = (
            /** @type CompiledMode */
            mode
          );
          if (mode.isCompiled) return cmode;
          [
            scopeClassName,
            // do this early so compiler extensions generally don't have to worry about
            // the distinction between match/begin
            compileMatch,
            MultiClass,
            beforeMatchExt
          ].forEach((ext) => ext(mode, parent));
          language.compilerExtensions.forEach((ext) => ext(mode, parent));
          mode.__beforeBegin = null;
          [
            beginKeywords,
            // do this later so compiler extensions that come earlier have access to the
            // raw array if they wanted to perhaps manipulate it, etc.
            compileIllegal,
            // default to 1 relevance if not specified
            compileRelevance
          ].forEach((ext) => ext(mode, parent));
          mode.isCompiled = true;
          let keywordPattern = null;
          if (typeof mode.keywords === "object" && mode.keywords.$pattern) {
            mode.keywords = Object.assign({}, mode.keywords);
            keywordPattern = mode.keywords.$pattern;
            delete mode.keywords.$pattern;
          }
          keywordPattern = keywordPattern || /\w+/;
          if (mode.keywords) {
            mode.keywords = compileKeywords(mode.keywords, language.case_insensitive);
          }
          cmode.keywordPatternRe = langRe(keywordPattern, true);
          if (parent) {
            if (!mode.begin) mode.begin = /\B|\b/;
            cmode.beginRe = langRe(cmode.begin);
            if (!mode.end && !mode.endsWithParent) mode.end = /\B|\b/;
            if (mode.end) cmode.endRe = langRe(cmode.end);
            cmode.terminatorEnd = source(cmode.end) || "";
            if (mode.endsWithParent && parent.terminatorEnd) {
              cmode.terminatorEnd += (mode.end ? "|" : "") + parent.terminatorEnd;
            }
          }
          if (mode.illegal) cmode.illegalRe = langRe(
            /** @type {RegExp | string} */
            mode.illegal
          );
          if (!mode.contains) mode.contains = [];
          mode.contains = [].concat(...mode.contains.map(function(c) {
            return expandOrCloneMode(c === "self" ? mode : c);
          }));
          mode.contains.forEach(function(c) {
            compileMode(
              /** @type Mode */
              c,
              cmode
            );
          });
          if (mode.starts) {
            compileMode(mode.starts, parent);
          }
          cmode.matcher = buildModeRegex(cmode);
          return cmode;
        }
        if (!language.compilerExtensions) language.compilerExtensions = [];
        if (language.contains && language.contains.includes("self")) {
          throw new Error("ERR: contains `self` is not supported at the top-level of a language.  See documentation.");
        }
        language.classNameAliases = inherit$1(language.classNameAliases || {});
        return compileMode(
          /** @type Mode */
          language
        );
      }
      function dependencyOnParent(mode) {
        if (!mode) return false;
        return mode.endsWithParent || dependencyOnParent(mode.starts);
      }
      function expandOrCloneMode(mode) {
        if (mode.variants && !mode.cachedVariants) {
          mode.cachedVariants = mode.variants.map(function(variant) {
            return inherit$1(mode, { variants: null }, variant);
          });
        }
        if (mode.cachedVariants) {
          return mode.cachedVariants;
        }
        if (dependencyOnParent(mode)) {
          return inherit$1(mode, { starts: mode.starts ? inherit$1(mode.starts) : null });
        }
        if (Object.isFrozen(mode)) {
          return inherit$1(mode);
        }
        return mode;
      }
      var version = "11.12.0";
      var HTMLInjectionError = class extends Error {
        constructor(reason, html) {
          super(reason);
          this.name = "HTMLInjectionError";
          this.html = html;
        }
      };
      var escape = escapeHTML;
      var inherit = inherit$1;
      var NO_MATCH = Symbol("nomatch");
      var MAX_KEYWORD_HITS = 7;
      var HLJS = function(hljs) {
        const languages = /* @__PURE__ */ Object.create(null);
        const aliases = /* @__PURE__ */ Object.create(null);
        const plugins = [];
        let SAFE_MODE = true;
        const LANGUAGE_NOT_FOUND = "Could not find the language '{}', did you forget to load/include a language module?";
        const PLAINTEXT_LANGUAGE = { disableAutodetect: true, name: "Plain text", contains: [] };
        let options = {
          ignoreUnescapedHTML: false,
          throwUnescapedHTML: false,
          noHighlightRe: /^(no-?highlight)$/i,
          languageDetectRe: /\blang(?:uage)?-([\w-]+)\b/i,
          classPrefix: "hljs-",
          cssSelector: "pre code",
          languages: null,
          // beta configuration options, subject to change, welcome to discuss
          // https://github.com/highlightjs/highlight.js/issues/1086
          __emitter: TokenTreeEmitter
        };
        function shouldNotHighlight(languageName) {
          return options.noHighlightRe.test(languageName);
        }
        function blockLanguage(block) {
          let classes = block.className + " ";
          classes += block.parentNode ? block.parentNode.className : "";
          const match = options.languageDetectRe.exec(classes);
          if (match) {
            const language = getLanguage(match[1]);
            if (!language) {
              warn(LANGUAGE_NOT_FOUND.replace("{}", match[1]));
              warn("Falling back to no-highlight mode for this block.", block);
            }
            return language ? match[1] : "no-highlight";
          }
          return classes.split(/\s+/).find((_class) => shouldNotHighlight(_class) || getLanguage(_class));
        }
        function highlight2(codeOrLanguageName, optionsOrCode, ignoreIllegals) {
          let code = "";
          let languageName = "";
          if (typeof optionsOrCode === "object") {
            code = codeOrLanguageName;
            ignoreIllegals = optionsOrCode.ignoreIllegals;
            languageName = optionsOrCode.language;
          } else {
            deprecated("10.7.0", "highlight(lang, code, ...args) has been deprecated.");
            deprecated("10.7.0", "Please use highlight(code, options) instead.\nhttps://github.com/highlightjs/highlight.js/issues/2277");
            languageName = codeOrLanguageName;
            code = optionsOrCode;
          }
          if (ignoreIllegals === void 0) {
            ignoreIllegals = true;
          }
          const context = {
            code,
            language: languageName
          };
          fire("before:highlight", context);
          const result = context.result ? context.result : _highlight(context.language, context.code, ignoreIllegals);
          result.code = context.code;
          fire("after:highlight", result);
          return result;
        }
        function _highlight(languageName, codeToHighlight, ignoreIllegals, continuation) {
          const keywordHits = /* @__PURE__ */ Object.create(null);
          function keywordData(mode, matchText) {
            return mode.keywords[matchText];
          }
          function processKeywords() {
            if (!top.keywords) {
              emitter.addText(modeBuffer);
              return;
            }
            let lastIndex = 0;
            top.keywordPatternRe.lastIndex = 0;
            let match = top.keywordPatternRe.exec(modeBuffer);
            let buf = "";
            while (match) {
              buf += modeBuffer.substring(lastIndex, match.index);
              const word = language.case_insensitive ? match[0].toLowerCase() : match[0];
              const data = keywordData(top, word);
              if (data) {
                const [kind, keywordRelevance] = data;
                emitter.addText(buf);
                buf = "";
                keywordHits[word] = (keywordHits[word] || 0) + 1;
                if (keywordHits[word] <= MAX_KEYWORD_HITS) relevance += keywordRelevance;
                if (kind.startsWith("_")) {
                  buf += match[0];
                } else {
                  const cssClass = language.classNameAliases[kind] || kind;
                  emitKeyword(match[0], cssClass);
                }
              } else {
                buf += match[0];
              }
              lastIndex = top.keywordPatternRe.lastIndex;
              match = top.keywordPatternRe.exec(modeBuffer);
            }
            buf += modeBuffer.substring(lastIndex);
            emitter.addText(buf);
          }
          function processSubLanguage() {
            if (modeBuffer === "") return;
            let result2 = null;
            if (typeof top.subLanguage === "string") {
              if (!languages[top.subLanguage]) {
                emitter.addText(modeBuffer);
                return;
              }
              result2 = _highlight(top.subLanguage, modeBuffer, true, continuations[top.subLanguage]);
              continuations[top.subLanguage] = /** @type {CompiledMode} */
              result2._top;
            } else {
              result2 = highlightAuto(modeBuffer, top.subLanguage.length ? top.subLanguage : null);
            }
            if (top.relevance > 0) {
              relevance += result2.relevance;
            }
            emitter.__addSublanguage(result2._emitter, result2.language);
          }
          function processBuffer() {
            if (top.subLanguage != null) {
              processSubLanguage();
            } else {
              processKeywords();
            }
            modeBuffer = "";
          }
          function emitKeyword(keyword, scope) {
            if (keyword === "") return;
            emitter.startScope(scope);
            emitter.addText(keyword);
            emitter.endScope();
          }
          function emitMultiClass(scope, match) {
            let i = 1;
            const max = match.length - 1;
            while (i <= max) {
              if (!scope._emit[i]) {
                i++;
                continue;
              }
              const klass = language.classNameAliases[scope[i]] || scope[i];
              const text2 = match[i];
              if (klass) {
                emitKeyword(text2, klass);
              } else {
                modeBuffer = text2;
                processKeywords();
                modeBuffer = "";
              }
              i++;
            }
          }
          function startNewMode(mode, match) {
            if (mode.scope && typeof mode.scope === "string") {
              emitter.openNode(language.classNameAliases[mode.scope] || mode.scope);
            }
            if (mode.beginScope) {
              if (mode.beginScope._wrap) {
                emitKeyword(modeBuffer, language.classNameAliases[mode.beginScope._wrap] || mode.beginScope._wrap);
                modeBuffer = "";
              } else if (mode.beginScope._multi) {
                emitMultiClass(mode.beginScope, match);
                modeBuffer = "";
              }
            }
            top = Object.create(mode, { parent: { value: top } });
            return top;
          }
          function endOfMode(mode, match, matchPlusRemainder) {
            let matched = startsWith(mode.endRe, matchPlusRemainder);
            if (matched) {
              if (mode["on:end"]) {
                const resp = new Response(mode);
                mode["on:end"](match, resp);
                if (resp.isMatchIgnored) matched = false;
              }
              if (matched) {
                while (mode.endsParent && mode.parent) {
                  mode = mode.parent;
                }
                return mode;
              }
            }
            if (mode.endsWithParent) {
              return endOfMode(mode.parent, match, matchPlusRemainder);
            }
          }
          function doIgnore(lexeme) {
            if (top.matcher.regexIndex === 0) {
              modeBuffer += lexeme[0];
              return 1;
            } else {
              resumeScanAtSamePosition = true;
              return 0;
            }
          }
          function doBeginMatch(match) {
            const lexeme = match[0];
            const newMode = match.rule;
            const resp = new Response(newMode);
            const beforeCallbacks = [newMode.__beforeBegin, newMode["on:begin"]];
            for (const cb of beforeCallbacks) {
              if (!cb) continue;
              cb(match, resp);
              if (resp.isMatchIgnored) return doIgnore(lexeme);
            }
            if (newMode.skip) {
              modeBuffer += lexeme;
            } else {
              if (newMode.excludeBegin) {
                modeBuffer += lexeme;
              }
              processBuffer();
              if (!newMode.returnBegin && !newMode.excludeBegin) {
                modeBuffer = lexeme;
              }
            }
            startNewMode(newMode, match);
            return newMode.returnBegin ? 0 : lexeme.length;
          }
          function doEndMatch(match) {
            const lexeme = match[0];
            const matchPlusRemainder = codeToHighlight.substring(match.index);
            const endMode = endOfMode(top, match, matchPlusRemainder);
            if (!endMode) {
              return NO_MATCH;
            }
            const origin = top;
            if (top.endScope && top.endScope._wrap) {
              processBuffer();
              emitKeyword(lexeme, top.endScope._wrap);
            } else if (top.endScope && top.endScope._multi) {
              processBuffer();
              emitMultiClass(top.endScope, match);
            } else if (origin.skip) {
              modeBuffer += lexeme;
            } else {
              if (!(origin.returnEnd || origin.excludeEnd)) {
                modeBuffer += lexeme;
              }
              processBuffer();
              if (origin.excludeEnd) {
                modeBuffer = lexeme;
              }
            }
            do {
              if (top.scope) {
                emitter.closeNode();
              }
              if (!top.skip && !top.subLanguage) {
                relevance += top.relevance;
              }
              top = top.parent;
            } while (top !== endMode.parent);
            if (endMode.starts) {
              startNewMode(endMode.starts, match);
            }
            return origin.returnEnd ? 0 : lexeme.length;
          }
          function processContinuations() {
            const list = [];
            for (let current = top; current !== language; current = current.parent) {
              if (current.scope) {
                list.unshift(current.scope);
              }
            }
            list.forEach((item) => emitter.openNode(item));
          }
          let lastMatch = {};
          function processLexeme(textBeforeMatch, match) {
            const lexeme = match && match[0];
            modeBuffer += textBeforeMatch;
            if (lexeme == null) {
              processBuffer();
              return 0;
            }
            if (lastMatch.type === "begin" && match.type === "end" && lastMatch.index === match.index && lexeme === "") {
              modeBuffer += codeToHighlight.slice(match.index, match.index + 1);
              if (!SAFE_MODE) {
                const err = new Error(`0 width match regex (${languageName})`);
                err.languageName = languageName;
                err.badRule = lastMatch.rule;
                throw err;
              }
              return 1;
            }
            lastMatch = match;
            if (match.type === "begin") {
              return doBeginMatch(match);
            } else if (match.type === "illegal" && !ignoreIllegals) {
              const err = new Error('Illegal lexeme "' + lexeme + '" for mode "' + (top.scope || "<unnamed>") + '"');
              err.mode = top;
              throw err;
            } else if (match.type === "end") {
              const processed = doEndMatch(match);
              if (processed !== NO_MATCH) {
                return processed;
              }
            }
            if (match.type === "illegal" && lexeme === "") {
              if (match.index === codeToHighlight.length) ;
              else {
                modeBuffer += "\n";
              }
              return 1;
            }
            if (iterations > 1e5 && iterations > match.index * 3) {
              const err = new Error("potential infinite loop, way more iterations than matches");
              throw err;
            }
            modeBuffer += lexeme;
            return lexeme.length;
          }
          const language = getLanguage(languageName);
          if (!language) {
            error(LANGUAGE_NOT_FOUND.replace("{}", languageName));
            throw new Error('Unknown language: "' + languageName + '"');
          }
          const md = compileLanguage(language);
          let result = "";
          let top = continuation || md;
          const continuations = {};
          const emitter = new options.__emitter(options);
          processContinuations();
          let modeBuffer = "";
          let relevance = 0;
          let index = 0;
          let iterations = 0;
          let resumeScanAtSamePosition = false;
          try {
            if (!language.__emitTokens) {
              top.matcher.considerAll();
              for (; ; ) {
                iterations++;
                if (resumeScanAtSamePosition) {
                  resumeScanAtSamePosition = false;
                } else {
                  top.matcher.considerAll();
                }
                top.matcher.lastIndex = index;
                const match = top.matcher.exec(codeToHighlight);
                if (!match) break;
                const beforeMatch = codeToHighlight.substring(index, match.index);
                const processedCount = processLexeme(beforeMatch, match);
                index = match.index + processedCount;
              }
              processLexeme(codeToHighlight.substring(index));
            } else {
              language.__emitTokens(codeToHighlight, emitter);
            }
            emitter.finalize();
            result = emitter.toHTML();
            return {
              language: languageName,
              value: result,
              relevance,
              illegal: false,
              _emitter: emitter,
              _top: top
            };
          } catch (err) {
            if (err.message && err.message.includes("Illegal")) {
              return {
                language: languageName,
                value: escape(codeToHighlight),
                illegal: true,
                relevance: 0,
                _illegalBy: {
                  message: err.message,
                  index,
                  context: codeToHighlight.slice(index - 100, index + 100),
                  mode: err.mode,
                  resultSoFar: result
                },
                _emitter: emitter
              };
            } else if (SAFE_MODE) {
              return {
                language: languageName,
                value: escape(codeToHighlight),
                illegal: false,
                relevance: 0,
                errorRaised: err,
                _emitter: emitter,
                _top: top
              };
            } else {
              throw err;
            }
          }
        }
        function justTextHighlightResult(code) {
          const result = {
            value: escape(code),
            illegal: false,
            relevance: 0,
            _top: PLAINTEXT_LANGUAGE,
            _emitter: new options.__emitter(options)
          };
          result._emitter.addText(code);
          return result;
        }
        function highlightAuto(code, languageSubset) {
          languageSubset = languageSubset || options.languages || Object.keys(languages);
          const plaintext = justTextHighlightResult(code);
          const results2 = languageSubset.filter(getLanguage).filter(autoDetection).map(
            (name) => _highlight(name, code, false)
          );
          results2.unshift(plaintext);
          const sorted = results2.sort((a, b) => {
            if (a.relevance !== b.relevance) return b.relevance - a.relevance;
            if (a.language && b.language) {
              if (getLanguage(a.language).supersetOf === b.language) {
                return 1;
              } else if (getLanguage(b.language).supersetOf === a.language) {
                return -1;
              }
            }
            return 0;
          });
          const [best, secondBest] = sorted;
          const result = best;
          result.secondBest = secondBest;
          return result;
        }
        function updateClassName(element, currentLang, resultLang) {
          const language = currentLang && aliases[currentLang] || resultLang;
          element.classList.add("hljs");
          element.classList.add(`language-${language}`);
        }
        function highlightElement(element) {
          let node = null;
          const language = blockLanguage(element);
          if (shouldNotHighlight(language)) return;
          fire(
            "before:highlightElement",
            { el: element, language }
          );
          if (element.dataset.highlighted) {
            console.log("Element previously highlighted. To highlight again, first unset `dataset.highlighted`.", element);
            return;
          }
          if (element.children.length > 0) {
            if (!options.ignoreUnescapedHTML) {
              console.warn("One of your code blocks includes unescaped HTML. This is a potentially serious security risk.");
              console.warn("https://github.com/highlightjs/highlight.js/wiki/security");
              console.warn("The element with unescaped HTML:");
              console.warn(element);
            }
            if (options.throwUnescapedHTML) {
              const err = new HTMLInjectionError(
                "One of your code blocks includes unescaped HTML.",
                element.innerHTML
              );
              throw err;
            }
          }
          node = element;
          const text2 = node.textContent;
          const result = language ? highlight2(text2, { language, ignoreIllegals: true }) : highlightAuto(text2);
          element.innerHTML = result.value;
          element.dataset.highlighted = "yes";
          updateClassName(element, language, result.language);
          element.result = {
            language: result.language,
            // TODO: remove with version 11.0
            re: result.relevance,
            relevance: result.relevance
          };
          if (result.secondBest) {
            element.secondBest = {
              language: result.secondBest.language,
              relevance: result.secondBest.relevance
            };
          }
          fire("after:highlightElement", { el: element, result, text: text2 });
        }
        function configure(userOptions) {
          options = inherit(options, userOptions);
        }
        const initHighlighting = () => {
          highlightAll();
          deprecated("10.6.0", "initHighlighting() deprecated.  Use highlightAll() now.");
        };
        function initHighlightingOnLoad() {
          highlightAll();
          deprecated("10.6.0", "initHighlightingOnLoad() deprecated.  Use highlightAll() now.");
        }
        let wantsHighlight = false;
        function highlightAll() {
          function boot() {
            highlightAll();
          }
          if (document.readyState === "loading") {
            if (!wantsHighlight) {
              window.addEventListener("DOMContentLoaded", boot, false);
            }
            wantsHighlight = true;
            return;
          }
          const blocks = document.querySelectorAll(options.cssSelector);
          blocks.forEach(highlightElement);
        }
        function registerLanguage(languageName, languageDefinition) {
          let lang = null;
          try {
            lang = languageDefinition(hljs);
          } catch (error$1) {
            error("Language definition for '{}' could not be registered.".replace("{}", languageName));
            if (!SAFE_MODE) {
              throw error$1;
            } else {
              error(error$1);
            }
            lang = PLAINTEXT_LANGUAGE;
          }
          if (!lang.name) lang.name = languageName;
          languages[languageName] = lang;
          lang.rawDefinition = languageDefinition.bind(null, hljs);
          if (lang.aliases) {
            registerAliases(lang.aliases, { languageName });
          }
        }
        function unregisterLanguage(languageName) {
          delete languages[languageName];
          for (const alias of Object.keys(aliases)) {
            if (aliases[alias] === languageName) {
              delete aliases[alias];
            }
          }
        }
        function listLanguages() {
          return Object.keys(languages);
        }
        function getLanguage(name) {
          name = (name || "").toLowerCase();
          return languages[name] || languages[aliases[name]];
        }
        function registerAliases(aliasList, { languageName }) {
          if (typeof aliasList === "string") {
            aliasList = [aliasList];
          }
          aliasList.forEach((alias) => {
            aliases[alias.toLowerCase()] = languageName;
          });
        }
        function autoDetection(name) {
          const lang = getLanguage(name);
          return lang && !lang.disableAutodetect;
        }
        function upgradePluginAPI(plugin) {
          if (plugin["before:highlightBlock"] && !plugin["before:highlightElement"]) {
            plugin["before:highlightElement"] = (data) => {
              plugin["before:highlightBlock"](
                Object.assign({ block: data.el }, data)
              );
            };
          }
          if (plugin["after:highlightBlock"] && !plugin["after:highlightElement"]) {
            plugin["after:highlightElement"] = (data) => {
              plugin["after:highlightBlock"](
                Object.assign({ block: data.el }, data)
              );
            };
          }
        }
        function addPlugin(plugin) {
          upgradePluginAPI(plugin);
          plugins.push(plugin);
        }
        function removePlugin(plugin) {
          const index = plugins.indexOf(plugin);
          if (index !== -1) {
            plugins.splice(index, 1);
          }
        }
        function fire(event, args) {
          const cb = event;
          plugins.forEach(function(plugin) {
            if (plugin[cb]) {
              plugin[cb](args);
            }
          });
        }
        function deprecateHighlightBlock(el3) {
          deprecated("10.7.0", "highlightBlock will be removed entirely in v12.0");
          deprecated("10.7.0", "Please use highlightElement now.");
          return highlightElement(el3);
        }
        Object.assign(hljs, {
          highlight: highlight2,
          highlightAuto,
          highlightAll,
          highlightElement,
          // TODO: Remove with v12 API
          highlightBlock: deprecateHighlightBlock,
          configure,
          initHighlighting,
          initHighlightingOnLoad,
          registerLanguage,
          unregisterLanguage,
          listLanguages,
          getLanguage,
          registerAliases,
          autoDetection,
          inherit,
          addPlugin,
          removePlugin
        });
        hljs.debugMode = function() {
          SAFE_MODE = false;
        };
        hljs.safeMode = function() {
          SAFE_MODE = true;
        };
        hljs.versionString = version;
        hljs.regex = {
          concat,
          lookahead,
          either,
          optional,
          anyNumberOfTimes
        };
        for (const key in MODES) {
          if (typeof MODES[key] === "object") {
            deepFreeze(MODES[key]);
          }
        }
        Object.assign(hljs, MODES);
        return hljs;
      };
      var highlight = HLJS({});
      highlight.newInstance = () => HLJS({});
      module.exports = highlight;
      highlight.HighlightJS = highlight;
      highlight.default = highlight;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/xml.js
  var require_xml = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/xml.js"(exports, module) {
      function xml(hljs) {
        const regex = hljs.regex;
        const TAG_NAME_RE = regex.concat(/[\p{L}_]/u, regex.optional(/[\p{L}0-9_.-]*:/u), /[\p{L}0-9_.-]*/u);
        const XML_IDENT_RE = /[\p{L}0-9._:-]+/u;
        const XML_ENTITIES = {
          className: "symbol",
          begin: /&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/
        };
        const XML_META_KEYWORDS = {
          begin: /\s/,
          contains: [
            {
              className: "keyword",
              begin: /#?[a-z_][a-z1-9_-]+/,
              illegal: /\n/
            }
          ]
        };
        const XML_META_PAR_KEYWORDS = hljs.inherit(XML_META_KEYWORDS, {
          begin: /\(/,
          end: /\)/
        });
        const APOS_META_STRING_MODE = hljs.inherit(hljs.APOS_STRING_MODE, { className: "string" });
        const QUOTE_META_STRING_MODE = hljs.inherit(hljs.QUOTE_STRING_MODE, { className: "string" });
        const TAG_INTERNALS = {
          endsWithParent: true,
          illegal: /</,
          relevance: 0,
          contains: [
            {
              className: "attr",
              begin: XML_IDENT_RE,
              relevance: 0
            },
            {
              begin: /=\s*/,
              relevance: 0,
              contains: [
                {
                  className: "string",
                  endsParent: true,
                  variants: [
                    {
                      begin: /"/,
                      end: /"/,
                      contains: [XML_ENTITIES]
                    },
                    {
                      begin: /'/,
                      end: /'/,
                      contains: [XML_ENTITIES]
                    },
                    { begin: /[^\s"'=<>`]+/ }
                  ]
                }
              ]
            }
          ]
        };
        return {
          name: "HTML, XML",
          aliases: [
            "html",
            "xhtml",
            "rss",
            "atom",
            "xjb",
            "xsd",
            "xsl",
            "plist",
            "wsf",
            "svg"
          ],
          case_insensitive: true,
          unicodeRegex: true,
          contains: [
            {
              className: "meta",
              begin: /<![a-z]/,
              end: />/,
              relevance: 10,
              contains: [
                XML_META_KEYWORDS,
                QUOTE_META_STRING_MODE,
                APOS_META_STRING_MODE,
                XML_META_PAR_KEYWORDS,
                {
                  begin: /\[/,
                  end: /\]/,
                  contains: [
                    {
                      className: "meta",
                      begin: /<![a-z]/,
                      end: />/,
                      contains: [
                        XML_META_KEYWORDS,
                        XML_META_PAR_KEYWORDS,
                        QUOTE_META_STRING_MODE,
                        APOS_META_STRING_MODE
                      ]
                    }
                  ]
                }
              ]
            },
            hljs.COMMENT(
              /<!--/,
              /-->/,
              { relevance: 10 }
            ),
            {
              begin: /<!\[CDATA\[/,
              end: /\]\]>/,
              relevance: 10
            },
            XML_ENTITIES,
            // xml processing instructions
            {
              className: "meta",
              end: /\?>/,
              variants: [
                {
                  begin: /<\?xml/,
                  relevance: 10,
                  contains: [
                    QUOTE_META_STRING_MODE
                  ]
                },
                {
                  begin: /<\?[a-z][a-z0-9]+/
                }
              ]
            },
            {
              className: "tag",
              /*
              The lookahead pattern (?=...) ensures that 'begin' only matches
              '<style' as a single word, followed by a whitespace or an
              ending bracket.
              */
              begin: /<style(?=\s|>)/,
              end: />/,
              keywords: { name: "style" },
              contains: [TAG_INTERNALS],
              starts: {
                end: /<\/style>/,
                returnEnd: true,
                subLanguage: "css"
              }
            },
            {
              className: "tag",
              // See the comment in the <style tag about the lookahead pattern
              begin: /<script(?=\s|>)/,
              end: />/,
              keywords: { name: "script" },
              contains: [TAG_INTERNALS],
              starts: {
                end: /<\/script>/,
                returnEnd: true,
                subLanguage: "javascript"
              }
            },
            // we need this for now for jSX
            {
              className: "tag",
              begin: /<>|<\/>/
            },
            // open tag
            {
              className: "tag",
              begin: regex.concat(
                /</,
                regex.lookahead(regex.concat(
                  TAG_NAME_RE,
                  // <tag/>
                  // <tag>
                  // <tag ...
                  regex.either(/\/>/, />/, /\s/)
                ))
              ),
              end: /\/?>/,
              contains: [
                {
                  className: "name",
                  begin: TAG_NAME_RE,
                  relevance: 0,
                  starts: TAG_INTERNALS
                }
              ]
            },
            // close tag
            {
              className: "tag",
              begin: regex.concat(
                /<\//,
                regex.lookahead(regex.concat(
                  TAG_NAME_RE,
                  />/
                ))
              ),
              contains: [
                {
                  className: "name",
                  begin: TAG_NAME_RE,
                  relevance: 0
                },
                {
                  begin: />/,
                  relevance: 0,
                  endsParent: true
                }
              ]
            }
          ]
        };
      }
      module.exports = xml;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/bash.js
  var require_bash = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/bash.js"(exports, module) {
      function bash(hljs) {
        const regex = hljs.regex;
        const VAR = {};
        const BRACED_VAR = {
          begin: /\$\{/,
          end: /\}/,
          contains: [
            "self",
            {
              begin: /:-/,
              contains: [VAR]
            }
            // default values
          ]
        };
        Object.assign(VAR, {
          className: "variable",
          variants: [
            { begin: regex.concat(
              /\$[\w\d#@][\w\d_]*/,
              // negative look-ahead tries to avoid matching patterns that are not
              // Perl at all like $ident$, @ident@, etc.
              `(?![\\w\\d])(?![$])`
            ) },
            BRACED_VAR
          ]
        });
        const SUBST = {
          className: "subst",
          begin: /\$\(/,
          end: /\)/,
          contains: [hljs.BACKSLASH_ESCAPE]
        };
        const COMMENT = hljs.inherit(
          hljs.COMMENT(),
          {
            match: [
              /(^|\s)/,
              /#.*$/
            ],
            scope: {
              2: "comment"
            }
          }
        );
        const HERE_DOC = {
          begin: /<<-?\s*(?=\w+)/,
          starts: { contains: [
            hljs.END_SAME_AS_BEGIN({
              begin: /(\w+)/,
              end: /(\w+)/,
              className: "string"
            })
          ] }
        };
        const QUOTE_STRING = {
          className: "string",
          begin: /"/,
          end: /"/,
          contains: [
            hljs.BACKSLASH_ESCAPE,
            VAR,
            SUBST
          ]
        };
        SUBST.contains.push(QUOTE_STRING);
        const ESCAPED_QUOTE = {
          match: /\\"/
        };
        const APOS_STRING = {
          className: "string",
          begin: /'/,
          end: /'/
        };
        const ESCAPED_APOS = {
          match: /\\'/
        };
        const ARITHMETIC = {
          begin: /\$?\(\(/,
          end: /\)\)/,
          contains: [
            {
              begin: /\d+#[0-9a-f]+/,
              className: "number"
            },
            hljs.NUMBER_MODE,
            VAR
          ]
        };
        const SH_LIKE_SHELLS = [
          "fish",
          "bash",
          "zsh",
          "sh",
          "csh",
          "ksh",
          "tcsh",
          "dash",
          "scsh"
        ];
        const KNOWN_SHEBANG = hljs.SHEBANG({
          binary: `(${SH_LIKE_SHELLS.join("|")})`,
          relevance: 10
        });
        const FUNCTION = {
          className: "function",
          begin: /\w[\w\d_]*\s*\(\s*\)\s*\{/,
          returnBegin: true,
          contains: [hljs.inherit(hljs.TITLE_MODE, { begin: /\w[\w\d_]*/ })],
          relevance: 0
        };
        const KEYWORDS = [
          "if",
          "then",
          "else",
          "elif",
          "fi",
          "time",
          "for",
          "while",
          "until",
          "in",
          "do",
          "done",
          "case",
          "esac",
          "coproc",
          "function",
          "select"
        ];
        const LITERALS = [
          "true",
          "false"
        ];
        const PATH_MODE = { match: /(\/[a-z._-]+)+/ };
        const SHELL_BUILT_INS = [
          "break",
          "cd",
          "continue",
          "eval",
          "exec",
          "exit",
          "export",
          "getopts",
          "hash",
          "pwd",
          "readonly",
          "return",
          "shift",
          "test",
          "times",
          "trap",
          "umask",
          "unset"
        ];
        const BASH_BUILT_INS = [
          "alias",
          "bind",
          "builtin",
          "caller",
          "command",
          "declare",
          "echo",
          "enable",
          "help",
          "let",
          "local",
          "logout",
          "mapfile",
          "printf",
          "read",
          "readarray",
          "source",
          "sudo",
          "type",
          "typeset",
          "ulimit",
          "unalias"
        ];
        const ZSH_BUILT_INS = [
          "autoload",
          "bg",
          "bindkey",
          "bye",
          "cap",
          "chdir",
          "clone",
          "comparguments",
          "compcall",
          "compctl",
          "compdescribe",
          "compfiles",
          "compgroups",
          "compquote",
          "comptags",
          "comptry",
          "compvalues",
          "dirs",
          "disable",
          "disown",
          "echotc",
          "echoti",
          "emulate",
          "fc",
          "fg",
          "float",
          "functions",
          "getcap",
          "getln",
          "history",
          "integer",
          "jobs",
          "kill",
          "limit",
          "log",
          "noglob",
          "popd",
          "print",
          "pushd",
          "pushln",
          "rehash",
          "sched",
          "setcap",
          "setopt",
          "stat",
          "suspend",
          "ttyctl",
          "unfunction",
          "unhash",
          "unlimit",
          "unsetopt",
          "vared",
          "wait",
          "whence",
          "where",
          "which",
          "zcompile",
          "zformat",
          "zftp",
          "zle",
          "zmodload",
          "zparseopts",
          "zprof",
          "zpty",
          "zregexparse",
          "zsocket",
          "zstyle",
          "ztcp"
        ];
        const GNU_CORE_UTILS = [
          "chcon",
          "chgrp",
          "chown",
          "chmod",
          "cp",
          "dd",
          "df",
          "dir",
          "dircolors",
          "ln",
          "ls",
          "mkdir",
          "mkfifo",
          "mknod",
          "mktemp",
          "mv",
          "realpath",
          "rm",
          "rmdir",
          "shred",
          "sync",
          "touch",
          "truncate",
          "vdir",
          "b2sum",
          "base32",
          "base64",
          "cat",
          "cksum",
          "comm",
          "csplit",
          "cut",
          "expand",
          "fmt",
          "fold",
          "head",
          "join",
          "md5sum",
          "nl",
          "numfmt",
          "od",
          "paste",
          "ptx",
          "pr",
          "sha1sum",
          "sha224sum",
          "sha256sum",
          "sha384sum",
          "sha512sum",
          "shuf",
          "sort",
          "split",
          "sum",
          "tac",
          "tail",
          "tr",
          "tsort",
          "unexpand",
          "uniq",
          "wc",
          "arch",
          "basename",
          "chroot",
          "date",
          "dirname",
          "du",
          "echo",
          "env",
          "expr",
          "factor",
          // "false", // keyword literal already
          "groups",
          "hostid",
          "id",
          "link",
          "logname",
          "nice",
          "nohup",
          "nproc",
          "pathchk",
          "pinky",
          "printenv",
          "printf",
          "pwd",
          "readlink",
          "runcon",
          "seq",
          "sleep",
          "stat",
          "stdbuf",
          "stty",
          "tee",
          "test",
          "timeout",
          // "true", // keyword literal already
          "tty",
          "uname",
          "unlink",
          "uptime",
          "users",
          "who",
          "whoami",
          "yes"
        ];
        return {
          name: "Bash",
          aliases: [
            "sh",
            "zsh"
          ],
          keywords: {
            $pattern: /\b[a-z][a-z0-9._-]+\b/,
            keyword: KEYWORDS,
            literal: LITERALS,
            built_in: [
              ...SHELL_BUILT_INS,
              ...BASH_BUILT_INS,
              // Shell modifiers
              "set",
              "shopt",
              ...ZSH_BUILT_INS,
              ...GNU_CORE_UTILS
            ]
          },
          contains: [
            KNOWN_SHEBANG,
            // to catch known shells and boost relevancy
            hljs.SHEBANG(),
            // to catch unknown shells but still highlight the shebang
            FUNCTION,
            ARITHMETIC,
            COMMENT,
            HERE_DOC,
            PATH_MODE,
            QUOTE_STRING,
            ESCAPED_QUOTE,
            APOS_STRING,
            ESCAPED_APOS,
            VAR
          ]
        };
      }
      module.exports = bash;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/c.js
  var require_c = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/c.js"(exports, module) {
      function c(hljs) {
        const regex = hljs.regex;
        const C_LINE_COMMENT_MODE = hljs.COMMENT("//", "$", { contains: [{ begin: /\\\n/ }] });
        const DECLTYPE_AUTO_RE = "decltype\\(auto\\)";
        const NAMESPACE_RE = "[a-zA-Z_]\\w*::";
        const TEMPLATE_ARGUMENT_RE = "<[^<>]+>";
        const FUNCTION_TYPE_RE = "(" + DECLTYPE_AUTO_RE + "|" + regex.optional(NAMESPACE_RE) + "[a-zA-Z_]\\w*" + regex.optional(TEMPLATE_ARGUMENT_RE) + ")";
        const ATOMIC_TYPES = regex.concat(/\batomic_/, regex.either(
          "bool",
          "char",
          "schar",
          "uchar",
          "short",
          "ushort",
          "int",
          "uint",
          "long",
          "ulong",
          "llong",
          "ullong",
          "char16_t",
          "char32_t",
          "wchar_t",
          "int_least8_t",
          "uint_least8_t",
          "int_least16_t",
          "uint_least16_t",
          "int_least32_t",
          "uint_least32_t",
          "int_least64_t",
          "uint_least64_t",
          "int_fast8_t",
          "uint_fast8_t",
          "int_fast16_t",
          "uint_fast16_t",
          "int_fast32_t",
          "uint_fast32_t",
          "int_fast64_t",
          "uint_fast64_t",
          "intptr_t",
          "uintptr_t",
          "size_t",
          "ptrdiff_t",
          "intmax_t",
          "uintmax_t"
        ), /\b/);
        const TYPES = {
          className: "type",
          variants: [
            { begin: "\\b[a-z\\d_]*_t\\b" },
            { match: ATOMIC_TYPES }
          ]
        };
        const CHARACTER_ESCAPES = "\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)";
        const STRINGS = {
          className: "string",
          variants: [
            {
              begin: '(u8?|U|L)?"',
              end: '"',
              illegal: "\\n",
              contains: [hljs.BACKSLASH_ESCAPE]
            },
            {
              begin: "(u8?|U|L)?'(" + CHARACTER_ESCAPES + "|.)",
              end: "'",
              illegal: "."
            },
            // https://en.cppreference.com/w/cpp/language/string_literal
            // a d-char-sequence never contains parentheses, backslashes or whitespace;
            // quotes are excluded as well so the closing delimiter cannot swallow the
            // quote that actually terminates the literal
            hljs.END_SAME_AS_BEGIN({
              begin: /(?:u8?|U|L)?R"([^()\\\s"]{0,16})\(/,
              end: /\)([^()\\\s"]{0,16})"/
            })
          ]
        };
        const NUMBERS = {
          className: "number",
          variants: [
            { match: /\b(0b[01']+)/ },
            { match: /(-?)\b([\d']+(\.[\d']*)?|\.[\d']+)((ll|LL|l|L)(u|U)?|(u|U)(ll|LL|l|L)?|f|F|b|B)/ },
            { match: /(-?)\b(0[xX][a-fA-F0-9]+(?:'[a-fA-F0-9]+)*(?:\.[a-fA-F0-9]*(?:'[a-fA-F0-9]*)*)?(?:[pP][-+]?[0-9]+)?(l|L)?(u|U)?)/ },
            { match: /(-?)\b\d+(?:'\d+)*(?:\.\d*(?:'\d*)*)?(?:[eE][-+]?\d+)?/ }
          ],
          relevance: 0
        };
        const PREPROCESSOR_INCLUDE = {
          scope: "meta",
          begin: /#\s*include\b/,
          end: /$/,
          keywords: { keyword: "include" },
          contains: [
            {
              // the `\` at the end of a line signaling continuation
              begin: /\\\n/
            },
            STRINGS,
            {
              scope: "string",
              begin: /<.*?>/
            },
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE
          ]
        };
        const PREPROCESSOR = {
          className: "meta",
          begin: /#\s*[a-z]+\b/,
          end: /$/,
          keywords: { keyword: "if else elif endif define undef warning error line pragma _Pragma ifdef ifndef elifdef elifndef include" },
          contains: [
            {
              begin: /\\\n/,
              relevance: 0
            },
            hljs.inherit(STRINGS, { className: "string" }),
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE
          ]
        };
        const PREPROCESSORS = [
          PREPROCESSOR_INCLUDE,
          PREPROCESSOR
        ];
        const TITLE_MODE = {
          className: "title",
          begin: regex.optional(NAMESPACE_RE) + hljs.IDENT_RE,
          relevance: 0
        };
        const FUNCTION_TITLE = regex.optional(NAMESPACE_RE) + hljs.IDENT_RE + "\\s*\\(";
        const MAX_FUNCTION_TYPE_TOKENS = 12;
        const C_KEYWORDS = [
          "asm",
          "auto",
          "break",
          "case",
          "continue",
          "default",
          "do",
          "else",
          "enum",
          "extern",
          "for",
          "fortran",
          "goto",
          "if",
          "inline",
          "register",
          "restrict",
          "return",
          "sizeof",
          "typeof",
          "typeof_unqual",
          "struct",
          "switch",
          "typedef",
          "union",
          "volatile",
          "while",
          "_Alignas",
          "_Alignof",
          "_Atomic",
          "_Generic",
          "_Noreturn",
          "_Static_assert",
          "_Thread_local",
          // aliases
          "alignas",
          "alignof",
          "noreturn",
          "static_assert",
          "thread_local",
          // not a C keyword but is, for all intents and purposes, treated exactly like one.
          "_Pragma"
        ];
        const C_TYPES = [
          "float",
          "double",
          "signed",
          "unsigned",
          "int",
          "short",
          "long",
          "char",
          "void",
          "_Bool",
          "_BitInt",
          "_Complex",
          "_Imaginary",
          "_Decimal32",
          "_Decimal64",
          "_Decimal96",
          "_Decimal128",
          "_Decimal64x",
          "_Decimal128x",
          "_Float16",
          "_Float32",
          "_Float64",
          "_Float128",
          "_Float32x",
          "_Float64x",
          "_Float128x",
          // modifiers
          "const",
          "static",
          "constexpr",
          // aliases
          "complex",
          "bool",
          "imaginary"
        ];
        const KEYWORDS = {
          keyword: C_KEYWORDS,
          type: C_TYPES,
          literal: "true false NULL",
          // TODO: apply hinting work similar to what was done in cpp.js
          built_in: "std string wstring cin cout cerr clog stdin stdout stderr stringstream istringstream ostringstream auto_ptr deque list queue stack vector map set pair bitset multiset multimap unordered_set unordered_map unordered_multiset unordered_multimap priority_queue make_pair array shared_ptr abort terminate abs acos asin atan2 atan calloc ceil cosh cos exit exp fabs floor fmod fprintf fputs free frexp fscanf future isalnum isalpha iscntrl isdigit isgraph islower isprint ispunct isspace isupper isxdigit tolower toupper labs ldexp log10 log malloc realloc memchr memcmp memcpy memset modf pow printf putchar puts scanf sinh sin snprintf sprintf sqrt sscanf strcat strchr strcmp strcpy strcspn strlen strncat strncmp strncpy strpbrk strrchr strspn strstr tanh tan vfprintf vprintf vsprintf endl initializer_list unique_ptr"
        };
        const EXPRESSION_CONTAINS = [
          ...PREPROCESSORS,
          TYPES,
          C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          NUMBERS,
          STRINGS
        ];
        const EXPRESSION_CONTEXT = {
          // This mode covers expression context where we can't expect a function
          // definition and shouldn't highlight anything that looks like one:
          // `return some()`, `else if()`, `(x*sum(1, 2))`
          variants: [
            {
              begin: /=/,
              end: /;/
            },
            {
              begin: /\(/,
              end: /\)/
            },
            {
              beginKeywords: "new throw return else",
              end: /;/
            }
          ],
          keywords: KEYWORDS,
          contains: EXPRESSION_CONTAINS.concat([
            {
              begin: /\(/,
              end: /\)/,
              keywords: KEYWORDS,
              contains: EXPRESSION_CONTAINS.concat(["self"]),
              relevance: 0
            }
          ]),
          relevance: 0
        };
        const FUNCTION_DECLARATION = {
          begin: "(" + FUNCTION_TYPE_RE + "[\\*&\\s]+){1," + MAX_FUNCTION_TYPE_TOKENS + "}" + FUNCTION_TITLE,
          returnBegin: true,
          end: /[{;=]/,
          excludeEnd: true,
          keywords: KEYWORDS,
          illegal: /[^\w\s\*&:<>.]/,
          contains: [
            {
              // to prevent it from being confused as the function title
              begin: DECLTYPE_AUTO_RE,
              keywords: KEYWORDS,
              relevance: 0
            },
            {
              begin: FUNCTION_TITLE,
              returnBegin: true,
              contains: [hljs.inherit(TITLE_MODE, { className: "title.function" })],
              relevance: 0
            },
            // allow for multiple declarations, e.g.:
            // extern void f(int), g(char);
            {
              relevance: 0,
              match: /,/
            },
            {
              className: "params",
              begin: /\(/,
              end: /\)/,
              keywords: KEYWORDS,
              relevance: 0,
              contains: [
                C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE,
                STRINGS,
                NUMBERS,
                TYPES,
                // Count matching parentheses.
                {
                  begin: /\(/,
                  end: /\)/,
                  keywords: KEYWORDS,
                  relevance: 0,
                  contains: [
                    "self",
                    C_LINE_COMMENT_MODE,
                    hljs.C_BLOCK_COMMENT_MODE,
                    STRINGS,
                    NUMBERS,
                    TYPES
                  ]
                }
              ]
            },
            TYPES,
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            ...PREPROCESSORS
          ]
        };
        return {
          name: "C",
          aliases: ["h"],
          keywords: KEYWORDS,
          // Until differentiations are added between `c` and `cpp`, `c` will
          // not be auto-detected to avoid auto-detect conflicts between C and C++
          disableAutodetect: true,
          illegal: "</",
          contains: [].concat(
            EXPRESSION_CONTEXT,
            FUNCTION_DECLARATION,
            EXPRESSION_CONTAINS,
            [
              ...PREPROCESSORS,
              {
                begin: hljs.IDENT_RE + "::",
                keywords: KEYWORDS
              },
              {
                className: "class",
                beginKeywords: "enum class struct union",
                end: /[{;:<>=]/,
                contains: [
                  { beginKeywords: "final class struct" },
                  hljs.TITLE_MODE
                ]
              }
            ]
          ),
          exports: {
            preprocessor: PREPROCESSOR,
            strings: STRINGS,
            keywords: KEYWORDS
          }
        };
      }
      module.exports = c;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/cpp.js
  var require_cpp = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/cpp.js"(exports, module) {
      function cpp(hljs) {
        const regex = hljs.regex;
        const C_LINE_COMMENT_MODE = hljs.COMMENT("//", "$", { contains: [{ begin: /\\\n/ }] });
        const DECLTYPE_AUTO_RE = "decltype\\(auto\\)";
        const NAMESPACE_RE = "[a-zA-Z_]\\w*::";
        const TEMPLATE_ARGUMENT_RE = "<[^<>]+>";
        const FUNCTION_TYPE_RE = "(?!struct)(" + DECLTYPE_AUTO_RE + "|" + regex.optional(NAMESPACE_RE) + "[a-zA-Z_]\\w*" + regex.optional(TEMPLATE_ARGUMENT_RE) + ")";
        const CPP_PRIMITIVE_TYPES = {
          className: "type",
          begin: "\\b[a-z\\d_]*_t\\b"
        };
        const CHARACTER_ESCAPES = "\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)";
        const STRINGS = {
          className: "string",
          variants: [
            {
              begin: '(u8?|U|L)?"',
              end: '"',
              illegal: "\\n",
              contains: [hljs.BACKSLASH_ESCAPE]
            },
            {
              begin: "(u8?|U|L)?'(" + CHARACTER_ESCAPES + "|.)",
              end: "'",
              illegal: "."
            },
            // https://en.cppreference.com/w/cpp/language/string_literal
            // a d-char-sequence never contains parentheses, backslashes or whitespace;
            // quotes are excluded as well so the closing delimiter cannot swallow the
            // quote that actually terminates the literal
            hljs.END_SAME_AS_BEGIN({
              begin: /(?:u8?|U|L)?R"([^()\\\s"]{0,16})\(/,
              end: /\)([^()\\\s"]{0,16})"/
            })
          ]
        };
        const NUMBERS = {
          className: "number",
          variants: [
            // Floating-point literal.
            {
              begin: "[+-]?(?:(?:\\b[0-9](?:'?[0-9])*\\.(?:[0-9](?:'?[0-9])*)?|\\.[0-9](?:'?[0-9])*)(?:[Ee][+-]?[0-9](?:'?[0-9])*)?|\\b[0-9](?:'?[0-9])*[Ee][+-]?[0-9](?:'?[0-9])*|\\b0[Xx](?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*(?:\\.(?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)?)?|\\.[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)[Pp][+-]?[0-9](?:'?[0-9])*)(?:[Ff](?:16|32|64|128)?|(BF|bf)16|[Ll]|)"
            },
            // Integer literal.
            {
              begin: "[+-]?\\b(?:0[Bb][01](?:'?[01])*|0[Xx][0-9A-Fa-f](?:'?[0-9A-Fa-f])*|0(?:'?[0-7])*|[1-9](?:'?[0-9])*)(?:[Uu](?:LL?|ll?)|[Uu][Zz]?|(?:LL?|ll?)[Uu]?|[Zz][Uu]|)"
              // Note: there are user-defined literal suffixes too, but perhaps having the custom suffix not part of the
              // literal highlight actually makes it stand out more.
            }
          ],
          relevance: 0
        };
        const PREPROCESSOR_INCLUDE = {
          scope: "meta",
          begin: /#\s*include\b/,
          end: /$/,
          keywords: { keyword: "include" },
          contains: [
            {
              // the `\` at the end of a line signaling continuation
              begin: /\\\n/
            },
            STRINGS,
            {
              scope: "string",
              begin: /<.*?>/
            },
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE
          ]
        };
        const PREPROCESSOR = {
          className: "meta",
          begin: /#\s*[a-z]+\b/,
          end: /$/,
          keywords: { keyword: "if else elif endif define undef warning error line pragma _Pragma ifdef ifndef include" },
          contains: [
            {
              begin: /\\\n/,
              relevance: 0
            },
            hljs.inherit(STRINGS, { className: "string" }),
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE
          ]
        };
        const PREPROCESSORS = [
          PREPROCESSOR_INCLUDE,
          PREPROCESSOR
        ];
        const TITLE_MODE = {
          className: "title",
          begin: regex.optional(NAMESPACE_RE) + hljs.IDENT_RE,
          relevance: 0
        };
        const FUNCTION_TITLE = regex.optional(NAMESPACE_RE) + hljs.IDENT_RE + "\\s*\\(";
        const MAX_FUNCTION_TYPE_TOKENS = 12;
        const RESERVED_KEYWORDS = [
          "alignas",
          "alignof",
          "and",
          "and_eq",
          "asm",
          "atomic_cancel",
          "atomic_commit",
          "atomic_noexcept",
          "auto",
          "bitand",
          "bitor",
          "break",
          "case",
          "catch",
          "class",
          "co_await",
          "co_return",
          "co_yield",
          "compl",
          "concept",
          "const_cast|10",
          "consteval",
          "constexpr",
          "constinit",
          "continue",
          "decltype",
          "default",
          "delete",
          "do",
          "dynamic_cast|10",
          "else",
          "enum",
          "explicit",
          "export",
          "extern",
          "false",
          "final",
          "for",
          "friend",
          "goto",
          "if",
          "import",
          "inline",
          "module",
          "mutable",
          "namespace",
          "new",
          "noexcept",
          "not",
          "not_eq",
          "nullptr",
          "operator",
          "or",
          "or_eq",
          "override",
          "private",
          "protected",
          "public",
          "reflexpr",
          "register",
          "reinterpret_cast|10",
          "requires",
          "return",
          "sizeof",
          "static_assert",
          "static_cast|10",
          "struct",
          "switch",
          "synchronized",
          "template",
          "this",
          "thread_local",
          "throw",
          "transaction_safe",
          "transaction_safe_dynamic",
          "true",
          "try",
          "typedef",
          "typeid",
          "typename",
          "union",
          "using",
          "virtual",
          "volatile",
          "while",
          "xor",
          "xor_eq"
        ];
        const RESERVED_TYPES = [
          "bool",
          "char",
          "char16_t",
          "char32_t",
          "char8_t",
          "double",
          "float",
          "int",
          "long",
          "short",
          "void",
          "wchar_t",
          "unsigned",
          "signed",
          "const",
          "static"
        ];
        const TYPE_HINTS = [
          "any",
          "auto_ptr",
          "barrier",
          "binary_semaphore",
          "bitset",
          "complex",
          "condition_variable",
          "condition_variable_any",
          "counting_semaphore",
          "deque",
          "false_type",
          "flat_map",
          "flat_set",
          "future",
          "imaginary",
          "initializer_list",
          "istringstream",
          "jthread",
          "latch",
          "lock_guard",
          "multimap",
          "multiset",
          "mutex",
          "optional",
          "ostringstream",
          "packaged_task",
          "pair",
          "promise",
          "priority_queue",
          "queue",
          "recursive_mutex",
          "recursive_timed_mutex",
          "scoped_lock",
          "set",
          "shared_future",
          "shared_lock",
          "shared_mutex",
          "shared_timed_mutex",
          "shared_ptr",
          "stack",
          "string_view",
          "stringstream",
          "timed_mutex",
          "thread",
          "true_type",
          "tuple",
          "unique_lock",
          "unique_ptr",
          "unordered_map",
          "unordered_multimap",
          "unordered_multiset",
          "unordered_set",
          "variant",
          "vector",
          "weak_ptr",
          "wstring",
          "wstring_view"
        ];
        const FUNCTION_HINTS = [
          "abort",
          "abs",
          "acos",
          "apply",
          "as_const",
          "asin",
          "atan",
          "atan2",
          "calloc",
          "ceil",
          "cerr",
          "cin",
          "clog",
          "cos",
          "cosh",
          "cout",
          "declval",
          "endl",
          "exchange",
          "exit",
          "exp",
          "fabs",
          "floor",
          "fmod",
          "forward",
          "fprintf",
          "fputs",
          "free",
          "frexp",
          "fscanf",
          "future",
          "invoke",
          "isalnum",
          "isalpha",
          "iscntrl",
          "isdigit",
          "isgraph",
          "islower",
          "isprint",
          "ispunct",
          "isspace",
          "isupper",
          "isxdigit",
          "labs",
          "launder",
          "ldexp",
          "log",
          "log10",
          "make_pair",
          "make_shared",
          "make_shared_for_overwrite",
          "make_tuple",
          "make_unique",
          "malloc",
          "memchr",
          "memcmp",
          "memcpy",
          "memset",
          "modf",
          "move",
          "pow",
          "printf",
          "putchar",
          "puts",
          "realloc",
          "scanf",
          "sin",
          "sinh",
          "snprintf",
          "sprintf",
          "sqrt",
          "sscanf",
          "std",
          "stderr",
          "stdin",
          "stdout",
          "strcat",
          "strchr",
          "strcmp",
          "strcpy",
          "strcspn",
          "strlen",
          "strncat",
          "strncmp",
          "strncpy",
          "strpbrk",
          "strrchr",
          "strspn",
          "strstr",
          "swap",
          "tan",
          "tanh",
          "terminate",
          "to_underlying",
          "tolower",
          "toupper",
          "vfprintf",
          "visit",
          "vprintf",
          "vsprintf"
        ];
        const LITERALS = [
          "NULL",
          "false",
          "nullopt",
          "nullptr",
          "true"
        ];
        const BUILT_IN = ["_Pragma"];
        const CPP_KEYWORDS = {
          type: RESERVED_TYPES,
          keyword: RESERVED_KEYWORDS,
          literal: LITERALS,
          built_in: BUILT_IN,
          _type_hints: TYPE_HINTS
        };
        const FUNCTION_DISPATCH = {
          className: "function.dispatch",
          relevance: 0,
          keywords: {
            // Only for relevance, not highlighting.
            _hint: FUNCTION_HINTS
          },
          begin: regex.concat(
            /\b/,
            `(?!${RESERVED_KEYWORDS.join("|")})`,
            hljs.IDENT_RE,
            regex.lookahead(/(<[^<>]+>|)\s*\(/)
          )
        };
        const EXPRESSION_CONTAINS = [
          FUNCTION_DISPATCH,
          ...PREPROCESSORS,
          CPP_PRIMITIVE_TYPES,
          C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          NUMBERS,
          STRINGS
        ];
        const EXPRESSION_CONTEXT = {
          // This mode covers expression context where we can't expect a function
          // definition and shouldn't highlight anything that looks like one:
          // `return some()`, `else if()`, `(x*sum(1, 2))`
          variants: [
            {
              begin: /=/,
              end: /;/
            },
            {
              begin: /\(/,
              end: /\)/
            },
            {
              beginKeywords: "new throw return else",
              end: /;/
            }
          ],
          keywords: CPP_KEYWORDS,
          contains: EXPRESSION_CONTAINS.concat([
            {
              begin: /\(/,
              end: /\)/,
              keywords: CPP_KEYWORDS,
              contains: EXPRESSION_CONTAINS.concat(["self"]),
              relevance: 0
            }
          ]),
          relevance: 0
        };
        const FUNCTION_DECLARATION = {
          className: "function",
          begin: "(" + FUNCTION_TYPE_RE + "[\\*&\\s]+){1," + MAX_FUNCTION_TYPE_TOKENS + "}" + FUNCTION_TITLE,
          returnBegin: true,
          end: /[{;=]/,
          excludeEnd: true,
          keywords: CPP_KEYWORDS,
          illegal: /[^\w\s\*&:<>.]/,
          contains: [
            {
              // to prevent it from being confused as the function title
              begin: DECLTYPE_AUTO_RE,
              keywords: CPP_KEYWORDS,
              relevance: 0
            },
            {
              begin: FUNCTION_TITLE,
              returnBegin: true,
              contains: [TITLE_MODE],
              relevance: 0
            },
            // needed because we do not have look-behind on the below rule
            // to prevent it from grabbing the final : in a :: pair
            {
              begin: /::/,
              relevance: 0
            },
            // initializers
            {
              begin: /:/,
              endsWithParent: true,
              contains: [
                STRINGS,
                NUMBERS
              ]
            },
            // allow for multiple declarations, e.g.:
            // extern void f(int), g(char);
            {
              relevance: 0,
              match: /,/
            },
            {
              className: "params",
              begin: /\(/,
              end: /\)/,
              keywords: CPP_KEYWORDS,
              relevance: 0,
              contains: [
                C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE,
                STRINGS,
                NUMBERS,
                CPP_PRIMITIVE_TYPES,
                // Count matching parentheses.
                {
                  begin: /\(/,
                  end: /\)/,
                  keywords: CPP_KEYWORDS,
                  relevance: 0,
                  contains: [
                    "self",
                    C_LINE_COMMENT_MODE,
                    hljs.C_BLOCK_COMMENT_MODE,
                    STRINGS,
                    NUMBERS,
                    CPP_PRIMITIVE_TYPES
                  ]
                }
              ]
            },
            CPP_PRIMITIVE_TYPES,
            C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            ...PREPROCESSORS
          ]
        };
        return {
          name: "C++",
          aliases: [
            "cc",
            "c++",
            "h++",
            "hpp",
            "hh",
            "hxx",
            "cxx"
          ],
          keywords: CPP_KEYWORDS,
          illegal: "</",
          classNameAliases: { "function.dispatch": "built_in" },
          contains: [].concat(
            EXPRESSION_CONTEXT,
            FUNCTION_DECLARATION,
            FUNCTION_DISPATCH,
            EXPRESSION_CONTAINS,
            [
              ...PREPROCESSORS,
              {
                // containers: ie, `vector <int> rooms (9);`
                begin: "\\b(deque|list|queue|priority_queue|pair|stack|vector|map|set|bitset|multiset|multimap|unordered_map|unordered_set|unordered_multiset|unordered_multimap|array|tuple|optional|variant|function|flat_map|flat_set)\\s*<(?!<)",
                end: ">",
                keywords: CPP_KEYWORDS,
                contains: [
                  "self",
                  CPP_PRIMITIVE_TYPES
                ]
              },
              {
                begin: hljs.IDENT_RE + "::",
                keywords: CPP_KEYWORDS
              },
              {
                match: [
                  // extra complexity to deal with `enum class` and `enum struct`
                  /\b(?:enum(?:\s+(?:class|struct))?|class|struct|union)/,
                  /\s+/,
                  /\w+/
                ],
                className: {
                  1: "keyword",
                  3: "title.class"
                }
              }
            ]
          )
        };
      }
      module.exports = cpp;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/csharp.js
  var require_csharp = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/csharp.js"(exports, module) {
      function csharp(hljs) {
        const BUILT_IN_KEYWORDS = [
          "bool",
          "byte",
          "char",
          "decimal",
          "delegate",
          "double",
          "dynamic",
          "enum",
          "float",
          "int",
          "long",
          "nint",
          "nuint",
          "object",
          "sbyte",
          "short",
          "string",
          "ulong",
          "uint",
          "ushort"
        ];
        const FUNCTION_MODIFIERS = [
          "public",
          "private",
          "protected",
          "static",
          "internal",
          "protected",
          "abstract",
          "async",
          "extern",
          "override",
          "unsafe",
          "virtual",
          "new",
          "sealed",
          "partial"
        ];
        const LITERAL_KEYWORDS = [
          "default",
          "false",
          "null",
          "true"
        ];
        const NORMAL_KEYWORDS = [
          "abstract",
          "as",
          "base",
          "break",
          "case",
          "catch",
          "class",
          "const",
          "continue",
          "do",
          "else",
          "event",
          "explicit",
          "extern",
          "finally",
          "fixed",
          "for",
          "foreach",
          "goto",
          "if",
          "implicit",
          "in",
          "interface",
          "internal",
          "is",
          "lock",
          "namespace",
          "new",
          "operator",
          "out",
          "override",
          "params",
          "private",
          "protected",
          "public",
          "readonly",
          "record",
          "ref",
          "return",
          "scoped",
          "sealed",
          "sizeof",
          "stackalloc",
          "static",
          "struct",
          "switch",
          "this",
          "throw",
          "try",
          "typeof",
          "unchecked",
          "unsafe",
          "using",
          "virtual",
          "void",
          "volatile",
          "while"
        ];
        const CONTEXTUAL_KEYWORDS = [
          "add",
          "alias",
          "and",
          "ascending",
          "args",
          "async",
          "await",
          "by",
          "descending",
          "dynamic",
          "equals",
          "file",
          "from",
          "get",
          "global",
          "group",
          "init",
          "into",
          "join",
          "let",
          "nameof",
          "not",
          "notnull",
          "on",
          "or",
          "orderby",
          "partial",
          "record",
          "remove",
          "required",
          "scoped",
          "select",
          "set",
          "unmanaged",
          "value|0",
          "var",
          "when",
          "where",
          "with",
          "yield"
        ];
        const KEYWORDS = {
          keyword: NORMAL_KEYWORDS.concat(CONTEXTUAL_KEYWORDS),
          built_in: BUILT_IN_KEYWORDS,
          literal: LITERAL_KEYWORDS
        };
        const TITLE_MODE = hljs.inherit(hljs.TITLE_MODE, { begin: "[a-zA-Z](\\.?\\w)*" });
        const DIGITS = "\\d(_*\\d)*";
        const INTEGER_SUFFIX = "([uU][lL]?|[lL][uU]?)?";
        const REAL_SUFFIX = "([fFdDmM]|[uU][lL]?|[lL][uU]?)?";
        const NUMBERS = {
          className: "number",
          variants: [
            { begin: "\\b0[bB]_*[01](_*[01])*" + INTEGER_SUFFIX },
            { begin: "(-?)\\b0[xX]_*[a-fA-F0-9](_*[a-fA-F0-9])*" + INTEGER_SUFFIX },
            { begin: "(-?)(\\b" + DIGITS + "(\\.(" + DIGITS + ")?)?|\\." + DIGITS + ")([eE][-+]?" + DIGITS + ")?" + REAL_SUFFIX }
          ],
          relevance: 0
        };
        const RAW_STRING = {
          className: "string",
          begin: /"""("*)(?!")(.|\n)*?"""\1/,
          relevance: 1
        };
        const VERBATIM_STRING = {
          className: "string",
          begin: '@"',
          end: '"',
          contains: [{ begin: '""' }]
        };
        const VERBATIM_STRING_NO_LF = hljs.inherit(VERBATIM_STRING, { illegal: /\n/ });
        const SUBST = {
          className: "subst",
          begin: /\{/,
          end: /\}/,
          keywords: KEYWORDS
        };
        const SUBST_NO_LF = hljs.inherit(SUBST, { illegal: /\n/ });
        const INTERPOLATED_STRING = {
          className: "string",
          begin: /\$"/,
          end: '"',
          illegal: /\n/,
          contains: [
            { begin: /\{\{/ },
            { begin: /\}\}/ },
            hljs.BACKSLASH_ESCAPE,
            SUBST_NO_LF
          ]
        };
        const INTERPOLATED_VERBATIM_STRING = {
          className: "string",
          begin: /\$@"/,
          end: '"',
          contains: [
            { begin: /\{\{/ },
            { begin: /\}\}/ },
            { begin: '""' },
            SUBST
          ]
        };
        const INTERPOLATED_VERBATIM_STRING_NO_LF = hljs.inherit(INTERPOLATED_VERBATIM_STRING, {
          illegal: /\n/,
          contains: [
            { begin: /\{\{/ },
            { begin: /\}\}/ },
            { begin: '""' },
            SUBST_NO_LF
          ]
        });
        SUBST.contains = [
          INTERPOLATED_VERBATIM_STRING,
          INTERPOLATED_STRING,
          VERBATIM_STRING,
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          NUMBERS,
          hljs.C_BLOCK_COMMENT_MODE
        ];
        SUBST_NO_LF.contains = [
          INTERPOLATED_VERBATIM_STRING_NO_LF,
          INTERPOLATED_STRING,
          VERBATIM_STRING_NO_LF,
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          NUMBERS,
          hljs.inherit(hljs.C_BLOCK_COMMENT_MODE, { illegal: /\n/ })
        ];
        const STRING = { variants: [
          RAW_STRING,
          INTERPOLATED_VERBATIM_STRING,
          INTERPOLATED_STRING,
          VERBATIM_STRING,
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE
        ] };
        const GENERIC_MODIFIER = {
          begin: "<",
          end: ">",
          contains: [
            { beginKeywords: "in out" },
            TITLE_MODE
          ]
        };
        const TYPE_IDENT_RE = hljs.IDENT_RE + "(<" + hljs.IDENT_RE + "(\\s*,\\s*" + hljs.IDENT_RE + ")*>)?(\\[\\])?";
        const AT_IDENTIFIER = {
          // prevents expressions like `@class` from incorrect flagging
          // `class` as a keyword
          begin: "@" + hljs.IDENT_RE,
          relevance: 0
        };
        return {
          name: "C#",
          aliases: [
            "cs",
            "c#"
          ],
          keywords: KEYWORDS,
          illegal: /::/,
          contains: [
            hljs.COMMENT(
              "///",
              "$",
              {
                returnBegin: true,
                contains: [
                  {
                    className: "doctag",
                    variants: [
                      {
                        begin: "///",
                        relevance: 0
                      },
                      { begin: "<!--|-->" },
                      {
                        begin: "</?",
                        end: ">"
                      }
                    ]
                  }
                ]
              }
            ),
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            {
              className: "meta",
              begin: "#",
              end: "$",
              keywords: { keyword: "if else elif endif define undef warning error line region endregion pragma checksum" }
            },
            STRING,
            NUMBERS,
            {
              beginKeywords: "class interface",
              relevance: 0,
              end: /[{;=]/,
              illegal: /[^\s:,]/,
              contains: [
                { beginKeywords: "where class" },
                TITLE_MODE,
                GENERIC_MODIFIER,
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            {
              beginKeywords: "namespace",
              relevance: 0,
              end: /[{;=]/,
              illegal: /[^\s:]/,
              contains: [
                TITLE_MODE,
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            {
              beginKeywords: "record",
              relevance: 0,
              end: /[{;=]/,
              illegal: /[^\s:]/,
              contains: [
                TITLE_MODE,
                GENERIC_MODIFIER,
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            {
              // [Attributes("")]
              className: "meta",
              begin: "^\\s*\\[(?=[\\w])",
              excludeBegin: true,
              end: "\\]",
              excludeEnd: true,
              contains: [
                {
                  className: "string",
                  begin: /"/,
                  end: /"/
                }
              ]
            },
            {
              // Expression keywords prevent 'keyword Name(...)' from being
              // recognized as a function definition
              beginKeywords: "new return throw await else",
              relevance: 0
            },
            {
              className: "function",
              begin: "(" + TYPE_IDENT_RE + "\\s+)+" + hljs.IDENT_RE + "\\s*(<[^=]+>\\s*)?\\(",
              returnBegin: true,
              end: /\s*[{;=]/,
              excludeEnd: true,
              keywords: KEYWORDS,
              contains: [
                // prevents these from being highlighted `title`
                {
                  beginKeywords: FUNCTION_MODIFIERS.join(" "),
                  relevance: 0
                },
                {
                  begin: hljs.IDENT_RE + "\\s*(<[^=]+>\\s*)?\\(",
                  returnBegin: true,
                  contains: [
                    hljs.TITLE_MODE,
                    GENERIC_MODIFIER
                  ],
                  relevance: 0
                },
                { match: /\(\)/ },
                {
                  className: "params",
                  begin: /\(/,
                  end: /\)/,
                  excludeBegin: true,
                  excludeEnd: true,
                  keywords: KEYWORDS,
                  relevance: 0,
                  contains: [
                    STRING,
                    NUMBERS,
                    hljs.C_BLOCK_COMMENT_MODE
                  ]
                },
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            AT_IDENTIFIER
          ]
        };
      }
      module.exports = csharp;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/css.js
  var require_css = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/css.js"(exports, module) {
      var MODES = (hljs) => {
        return {
          IMPORTANT: {
            scope: "meta",
            begin: "!important"
          },
          BLOCK_COMMENT: hljs.C_BLOCK_COMMENT_MODE,
          HEXCOLOR: {
            scope: "number",
            begin: /#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/
          },
          UNICODE_RANGE: {
            scope: "number",
            begin: /\b[Uu]\+[0-9A-Fa-f][0-9A-Fa-f?]{0,5}(-[0-9A-Fa-f][0-9A-Fa-f]{0,5})?/
          },
          FUNCTION_DISPATCH: {
            className: "built_in",
            begin: /[\w-]+(?=\()/
          },
          ATTRIBUTE_SELECTOR_MODE: {
            scope: "selector-attr",
            begin: /\[/,
            end: /\]/,
            illegal: "$",
            contains: [
              hljs.APOS_STRING_MODE,
              hljs.QUOTE_STRING_MODE
            ]
          },
          CSS_NUMBER_MODE: {
            scope: "number",
            begin: hljs.NUMBER_RE + "(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",
            relevance: 0
          },
          CSS_VARIABLE: {
            className: "attr",
            begin: /--[A-Za-z_][A-Za-z0-9_-]*/
          }
        };
      };
      var HTML_TAGS = [
        "a",
        "abbr",
        "address",
        "article",
        "aside",
        "audio",
        "b",
        "blockquote",
        "body",
        "button",
        "canvas",
        "caption",
        "cite",
        "code",
        "dd",
        "del",
        "details",
        "dfn",
        "div",
        "dl",
        "dt",
        "em",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "html",
        "i",
        "iframe",
        "img",
        "input",
        "ins",
        "kbd",
        "label",
        "legend",
        "li",
        "main",
        "mark",
        "menu",
        "nav",
        "object",
        "ol",
        "optgroup",
        "option",
        "p",
        "picture",
        "q",
        "quote",
        "samp",
        "section",
        "select",
        "source",
        "span",
        "strong",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "textarea",
        "tfoot",
        "th",
        "thead",
        "time",
        "tr",
        "ul",
        "var",
        "video"
      ];
      var SVG_TAGS = [
        "defs",
        "g",
        "marker",
        "mask",
        "pattern",
        "svg",
        "switch",
        "symbol",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feFlood",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMorphology",
        "feOffset",
        "feSpecularLighting",
        "feTile",
        "feTurbulence",
        "linearGradient",
        "radialGradient",
        "stop",
        "circle",
        "ellipse",
        "image",
        "line",
        "path",
        "polygon",
        "polyline",
        "rect",
        "text",
        "use",
        "textPath",
        "tspan",
        "foreignObject",
        "clipPath"
      ];
      var TAGS = [
        ...HTML_TAGS,
        ...SVG_TAGS
      ];
      var MEDIA_FEATURES = [
        "any-hover",
        "any-pointer",
        "aspect-ratio",
        "color",
        "color-gamut",
        "color-index",
        "device-aspect-ratio",
        "device-height",
        "device-width",
        "display-mode",
        "forced-colors",
        "grid",
        "height",
        "hover",
        "inverted-colors",
        "monochrome",
        "orientation",
        "overflow-block",
        "overflow-inline",
        "pointer",
        "prefers-color-scheme",
        "prefers-contrast",
        "prefers-reduced-motion",
        "prefers-reduced-transparency",
        "resolution",
        "scan",
        "scripting",
        "update",
        "width",
        // TODO: find a better solution?
        "min-width",
        "max-width",
        "min-height",
        "max-height"
      ].sort().reverse();
      var PSEUDO_CLASSES = [
        "active",
        "any-link",
        "blank",
        "checked",
        "current",
        "default",
        "defined",
        "dir",
        // dir()
        "disabled",
        "drop",
        "empty",
        "enabled",
        "first",
        "first-child",
        "first-of-type",
        "fullscreen",
        "future",
        "focus",
        "focus-visible",
        "focus-within",
        "has",
        // has()
        "host",
        // host or host()
        "host-context",
        // host-context()
        "hover",
        "indeterminate",
        "in-range",
        "invalid",
        "is",
        // is()
        "lang",
        // lang()
        "last-child",
        "last-of-type",
        "left",
        "link",
        "local-link",
        "not",
        // not()
        "nth-child",
        // nth-child()
        "nth-col",
        // nth-col()
        "nth-last-child",
        // nth-last-child()
        "nth-last-col",
        // nth-last-col()
        "nth-last-of-type",
        //nth-last-of-type()
        "nth-of-type",
        //nth-of-type()
        "only-child",
        "only-of-type",
        "optional",
        "out-of-range",
        "past",
        "placeholder-shown",
        "read-only",
        "read-write",
        "required",
        "right",
        "root",
        "scope",
        "target",
        "target-within",
        "user-invalid",
        "valid",
        "visited",
        "where"
        // where()
      ].sort().reverse();
      var PSEUDO_ELEMENTS = [
        "after",
        "backdrop",
        "before",
        "cue",
        "cue-region",
        "first-letter",
        "first-line",
        "grammar-error",
        "marker",
        "part",
        "placeholder",
        "selection",
        "slotted",
        "spelling-error"
      ].sort().reverse();
      var ATTRIBUTES = [
        "accent-color",
        "align-content",
        "align-items",
        "align-self",
        "alignment-baseline",
        "all",
        "anchor-name",
        "animation",
        "animation-composition",
        "animation-delay",
        "animation-direction",
        "animation-duration",
        "animation-fill-mode",
        "animation-iteration-count",
        "animation-name",
        "animation-play-state",
        "animation-range",
        "animation-range-end",
        "animation-range-start",
        "animation-timeline",
        "animation-timing-function",
        "appearance",
        "aspect-ratio",
        "backdrop-filter",
        "backface-visibility",
        "background",
        "background-attachment",
        "background-blend-mode",
        "background-clip",
        "background-color",
        "background-image",
        "background-origin",
        "background-position",
        "background-position-x",
        "background-position-y",
        "background-repeat",
        "background-size",
        "baseline-shift",
        "block-size",
        "border",
        "border-block",
        "border-block-color",
        "border-block-end",
        "border-block-end-color",
        "border-block-end-style",
        "border-block-end-width",
        "border-block-start",
        "border-block-start-color",
        "border-block-start-style",
        "border-block-start-width",
        "border-block-style",
        "border-block-width",
        "border-bottom",
        "border-bottom-color",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
        "border-bottom-style",
        "border-bottom-width",
        "border-collapse",
        "border-color",
        "border-end-end-radius",
        "border-end-start-radius",
        "border-image",
        "border-image-outset",
        "border-image-repeat",
        "border-image-slice",
        "border-image-source",
        "border-image-width",
        "border-inline",
        "border-inline-color",
        "border-inline-end",
        "border-inline-end-color",
        "border-inline-end-style",
        "border-inline-end-width",
        "border-inline-start",
        "border-inline-start-color",
        "border-inline-start-style",
        "border-inline-start-width",
        "border-inline-style",
        "border-inline-width",
        "border-left",
        "border-left-color",
        "border-left-style",
        "border-left-width",
        "border-radius",
        "border-right",
        "border-right-color",
        "border-right-style",
        "border-right-width",
        "border-spacing",
        "border-start-end-radius",
        "border-start-start-radius",
        "border-style",
        "border-top",
        "border-top-color",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-top-style",
        "border-top-width",
        "border-width",
        "bottom",
        "box-align",
        "box-decoration-break",
        "box-direction",
        "box-flex",
        "box-flex-group",
        "box-lines",
        "box-ordinal-group",
        "box-orient",
        "box-pack",
        "box-shadow",
        "box-sizing",
        "break-after",
        "break-before",
        "break-inside",
        "caption-side",
        "caret-color",
        "clear",
        "clip",
        "clip-path",
        "clip-rule",
        "color",
        "color-interpolation",
        "color-interpolation-filters",
        "color-profile",
        "color-rendering",
        "color-scheme",
        "column-count",
        "column-fill",
        "column-gap",
        "column-rule",
        "column-rule-color",
        "column-rule-style",
        "column-rule-width",
        "column-span",
        "column-width",
        "columns",
        "contain",
        "contain-intrinsic-block-size",
        "contain-intrinsic-height",
        "contain-intrinsic-inline-size",
        "contain-intrinsic-size",
        "contain-intrinsic-width",
        "container",
        "container-name",
        "container-type",
        "content",
        "content-visibility",
        "corner-bottom-left-shape",
        "corner-bottom-right-shape",
        "corner-shape",
        "corner-top-left-shape",
        "corner-top-right-shape",
        "counter-increment",
        "counter-reset",
        "counter-set",
        "cue",
        "cue-after",
        "cue-before",
        "cursor",
        "cx",
        "cy",
        "direction",
        "display",
        "dominant-baseline",
        "empty-cells",
        "enable-background",
        "field-sizing",
        "fill",
        "fill-opacity",
        "fill-rule",
        "filter",
        "flex",
        "flex-basis",
        "flex-direction",
        "flex-flow",
        "flex-grow",
        "flex-shrink",
        "flex-wrap",
        "float",
        "flood-color",
        "flood-opacity",
        "flow",
        "font",
        "font-display",
        "font-family",
        "font-feature-settings",
        "font-kerning",
        "font-language-override",
        "font-optical-sizing",
        "font-palette",
        "font-size",
        "font-size-adjust",
        "font-smooth",
        "font-smoothing",
        "font-stretch",
        "font-style",
        "font-synthesis",
        "font-synthesis-position",
        "font-synthesis-small-caps",
        "font-synthesis-style",
        "font-synthesis-weight",
        "font-variant",
        "font-variant-alternates",
        "font-variant-caps",
        "font-variant-east-asian",
        "font-variant-emoji",
        "font-variant-ligatures",
        "font-variant-numeric",
        "font-variant-position",
        "font-variation-settings",
        "font-weight",
        "forced-color-adjust",
        "gap",
        "glyph-orientation-horizontal",
        "glyph-orientation-vertical",
        "grid",
        "grid-area",
        "grid-auto-columns",
        "grid-auto-flow",
        "grid-auto-rows",
        "grid-column",
        "grid-column-end",
        "grid-column-start",
        "grid-gap",
        "grid-row",
        "grid-row-end",
        "grid-row-start",
        "grid-template",
        "grid-template-areas",
        "grid-template-columns",
        "grid-template-rows",
        "hanging-punctuation",
        "height",
        "hyphenate-character",
        "hyphenate-limit-chars",
        "hyphens",
        "icon",
        "image-orientation",
        "image-rendering",
        "image-resolution",
        "ime-mode",
        "initial-letter",
        "initial-letter-align",
        "inline-size",
        "inset",
        "inset-area",
        "inset-block",
        "inset-block-end",
        "inset-block-start",
        "inset-inline",
        "inset-inline-end",
        "inset-inline-start",
        "isolation",
        "justify-content",
        "justify-items",
        "justify-self",
        "kerning",
        "left",
        "letter-spacing",
        "lighting-color",
        "line-break",
        "line-height",
        "line-height-step",
        "list-style",
        "list-style-image",
        "list-style-position",
        "list-style-type",
        "margin",
        "margin-block",
        "margin-block-end",
        "margin-block-start",
        "margin-bottom",
        "margin-inline",
        "margin-inline-end",
        "margin-inline-start",
        "margin-left",
        "margin-right",
        "margin-top",
        "margin-trim",
        "marker",
        "marker-end",
        "marker-mid",
        "marker-start",
        "marks",
        "mask",
        "mask-border",
        "mask-border-mode",
        "mask-border-outset",
        "mask-border-repeat",
        "mask-border-slice",
        "mask-border-source",
        "mask-border-width",
        "mask-clip",
        "mask-composite",
        "mask-image",
        "mask-mode",
        "mask-origin",
        "mask-position",
        "mask-repeat",
        "mask-size",
        "mask-type",
        "masonry-auto-flow",
        "math-depth",
        "math-shift",
        "math-style",
        "max-block-size",
        "max-height",
        "max-inline-size",
        "max-width",
        "min-block-size",
        "min-height",
        "min-inline-size",
        "min-width",
        "mix-blend-mode",
        "nav-down",
        "nav-index",
        "nav-left",
        "nav-right",
        "nav-up",
        "none",
        "normal",
        "object-fit",
        "object-position",
        "offset",
        "offset-anchor",
        "offset-distance",
        "offset-path",
        "offset-position",
        "offset-rotate",
        "opacity",
        "order",
        "orphans",
        "outline",
        "outline-color",
        "outline-offset",
        "outline-style",
        "outline-width",
        "overflow",
        "overflow-anchor",
        "overflow-block",
        "overflow-clip-margin",
        "overflow-inline",
        "overflow-wrap",
        "overflow-x",
        "overflow-y",
        "overlay",
        "overscroll-behavior",
        "overscroll-behavior-block",
        "overscroll-behavior-inline",
        "overscroll-behavior-x",
        "overscroll-behavior-y",
        "padding",
        "padding-block",
        "padding-block-end",
        "padding-block-start",
        "padding-bottom",
        "padding-inline",
        "padding-inline-end",
        "padding-inline-start",
        "padding-left",
        "padding-right",
        "padding-top",
        "page",
        "page-break-after",
        "page-break-before",
        "page-break-inside",
        "paint-order",
        "pause",
        "pause-after",
        "pause-before",
        "perspective",
        "perspective-origin",
        "place-content",
        "place-items",
        "place-self",
        "pointer-events",
        "position",
        "position-anchor",
        "position-visibility",
        "print-color-adjust",
        "quotes",
        "r",
        "resize",
        "rest",
        "rest-after",
        "rest-before",
        "right",
        "rotate",
        "row-gap",
        "ruby-align",
        "ruby-position",
        "scale",
        "scroll-behavior",
        "scroll-margin",
        "scroll-margin-block",
        "scroll-margin-block-end",
        "scroll-margin-block-start",
        "scroll-margin-bottom",
        "scroll-margin-inline",
        "scroll-margin-inline-end",
        "scroll-margin-inline-start",
        "scroll-margin-left",
        "scroll-margin-right",
        "scroll-margin-top",
        "scroll-padding",
        "scroll-padding-block",
        "scroll-padding-block-end",
        "scroll-padding-block-start",
        "scroll-padding-bottom",
        "scroll-padding-inline",
        "scroll-padding-inline-end",
        "scroll-padding-inline-start",
        "scroll-padding-left",
        "scroll-padding-right",
        "scroll-padding-top",
        "scroll-snap-align",
        "scroll-snap-stop",
        "scroll-snap-type",
        "scroll-timeline",
        "scroll-timeline-axis",
        "scroll-timeline-name",
        "scrollbar-color",
        "scrollbar-gutter",
        "scrollbar-width",
        "shape-image-threshold",
        "shape-margin",
        "shape-outside",
        "shape-rendering",
        "speak",
        "speak-as",
        "src",
        // @font-face
        "stop-color",
        "stop-opacity",
        "stroke",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-miterlimit",
        "stroke-opacity",
        "stroke-width",
        "tab-size",
        "table-layout",
        "text-align",
        "text-align-all",
        "text-align-last",
        "text-anchor",
        "text-combine-upright",
        "text-decoration",
        "text-decoration-color",
        "text-decoration-line",
        "text-decoration-skip",
        "text-decoration-skip-ink",
        "text-decoration-style",
        "text-decoration-thickness",
        "text-emphasis",
        "text-emphasis-color",
        "text-emphasis-position",
        "text-emphasis-style",
        "text-indent",
        "text-justify",
        "text-orientation",
        "text-overflow",
        "text-rendering",
        "text-shadow",
        "text-size-adjust",
        "text-transform",
        "text-underline-offset",
        "text-underline-position",
        "text-wrap",
        "text-wrap-mode",
        "text-wrap-style",
        "timeline-scope",
        "top",
        "touch-action",
        "transform",
        "transform-box",
        "transform-origin",
        "transform-style",
        "transition",
        "transition-behavior",
        "transition-delay",
        "transition-duration",
        "transition-property",
        "transition-timing-function",
        "translate",
        "unicode-bidi",
        "unicode-range",
        "user-modify",
        "user-select",
        "vector-effect",
        "vertical-align",
        "view-timeline",
        "view-timeline-axis",
        "view-timeline-inset",
        "view-timeline-name",
        "view-transition-name",
        "visibility",
        "voice-balance",
        "voice-duration",
        "voice-family",
        "voice-pitch",
        "voice-range",
        "voice-rate",
        "voice-stress",
        "voice-volume",
        "white-space",
        "white-space-collapse",
        "widows",
        "width",
        "will-change",
        "word-break",
        "word-spacing",
        "word-wrap",
        "writing-mode",
        "x",
        "y",
        "z-index",
        "zoom"
      ].sort().reverse();
      function css(hljs) {
        const regex = hljs.regex;
        const modes = MODES(hljs);
        const VENDOR_PREFIX = { begin: /-(webkit|moz|ms|o)-(?=[a-z])/ };
        const AT_MODIFIERS = "and or not only";
        const AT_PROPERTY_RE = /@-?\w[\w]*(-\w+)*/;
        const IDENT_RE = "[a-zA-Z-][a-zA-Z0-9_-]*";
        const STRINGS = [
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE
        ];
        return {
          name: "CSS",
          case_insensitive: true,
          illegal: /[=|'\$]/,
          keywords: { keyframePosition: "from to" },
          classNameAliases: {
            // for visual continuity with `tag {}` and because we
            // don't have a great class for this?
            keyframePosition: "selector-tag"
          },
          contains: [
            modes.BLOCK_COMMENT,
            VENDOR_PREFIX,
            // to recognize keyframe 40% etc which are outside the scope of our
            // attribute value mode
            modes.CSS_NUMBER_MODE,
            {
              className: "selector-id",
              begin: /#[A-Za-z0-9_-]+/,
              relevance: 0
            },
            {
              className: "selector-class",
              begin: "\\." + IDENT_RE,
              relevance: 0
            },
            modes.ATTRIBUTE_SELECTOR_MODE,
            {
              className: "selector-pseudo",
              variants: [
                { begin: ":(" + PSEUDO_CLASSES.join("|") + ")" },
                { begin: ":(:)?(" + PSEUDO_ELEMENTS.join("|") + ")" }
              ]
            },
            // we may actually need this (12/2020)
            // { // pseudo-selector params
            //   begin: /\(/,
            //   end: /\)/,
            //   contains: [ hljs.CSS_NUMBER_MODE ]
            // },
            modes.CSS_VARIABLE,
            {
              className: "attribute",
              begin: "\\b(" + ATTRIBUTES.join("|") + ")\\b"
            },
            // attribute values
            {
              begin: /:/,
              end: /[;}{]/,
              contains: [
                modes.BLOCK_COMMENT,
                modes.HEXCOLOR,
                modes.IMPORTANT,
                modes.CSS_NUMBER_MODE,
                modes.UNICODE_RANGE,
                ...STRINGS,
                // needed to highlight these as strings and to avoid issues with
                // illegal characters that might be inside urls that would trigger the
                // languages illegal stack
                {
                  begin: /(url|data-uri)\(/,
                  end: /\)/,
                  relevance: 0,
                  // from keywords
                  keywords: { built_in: "url data-uri" },
                  contains: [
                    ...STRINGS,
                    {
                      className: "string",
                      // any character other than `)` as in `url()` will be the start
                      // of a string, which ends with `)` (from the parent mode)
                      begin: /[^)]/,
                      endsWithParent: true,
                      excludeEnd: true
                    }
                  ]
                },
                modes.FUNCTION_DISPATCH
              ]
            },
            {
              begin: regex.lookahead(/@/),
              end: "[{;]",
              relevance: 0,
              illegal: /:/,
              // break on Less variables @var: ...
              contains: [
                {
                  className: "keyword",
                  begin: AT_PROPERTY_RE
                },
                {
                  begin: /\s/,
                  endsWithParent: true,
                  excludeEnd: true,
                  relevance: 0,
                  keywords: {
                    $pattern: /[a-z-]+/,
                    keyword: AT_MODIFIERS,
                    attribute: MEDIA_FEATURES.join(" ")
                  },
                  contains: [
                    {
                      begin: /[a-z-]+(?=:)/,
                      className: "attribute"
                    },
                    ...STRINGS,
                    modes.CSS_NUMBER_MODE
                  ]
                }
              ]
            },
            {
              className: "selector-tag",
              begin: "\\b(" + TAGS.join("|") + ")\\b"
            }
          ]
        };
      }
      module.exports = css;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/markdown.js
  var require_markdown = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/markdown.js"(exports, module) {
      function markdown(hljs) {
        const regex = hljs.regex;
        const INLINE_HTML = {
          begin: /<\/?[A-Za-z_]/,
          end: ">",
          subLanguage: "xml",
          relevance: 0
        };
        const HORIZONTAL_RULE = { match: /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/ };
        const CODE = {
          className: "code",
          variants: [
            // TODO: fix to allow these to work with sublanguage also
            { begin: "(`{3,})[^`](.|\\n)*?\\1`*[ ]*" },
            { begin: "(~{3,})[^~](.|\\n)*?\\1~*[ ]*" },
            // needed to allow markdown as a sublanguage to work
            {
              begin: "```",
              end: "```+[ ]*$"
            },
            {
              begin: "~~~",
              end: "~~~+[ ]*$"
            },
            { begin: "`.+?`" },
            {
              begin: "(?=^( {4}|\\t))",
              // use contains to gobble up multiple lines to allow the block to be whatever size
              // but only have a single open/close tag vs one per line
              contains: [
                {
                  begin: "^( {4}|\\t)",
                  end: "(\\n)$"
                }
              ],
              relevance: 0
            }
          ]
        };
        const LIST = {
          className: "bullet",
          begin: "^[ 	]*([*+-]|(\\d+\\.))(?=\\s+)",
          end: "\\s+",
          excludeEnd: true
        };
        const LINK_REFERENCE = {
          begin: /^\[[^\n]+\]:/,
          returnBegin: true,
          contains: [
            {
              className: "symbol",
              begin: /\[/,
              end: /\]/,
              excludeBegin: true,
              excludeEnd: true
            },
            {
              className: "link",
              begin: /:\s*/,
              end: /$/,
              excludeBegin: true
            }
          ]
        };
        const URL_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*/;
        const LINK = {
          variants: [
            // too much like nested array access in so many languages
            // to have any real relevance
            {
              begin: /\[.+?\]\[.*?\]/,
              relevance: 0
            },
            // popular internet URLs
            {
              begin: /\[.+?\]\(((data|javascript|mailto):|(?:http|ftp)s?:\/\/).*?\)/,
              relevance: 2
            },
            {
              begin: regex.concat(/\[.+?\]\(/, URL_SCHEME, /:\/\/.*?\)/),
              relevance: 2
            },
            // relative urls
            {
              begin: /\[.+?\]\([./?&#].*?\)/,
              relevance: 1
            },
            // whatever else, lower relevance (might not be a link at all)
            {
              begin: /\[.*?\]\(.*?\)/,
              relevance: 0
            }
          ],
          returnBegin: true,
          contains: [
            {
              // empty strings for alt or link text
              match: /\[(?=\])/
            },
            {
              className: "string",
              relevance: 0,
              begin: "\\[",
              end: "\\]",
              excludeBegin: true,
              returnEnd: true
            },
            {
              className: "link",
              relevance: 0,
              begin: "\\]\\(",
              end: "\\)",
              excludeBegin: true,
              excludeEnd: true
            },
            {
              className: "symbol",
              relevance: 0,
              begin: "\\]\\[",
              end: "\\]",
              excludeBegin: true,
              excludeEnd: true
            }
          ]
        };
        const BOLD = {
          className: "strong",
          contains: [],
          // defined later
          variants: [
            {
              begin: /_{2}(?!\s)/,
              end: /_{2}/
            },
            {
              begin: /\*{2}(?!\s)/,
              end: /\*{2}/
            }
          ]
        };
        const ITALIC = {
          className: "emphasis",
          contains: [],
          // defined later
          variants: [
            {
              begin: /\*(?![*\s])/,
              end: /\*/
            },
            {
              begin: /_(?![_\s])/,
              end: /_/,
              relevance: 0
            }
          ]
        };
        const BOLD_WITHOUT_ITALIC = hljs.inherit(BOLD, { contains: [] });
        const ITALIC_WITHOUT_BOLD = hljs.inherit(ITALIC, { contains: [] });
        BOLD.contains.push(ITALIC_WITHOUT_BOLD);
        ITALIC.contains.push(BOLD_WITHOUT_ITALIC);
        let CONTAINABLE = [
          INLINE_HTML,
          LINK
        ];
        [
          BOLD,
          ITALIC,
          BOLD_WITHOUT_ITALIC,
          ITALIC_WITHOUT_BOLD
        ].forEach((m) => {
          m.contains = m.contains.concat(CONTAINABLE);
        });
        CONTAINABLE = CONTAINABLE.concat(BOLD, ITALIC);
        const HEADER = {
          className: "section",
          variants: [
            {
              begin: "^#{1,6}",
              end: "$",
              contains: CONTAINABLE
            },
            {
              begin: "(?=^.+?\\n[=-]{2,}$)",
              contains: [
                { begin: "^[=-]*$" },
                {
                  begin: "^",
                  end: "\\n",
                  contains: CONTAINABLE
                }
              ]
            }
          ]
        };
        const BLOCKQUOTE = {
          className: "quote",
          begin: "^>\\s+",
          contains: CONTAINABLE,
          end: "$"
        };
        const ENTITY = {
          //https://spec.commonmark.org/0.31.2/#entity-references
          scope: "literal",
          match: /&([a-zA-Z0-9]+|#[0-9]{1,7}|#[Xx][0-9a-fA-F]{1,6});/
        };
        return {
          name: "Markdown",
          aliases: [
            "md",
            "mkdown",
            "mkd"
          ],
          contains: [
            HEADER,
            INLINE_HTML,
            LIST,
            // must come before BOLD/ITALIC so that a `***` or `___` thematic break
            // isn't mistaken for the start of bold text
            HORIZONTAL_RULE,
            BOLD,
            ITALIC,
            BLOCKQUOTE,
            CODE,
            LINK,
            LINK_REFERENCE,
            ENTITY
          ]
        };
      }
      module.exports = markdown;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/diff.js
  var require_diff = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/diff.js"(exports, module) {
      function diff(hljs) {
        const regex = hljs.regex;
        return {
          name: "Diff",
          aliases: ["patch"],
          contains: [
            {
              className: "meta",
              relevance: 10,
              match: regex.either(
                /^@@ +-\d+,\d+ +\+\d+,\d+ +@@/,
                // @@ -1,2 +1,2 @@
                /^@@ +-\d+ +\+\d+,\d+ +@@/,
                // @@ -1 +1,2 @@
                /^@@ +-\d+,\d+ +\+\d+ +@@/,
                // @@ -1,2 +1 @@
                /^@@ +-\d+ +\+\d+ +@@/,
                // @@ -1 +1 @@
                /^\*\*\* +\d+,\d+ +\*\*\*\*$/,
                /^--- +\d+,\d+ +----$/
              )
            },
            {
              className: "comment",
              variants: [
                {
                  begin: regex.either(
                    /Index: /,
                    /^index/,
                    /={3,}/,
                    /^-{3}/,
                    /^\*{3} /,
                    /^\+{3}/,
                    /^diff --git/
                  ),
                  end: /$/
                },
                { match: /^\*{15}$/ }
              ]
            },
            {
              className: "addition",
              begin: /^\+/,
              end: /$/
            },
            {
              className: "deletion",
              begin: /^-/,
              end: /$/
            },
            {
              className: "addition",
              begin: /^!/,
              end: /$/
            }
          ]
        };
      }
      module.exports = diff;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/ruby.js
  var require_ruby = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/ruby.js"(exports, module) {
      function ruby(hljs) {
        const regex = hljs.regex;
        const RUBY_METHOD_RE = "([a-zA-Z_]\\w*[!?=]?|[-+~]@|<<|>>|=~|===?|<=>|[<>]=?|\\*\\*|[-/+%^&*~`|]|\\[\\]=?)";
        const CLASS_NAME_RE = regex.either(
          /\b([A-Z]+[a-z0-9]+)+/,
          // ends in caps
          /\b([A-Z]+[a-z0-9]+)+[A-Z]+/
        );
        const CLASS_NAME_WITH_NAMESPACE_RE = regex.concat(CLASS_NAME_RE, /(::\w+)*/);
        const PSEUDO_KWS = [
          "include",
          "extend",
          "prepend",
          "public",
          "private",
          "protected",
          "raise",
          "throw"
        ];
        const RUBY_KEYWORDS = {
          "variable.constant": [
            "__FILE__",
            "__LINE__",
            "__ENCODING__"
          ],
          "variable.language": [
            "self",
            "super"
          ],
          keyword: [
            "alias",
            "and",
            "begin",
            "BEGIN",
            "break",
            "case",
            "class",
            "defined",
            "do",
            "else",
            "elsif",
            "end",
            "END",
            "ensure",
            "for",
            "if",
            "in",
            "module",
            "next",
            "not",
            "or",
            "redo",
            "require",
            "rescue",
            "retry",
            "return",
            "then",
            "undef",
            "unless",
            "until",
            "when",
            "while",
            "yield",
            ...PSEUDO_KWS
          ],
          built_in: [
            "proc",
            "lambda",
            "attr_accessor",
            "attr_reader",
            "attr_writer",
            "define_method",
            "private_constant",
            "module_function"
          ],
          literal: [
            "true",
            "false",
            "nil"
          ]
        };
        const YARDOCTAG = {
          className: "doctag",
          begin: "@[A-Za-z]+"
        };
        const IRB_OBJECT = {
          begin: "#<",
          end: ">"
        };
        const COMMENT_MODES = [
          hljs.COMMENT(
            "#",
            "$",
            { contains: [YARDOCTAG] }
          ),
          hljs.COMMENT(
            "^=begin",
            "^=end",
            {
              contains: [YARDOCTAG],
              relevance: 10
            }
          ),
          hljs.COMMENT("^__END__", hljs.MATCH_NOTHING_RE)
        ];
        const SUBST = {
          className: "subst",
          begin: /#\{/,
          end: /\}/,
          keywords: RUBY_KEYWORDS
        };
        const STRING = {
          className: "string",
          contains: [
            hljs.BACKSLASH_ESCAPE,
            SUBST
          ],
          variants: [
            {
              begin: /'/,
              end: /'/
            },
            {
              begin: /"/,
              end: /"/
            },
            {
              begin: /`/,
              end: /`/
            },
            {
              begin: /%[qQwWx]?\(/,
              end: /\)/
            },
            {
              begin: /%[qQwWx]?\[/,
              end: /\]/
            },
            {
              begin: /%[qQwWx]?\{/,
              end: /\}/
            },
            {
              begin: /%[qQwWx]?</,
              end: />/
            },
            {
              begin: /%[qQwWx]?\//,
              end: /\//
            },
            {
              begin: /%[qQwWx]?%/,
              end: /%/
            },
            {
              begin: /%[qQwWx]?-/,
              end: /-/
            },
            {
              begin: /%[qQwWx]?\|/,
              end: /\|/
            },
            // in the following expressions, \B in the beginning suppresses recognition of ?-sequences
            // where ? is the last character of a preceding identifier, as in: `func?4`
            { begin: /\B\?(\\\d{1,3})/ },
            { begin: /\B\?(\\x[A-Fa-f0-9]{1,2})/ },
            { begin: /\B\?(\\u\{?[A-Fa-f0-9]{1,6}\}?)/ },
            { begin: /\B\?(\\M-\\C-|\\M-\\c|\\c\\M-|\\M-|\\C-\\M-)[\x20-\x7e]/ },
            { begin: /\B\?\\(c|C-)[\x20-\x7e]/ },
            { begin: /\B\?\\?\S/ },
            // heredocs
            {
              // this guard makes sure that we have an entire heredoc and not a false
              // positive (auto-detect, etc.)
              begin: regex.concat(
                /<<[-~]?'?/,
                regex.lookahead(/(\w+)(?=\W)[^\n]*\n(?:[^\n]*\n)*?\s*\1\b/)
              ),
              contains: [
                hljs.END_SAME_AS_BEGIN({
                  begin: /(\w+)/,
                  end: /(\w+)/,
                  contains: [
                    hljs.BACKSLASH_ESCAPE,
                    SUBST
                  ]
                })
              ]
            }
          ]
        };
        const decimal = "[1-9](_?[0-9])*|0";
        const digits = "[0-9](_?[0-9])*";
        const NUMBER = {
          className: "number",
          relevance: 0,
          variants: [
            // decimal integer/float, optionally exponential or rational, optionally imaginary
            { begin: `\\b(${decimal})(\\.(${digits}))?([eE][+-]?(${digits})|r)?i?\\b` },
            // explicit decimal/binary/octal/hexadecimal integer,
            // optionally rational and/or imaginary
            { begin: "\\b0[dD][0-9](_?[0-9])*r?i?\\b" },
            { begin: "\\b0[bB][0-1](_?[0-1])*r?i?\\b" },
            { begin: "\\b0[oO][0-7](_?[0-7])*r?i?\\b" },
            { begin: "\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*r?i?\\b" },
            // 0-prefixed implicit octal integer, optionally rational and/or imaginary
            { begin: "\\b0(_?[0-7])+r?i?\\b" }
          ]
        };
        const PARAMS = {
          variants: [
            {
              match: /\(\)/
            },
            {
              className: "params",
              begin: /\(/,
              end: /(?=\))/,
              excludeBegin: true,
              endsParent: true,
              keywords: RUBY_KEYWORDS
            }
          ]
        };
        const INCLUDE_EXTEND = {
          match: [
            /(include|extend)\s+/,
            CLASS_NAME_WITH_NAMESPACE_RE
          ],
          scope: {
            2: "title.class"
          },
          keywords: RUBY_KEYWORDS
        };
        const CLASS_DEFINITION = {
          variants: [
            {
              match: [
                /class\s+/,
                CLASS_NAME_WITH_NAMESPACE_RE,
                /\s+<\s+/,
                CLASS_NAME_WITH_NAMESPACE_RE
              ]
            },
            {
              match: [
                /\b(class|module)\s+/,
                CLASS_NAME_WITH_NAMESPACE_RE
              ]
            }
          ],
          scope: {
            2: "title.class",
            4: "title.class.inherited"
          },
          keywords: RUBY_KEYWORDS
        };
        const UPPER_CASE_CONSTANT = {
          relevance: 0,
          match: /\b[A-Z][A-Z_0-9]+\b/,
          className: "variable.constant"
        };
        const METHOD_DEFINITION = {
          match: [
            /def/,
            /\s+/,
            RUBY_METHOD_RE
          ],
          scope: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            PARAMS
          ]
        };
        const OBJECT_CREATION = {
          relevance: 0,
          match: [
            CLASS_NAME_WITH_NAMESPACE_RE,
            /\.new[. (]/
          ],
          scope: {
            1: "title.class"
          }
        };
        const CLASS_REFERENCE = {
          relevance: 0,
          match: CLASS_NAME_RE,
          scope: "title.class"
        };
        const RUBY_DEFAULT_CONTAINS = [
          STRING,
          CLASS_DEFINITION,
          INCLUDE_EXTEND,
          OBJECT_CREATION,
          UPPER_CASE_CONSTANT,
          CLASS_REFERENCE,
          METHOD_DEFINITION,
          {
            // swallow the scope resolution operator so `::` is not read as a symbol
            begin: "::"
          },
          {
            className: "symbol",
            begin: hljs.UNDERSCORE_IDENT_RE + "(!|\\?)?:",
            relevance: 0
          },
          {
            className: "symbol",
            begin: ":(?!\\s)",
            contains: [
              STRING,
              { begin: RUBY_METHOD_RE }
            ],
            relevance: 0
          },
          NUMBER,
          {
            // negative-look forward attempts to prevent false matches like:
            // @ident@ or $ident$ that might indicate this is not ruby at all
            className: "variable",
            begin: `(\\$\\W)|((\\$|@@?)(\\w+))(?=[^@$?])(?![A-Za-z])(?![@$?'])`
          },
          {
            className: "params",
            begin: /\|(?!=)/,
            end: /\|/,
            excludeBegin: true,
            excludeEnd: true,
            relevance: 0,
            // this could be a lot of things (in other languages) other than params
            keywords: RUBY_KEYWORDS
          },
          {
            // regexp container
            begin: "(" + hljs.RE_STARTERS_RE + "|unless)\\s*",
            keywords: "unless",
            contains: [
              {
                className: "regexp",
                contains: [
                  hljs.BACKSLASH_ESCAPE,
                  SUBST
                ],
                illegal: /\n/,
                variants: [
                  {
                    begin: "/",
                    end: "/[a-z]*"
                  },
                  {
                    begin: /%r\{/,
                    end: /\}[a-z]*/
                  },
                  {
                    begin: "%r\\(",
                    end: "\\)[a-z]*"
                  },
                  {
                    begin: "%r!",
                    end: "![a-z]*"
                  },
                  {
                    begin: "%r\\[",
                    end: "\\][a-z]*"
                  }
                ]
              }
            ].concat(IRB_OBJECT, COMMENT_MODES),
            relevance: 0
          }
        ].concat(IRB_OBJECT, COMMENT_MODES);
        SUBST.contains = RUBY_DEFAULT_CONTAINS;
        PARAMS.contains = RUBY_DEFAULT_CONTAINS;
        const SIMPLE_PROMPT = "[>?]>";
        const DEFAULT_PROMPT = "[\\w#]+\\(\\w+\\):\\d+:\\d+[>*]";
        const RVM_PROMPT = "(\\w+-)?\\d+\\.\\d+\\.\\d+(p\\d+)?[^\\d][^>]+>";
        const IRB_DEFAULT = [
          {
            begin: /^\s*=>/,
            starts: {
              end: "$",
              contains: RUBY_DEFAULT_CONTAINS
            }
          },
          {
            className: "meta.prompt",
            begin: "^(" + SIMPLE_PROMPT + "|" + DEFAULT_PROMPT + "|" + RVM_PROMPT + ")(?=[ ])",
            starts: {
              end: "$",
              keywords: RUBY_KEYWORDS,
              contains: RUBY_DEFAULT_CONTAINS
            }
          }
        ];
        COMMENT_MODES.unshift(IRB_OBJECT);
        return {
          name: "Ruby",
          aliases: [
            "rb",
            "gemspec",
            "podspec",
            "thor",
            "irb"
          ],
          keywords: RUBY_KEYWORDS,
          illegal: /\/\*/,
          contains: [hljs.SHEBANG({ binary: "ruby" })].concat(IRB_DEFAULT).concat(COMMENT_MODES).concat(RUBY_DEFAULT_CONTAINS)
        };
      }
      module.exports = ruby;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/go.js
  var require_go = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/go.js"(exports, module) {
      function go(hljs) {
        const LITERALS = [
          "true",
          "false",
          "iota",
          "nil"
        ];
        const BUILT_INS = [
          "append",
          "cap",
          "close",
          "complex",
          "copy",
          "imag",
          "len",
          "make",
          "new",
          "panic",
          "print",
          "println",
          "real",
          "recover",
          "delete"
        ];
        const TYPES = [
          "bool",
          "byte",
          "complex64",
          "complex128",
          "error",
          "float32",
          "float64",
          "int8",
          "int16",
          "int32",
          "int64",
          "string",
          "uint8",
          "uint16",
          "uint32",
          "uint64",
          "int",
          "uint",
          "uintptr",
          "rune"
        ];
        const KWS = [
          "break",
          "case",
          "chan",
          "const",
          "continue",
          "default",
          "defer",
          "else",
          "fallthrough",
          "for",
          "func",
          "go",
          "goto",
          "if",
          "import",
          "interface",
          "map",
          "package",
          "range",
          "return",
          "select",
          "struct",
          "switch",
          "type",
          "var"
        ];
        const KEYWORDS = {
          keyword: KWS,
          type: TYPES,
          literal: LITERALS,
          built_in: BUILT_INS
        };
        return {
          name: "Go",
          aliases: ["golang"],
          keywords: KEYWORDS,
          illegal: "</",
          contains: [
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            {
              className: "string",
              variants: [
                hljs.QUOTE_STRING_MODE,
                hljs.APOS_STRING_MODE,
                {
                  begin: "`",
                  end: "`"
                }
              ]
            },
            {
              className: "number",
              variants: [
                {
                  match: /-?\b0[xX]\.[a-fA-F0-9](_?[a-fA-F0-9])*[pP][+-]?\d(_?\d)*i?/,
                  // hex without a present digit before . (making a digit afterwards required)
                  relevance: 0
                },
                {
                  match: /-?\b0[xX](_?[a-fA-F0-9])+((\.([a-fA-F0-9](_?[a-fA-F0-9])*)?)?[pP][+-]?\d(_?\d)*)?i?/,
                  // hex with a present digit before . (making a digit afterwards optional)
                  relevance: 0
                },
                {
                  match: /-?\b0[oO](_?[0-7])*i?/,
                  // leading 0o octal
                  relevance: 0
                },
                {
                  match: /-?\b0[bB](_?[01])*i?/,
                  // leading 0b binary
                  relevance: 0
                },
                {
                  match: /-?\.\d(_?\d)*([eE][+-]?\d(_?\d)*)?i?/,
                  // decimal without a present digit before . (making a digit afterwards required)
                  relevance: 0
                },
                {
                  match: /-?\b\d(_?\d)*(\.(\d(_?\d)*)?)?([eE][+-]?\d(_?\d)*)?i?/,
                  // decimal with a present digit before . (making a digit afterwards optional)
                  relevance: 0
                }
              ]
            },
            {
              begin: /:=/
              // relevance booster
            },
            {
              className: "function",
              beginKeywords: "func",
              end: "\\s*(\\{|$)",
              excludeEnd: true,
              contains: [
                hljs.TITLE_MODE,
                {
                  className: "params",
                  begin: /\(/,
                  end: /\)/,
                  endsParent: true,
                  keywords: KEYWORDS,
                  illegal: /["']/
                }
              ]
            }
          ]
        };
      }
      module.exports = go;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/graphql.js
  var require_graphql = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/graphql.js"(exports, module) {
      function graphql(hljs) {
        const regex = hljs.regex;
        const GQL_NAME = /[_A-Za-z][_0-9A-Za-z]*/;
        return {
          name: "GraphQL",
          aliases: ["gql"],
          case_insensitive: true,
          disableAutodetect: false,
          keywords: {
            keyword: [
              "query",
              "mutation",
              "subscription",
              "type",
              "input",
              "schema",
              "directive",
              "interface",
              "union",
              "scalar",
              "fragment",
              "enum",
              "on"
            ],
            literal: [
              "true",
              "false",
              "null"
            ]
          },
          contains: [
            hljs.HASH_COMMENT_MODE,
            hljs.QUOTE_STRING_MODE,
            hljs.NUMBER_MODE,
            {
              scope: "punctuation",
              match: /[.]{3}/,
              relevance: 0
            },
            {
              scope: "punctuation",
              begin: /[\!\(\)\:\=\[\]\{\|\}]{1}/,
              relevance: 0
            },
            {
              scope: "variable",
              begin: /\$/,
              end: /\W/,
              excludeEnd: true,
              relevance: 0
            },
            {
              scope: "meta",
              match: /@\w+/,
              excludeEnd: true
            },
            {
              scope: "symbol",
              begin: regex.concat(GQL_NAME, regex.lookahead(/\s*:/)),
              relevance: 0
            }
          ],
          illegal: [
            /[;<']/,
            /BEGIN/
          ]
        };
      }
      module.exports = graphql;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/ini.js
  var require_ini = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/ini.js"(exports, module) {
      function ini(hljs) {
        const regex = hljs.regex;
        const NUMBERS = {
          className: "number",
          relevance: 0,
          variants: [
            { begin: /([+-]+)?[\d]+_[\d_]+/ },
            { begin: hljs.NUMBER_RE }
          ]
        };
        const COMMENTS = hljs.COMMENT();
        COMMENTS.variants = [
          {
            begin: /;/,
            end: /$/
          },
          {
            begin: /#/,
            end: /$/
          }
        ];
        const VARIABLES = {
          className: "variable",
          variants: [
            { begin: /\$[\w\d"][\w\d_]*/ },
            { begin: /\$\{(.*?)\}/ }
          ]
        };
        const LITERALS = {
          className: "literal",
          begin: /\bon|off|true|false|yes|no\b/
        };
        const STRINGS = {
          className: "string",
          contains: [hljs.BACKSLASH_ESCAPE],
          variants: [
            {
              begin: "'''",
              end: "'''",
              relevance: 10
            },
            {
              begin: '"""',
              end: '"""',
              relevance: 10
            },
            {
              begin: '"',
              end: '"'
            },
            {
              begin: "'",
              end: "'"
            }
          ]
        };
        const ARRAY = {
          begin: /\[/,
          end: /\]/,
          contains: [
            COMMENTS,
            LITERALS,
            VARIABLES,
            STRINGS,
            NUMBERS,
            "self"
          ],
          relevance: 0
        };
        const BARE_KEY = /[A-Za-z0-9_-]+/;
        const QUOTED_KEY_DOUBLE_QUOTE = /"(\\"|[^"])*"/;
        const QUOTED_KEY_SINGLE_QUOTE = /'[^']*'/;
        const ANY_KEY = regex.either(
          BARE_KEY,
          QUOTED_KEY_DOUBLE_QUOTE,
          QUOTED_KEY_SINGLE_QUOTE
        );
        const DOTTED_KEY = regex.concat(
          ANY_KEY,
          "(\\s*\\.\\s*",
          ANY_KEY,
          ")*",
          regex.lookahead(/\s*=\s*[^#\s]/)
        );
        return {
          name: "TOML, also INI",
          aliases: ["toml"],
          case_insensitive: true,
          illegal: /\S/,
          contains: [
            COMMENTS,
            {
              className: "section",
              begin: /\[+/,
              end: /\]+/
            },
            {
              begin: DOTTED_KEY,
              className: "attr",
              starts: {
                end: /$/,
                contains: [
                  COMMENTS,
                  ARRAY,
                  LITERALS,
                  VARIABLES,
                  STRINGS,
                  NUMBERS
                ]
              }
            }
          ]
        };
      }
      module.exports = ini;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/java.js
  var require_java = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/java.js"(exports, module) {
      var decimalDigits = "[0-9](_*[0-9])*";
      var frac = `\\.(${decimalDigits})`;
      var hexDigits = "[0-9a-fA-F](_*[0-9a-fA-F])*";
      var NUMERIC = {
        className: "number",
        variants: [
          // DecimalFloatingPointLiteral
          // including ExponentPart
          { begin: `(\\b(${decimalDigits})((${frac})|\\.)?|(${frac}))[eE][+-]?(${decimalDigits})[fFdD]?\\b` },
          // excluding ExponentPart
          { begin: `\\b(${decimalDigits})((${frac})[fFdD]?\\b|\\.([fFdD]\\b)?)` },
          { begin: `(${frac})[fFdD]?\\b` },
          { begin: `\\b(${decimalDigits})[fFdD]\\b` },
          // HexadecimalFloatingPointLiteral
          { begin: `\\b0[xX]((${hexDigits})\\.?|(${hexDigits})?\\.(${hexDigits}))[pP][+-]?(${decimalDigits})[fFdD]?\\b` },
          // DecimalIntegerLiteral
          { begin: "\\b(0|[1-9](_*[0-9])*)[lL]?\\b" },
          // HexIntegerLiteral
          { begin: `\\b0[xX](${hexDigits})[lL]?\\b` },
          // OctalIntegerLiteral
          { begin: "\\b0(_*[0-7])*[lL]?\\b" },
          // BinaryIntegerLiteral
          { begin: "\\b0[bB][01](_*[01])*[lL]?\\b" }
        ],
        relevance: 0
      };
      function recurRegex(re, substitution, depth) {
        if (depth === -1) return "";
        return re.replace(substitution, (_) => {
          return recurRegex(re, substitution, depth - 1);
        });
      }
      function java(hljs) {
        const regex = hljs.regex;
        const JAVA_IDENT_RE = "[\xC0-\u02B8a-zA-Z_$][\xC0-\u02B8a-zA-Z_$0-9]*";
        const ARRAY_BRACKETS_OPTIONAL_RE = "(?:(?:\\s*\\[\\s*])+)?";
        const SIMPLE_TYPE_RE = JAVA_IDENT_RE + "<@@@>" + ARRAY_BRACKETS_OPTIONAL_RE;
        const WILDCARD_TYPE_RE = "\\?(?:\\s+(?:extends|super)\\s+" + SIMPLE_TYPE_RE + ")?";
        const TYPE_ARG_RE = "(?:" + WILDCARD_TYPE_RE + "|" + SIMPLE_TYPE_RE + ")";
        const TYPE_ARGS_OPTIONAL_RE = recurRegex(
          "(?:\\s*<\\s*" + TYPE_ARG_RE + "(?:\\s*,\\s*" + TYPE_ARG_RE + ")*\\s*>)?",
          /<@@@>/g,
          2
        );
        const MAIN_KEYWORDS = [
          "synchronized",
          "abstract",
          "private",
          "var",
          "static",
          "if",
          "const ",
          "for",
          "while",
          "strictfp",
          "finally",
          "protected",
          "import",
          "native",
          "final",
          "void",
          "enum",
          "else",
          "break",
          "transient",
          "catch",
          "instanceof",
          "volatile",
          "case",
          "assert",
          "package",
          "default",
          "public",
          "try",
          "switch",
          "continue",
          "throws",
          "protected",
          "public",
          "private",
          "module",
          "requires",
          "exports",
          "do",
          "sealed",
          "yield",
          "permits",
          "goto",
          "when"
        ];
        const BUILT_INS = [
          "super",
          "this"
        ];
        const LITERALS = [
          "false",
          "true",
          "null"
        ];
        const TYPES = [
          "char",
          "boolean",
          "long",
          "float",
          "int",
          "byte",
          "short",
          "double"
        ];
        const KEYWORDS = {
          keyword: MAIN_KEYWORDS,
          literal: LITERALS,
          type: TYPES,
          built_in: BUILT_INS
        };
        const ANNOTATION = {
          className: "meta",
          begin: "@" + JAVA_IDENT_RE,
          contains: [
            {
              begin: /\(/,
              end: /\)/,
              contains: ["self"]
              // allow nested () inside our annotation
            }
          ]
        };
        const PARAMS = {
          className: "params",
          begin: /\(/,
          end: /\)/,
          keywords: KEYWORDS,
          relevance: 0,
          contains: [hljs.C_BLOCK_COMMENT_MODE],
          endsParent: true
        };
        return {
          name: "Java",
          aliases: ["jsp"],
          keywords: KEYWORDS,
          illegal: /<\/|#/,
          contains: [
            hljs.COMMENT(
              "/\\*\\*",
              "\\*/",
              {
                relevance: 0,
                contains: [
                  {
                    // eat up @'s in emails to prevent them to be recognized as doctags
                    begin: /\w+@/,
                    relevance: 0
                  },
                  {
                    className: "doctag",
                    begin: "@[A-Za-z]+"
                  }
                ]
              }
            ),
            // relevance boost
            {
              begin: /import java\.[a-z]+\./,
              keywords: "import",
              relevance: 2
            },
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            {
              begin: /"""/,
              end: /"""/,
              className: "string",
              contains: [hljs.BACKSLASH_ESCAPE]
            },
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            {
              match: [
                /\b(?:class|interface|enum|extends|implements|new)/,
                /\s+/,
                JAVA_IDENT_RE
              ],
              className: {
                1: "keyword",
                3: "title.class"
              }
            },
            {
              // Exceptions for hyphenated keywords
              match: /non-sealed/,
              scope: "keyword"
            },
            {
              // Expression keywords prevent keyword-led expressions from being
              // recognized as variable or method declarations.
              beginKeywords: "new throw return else yield assert",
              relevance: 0
            },
            {
              begin: [
                JAVA_IDENT_RE,
                regex.concat(TYPE_ARGS_OPTIONAL_RE, ARRAY_BRACKETS_OPTIONAL_RE, /\s+/),
                JAVA_IDENT_RE,
                ARRAY_BRACKETS_OPTIONAL_RE,
                /\s*/,
                /=(?!=)/
              ],
              className: {
                1: "type",
                3: "variable",
                6: "operator"
              }
            },
            {
              begin: [
                /record/,
                /\s+/,
                JAVA_IDENT_RE
              ],
              className: {
                1: "keyword",
                3: "title.class"
              },
              contains: [
                PARAMS,
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            {
              begin: [
                JAVA_IDENT_RE,
                regex.concat(TYPE_ARGS_OPTIONAL_RE, ARRAY_BRACKETS_OPTIONAL_RE, /\s+/),
                JAVA_IDENT_RE,
                /\s*(?=\()/
              ],
              className: {
                1: "type",
                3: "title.function"
              },
              keywords: KEYWORDS,
              contains: [
                {
                  className: "params",
                  begin: /\(/,
                  end: /\)/,
                  keywords: KEYWORDS,
                  relevance: 0,
                  contains: [
                    ANNOTATION,
                    hljs.APOS_STRING_MODE,
                    hljs.QUOTE_STRING_MODE,
                    NUMERIC,
                    hljs.C_BLOCK_COMMENT_MODE
                  ]
                },
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            NUMERIC,
            ANNOTATION
          ]
        };
      }
      module.exports = java;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/javascript.js
  var require_javascript = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/javascript.js"(exports, module) {
      var IDENT_RE = "[A-Za-z$_][0-9A-Za-z$_]*";
      var KEYWORDS = [
        "as",
        // for exports
        "in",
        "of",
        "if",
        "for",
        "while",
        "finally",
        "var",
        "new",
        "function",
        "do",
        "return",
        "void",
        "else",
        "break",
        "catch",
        "instanceof",
        "with",
        "throw",
        "case",
        "default",
        "try",
        "switch",
        "continue",
        "typeof",
        "delete",
        "let",
        "yield",
        "const",
        "class",
        // JS handles these with a special rule
        // "get",
        // "set",
        "debugger",
        "async",
        "await",
        "static",
        "import",
        "from",
        "export",
        "extends",
        // It's reached stage 3, which is "recommended for implementation":
        "using"
      ];
      var LITERALS = [
        "true",
        "false",
        "null",
        "undefined",
        "NaN",
        "Infinity"
      ];
      var TYPES = [
        // Fundamental objects
        "Object",
        "Function",
        "Boolean",
        "Symbol",
        // numbers and dates
        "Math",
        "Date",
        "Number",
        "BigInt",
        // text
        "String",
        "RegExp",
        // Indexed collections
        "Array",
        "Float32Array",
        "Float64Array",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Int32Array",
        "Uint16Array",
        "Uint32Array",
        "BigInt64Array",
        "BigUint64Array",
        // Keyed collections
        "Set",
        "Map",
        "WeakSet",
        "WeakMap",
        // Structured data
        "ArrayBuffer",
        "SharedArrayBuffer",
        "Atomics",
        "DataView",
        "JSON",
        // Control abstraction objects
        "Promise",
        "Generator",
        "GeneratorFunction",
        "AsyncFunction",
        // Reflection
        "Reflect",
        "Proxy",
        // Internationalization
        "Intl",
        // WebAssembly
        "WebAssembly"
      ];
      var ERROR_TYPES = [
        "Error",
        "EvalError",
        "InternalError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "TypeError",
        "URIError"
      ];
      var BUILT_IN_GLOBALS = [
        "setInterval",
        "setTimeout",
        "clearInterval",
        "clearTimeout",
        "require",
        "exports",
        "eval",
        "isFinite",
        "isNaN",
        "parseFloat",
        "parseInt",
        "decodeURI",
        "decodeURIComponent",
        "encodeURI",
        "encodeURIComponent",
        "escape",
        "unescape"
      ];
      var BUILT_IN_VARIABLES = [
        "arguments",
        "this",
        "super",
        "console",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "module",
        "self",
        "global"
        // Node.js
      ];
      var BUILT_INS = [].concat(
        BUILT_IN_GLOBALS,
        TYPES,
        ERROR_TYPES
      );
      function javascript(hljs) {
        const regex = hljs.regex;
        const hasClosingTag = (match, { after }) => {
          const tag = "</" + match[0].slice(1);
          const pos = match.input.indexOf(tag, after);
          return pos !== -1;
        };
        const IDENT_RE$1 = IDENT_RE;
        const FRAGMENT = {
          begin: "<>",
          end: "</>"
        };
        const XML_SELF_CLOSING = /<[A-Za-z0-9\\._:-]+\s*\/>/;
        const XML_TAG = {
          begin: /<[A-Za-z0-9\\._:-]+/,
          end: /\/[A-Za-z0-9\\._:-]+>|\/>/,
          /**
           * @param {RegExpMatchArray} match
           * @param {CallbackResponse} response
           */
          isTrulyOpeningTag: (match, response) => {
            const afterMatchIndex = match[0].length + match.index;
            const nextChar = match.input[afterMatchIndex];
            if (
              // HTML should not include another raw `<` inside a tag
              // nested type?
              // `<Array<Array<number>>`, etc.
              nextChar === "<" || // the , gives away that this is not HTML
              // `<T, A extends keyof T, V>`
              nextChar === ","
            ) {
              response.ignoreMatch();
              return;
            }
            if (nextChar === ">") {
              if (!hasClosingTag(match, { after: afterMatchIndex })) {
                response.ignoreMatch();
              }
            }
            let m;
            const afterMatch = match.input.substring(afterMatchIndex);
            if (m = afterMatch.match(/^\s*=/)) {
              response.ignoreMatch();
              return;
            }
            if (m = afterMatch.match(/^\s+extends\s+/)) {
              if (m.index === 0) {
                response.ignoreMatch();
                return;
              }
            }
          }
        };
        const KEYWORDS$1 = {
          $pattern: IDENT_RE,
          keyword: KEYWORDS,
          literal: LITERALS,
          built_in: BUILT_INS,
          "variable.language": BUILT_IN_VARIABLES
        };
        const decimalDigits = "[0-9](_?[0-9])*";
        const frac = `\\.(${decimalDigits})`;
        const decimalInteger = `0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`;
        const NUMBER = {
          className: "number",
          variants: [
            // DecimalLiteral
            { begin: `(\\b(${decimalInteger})((${frac})|\\.)?|(${frac}))[eE][+-]?(${decimalDigits})\\b` },
            { begin: `\\b(${decimalInteger})\\b((${frac})\\b|\\.)?|(${frac})\\b` },
            // DecimalBigIntegerLiteral
            { begin: `\\b(0|[1-9](_?[0-9])*)n\\b` },
            // NonDecimalIntegerLiteral
            { begin: "\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b" },
            { begin: "\\b0[bB][0-1](_?[0-1])*n?\\b" },
            { begin: "\\b0[oO][0-7](_?[0-7])*n?\\b" },
            // LegacyOctalIntegerLiteral (does not include underscore separators)
            // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
            { begin: "\\b0[0-7]+n?\\b" }
          ],
          relevance: 0
        };
        const SUBST = {
          className: "subst",
          begin: "\\$\\{",
          end: "\\}",
          keywords: KEYWORDS$1,
          contains: []
          // defined later
        };
        const HTML_TEMPLATE = {
          begin: ".?html`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "xml"
          }
        };
        const CSS_TEMPLATE = {
          begin: ".?css`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "css"
          }
        };
        const GRAPHQL_TEMPLATE = {
          begin: ".?gql`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "graphql"
          }
        };
        const TEMPLATE_STRING = {
          className: "string",
          begin: "`",
          end: "`",
          contains: [
            hljs.BACKSLASH_ESCAPE,
            SUBST
          ]
        };
        const JSDOC_COMMENT = hljs.COMMENT(
          /\/\*\*(?!\/)/,
          "\\*/",
          {
            relevance: 0,
            contains: [
              {
                begin: "(?=@[A-Za-z]+)",
                relevance: 0,
                contains: [
                  {
                    className: "doctag",
                    begin: "@[A-Za-z]+"
                  },
                  {
                    className: "type",
                    begin: "\\{",
                    end: "\\}",
                    excludeEnd: true,
                    excludeBegin: true,
                    relevance: 0
                  },
                  {
                    className: "variable",
                    begin: IDENT_RE$1 + "(?=\\s*(-)|$)",
                    endsParent: true,
                    relevance: 0
                  },
                  // eat spaces (not newlines) so we can find
                  // types or variables
                  {
                    begin: /(?=[^\n])\s/,
                    relevance: 0
                  }
                ]
              }
            ]
          }
        );
        const COMMENT = {
          className: "comment",
          variants: [
            JSDOC_COMMENT,
            hljs.C_BLOCK_COMMENT_MODE,
            hljs.C_LINE_COMMENT_MODE
          ]
        };
        const SUBST_INTERNALS = [
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          HTML_TEMPLATE,
          CSS_TEMPLATE,
          GRAPHQL_TEMPLATE,
          TEMPLATE_STRING,
          // Skip numbers when they are part of a variable name
          { match: /\$\d+/ },
          NUMBER
          // This is intentional:
          // See https://github.com/highlightjs/highlight.js/issues/3288
          // hljs.REGEXP_MODE
        ];
        SUBST.contains = SUBST_INTERNALS.concat({
          // we need to pair up {} inside our subst to prevent
          // it from ending too early by matching another }
          begin: /\{/,
          end: /\}/,
          keywords: KEYWORDS$1,
          contains: [
            "self"
          ].concat(SUBST_INTERNALS)
        });
        const SUBST_AND_COMMENTS = [].concat(COMMENT, SUBST.contains);
        const PARAMS_CONTAINS = SUBST_AND_COMMENTS.concat([
          // eat recursive parens in sub expressions
          {
            begin: /(\s*)\(/,
            end: /\)/,
            keywords: KEYWORDS$1,
            contains: ["self"].concat(SUBST_AND_COMMENTS)
          }
        ]);
        const PARAMS = {
          className: "params",
          // convert this to negative lookbehind in v12
          begin: /(\s*)\(/,
          // to match the parms with
          end: /\)/,
          excludeBegin: true,
          excludeEnd: true,
          keywords: KEYWORDS$1,
          contains: PARAMS_CONTAINS
        };
        const CLASS_OR_EXTENDS = {
          variants: [
            // class Car extends vehicle
            {
              match: [
                /class/,
                /\s+/,
                IDENT_RE$1,
                /\s+/,
                /extends/,
                /\s+/,
                regex.concat(IDENT_RE$1, "(", regex.concat(/\./, IDENT_RE$1), ")*")
              ],
              scope: {
                1: "keyword",
                3: "title.class",
                5: "keyword",
                7: "title.class.inherited"
              }
            },
            // class Car
            {
              match: [
                /class/,
                /\s+/,
                IDENT_RE$1
              ],
              scope: {
                1: "keyword",
                3: "title.class"
              }
            }
          ]
        };
        const CLASS_REFERENCE = {
          relevance: 0,
          match: regex.either(
            // Hard coded exceptions
            /\bJSON/,
            // Float32Array, OutT
            /\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,
            // CSSFactory, CSSFactoryT
            /\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,
            // FPs, FPsT
            /\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/
            // P
            // single letters are not highlighted
            // BLAH
            // this will be flagged as a UPPER_CASE_CONSTANT instead
          ),
          className: "title.class",
          keywords: {
            _: [
              // se we still get relevance credit for JS library classes
              ...TYPES,
              ...ERROR_TYPES
            ]
          }
        };
        const USE_STRICT = {
          label: "use_strict",
          className: "meta",
          relevance: 10,
          begin: /^\s*['"]use (strict|asm)['"]/
        };
        const FUNCTION_DEFINITION = {
          variants: [
            {
              match: [
                /function/,
                /\s+/,
                IDENT_RE$1,
                /(?=\s*\()/
              ]
            },
            // anonymous function
            {
              match: [
                /function/,
                /\s*(?=\()/
              ]
            }
          ],
          className: {
            1: "keyword",
            3: "title.function"
          },
          label: "func.def",
          contains: [PARAMS],
          illegal: /%/
        };
        const UPPER_CASE_CONSTANT = {
          relevance: 0,
          match: /\b[A-Z][A-Z_0-9]+\b/,
          className: "variable.constant"
        };
        function noneOf(list) {
          return regex.concat("(?!", list.join("|"), ")");
        }
        const FUNCTION_CALL = {
          match: regex.concat(
            /\b/,
            noneOf([
              ...BUILT_IN_GLOBALS,
              "super",
              "import",
              "await"
            ].map((x) => `${x}\\s*\\(`)),
            IDENT_RE$1,
            regex.lookahead(/\s*\(/)
          ),
          className: "title.function",
          relevance: 0
        };
        const PROPERTY_ACCESS = {
          begin: regex.concat(/\./, regex.lookahead(
            regex.concat(IDENT_RE$1, /(?![0-9A-Za-z$_(])/)
          )),
          end: IDENT_RE$1,
          excludeBegin: true,
          keywords: "prototype",
          className: "property",
          relevance: 0
        };
        const GETTER_OR_SETTER = {
          match: [
            /get|set/,
            /\s+/,
            IDENT_RE$1,
            /(?=\()/
          ],
          className: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            {
              // eat to avoid empty params
              begin: /\(\)/
            },
            PARAMS
          ]
        };
        const FUNC_LEAD_IN_RE = "(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|" + hljs.UNDERSCORE_IDENT_RE + ")\\s*=>";
        const FUNCTION_VARIABLE = {
          match: [
            /const|var|let/,
            /\s+/,
            IDENT_RE$1,
            /\s*/,
            /=\s*/,
            /(async\s*)?/,
            // async is optional
            regex.lookahead(FUNC_LEAD_IN_RE)
          ],
          keywords: "async",
          className: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            PARAMS
          ]
        };
        return {
          name: "JavaScript",
          aliases: ["js", "jsx", "mjs", "cjs"],
          keywords: KEYWORDS$1,
          // this will be extended by TypeScript
          exports: { PARAMS_CONTAINS, CLASS_REFERENCE },
          illegal: /#(?![$_A-Za-z])/,
          contains: [
            hljs.SHEBANG({
              label: "shebang",
              binary: "node",
              relevance: 5
            }),
            USE_STRICT,
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            HTML_TEMPLATE,
            CSS_TEMPLATE,
            GRAPHQL_TEMPLATE,
            TEMPLATE_STRING,
            COMMENT,
            // Skip numbers when they are part of a variable name
            { match: /\$\d+/ },
            NUMBER,
            CLASS_REFERENCE,
            {
              scope: "attr",
              match: IDENT_RE$1 + regex.lookahead(":"),
              relevance: 0
            },
            FUNCTION_VARIABLE,
            {
              // "value" container
              begin: "(" + hljs.RE_STARTERS_RE + "|\\b(case|return|throw)\\b)\\s*",
              keywords: "return throw case",
              relevance: 0,
              contains: [
                COMMENT,
                hljs.REGEXP_MODE,
                {
                  className: "function",
                  // we have to count the parens to make sure we actually have the
                  // correct bounding ( ) before the =>.  There could be any number of
                  // sub-expressions inside also surrounded by parens.
                  begin: FUNC_LEAD_IN_RE,
                  returnBegin: true,
                  end: "\\s*=>",
                  contains: [
                    {
                      className: "params",
                      variants: [
                        {
                          begin: hljs.UNDERSCORE_IDENT_RE,
                          relevance: 0
                        },
                        {
                          className: null,
                          begin: /\(\s*\)/,
                          skip: true
                        },
                        {
                          begin: /(\s*)\(/,
                          end: /\)/,
                          excludeBegin: true,
                          excludeEnd: true,
                          keywords: KEYWORDS$1,
                          contains: PARAMS_CONTAINS
                        }
                      ]
                    }
                  ]
                },
                {
                  // could be a comma delimited list of params to a function call
                  begin: /,/,
                  relevance: 0
                },
                {
                  match: /\s+/,
                  relevance: 0
                },
                {
                  // JSX
                  variants: [
                    { begin: FRAGMENT.begin, end: FRAGMENT.end },
                    { match: XML_SELF_CLOSING },
                    {
                      begin: XML_TAG.begin,
                      // we carefully check the opening tag to see if it truly
                      // is a tag and not a false positive
                      "on:begin": XML_TAG.isTrulyOpeningTag,
                      end: XML_TAG.end
                    }
                  ],
                  subLanguage: "xml",
                  contains: [
                    {
                      begin: XML_TAG.begin,
                      end: XML_TAG.end,
                      skip: true,
                      contains: ["self"]
                    }
                  ]
                }
              ]
            },
            FUNCTION_DEFINITION,
            {
              // prevent this from getting swallowed up by function
              // since they appear "function like"
              beginKeywords: "while if switch catch for"
            },
            {
              // we have to count the parens to make sure we actually have the correct
              // bounding ( ).  There could be any number of sub-expressions inside
              // also surrounded by parens.
              begin: "\\b(?!function)" + hljs.UNDERSCORE_IDENT_RE + "\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",
              // end parens
              returnBegin: true,
              label: "func.def",
              contains: [
                PARAMS,
                hljs.inherit(hljs.TITLE_MODE, { begin: IDENT_RE$1, className: "title.function" })
              ]
            },
            // catch ... so it won't trigger the property rule below
            {
              match: /\.\.\./,
              relevance: 0
            },
            PROPERTY_ACCESS,
            // hack: prevents detection of keywords in some circumstances
            // .keyword()
            // $keyword = x
            {
              match: "\\$" + IDENT_RE$1,
              relevance: 0
            },
            {
              match: [/\bconstructor(?=\s*\()/],
              className: { 1: "title.function" },
              contains: [PARAMS]
            },
            FUNCTION_CALL,
            UPPER_CASE_CONSTANT,
            CLASS_OR_EXTENDS,
            GETTER_OR_SETTER,
            {
              match: /\$[(.]/
              // relevance booster for a pattern common to JS libs: `$(something)` and `$.something`
            }
          ]
        };
      }
      module.exports = javascript;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/json.js
  var require_json = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/json.js"(exports, module) {
      var EXTENDED_NUMBER_RE = "([-+]?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)|NaN|[-+]?Infinity";
      var EXTENDED_NUMBER_MODE = {
        scope: "number",
        match: EXTENDED_NUMBER_RE,
        relevance: 0
      };
      function json(hljs) {
        const ATTRIBUTE = {
          className: "attr",
          begin: /(("(\\.|[^\\"\r\n])*")|('(\\.|[^\\'\r\n])*'))(?=\s*:)/,
          relevance: 1.01
        };
        const PUNCTUATION = {
          match: /[{}[\],:]/,
          className: "punctuation",
          relevance: 0
        };
        const LITERALS = [
          "true",
          "false",
          "null"
        ];
        const LITERALS_MODE = {
          scope: "literal",
          beginKeywords: LITERALS.join(" ")
        };
        return {
          name: "JSON",
          aliases: ["jsonc", "json5"],
          keywords: {
            literal: LITERALS
          },
          contains: [
            ATTRIBUTE,
            PUNCTUATION,
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            LITERALS_MODE,
            EXTENDED_NUMBER_MODE,
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE
          ],
          illegal: "\\S"
        };
      }
      module.exports = json;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/kotlin.js
  var require_kotlin = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/kotlin.js"(exports, module) {
      var decimalDigits = "[0-9](_*[0-9])*";
      var frac = `\\.(${decimalDigits})`;
      var hexDigits = "[0-9a-fA-F](_*[0-9a-fA-F])*";
      var NUMERIC = {
        className: "number",
        variants: [
          // DecimalFloatingPointLiteral
          // including ExponentPart
          { begin: `(\\b(${decimalDigits})((${frac})|\\.)?|(${frac}))[eE][+-]?(${decimalDigits})[fFdD]?\\b` },
          // excluding ExponentPart
          { begin: `\\b(${decimalDigits})((${frac})[fFdD]?\\b|\\.([fFdD]\\b)?)` },
          { begin: `(${frac})[fFdD]?\\b` },
          { begin: `\\b(${decimalDigits})[fFdD]\\b` },
          // HexadecimalFloatingPointLiteral
          { begin: `\\b0[xX]((${hexDigits})\\.?|(${hexDigits})?\\.(${hexDigits}))[pP][+-]?(${decimalDigits})[fFdD]?\\b` },
          // DecimalIntegerLiteral
          { begin: "\\b(0|[1-9](_*[0-9])*)[lL]?\\b" },
          // HexIntegerLiteral
          { begin: `\\b0[xX](${hexDigits})[lL]?\\b` },
          // OctalIntegerLiteral
          { begin: "\\b0(_*[0-7])*[lL]?\\b" },
          // BinaryIntegerLiteral
          { begin: "\\b0[bB][01](_*[01])*[lL]?\\b" }
        ],
        relevance: 0
      };
      function kotlin(hljs) {
        const KEYWORDS = {
          keyword: "abstract as val var vararg get set class object open private protected public noinline crossinline dynamic final enum if else do while for when throw try catch finally import package is in fun override companion reified inline lateinit init interface annotation data sealed internal infix operator out by constructor super tailrec where const inner suspend typealias external expect actual",
          built_in: "Byte Short Char Int Long Boolean Float Double Void Unit Nothing",
          literal: "true false null"
        };
        const KEYWORDS_WITH_LABEL = {
          className: "keyword",
          begin: /\b(break|continue|return|this)\b/,
          starts: { contains: [
            {
              className: "symbol",
              begin: /@\w+/
            }
          ] }
        };
        const LABEL = {
          className: "symbol",
          begin: hljs.UNDERSCORE_IDENT_RE + "@"
        };
        const SUBST = {
          className: "subst",
          begin: /\$\{/,
          end: /\}/,
          contains: [hljs.C_NUMBER_MODE]
        };
        const VARIABLE = {
          className: "variable",
          begin: "\\$" + hljs.UNDERSCORE_IDENT_RE
        };
        const STRING = {
          className: "string",
          variants: [
            {
              begin: '"""',
              end: '"""(?=[^"])',
              contains: [
                VARIABLE,
                SUBST
              ]
            },
            // Can't use built-in modes easily, as we want to use STRING in the meta
            // context as 'meta-string' and there's no syntax to remove explicitly set
            // classNames in built-in modes.
            {
              begin: "'",
              end: "'",
              illegal: /\n/,
              contains: [hljs.BACKSLASH_ESCAPE]
            },
            {
              begin: '"',
              end: '"',
              illegal: /\n/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                VARIABLE,
                SUBST
              ]
            }
          ]
        };
        SUBST.contains.push(STRING);
        const ANNOTATION_USE_SITE = {
          className: "meta",
          begin: "@(?:file|property|field|get|set|receiver|param|setparam|delegate)\\s*:(?:\\s*" + hljs.UNDERSCORE_IDENT_RE + ")?"
        };
        const ANNOTATION = {
          className: "meta",
          begin: "@" + hljs.UNDERSCORE_IDENT_RE,
          contains: [
            {
              begin: /\(/,
              end: /\)/,
              contains: [
                hljs.inherit(STRING, { className: "string" }),
                "self"
              ]
            }
          ]
        };
        const KOTLIN_NUMBER_MODE = NUMERIC;
        const KOTLIN_NESTED_COMMENT = hljs.COMMENT(
          "/\\*",
          "\\*/",
          { contains: [hljs.C_BLOCK_COMMENT_MODE] }
        );
        const KOTLIN_PAREN_TYPE = { variants: [
          {
            className: "type",
            begin: hljs.UNDERSCORE_IDENT_RE
          },
          {
            begin: /\(/,
            end: /\)/,
            contains: []
            // defined later
          }
        ] };
        const KOTLIN_PAREN_TYPE2 = KOTLIN_PAREN_TYPE;
        KOTLIN_PAREN_TYPE2.variants[1].contains = [KOTLIN_PAREN_TYPE];
        KOTLIN_PAREN_TYPE.variants[1].contains = [KOTLIN_PAREN_TYPE2];
        return {
          name: "Kotlin",
          aliases: [
            "kt",
            "kts",
            "ktm",
            "ktx"
          ],
          keywords: KEYWORDS,
          contains: [
            hljs.COMMENT(
              "/\\*\\*",
              "\\*/",
              {
                relevance: 0,
                contains: [
                  {
                    className: "doctag",
                    begin: "@[A-Za-z]+"
                  }
                ]
              }
            ),
            hljs.C_LINE_COMMENT_MODE,
            KOTLIN_NESTED_COMMENT,
            KEYWORDS_WITH_LABEL,
            LABEL,
            ANNOTATION_USE_SITE,
            ANNOTATION,
            {
              className: "function",
              beginKeywords: "fun",
              end: "[(]|$",
              returnBegin: true,
              excludeEnd: true,
              keywords: KEYWORDS,
              relevance: 5,
              contains: [
                {
                  begin: hljs.UNDERSCORE_IDENT_RE + "\\s*\\(",
                  returnBegin: true,
                  relevance: 0,
                  contains: [hljs.UNDERSCORE_TITLE_MODE]
                },
                {
                  className: "type",
                  begin: /</,
                  end: />/,
                  keywords: "reified",
                  relevance: 0
                },
                {
                  className: "params",
                  begin: /\(/,
                  end: /\)/,
                  endsParent: true,
                  keywords: KEYWORDS,
                  relevance: 0,
                  contains: [
                    {
                      begin: /:/,
                      end: /[=,\/]/,
                      endsWithParent: true,
                      contains: [
                        KOTLIN_PAREN_TYPE,
                        hljs.C_LINE_COMMENT_MODE,
                        KOTLIN_NESTED_COMMENT
                      ],
                      relevance: 0
                    },
                    hljs.C_LINE_COMMENT_MODE,
                    KOTLIN_NESTED_COMMENT,
                    ANNOTATION_USE_SITE,
                    ANNOTATION,
                    STRING,
                    hljs.C_NUMBER_MODE
                  ]
                },
                KOTLIN_NESTED_COMMENT
              ]
            },
            {
              begin: [
                /class|interface|trait/,
                /\s+/,
                hljs.UNDERSCORE_IDENT_RE
              ],
              beginScope: {
                3: "title.class"
              },
              keywords: "class interface trait",
              end: /[:\{(]|$/,
              excludeEnd: true,
              illegal: "extends implements",
              contains: [
                { beginKeywords: "public protected internal private constructor" },
                hljs.UNDERSCORE_TITLE_MODE,
                {
                  className: "type",
                  begin: /</,
                  end: />/,
                  excludeBegin: true,
                  excludeEnd: true,
                  relevance: 0
                },
                {
                  className: "type",
                  begin: /[,:]\s*/,
                  end: /[<\(,){\s]|$/,
                  excludeBegin: true,
                  returnEnd: true
                },
                ANNOTATION_USE_SITE,
                ANNOTATION
              ]
            },
            STRING,
            {
              className: "meta",
              begin: "^#!/usr/bin/env",
              end: "$",
              illegal: "\n"
            },
            KOTLIN_NUMBER_MODE
          ]
        };
      }
      module.exports = kotlin;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/less.js
  var require_less = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/less.js"(exports, module) {
      var MODES = (hljs) => {
        return {
          IMPORTANT: {
            scope: "meta",
            begin: "!important"
          },
          BLOCK_COMMENT: hljs.C_BLOCK_COMMENT_MODE,
          HEXCOLOR: {
            scope: "number",
            begin: /#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/
          },
          UNICODE_RANGE: {
            scope: "number",
            begin: /\b[Uu]\+[0-9A-Fa-f][0-9A-Fa-f?]{0,5}(-[0-9A-Fa-f][0-9A-Fa-f]{0,5})?/
          },
          FUNCTION_DISPATCH: {
            className: "built_in",
            begin: /[\w-]+(?=\()/
          },
          ATTRIBUTE_SELECTOR_MODE: {
            scope: "selector-attr",
            begin: /\[/,
            end: /\]/,
            illegal: "$",
            contains: [
              hljs.APOS_STRING_MODE,
              hljs.QUOTE_STRING_MODE
            ]
          },
          CSS_NUMBER_MODE: {
            scope: "number",
            begin: hljs.NUMBER_RE + "(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",
            relevance: 0
          },
          CSS_VARIABLE: {
            className: "attr",
            begin: /--[A-Za-z_][A-Za-z0-9_-]*/
          }
        };
      };
      var HTML_TAGS = [
        "a",
        "abbr",
        "address",
        "article",
        "aside",
        "audio",
        "b",
        "blockquote",
        "body",
        "button",
        "canvas",
        "caption",
        "cite",
        "code",
        "dd",
        "del",
        "details",
        "dfn",
        "div",
        "dl",
        "dt",
        "em",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "html",
        "i",
        "iframe",
        "img",
        "input",
        "ins",
        "kbd",
        "label",
        "legend",
        "li",
        "main",
        "mark",
        "menu",
        "nav",
        "object",
        "ol",
        "optgroup",
        "option",
        "p",
        "picture",
        "q",
        "quote",
        "samp",
        "section",
        "select",
        "source",
        "span",
        "strong",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "textarea",
        "tfoot",
        "th",
        "thead",
        "time",
        "tr",
        "ul",
        "var",
        "video"
      ];
      var SVG_TAGS = [
        "defs",
        "g",
        "marker",
        "mask",
        "pattern",
        "svg",
        "switch",
        "symbol",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feFlood",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMorphology",
        "feOffset",
        "feSpecularLighting",
        "feTile",
        "feTurbulence",
        "linearGradient",
        "radialGradient",
        "stop",
        "circle",
        "ellipse",
        "image",
        "line",
        "path",
        "polygon",
        "polyline",
        "rect",
        "text",
        "use",
        "textPath",
        "tspan",
        "foreignObject",
        "clipPath"
      ];
      var TAGS = [
        ...HTML_TAGS,
        ...SVG_TAGS
      ];
      var MEDIA_FEATURES = [
        "any-hover",
        "any-pointer",
        "aspect-ratio",
        "color",
        "color-gamut",
        "color-index",
        "device-aspect-ratio",
        "device-height",
        "device-width",
        "display-mode",
        "forced-colors",
        "grid",
        "height",
        "hover",
        "inverted-colors",
        "monochrome",
        "orientation",
        "overflow-block",
        "overflow-inline",
        "pointer",
        "prefers-color-scheme",
        "prefers-contrast",
        "prefers-reduced-motion",
        "prefers-reduced-transparency",
        "resolution",
        "scan",
        "scripting",
        "update",
        "width",
        // TODO: find a better solution?
        "min-width",
        "max-width",
        "min-height",
        "max-height"
      ].sort().reverse();
      var PSEUDO_CLASSES = [
        "active",
        "any-link",
        "blank",
        "checked",
        "current",
        "default",
        "defined",
        "dir",
        // dir()
        "disabled",
        "drop",
        "empty",
        "enabled",
        "first",
        "first-child",
        "first-of-type",
        "fullscreen",
        "future",
        "focus",
        "focus-visible",
        "focus-within",
        "has",
        // has()
        "host",
        // host or host()
        "host-context",
        // host-context()
        "hover",
        "indeterminate",
        "in-range",
        "invalid",
        "is",
        // is()
        "lang",
        // lang()
        "last-child",
        "last-of-type",
        "left",
        "link",
        "local-link",
        "not",
        // not()
        "nth-child",
        // nth-child()
        "nth-col",
        // nth-col()
        "nth-last-child",
        // nth-last-child()
        "nth-last-col",
        // nth-last-col()
        "nth-last-of-type",
        //nth-last-of-type()
        "nth-of-type",
        //nth-of-type()
        "only-child",
        "only-of-type",
        "optional",
        "out-of-range",
        "past",
        "placeholder-shown",
        "read-only",
        "read-write",
        "required",
        "right",
        "root",
        "scope",
        "target",
        "target-within",
        "user-invalid",
        "valid",
        "visited",
        "where"
        // where()
      ].sort().reverse();
      var PSEUDO_ELEMENTS = [
        "after",
        "backdrop",
        "before",
        "cue",
        "cue-region",
        "first-letter",
        "first-line",
        "grammar-error",
        "marker",
        "part",
        "placeholder",
        "selection",
        "slotted",
        "spelling-error"
      ].sort().reverse();
      var ATTRIBUTES = [
        "accent-color",
        "align-content",
        "align-items",
        "align-self",
        "alignment-baseline",
        "all",
        "anchor-name",
        "animation",
        "animation-composition",
        "animation-delay",
        "animation-direction",
        "animation-duration",
        "animation-fill-mode",
        "animation-iteration-count",
        "animation-name",
        "animation-play-state",
        "animation-range",
        "animation-range-end",
        "animation-range-start",
        "animation-timeline",
        "animation-timing-function",
        "appearance",
        "aspect-ratio",
        "backdrop-filter",
        "backface-visibility",
        "background",
        "background-attachment",
        "background-blend-mode",
        "background-clip",
        "background-color",
        "background-image",
        "background-origin",
        "background-position",
        "background-position-x",
        "background-position-y",
        "background-repeat",
        "background-size",
        "baseline-shift",
        "block-size",
        "border",
        "border-block",
        "border-block-color",
        "border-block-end",
        "border-block-end-color",
        "border-block-end-style",
        "border-block-end-width",
        "border-block-start",
        "border-block-start-color",
        "border-block-start-style",
        "border-block-start-width",
        "border-block-style",
        "border-block-width",
        "border-bottom",
        "border-bottom-color",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
        "border-bottom-style",
        "border-bottom-width",
        "border-collapse",
        "border-color",
        "border-end-end-radius",
        "border-end-start-radius",
        "border-image",
        "border-image-outset",
        "border-image-repeat",
        "border-image-slice",
        "border-image-source",
        "border-image-width",
        "border-inline",
        "border-inline-color",
        "border-inline-end",
        "border-inline-end-color",
        "border-inline-end-style",
        "border-inline-end-width",
        "border-inline-start",
        "border-inline-start-color",
        "border-inline-start-style",
        "border-inline-start-width",
        "border-inline-style",
        "border-inline-width",
        "border-left",
        "border-left-color",
        "border-left-style",
        "border-left-width",
        "border-radius",
        "border-right",
        "border-right-color",
        "border-right-style",
        "border-right-width",
        "border-spacing",
        "border-start-end-radius",
        "border-start-start-radius",
        "border-style",
        "border-top",
        "border-top-color",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-top-style",
        "border-top-width",
        "border-width",
        "bottom",
        "box-align",
        "box-decoration-break",
        "box-direction",
        "box-flex",
        "box-flex-group",
        "box-lines",
        "box-ordinal-group",
        "box-orient",
        "box-pack",
        "box-shadow",
        "box-sizing",
        "break-after",
        "break-before",
        "break-inside",
        "caption-side",
        "caret-color",
        "clear",
        "clip",
        "clip-path",
        "clip-rule",
        "color",
        "color-interpolation",
        "color-interpolation-filters",
        "color-profile",
        "color-rendering",
        "color-scheme",
        "column-count",
        "column-fill",
        "column-gap",
        "column-rule",
        "column-rule-color",
        "column-rule-style",
        "column-rule-width",
        "column-span",
        "column-width",
        "columns",
        "contain",
        "contain-intrinsic-block-size",
        "contain-intrinsic-height",
        "contain-intrinsic-inline-size",
        "contain-intrinsic-size",
        "contain-intrinsic-width",
        "container",
        "container-name",
        "container-type",
        "content",
        "content-visibility",
        "corner-bottom-left-shape",
        "corner-bottom-right-shape",
        "corner-shape",
        "corner-top-left-shape",
        "corner-top-right-shape",
        "counter-increment",
        "counter-reset",
        "counter-set",
        "cue",
        "cue-after",
        "cue-before",
        "cursor",
        "cx",
        "cy",
        "direction",
        "display",
        "dominant-baseline",
        "empty-cells",
        "enable-background",
        "field-sizing",
        "fill",
        "fill-opacity",
        "fill-rule",
        "filter",
        "flex",
        "flex-basis",
        "flex-direction",
        "flex-flow",
        "flex-grow",
        "flex-shrink",
        "flex-wrap",
        "float",
        "flood-color",
        "flood-opacity",
        "flow",
        "font",
        "font-display",
        "font-family",
        "font-feature-settings",
        "font-kerning",
        "font-language-override",
        "font-optical-sizing",
        "font-palette",
        "font-size",
        "font-size-adjust",
        "font-smooth",
        "font-smoothing",
        "font-stretch",
        "font-style",
        "font-synthesis",
        "font-synthesis-position",
        "font-synthesis-small-caps",
        "font-synthesis-style",
        "font-synthesis-weight",
        "font-variant",
        "font-variant-alternates",
        "font-variant-caps",
        "font-variant-east-asian",
        "font-variant-emoji",
        "font-variant-ligatures",
        "font-variant-numeric",
        "font-variant-position",
        "font-variation-settings",
        "font-weight",
        "forced-color-adjust",
        "gap",
        "glyph-orientation-horizontal",
        "glyph-orientation-vertical",
        "grid",
        "grid-area",
        "grid-auto-columns",
        "grid-auto-flow",
        "grid-auto-rows",
        "grid-column",
        "grid-column-end",
        "grid-column-start",
        "grid-gap",
        "grid-row",
        "grid-row-end",
        "grid-row-start",
        "grid-template",
        "grid-template-areas",
        "grid-template-columns",
        "grid-template-rows",
        "hanging-punctuation",
        "height",
        "hyphenate-character",
        "hyphenate-limit-chars",
        "hyphens",
        "icon",
        "image-orientation",
        "image-rendering",
        "image-resolution",
        "ime-mode",
        "initial-letter",
        "initial-letter-align",
        "inline-size",
        "inset",
        "inset-area",
        "inset-block",
        "inset-block-end",
        "inset-block-start",
        "inset-inline",
        "inset-inline-end",
        "inset-inline-start",
        "isolation",
        "justify-content",
        "justify-items",
        "justify-self",
        "kerning",
        "left",
        "letter-spacing",
        "lighting-color",
        "line-break",
        "line-height",
        "line-height-step",
        "list-style",
        "list-style-image",
        "list-style-position",
        "list-style-type",
        "margin",
        "margin-block",
        "margin-block-end",
        "margin-block-start",
        "margin-bottom",
        "margin-inline",
        "margin-inline-end",
        "margin-inline-start",
        "margin-left",
        "margin-right",
        "margin-top",
        "margin-trim",
        "marker",
        "marker-end",
        "marker-mid",
        "marker-start",
        "marks",
        "mask",
        "mask-border",
        "mask-border-mode",
        "mask-border-outset",
        "mask-border-repeat",
        "mask-border-slice",
        "mask-border-source",
        "mask-border-width",
        "mask-clip",
        "mask-composite",
        "mask-image",
        "mask-mode",
        "mask-origin",
        "mask-position",
        "mask-repeat",
        "mask-size",
        "mask-type",
        "masonry-auto-flow",
        "math-depth",
        "math-shift",
        "math-style",
        "max-block-size",
        "max-height",
        "max-inline-size",
        "max-width",
        "min-block-size",
        "min-height",
        "min-inline-size",
        "min-width",
        "mix-blend-mode",
        "nav-down",
        "nav-index",
        "nav-left",
        "nav-right",
        "nav-up",
        "none",
        "normal",
        "object-fit",
        "object-position",
        "offset",
        "offset-anchor",
        "offset-distance",
        "offset-path",
        "offset-position",
        "offset-rotate",
        "opacity",
        "order",
        "orphans",
        "outline",
        "outline-color",
        "outline-offset",
        "outline-style",
        "outline-width",
        "overflow",
        "overflow-anchor",
        "overflow-block",
        "overflow-clip-margin",
        "overflow-inline",
        "overflow-wrap",
        "overflow-x",
        "overflow-y",
        "overlay",
        "overscroll-behavior",
        "overscroll-behavior-block",
        "overscroll-behavior-inline",
        "overscroll-behavior-x",
        "overscroll-behavior-y",
        "padding",
        "padding-block",
        "padding-block-end",
        "padding-block-start",
        "padding-bottom",
        "padding-inline",
        "padding-inline-end",
        "padding-inline-start",
        "padding-left",
        "padding-right",
        "padding-top",
        "page",
        "page-break-after",
        "page-break-before",
        "page-break-inside",
        "paint-order",
        "pause",
        "pause-after",
        "pause-before",
        "perspective",
        "perspective-origin",
        "place-content",
        "place-items",
        "place-self",
        "pointer-events",
        "position",
        "position-anchor",
        "position-visibility",
        "print-color-adjust",
        "quotes",
        "r",
        "resize",
        "rest",
        "rest-after",
        "rest-before",
        "right",
        "rotate",
        "row-gap",
        "ruby-align",
        "ruby-position",
        "scale",
        "scroll-behavior",
        "scroll-margin",
        "scroll-margin-block",
        "scroll-margin-block-end",
        "scroll-margin-block-start",
        "scroll-margin-bottom",
        "scroll-margin-inline",
        "scroll-margin-inline-end",
        "scroll-margin-inline-start",
        "scroll-margin-left",
        "scroll-margin-right",
        "scroll-margin-top",
        "scroll-padding",
        "scroll-padding-block",
        "scroll-padding-block-end",
        "scroll-padding-block-start",
        "scroll-padding-bottom",
        "scroll-padding-inline",
        "scroll-padding-inline-end",
        "scroll-padding-inline-start",
        "scroll-padding-left",
        "scroll-padding-right",
        "scroll-padding-top",
        "scroll-snap-align",
        "scroll-snap-stop",
        "scroll-snap-type",
        "scroll-timeline",
        "scroll-timeline-axis",
        "scroll-timeline-name",
        "scrollbar-color",
        "scrollbar-gutter",
        "scrollbar-width",
        "shape-image-threshold",
        "shape-margin",
        "shape-outside",
        "shape-rendering",
        "speak",
        "speak-as",
        "src",
        // @font-face
        "stop-color",
        "stop-opacity",
        "stroke",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-miterlimit",
        "stroke-opacity",
        "stroke-width",
        "tab-size",
        "table-layout",
        "text-align",
        "text-align-all",
        "text-align-last",
        "text-anchor",
        "text-combine-upright",
        "text-decoration",
        "text-decoration-color",
        "text-decoration-line",
        "text-decoration-skip",
        "text-decoration-skip-ink",
        "text-decoration-style",
        "text-decoration-thickness",
        "text-emphasis",
        "text-emphasis-color",
        "text-emphasis-position",
        "text-emphasis-style",
        "text-indent",
        "text-justify",
        "text-orientation",
        "text-overflow",
        "text-rendering",
        "text-shadow",
        "text-size-adjust",
        "text-transform",
        "text-underline-offset",
        "text-underline-position",
        "text-wrap",
        "text-wrap-mode",
        "text-wrap-style",
        "timeline-scope",
        "top",
        "touch-action",
        "transform",
        "transform-box",
        "transform-origin",
        "transform-style",
        "transition",
        "transition-behavior",
        "transition-delay",
        "transition-duration",
        "transition-property",
        "transition-timing-function",
        "translate",
        "unicode-bidi",
        "unicode-range",
        "user-modify",
        "user-select",
        "vector-effect",
        "vertical-align",
        "view-timeline",
        "view-timeline-axis",
        "view-timeline-inset",
        "view-timeline-name",
        "view-transition-name",
        "visibility",
        "voice-balance",
        "voice-duration",
        "voice-family",
        "voice-pitch",
        "voice-range",
        "voice-rate",
        "voice-stress",
        "voice-volume",
        "white-space",
        "white-space-collapse",
        "widows",
        "width",
        "will-change",
        "word-break",
        "word-spacing",
        "word-wrap",
        "writing-mode",
        "x",
        "y",
        "z-index",
        "zoom"
      ].sort().reverse();
      var PSEUDO_SELECTORS = PSEUDO_CLASSES.concat(PSEUDO_ELEMENTS).sort().reverse();
      function less(hljs) {
        const modes = MODES(hljs);
        const PSEUDO_SELECTORS$1 = PSEUDO_SELECTORS;
        const AT_MODIFIERS = "and or not only";
        const IDENT_RE = "[\\w-]+";
        const INTERP_IDENT_RE = "(" + IDENT_RE + "|@\\{" + IDENT_RE + "\\})";
        const RULES = [];
        const VALUE_MODES = [];
        const STRING_MODE = function(c) {
          return {
            // Less strings are not multiline (also include '~' for more consistent coloring of "escaped" strings)
            className: "string",
            begin: "~?" + c + ".*?" + c
          };
        };
        const IDENT_MODE = function(name, begin, relevance) {
          return {
            className: name,
            begin,
            relevance
          };
        };
        const AT_KEYWORDS = {
          $pattern: /[a-z-]+/,
          keyword: AT_MODIFIERS,
          attribute: MEDIA_FEATURES.join(" ")
        };
        const PARENS_MODE = {
          // used only to properly balance nested parens inside mixin call, def. arg list
          begin: "\\(",
          end: "\\)",
          contains: VALUE_MODES,
          keywords: AT_KEYWORDS,
          relevance: 0
        };
        VALUE_MODES.push(
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          STRING_MODE("'"),
          STRING_MODE('"'),
          modes.CSS_NUMBER_MODE,
          // fixme: it does not include dot for numbers like .5em :(
          {
            begin: "(url|data-uri)\\(",
            starts: {
              className: "string",
              end: "[\\)\\n]",
              excludeEnd: true
            }
          },
          modes.UNICODE_RANGE,
          modes.HEXCOLOR,
          PARENS_MODE,
          IDENT_MODE("variable", "@@?" + IDENT_RE, 10),
          IDENT_MODE("variable", "@\\{" + IDENT_RE + "\\}"),
          IDENT_MODE("built_in", "~?`[^`]*?`"),
          // inline javascript (or whatever host language) *multiline* string
          {
            // @media features (it’s here to not duplicate things in AT_RULE_MODE with extra PARENS_MODE overriding):
            className: "attribute",
            begin: IDENT_RE + "\\s*:",
            end: ":",
            returnBegin: true,
            excludeEnd: true
          },
          modes.IMPORTANT,
          { beginKeywords: "and not" },
          modes.FUNCTION_DISPATCH
        );
        const VALUE_WITH_RULESETS = VALUE_MODES.concat({
          begin: /\{/,
          end: /\}/,
          contains: RULES
        });
        const MIXIN_GUARD_MODE = {
          beginKeywords: "when",
          endsWithParent: true,
          contains: [{ beginKeywords: "and not" }].concat(VALUE_MODES)
          // using this form to override VALUE’s 'function' match
        };
        const RULE_MODE = {
          begin: INTERP_IDENT_RE + "\\s*:",
          returnBegin: true,
          end: /[;}]/,
          relevance: 0,
          contains: [
            { begin: /-(webkit|moz|ms|o)-/ },
            modes.CSS_VARIABLE,
            {
              className: "attribute",
              begin: "\\b(" + ATTRIBUTES.join("|") + ")\\b",
              end: /(?=:)/,
              starts: {
                endsWithParent: true,
                illegal: "[<=$]",
                relevance: 0,
                contains: VALUE_MODES
              }
            }
          ]
        };
        const AT_RULE_MODE = {
          className: "keyword",
          begin: "@(import|media|charset|font-face|(-[a-z]+-)?keyframes|supports|document|namespace|page|viewport|host)\\b",
          starts: {
            end: "[;{}]",
            keywords: AT_KEYWORDS,
            returnEnd: true,
            contains: VALUE_MODES,
            relevance: 0
          }
        };
        const VAR_RULE_MODE = {
          className: "variable",
          variants: [
            // using more strict pattern for higher relevance to increase chances of Less detection.
            // this is *the only* Less specific statement used in most of the sources, so...
            // (we’ll still often loose to the css-parser unless there's '//' comment,
            // simply because 1 variable just can't beat 99 properties :)
            {
              begin: "@" + IDENT_RE + "\\s*:",
              relevance: 15
            },
            { begin: "@" + IDENT_RE }
          ],
          starts: {
            end: "[;}]",
            returnEnd: true,
            contains: VALUE_WITH_RULESETS
          }
        };
        const SELECTOR_MODE = {
          // first parse unambiguous selectors (i.e. those not starting with tag)
          // then fall into the scary lookahead-discriminator variant.
          // this mode also handles mixin definitions and calls
          variants: [
            {
              begin: "[\\.#:&\\[>]",
              end: "[;{}]"
              // mixin calls end with ';'
            },
            {
              begin: INTERP_IDENT_RE,
              end: /\{/
            }
          ],
          returnBegin: true,
          returnEnd: true,
          illegal: `[<='$"]`,
          relevance: 0,
          contains: [
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            MIXIN_GUARD_MODE,
            IDENT_MODE("keyword", "all\\b"),
            IDENT_MODE("variable", "@\\{" + IDENT_RE + "\\}"),
            // otherwise it’s identified as tag
            {
              begin: "\\b(" + TAGS.join("|") + ")\\b",
              className: "selector-tag"
            },
            modes.CSS_NUMBER_MODE,
            IDENT_MODE("selector-tag", INTERP_IDENT_RE, 0),
            IDENT_MODE("selector-id", "#" + INTERP_IDENT_RE),
            IDENT_MODE("selector-class", "\\." + INTERP_IDENT_RE, 0),
            IDENT_MODE("selector-tag", "&", 0),
            modes.ATTRIBUTE_SELECTOR_MODE,
            {
              className: "selector-pseudo",
              begin: ":(" + PSEUDO_CLASSES.join("|") + ")"
            },
            {
              className: "selector-pseudo",
              begin: ":(:)?(" + PSEUDO_ELEMENTS.join("|") + ")"
            },
            {
              begin: /\(/,
              end: /\)/,
              relevance: 0,
              contains: VALUE_WITH_RULESETS
            },
            // argument list of parametric mixins
            { begin: "!important" },
            // eat !important after mixin call or it will be colored as tag
            modes.FUNCTION_DISPATCH
          ]
        };
        const PSEUDO_SELECTOR_MODE = {
          begin: IDENT_RE + `:(:)?(${PSEUDO_SELECTORS$1.join("|")})`,
          returnBegin: true,
          contains: [SELECTOR_MODE]
        };
        RULES.push(
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          AT_RULE_MODE,
          VAR_RULE_MODE,
          PSEUDO_SELECTOR_MODE,
          RULE_MODE,
          SELECTOR_MODE,
          MIXIN_GUARD_MODE,
          modes.FUNCTION_DISPATCH
        );
        return {
          name: "Less",
          case_insensitive: true,
          illegal: `[=>'/<($"]`,
          contains: RULES
        };
      }
      module.exports = less;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/lua.js
  var require_lua = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/lua.js"(exports, module) {
      function lua(hljs) {
        const OPENING_LONG_BRACKET = "\\[=*\\[";
        const CLOSING_LONG_BRACKET = "\\]=*\\]";
        const LONG_BRACKETS = {
          begin: OPENING_LONG_BRACKET,
          end: CLOSING_LONG_BRACKET,
          contains: ["self"]
        };
        const COMMENTS = [
          hljs.COMMENT("--(?!" + OPENING_LONG_BRACKET + ")", "$"),
          hljs.COMMENT(
            "--" + OPENING_LONG_BRACKET,
            CLOSING_LONG_BRACKET,
            {
              contains: [LONG_BRACKETS],
              relevance: 10
            }
          )
        ];
        return {
          name: "Lua",
          aliases: ["pluto"],
          keywords: {
            $pattern: hljs.UNDERSCORE_IDENT_RE,
            literal: "true false nil",
            keyword: "and break do else elseif end for goto if in local global not or repeat return then until while",
            built_in: (
              // Metatags and globals:
              "_G _ENV _VERSION __index __newindex __mode __call __metatable __tostring __len __gc __add __sub __mul __div __mod __pow __concat __unm __eq __lt __le assert collectgarbage dofile error getfenv getmetatable ipairs load loadfile loadstring module next pairs pcall print rawequal rawget rawset require select setfenv setmetatable tonumber tostring type unpack xpcall arg self coroutine resume yield status wrap create running debug getupvalue debug sethook getmetatable gethook setmetatable setlocal traceback setfenv getinfo setupvalue getlocal getregistry getfenv io lines write close flush open output type read stderr stdin input stdout popen tmpfile math log max acos huge ldexp pi cos tanh pow deg tan cosh sinh random randomseed frexp ceil floor rad abs sqrt modf asin min mod fmod log10 atan2 exp sin atan os exit setlocale date getenv difftime remove time clock tmpname rename execute package preload loadlib loaded loaders cpath config path seeall string sub upper len gfind rep find match char dump gmatch reverse byte format gsub lower table setn insert getn foreachi maxn foreach concat sort remove"
            )
          },
          contains: COMMENTS.concat([
            {
              className: "function",
              beginKeywords: "function",
              end: "\\)",
              contains: [
                hljs.inherit(hljs.TITLE_MODE, { begin: "([_a-zA-Z]\\w*\\.)*([_a-zA-Z]\\w*:)?[_a-zA-Z]\\w*" }),
                {
                  className: "params",
                  begin: "\\(",
                  endsWithParent: true,
                  contains: COMMENTS
                }
              ].concat(COMMENTS)
            },
            hljs.C_NUMBER_MODE,
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            {
              className: "string",
              begin: OPENING_LONG_BRACKET,
              end: CLOSING_LONG_BRACKET,
              contains: [LONG_BRACKETS],
              relevance: 5
            }
          ])
        };
      }
      module.exports = lua;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/makefile.js
  var require_makefile = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/makefile.js"(exports, module) {
      function makefile(hljs) {
        const VARIABLE = {
          className: "variable",
          variants: [
            {
              begin: "\\$\\(" + hljs.UNDERSCORE_IDENT_RE + "\\)",
              contains: [hljs.BACKSLASH_ESCAPE]
            },
            { begin: /\$[@%<?\^\+\*]/ }
          ]
        };
        const QUOTE_STRING = {
          className: "string",
          begin: /"/,
          end: /"/,
          contains: [
            hljs.BACKSLASH_ESCAPE,
            VARIABLE
          ]
        };
        const FUNC = {
          className: "variable",
          begin: /\$\([\w-]+\s/,
          end: /\)/,
          keywords: { built_in: "subst patsubst strip findstring filter filter-out sort word wordlist firstword lastword dir notdir suffix basename addsuffix addprefix join wildcard realpath abspath error warning shell origin flavor foreach if or and call eval file value" },
          contains: [
            VARIABLE,
            QUOTE_STRING
            // Added QUOTE_STRING as they can be a part of functions
          ]
        };
        const ASSIGNMENT = { begin: "^" + hljs.UNDERSCORE_IDENT_RE + "\\s*(?=[:+?]?=)" };
        const META = {
          className: "meta",
          begin: /^\.PHONY:/,
          end: /$/,
          keywords: {
            $pattern: /[\.\w]+/,
            keyword: ".PHONY"
          }
        };
        const TARGET = {
          className: "section",
          begin: /^[^\s]+:/,
          end: /$/,
          contains: [VARIABLE]
        };
        return {
          name: "Makefile",
          aliases: [
            "mk",
            "mak",
            "make"
          ],
          keywords: {
            $pattern: /[\w-]+/,
            keyword: "define endef undefine ifdef ifndef ifeq ifneq else endif include -include sinclude override export unexport private vpath"
          },
          contains: [
            hljs.HASH_COMMENT_MODE,
            VARIABLE,
            QUOTE_STRING,
            FUNC,
            ASSIGNMENT,
            META,
            TARGET
          ]
        };
      }
      module.exports = makefile;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/perl.js
  var require_perl = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/perl.js"(exports, module) {
      function perl(hljs) {
        const regex = hljs.regex;
        const KEYWORDS = [
          "abs",
          "accept",
          "alarm",
          "and",
          "atan2",
          "bind",
          "binmode",
          "bless",
          "break",
          "caller",
          "chdir",
          "chmod",
          "chomp",
          "chop",
          "chown",
          "chr",
          "chroot",
          "class",
          "close",
          "closedir",
          "connect",
          "continue",
          "cos",
          "crypt",
          "dbmclose",
          "dbmopen",
          "defined",
          "delete",
          "die",
          "do",
          "dump",
          "each",
          "else",
          "elsif",
          "endgrent",
          "endhostent",
          "endnetent",
          "endprotoent",
          "endpwent",
          "endservent",
          "eof",
          "eval",
          "exec",
          "exists",
          "exit",
          "exp",
          "fcntl",
          "field",
          "fileno",
          "flock",
          "for",
          "foreach",
          "fork",
          "format",
          "formline",
          "getc",
          "getgrent",
          "getgrgid",
          "getgrnam",
          "gethostbyaddr",
          "gethostbyname",
          "gethostent",
          "getlogin",
          "getnetbyaddr",
          "getnetbyname",
          "getnetent",
          "getpeername",
          "getpgrp",
          "getpriority",
          "getprotobyname",
          "getprotobynumber",
          "getprotoent",
          "getpwent",
          "getpwnam",
          "getpwuid",
          "getservbyname",
          "getservbyport",
          "getservent",
          "getsockname",
          "getsockopt",
          "given",
          "glob",
          "gmtime",
          "goto",
          "grep",
          "gt",
          "hex",
          "if",
          "index",
          "int",
          "ioctl",
          "join",
          "keys",
          "kill",
          "last",
          "lc",
          "lcfirst",
          "length",
          "link",
          "listen",
          "local",
          "localtime",
          "log",
          "lstat",
          "lt",
          "ma",
          "map",
          "method",
          "mkdir",
          "msgctl",
          "msgget",
          "msgrcv",
          "msgsnd",
          "my",
          "ne",
          "next",
          "no",
          "not",
          "oct",
          "open",
          "opendir",
          "or",
          "ord",
          "our",
          "pack",
          "package",
          "pipe",
          "pop",
          "pos",
          "print",
          "printf",
          "prototype",
          "push",
          "q|0",
          "qq",
          "quotemeta",
          "qw",
          "qx",
          "rand",
          "read",
          "readdir",
          "readline",
          "readlink",
          "readpipe",
          "recv",
          "redo",
          "ref",
          "rename",
          "require",
          "reset",
          "return",
          "reverse",
          "rewinddir",
          "rindex",
          "rmdir",
          "say",
          "scalar",
          "seek",
          "seekdir",
          "select",
          "semctl",
          "semget",
          "semop",
          "send",
          "setgrent",
          "sethostent",
          "setnetent",
          "setpgrp",
          "setpriority",
          "setprotoent",
          "setpwent",
          "setservent",
          "setsockopt",
          "shift",
          "shmctl",
          "shmget",
          "shmread",
          "shmwrite",
          "shutdown",
          "sin",
          "sleep",
          "socket",
          "socketpair",
          "sort",
          "splice",
          "split",
          "sprintf",
          "sqrt",
          "srand",
          "stat",
          "state",
          "study",
          "sub",
          "substr",
          "symlink",
          "syscall",
          "sysopen",
          "sysread",
          "sysseek",
          "system",
          "syswrite",
          "tell",
          "telldir",
          "tie",
          "tied",
          "time",
          "times",
          "tr",
          "truncate",
          "uc",
          "ucfirst",
          "umask",
          "undef",
          "unless",
          "unlink",
          "unpack",
          "unshift",
          "untie",
          "until",
          "use",
          "utime",
          "values",
          "vec",
          "wait",
          "waitpid",
          "wantarray",
          "warn",
          "when",
          "while",
          "write",
          "x|0",
          "xor",
          "y|0"
        ];
        const REGEX_MODIFIERS = /[dualxmsipngr]{0,12}/;
        const PERL_KEYWORDS = {
          $pattern: /[\w.]+/,
          keyword: KEYWORDS.join(" ")
        };
        const SUBST = {
          className: "subst",
          begin: "[$@]\\{",
          end: "\\}",
          keywords: PERL_KEYWORDS
        };
        const METHOD = {
          begin: /->\{/,
          end: /\}/
          // contains defined later
        };
        const ATTR = {
          scope: "attr",
          match: /\s+:\s*\w+(\s*\(.*?\))?/
        };
        const VAR = {
          scope: "variable",
          variants: [
            { begin: /\$\d/ },
            {
              begin: regex.concat(
                /[$%@](?!")(\^\w\b|#\w+(::\w+)*|\{\w+\}|\w+(::\w*)*)/,
                // negative look-ahead tries to avoid matching patterns that are not
                // Perl at all like $ident$, @ident@, etc.
                `(?![A-Za-z])(?![@$%])`
              )
            },
            {
              // Only $= is a special Perl variable and one can't declare @= or %=.
              begin: /[$%@](?!")[^\s\w{=]|\$=/,
              relevance: 0
            }
          ],
          contains: [ATTR]
        };
        const NUMBER = {
          className: "number",
          variants: [
            // decimal numbers:
            // include the case where a number starts with a dot (eg. .9), and
            // the leading 0? avoids mixing the first and second match on 0.x cases
            { match: /0?\.[0-9][0-9_]+\b/ },
            // include the special versioned number (eg. v5.38)
            { match: /\bv?(0|[1-9][0-9_]*(\.[0-9_]+)?|[1-9][0-9_]*)\b/ },
            // non-decimal numbers:
            { match: /\b0[0-7][0-7_]*\b/ },
            { match: /\b0x[0-9a-fA-F][0-9a-fA-F_]*\b/ },
            { match: /\b0b[0-1][0-1_]*\b/ }
          ],
          relevance: 0
        };
        const STRING_CONTAINS = [
          hljs.BACKSLASH_ESCAPE,
          SUBST,
          VAR
        ];
        const REGEX_DELIMS = [
          /!/,
          /\//,
          /\|/,
          /\?/,
          /'/,
          /"/,
          // valid but infrequent and weird
          /#/
          // valid but infrequent and weird
        ];
        const PAIRED_DOUBLE_RE = (prefix, open, close = "\\1") => {
          const middle = close === "\\1" ? close : regex.concat(close, open);
          return regex.concat(
            regex.concat("(?:", prefix, ")"),
            open,
            /(?:\\.|[^\\\/])*?/,
            middle,
            /(?:\\.|[^\\\/])*?/,
            close,
            REGEX_MODIFIERS
          );
        };
        const PAIRED_RE = (prefix, open, close) => {
          return regex.concat(
            regex.concat("(?:", prefix, ")"),
            open,
            /(?:\\.|[^\\\/])*?/,
            close,
            REGEX_MODIFIERS
          );
        };
        const PERL_DEFAULT_CONTAINS = [
          VAR,
          hljs.HASH_COMMENT_MODE,
          hljs.COMMENT(
            /^=\w/,
            /=cut/,
            { endsWithParent: true }
          ),
          METHOD,
          {
            className: "string",
            contains: STRING_CONTAINS,
            variants: [
              {
                begin: "q[qwxr]?\\s*\\(",
                end: "\\)",
                relevance: 5
              },
              {
                begin: "q[qwxr]?\\s*\\[",
                end: "\\]",
                relevance: 5
              },
              {
                begin: "q[qwxr]?\\s*\\{",
                end: "\\}",
                relevance: 5
              },
              {
                begin: "q[qwxr]?\\s*\\|",
                end: "\\|",
                relevance: 5
              },
              {
                begin: "q[qwxr]?\\s*<",
                end: ">",
                relevance: 5
              },
              {
                begin: "qw\\s+q",
                end: "q",
                relevance: 5
              },
              {
                begin: "'",
                end: "'",
                contains: [hljs.BACKSLASH_ESCAPE]
              },
              {
                begin: '"',
                end: '"'
              },
              {
                begin: "`",
                end: "`",
                contains: [hljs.BACKSLASH_ESCAPE]
              },
              {
                begin: /\{\w+\}/,
                relevance: 0
              },
              {
                begin: "-?\\w+\\s*=>",
                relevance: 0
              }
            ]
          },
          NUMBER,
          {
            // regexp container
            begin: "(\\/\\/|" + hljs.RE_STARTERS_RE + "|\\b(split|return|print|reverse|grep)\\b)\\s*",
            keywords: "split return print reverse grep",
            relevance: 0,
            contains: [
              hljs.HASH_COMMENT_MODE,
              {
                className: "regexp",
                variants: [
                  // allow matching common delimiters
                  { begin: PAIRED_DOUBLE_RE("s|tr|y", regex.either(...REGEX_DELIMS, { capture: true })) },
                  // and then paired delmis
                  { begin: PAIRED_DOUBLE_RE("s|tr|y", "\\(", "\\)") },
                  { begin: PAIRED_DOUBLE_RE("s|tr|y", "\\[", "\\]") },
                  { begin: PAIRED_DOUBLE_RE("s|tr|y", "\\{", "\\}") }
                ],
                relevance: 2
              },
              {
                className: "regexp",
                variants: [
                  {
                    // could be a comment in many languages so do not count
                    // as relevant
                    begin: /(m|qr)\/\//,
                    relevance: 0
                  },
                  // prefix is optional with /regex/
                  { begin: PAIRED_RE("(?:m|qr)?", /\//, /\//) },
                  // allow matching common delimiters
                  { begin: PAIRED_RE("m|qr", regex.either(...REGEX_DELIMS, { capture: true }), /\1/) },
                  // allow common paired delmins
                  { begin: PAIRED_RE("m|qr", /\(/, /\)/) },
                  { begin: PAIRED_RE("m|qr", /\[/, /\]/) },
                  { begin: PAIRED_RE("m|qr", /\{/, /\}/) }
                ]
              }
            ]
          },
          {
            className: "function",
            beginKeywords: "sub method",
            end: "(\\s*\\(.*?\\))?[;{]",
            excludeEnd: true,
            relevance: 5,
            contains: [hljs.TITLE_MODE, ATTR]
          },
          {
            className: "class",
            beginKeywords: "class",
            end: "[;{]",
            excludeEnd: true,
            relevance: 5,
            contains: [hljs.TITLE_MODE, ATTR, NUMBER]
          },
          {
            begin: "-\\w\\b",
            relevance: 0
          },
          {
            begin: "^__DATA__$",
            end: "^__END__$",
            subLanguage: "mojolicious",
            contains: [
              {
                begin: "^@@.*",
                end: "$",
                className: "comment"
              }
            ]
          }
        ];
        SUBST.contains = PERL_DEFAULT_CONTAINS;
        METHOD.contains = PERL_DEFAULT_CONTAINS;
        return {
          name: "Perl",
          aliases: [
            "pl",
            "pm"
          ],
          keywords: PERL_KEYWORDS,
          contains: PERL_DEFAULT_CONTAINS
        };
      }
      module.exports = perl;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/objectivec.js
  var require_objectivec = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/objectivec.js"(exports, module) {
      function objectivec(hljs) {
        const API_CLASS = {
          className: "built_in",
          begin: "\\b(AV|CA|CF|CG|CI|CL|CM|CN|CT|MK|MP|MTK|MTL|NS|SCN|SK|UI|WK|XC)\\w+"
        };
        const IDENTIFIER_RE = /[a-zA-Z@][a-zA-Z0-9_]*/;
        const TYPES = [
          "int",
          "float",
          "char",
          "unsigned",
          "signed",
          "short",
          "long",
          "double",
          "wchar_t",
          "unichar",
          "void",
          "bool",
          "BOOL",
          "id|0",
          "_Bool"
        ];
        const KWS = [
          "while",
          "export",
          "sizeof",
          "typedef",
          "const",
          "struct",
          "for",
          "union",
          "volatile",
          "static",
          "mutable",
          "if",
          "do",
          "return",
          "goto",
          "enum",
          "else",
          "break",
          "extern",
          "asm",
          "case",
          "default",
          "register",
          "explicit",
          "typename",
          "switch",
          "continue",
          "inline",
          "readonly",
          "assign",
          "readwrite",
          "self",
          "@synchronized",
          "id",
          "typeof",
          "nonatomic",
          "IBOutlet",
          "IBAction",
          "strong",
          "weak",
          "copy",
          "in",
          "out",
          "inout",
          "bycopy",
          "byref",
          "oneway",
          "__strong",
          "__weak",
          "__block",
          "__autoreleasing",
          "@private",
          "@protected",
          "@public",
          "@try",
          "@property",
          "@end",
          "@throw",
          "@catch",
          "@finally",
          "@autoreleasepool",
          "@synthesize",
          "@dynamic",
          "@selector",
          "@optional",
          "@required",
          "@encode",
          "@package",
          "@import",
          "@defs",
          "@compatibility_alias",
          "__bridge",
          "__bridge_transfer",
          "__bridge_retained",
          "__bridge_retain",
          "__covariant",
          "__contravariant",
          "__kindof",
          "_Nonnull",
          "_Nullable",
          "_Null_unspecified",
          "__FUNCTION__",
          "__PRETTY_FUNCTION__",
          "__attribute__",
          "getter",
          "setter",
          "retain",
          "unsafe_unretained",
          "nonnull",
          "nullable",
          "null_unspecified",
          "null_resettable",
          "class",
          "instancetype",
          "NS_DESIGNATED_INITIALIZER",
          "NS_UNAVAILABLE",
          "NS_REQUIRES_SUPER",
          "NS_RETURNS_INNER_POINTER",
          "NS_INLINE",
          "NS_AVAILABLE",
          "NS_DEPRECATED",
          "NS_ENUM",
          "NS_OPTIONS",
          "NS_SWIFT_UNAVAILABLE",
          "NS_ASSUME_NONNULL_BEGIN",
          "NS_ASSUME_NONNULL_END",
          "NS_REFINED_FOR_SWIFT",
          "NS_SWIFT_NAME",
          "NS_SWIFT_NOTHROW",
          "NS_DURING",
          "NS_HANDLER",
          "NS_ENDHANDLER",
          "NS_VALUERETURN",
          "NS_VOIDRETURN"
        ];
        const LITERALS = [
          "false",
          "true",
          "FALSE",
          "TRUE",
          "nil",
          "YES",
          "NO",
          "NULL"
        ];
        const BUILT_INS = [
          "dispatch_once_t",
          "dispatch_queue_t",
          "dispatch_sync",
          "dispatch_async",
          "dispatch_once"
        ];
        const KEYWORDS = {
          "variable.language": [
            "this",
            "super"
          ],
          $pattern: IDENTIFIER_RE,
          keyword: KWS,
          literal: LITERALS,
          built_in: BUILT_INS,
          type: TYPES
        };
        const CLASS_KEYWORDS = {
          $pattern: IDENTIFIER_RE,
          keyword: [
            "@interface",
            "@class",
            "@protocol",
            "@implementation"
          ]
        };
        return {
          name: "Objective-C",
          aliases: [
            "mm",
            "objc",
            "obj-c",
            "obj-c++",
            "objective-c++"
          ],
          keywords: KEYWORDS,
          illegal: "</",
          contains: [
            API_CLASS,
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            hljs.C_NUMBER_MODE,
            hljs.QUOTE_STRING_MODE,
            hljs.APOS_STRING_MODE,
            {
              className: "string",
              variants: [
                {
                  begin: '@"',
                  end: '"',
                  illegal: "\\n",
                  contains: [hljs.BACKSLASH_ESCAPE]
                }
              ]
            },
            {
              className: "meta",
              begin: /#\s*[a-z]+\b/,
              end: /$/,
              keywords: { keyword: "if else elif endif define undef warning error line pragma ifdef ifndef include" },
              contains: [
                {
                  begin: /\\\n/,
                  relevance: 0
                },
                hljs.inherit(hljs.QUOTE_STRING_MODE, { className: "string" }),
                {
                  className: "string",
                  begin: /<.*?>/,
                  end: /$/,
                  illegal: "\\n"
                },
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE
              ]
            },
            {
              className: "class",
              begin: "(" + CLASS_KEYWORDS.keyword.join("|") + ")\\b",
              end: /(\{|$)/,
              excludeEnd: true,
              keywords: CLASS_KEYWORDS,
              contains: [hljs.UNDERSCORE_TITLE_MODE]
            },
            {
              begin: "\\." + hljs.UNDERSCORE_IDENT_RE,
              relevance: 0
            }
          ]
        };
      }
      module.exports = objectivec;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/php.js
  var require_php = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/php.js"(exports, module) {
      function php(hljs) {
        const regex = hljs.regex;
        const NOT_PERL_ETC = /(?![A-Za-z0-9])(?![$])/;
        const IDENT_RE = regex.concat(
          /[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/,
          NOT_PERL_ETC
        );
        const PASCAL_CASE_CLASS_NAME_RE = regex.concat(
          /(\\?[A-Z][a-z0-9_\x7f-\xff]+|\\?[A-Z]+(?=[A-Z][a-z0-9_\x7f-\xff])){1,}/,
          NOT_PERL_ETC
        );
        const UPCASE_NAME_RE = regex.concat(
          /[A-Z]+/,
          NOT_PERL_ETC
        );
        const VARIABLE = {
          scope: "variable",
          match: "\\$+" + IDENT_RE
        };
        const PREPROCESSOR = {
          scope: "meta",
          variants: [
            { begin: /<\?php/, relevance: 10 },
            // boost for obvious PHP
            { begin: /<\?=/ },
            // less relevant per PSR-1 which says not to use short-tags
            { begin: /<\?/, relevance: 0.1 },
            { begin: /\?>/ }
            // end php tag
          ]
        };
        const SUBST = {
          scope: "subst",
          variants: [
            { begin: /\$\w+/ },
            {
              begin: /\{\$/,
              end: /\}/
            }
          ]
        };
        const SINGLE_QUOTED = hljs.inherit(hljs.APOS_STRING_MODE, { illegal: null });
        const DOUBLE_QUOTED = hljs.inherit(hljs.QUOTE_STRING_MODE, {
          illegal: null,
          contains: hljs.QUOTE_STRING_MODE.contains.concat(SUBST)
        });
        const HEREDOC = {
          begin: /<<<[ \t]*(?:(\w+)|"(\w+)")\n/,
          end: /[ \t]*(\w+)\b/,
          contains: hljs.QUOTE_STRING_MODE.contains.concat(SUBST),
          "on:begin": (m, resp) => {
            resp.data._beginMatch = m[1] || m[2];
          },
          "on:end": (m, resp) => {
            if (resp.data._beginMatch !== m[1]) resp.ignoreMatch();
          }
        };
        const NOWDOC = hljs.END_SAME_AS_BEGIN({
          begin: /<<<[ \t]*'(\w+)'\n/,
          end: /[ \t]*(\w+)\b/
        });
        const WHITESPACE = "[ 	\n]";
        const STRING = {
          scope: "string",
          variants: [
            DOUBLE_QUOTED,
            SINGLE_QUOTED,
            HEREDOC,
            NOWDOC
          ]
        };
        const NUMBER = {
          scope: "number",
          variants: [
            { begin: `\\b0[bB][01]+(?:_[01]+)*\\b` },
            // Binary w/ underscore support
            { begin: `\\b0[oO][0-7]+(?:_[0-7]+)*\\b` },
            // Octals w/ underscore support
            { begin: `\\b0[xX][\\da-fA-F]+(?:_[\\da-fA-F]+)*\\b` },
            // Hex w/ underscore support
            // Decimals w/ underscore support, with optional fragments and scientific exponent (e) suffix.
            { begin: `(?:\\b\\d+(?:_\\d+)*(\\.(?:\\d+(?:_\\d+)*))?|\\B\\.\\d+)(?:[eE][+-]?\\d+)?` }
          ],
          relevance: 0
        };
        const LITERALS = [
          "false",
          "null",
          "true"
        ];
        const KWS = [
          // Magic constants:
          // <https://www.php.net/manual/en/language.constants.predefined.php>
          "__CLASS__",
          "__DIR__",
          "__FILE__",
          "__FUNCTION__",
          "__COMPILER_HALT_OFFSET__",
          "__LINE__",
          "__METHOD__",
          "__NAMESPACE__",
          "__TRAIT__",
          // Function that look like language construct or language construct that look like function:
          // List of keywords that may not require parenthesis
          "die",
          "echo",
          "exit",
          "include",
          "include_once",
          "print",
          "require",
          "require_once",
          // These are not language construct (function) but operate on the currently-executing function and can access the current symbol table
          // 'compact extract func_get_arg func_get_args func_num_args get_called_class get_parent_class ' +
          // Other keywords:
          // <https://www.php.net/manual/en/reserved.php>
          // <https://www.php.net/manual/en/language.types.type-juggling.php>
          "array",
          "abstract",
          "and",
          "as",
          "binary",
          "bool",
          "boolean",
          "break",
          "callable",
          "case",
          "catch",
          "class",
          "clone",
          "const",
          "continue",
          "declare",
          "default",
          "do",
          "double",
          "else",
          "elseif",
          "empty",
          "enddeclare",
          "endfor",
          "endforeach",
          "endif",
          "endswitch",
          "endwhile",
          "enum",
          "eval",
          "extends",
          "final",
          "finally",
          "float",
          "for",
          "foreach",
          "from",
          "global",
          "goto",
          "if",
          "implements",
          "instanceof",
          "insteadof",
          "int",
          "integer",
          "interface",
          "isset",
          "iterable",
          "list",
          "match|0",
          "mixed",
          "new",
          "never",
          "object",
          "or",
          "private",
          "protected",
          "public",
          "readonly",
          "real",
          "return",
          "string",
          "switch",
          "throw",
          "trait",
          "try",
          "unset",
          "use",
          "var",
          "void",
          "while",
          "xor",
          "yield"
        ];
        const BUILT_INS = [
          // Standard PHP library:
          // <https://www.php.net/manual/en/book.spl.php>
          "Error|0",
          "AppendIterator",
          "ArgumentCountError",
          "ArithmeticError",
          "ArrayIterator",
          "ArrayObject",
          "AssertionError",
          "BadFunctionCallException",
          "BadMethodCallException",
          "CachingIterator",
          "CallbackFilterIterator",
          "CompileError",
          "Countable",
          "DirectoryIterator",
          "DivisionByZeroError",
          "DomainException",
          "EmptyIterator",
          "ErrorException",
          "Exception",
          "FilesystemIterator",
          "FilterIterator",
          "GlobIterator",
          "InfiniteIterator",
          "InvalidArgumentException",
          "IteratorIterator",
          "LengthException",
          "LimitIterator",
          "LogicException",
          "MultipleIterator",
          "NoRewindIterator",
          "OutOfBoundsException",
          "OutOfRangeException",
          "OuterIterator",
          "OverflowException",
          "ParentIterator",
          "ParseError",
          "RangeException",
          "RecursiveArrayIterator",
          "RecursiveCachingIterator",
          "RecursiveCallbackFilterIterator",
          "RecursiveDirectoryIterator",
          "RecursiveFilterIterator",
          "RecursiveIterator",
          "RecursiveIteratorIterator",
          "RecursiveRegexIterator",
          "RecursiveTreeIterator",
          "RegexIterator",
          "RuntimeException",
          "SeekableIterator",
          "SplDoublyLinkedList",
          "SplFileInfo",
          "SplFileObject",
          "SplFixedArray",
          "SplHeap",
          "SplMaxHeap",
          "SplMinHeap",
          "SplObjectStorage",
          "SplObserver",
          "SplPriorityQueue",
          "SplQueue",
          "SplStack",
          "SplSubject",
          "SplTempFileObject",
          "TypeError",
          "UnderflowException",
          "UnexpectedValueException",
          "UnhandledMatchError",
          // Reserved interfaces:
          // <https://www.php.net/manual/en/reserved.interfaces.php>
          "ArrayAccess",
          "BackedEnum",
          "Closure",
          "Fiber",
          "Generator",
          "Iterator",
          "IteratorAggregate",
          "Serializable",
          "Stringable",
          "Throwable",
          "Traversable",
          "UnitEnum",
          "WeakReference",
          "WeakMap",
          // Reserved classes:
          // <https://www.php.net/manual/en/reserved.classes.php>
          "Directory",
          "__PHP_Incomplete_Class",
          "parent",
          "php_user_filter",
          "self",
          "static",
          "stdClass"
        ];
        const dualCase = (items) => {
          const result = [];
          items.forEach((item) => {
            result.push(item);
            if (item.toLowerCase() === item) {
              result.push(item.toUpperCase());
            } else {
              result.push(item.toLowerCase());
            }
          });
          return result;
        };
        const KEYWORDS = {
          keyword: KWS,
          literal: dualCase(LITERALS),
          built_in: BUILT_INS
        };
        const normalizeKeywords = (items) => {
          return items.map((item) => {
            return item.replace(/\|\d+$/, "");
          });
        };
        const CONSTRUCTOR_CALL = { variants: [
          {
            match: [
              /new/,
              regex.concat(WHITESPACE, "+"),
              // to prevent built ins from being confused as the class constructor call
              regex.concat("(?!", normalizeKeywords(BUILT_INS).join("\\b|"), "\\b)"),
              PASCAL_CASE_CLASS_NAME_RE
            ],
            scope: {
              1: "keyword",
              4: "title.class"
            }
          }
        ] };
        const CONSTANT_REFERENCE = regex.concat(IDENT_RE, "\\b(?!\\()");
        const LEFT_AND_RIGHT_SIDE_OF_DOUBLE_COLON = { variants: [
          {
            match: [
              regex.concat(
                /::/,
                regex.lookahead(/(?!class\b)/)
              ),
              CONSTANT_REFERENCE
            ],
            scope: { 2: "variable.constant" }
          },
          {
            match: [
              /::/,
              /class/
            ],
            scope: { 2: "variable.language" }
          },
          {
            match: [
              PASCAL_CASE_CLASS_NAME_RE,
              regex.concat(
                /::/,
                regex.lookahead(/(?!class\b)/)
              ),
              CONSTANT_REFERENCE
            ],
            scope: {
              1: "title.class",
              3: "variable.constant"
            }
          },
          {
            match: [
              PASCAL_CASE_CLASS_NAME_RE,
              regex.concat(
                "::",
                regex.lookahead(/(?!class\b)/)
              )
            ],
            scope: { 1: "title.class" }
          },
          {
            match: [
              PASCAL_CASE_CLASS_NAME_RE,
              /::/,
              /class/
            ],
            scope: {
              1: "title.class",
              3: "variable.language"
            }
          }
        ] };
        const NAMED_ARGUMENT = {
          scope: "attr",
          match: regex.concat(IDENT_RE, regex.lookahead(":"), regex.lookahead(/(?!::)/))
        };
        const PARAMS_MODE = {
          relevance: 0,
          begin: /\(/,
          end: /\)/,
          keywords: KEYWORDS,
          contains: [
            NAMED_ARGUMENT,
            VARIABLE,
            LEFT_AND_RIGHT_SIDE_OF_DOUBLE_COLON,
            hljs.C_BLOCK_COMMENT_MODE,
            hljs.C_LINE_COMMENT_MODE,
            hljs.HASH_COMMENT_MODE,
            STRING,
            NUMBER,
            CONSTRUCTOR_CALL
          ]
        };
        const FUNCTION_INVOKE = {
          relevance: 0,
          match: [
            /\b/,
            // to prevent keywords from being confused as the function title
            regex.concat("(?!fn\\b|function\\b|", normalizeKeywords(KWS).join("\\b|"), "|", normalizeKeywords(BUILT_INS).join("\\b|"), "\\b)"),
            IDENT_RE,
            regex.concat(WHITESPACE, "*"),
            regex.lookahead(/(?=\()/)
          ],
          scope: { 3: "title.function.invoke" },
          contains: [PARAMS_MODE]
        };
        PARAMS_MODE.contains.push(FUNCTION_INVOKE);
        const ATTRIBUTE_CONTAINS = [
          NAMED_ARGUMENT,
          LEFT_AND_RIGHT_SIDE_OF_DOUBLE_COLON,
          hljs.C_BLOCK_COMMENT_MODE,
          hljs.C_LINE_COMMENT_MODE,
          hljs.HASH_COMMENT_MODE,
          STRING,
          NUMBER,
          CONSTRUCTOR_CALL
        ];
        const ATTRIBUTES = {
          begin: regex.concat(
            /#\[\s*\\?/,
            regex.either(
              PASCAL_CASE_CLASS_NAME_RE,
              UPCASE_NAME_RE
            )
          ),
          beginScope: "meta",
          end: /]/,
          endScope: "meta",
          keywords: {
            literal: LITERALS,
            keyword: [
              "new",
              "array"
            ]
          },
          contains: [
            {
              begin: /\[/,
              end: /]/,
              keywords: {
                literal: LITERALS,
                keyword: [
                  "new",
                  "array"
                ]
              },
              contains: [
                "self",
                ...ATTRIBUTE_CONTAINS
              ]
            },
            ...ATTRIBUTE_CONTAINS,
            {
              scope: "meta",
              variants: [
                { match: PASCAL_CASE_CLASS_NAME_RE },
                { match: UPCASE_NAME_RE }
              ]
            }
          ]
        };
        return {
          case_insensitive: false,
          keywords: KEYWORDS,
          contains: [
            ATTRIBUTES,
            hljs.HASH_COMMENT_MODE,
            hljs.COMMENT("//", "$"),
            hljs.COMMENT(
              "/\\*",
              "\\*/",
              { contains: [
                {
                  scope: "doctag",
                  match: "@[A-Za-z]+"
                }
              ] }
            ),
            {
              match: /__halt_compiler\(\);/,
              keywords: "__halt_compiler",
              starts: {
                scope: "comment",
                end: hljs.MATCH_NOTHING_RE,
                contains: [
                  {
                    match: /\?>/,
                    scope: "meta",
                    endsParent: true
                  }
                ]
              }
            },
            PREPROCESSOR,
            {
              scope: "variable.language",
              match: /\$this\b/
            },
            VARIABLE,
            FUNCTION_INVOKE,
            LEFT_AND_RIGHT_SIDE_OF_DOUBLE_COLON,
            {
              match: [
                /const/,
                /\s/,
                IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "variable.constant"
              }
            },
            CONSTRUCTOR_CALL,
            {
              scope: "function",
              relevance: 0,
              beginKeywords: "fn function",
              end: /[;{]/,
              excludeEnd: true,
              illegal: "[$%\\[]",
              contains: [
                { beginKeywords: "use" },
                hljs.UNDERSCORE_TITLE_MODE,
                {
                  begin: "=>",
                  // No markup, just a relevance booster
                  endsParent: true
                },
                {
                  scope: "params",
                  begin: "\\(",
                  end: "\\)",
                  excludeBegin: true,
                  excludeEnd: true,
                  keywords: KEYWORDS,
                  contains: [
                    "self",
                    ATTRIBUTES,
                    VARIABLE,
                    LEFT_AND_RIGHT_SIDE_OF_DOUBLE_COLON,
                    hljs.C_BLOCK_COMMENT_MODE,
                    hljs.C_LINE_COMMENT_MODE,
                    hljs.HASH_COMMENT_MODE,
                    STRING,
                    NUMBER
                  ]
                }
              ]
            },
            {
              scope: "class",
              variants: [
                {
                  beginKeywords: "enum",
                  illegal: /[($"]/
                },
                {
                  beginKeywords: "class interface trait",
                  illegal: /[:($"]/
                }
              ],
              relevance: 0,
              end: /\{/,
              excludeEnd: true,
              contains: [
                { beginKeywords: "extends implements" },
                hljs.UNDERSCORE_TITLE_MODE
              ]
            },
            // both use and namespace still use "old style" rules (vs multi-match)
            // because the namespace name can include `\` and we still want each
            // element to be treated as its own *individual* title
            {
              beginKeywords: "namespace",
              relevance: 0,
              end: ";",
              illegal: /[.']/,
              contains: [hljs.inherit(hljs.UNDERSCORE_TITLE_MODE, { scope: "title.class" })]
            },
            {
              beginKeywords: "use",
              relevance: 0,
              end: ";",
              contains: [
                // TODO: title.function vs title.class
                {
                  match: /\b(as|const|function)\b/,
                  scope: "keyword"
                },
                // TODO: could be title.class or title.function
                hljs.UNDERSCORE_TITLE_MODE
              ]
            },
            STRING,
            NUMBER
          ]
        };
      }
      module.exports = php;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/php-template.js
  var require_php_template = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/php-template.js"(exports, module) {
      function phpTemplate(hljs) {
        return {
          name: "PHP template",
          subLanguage: "xml",
          contains: [
            {
              begin: /<\?(php|=)?/,
              end: /\?>/,
              subLanguage: "php",
              contains: [
                // We don't want the php closing tag ?> to close the PHP block when
                // inside any of the following blocks:
                {
                  begin: "/\\*",
                  end: "\\*/",
                  skip: true
                },
                {
                  begin: 'b"',
                  end: '"',
                  skip: true
                },
                {
                  begin: "b'",
                  end: "'",
                  skip: true
                },
                hljs.inherit(hljs.APOS_STRING_MODE, {
                  illegal: null,
                  className: null,
                  contains: null,
                  skip: true
                }),
                hljs.inherit(hljs.QUOTE_STRING_MODE, {
                  illegal: null,
                  className: null,
                  contains: null,
                  skip: true
                })
              ]
            }
          ]
        };
      }
      module.exports = phpTemplate;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/plaintext.js
  var require_plaintext = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/plaintext.js"(exports, module) {
      function plaintext(hljs) {
        return {
          name: "Plain text",
          aliases: [
            "text",
            "txt"
          ],
          disableAutodetect: true
        };
      }
      module.exports = plaintext;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/python.js
  var require_python = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/python.js"(exports, module) {
      function python(hljs) {
        const regex = hljs.regex;
        const IDENT_RE = /[\p{XID_Start}_]\p{XID_Continue}*/u;
        const RESERVED_WORDS = [
          "and",
          "as",
          "assert",
          "async",
          "await",
          "break",
          "case",
          "class",
          "continue",
          "def",
          "del",
          "elif",
          "else",
          "except",
          "finally",
          "for",
          "from",
          "global",
          "if",
          "import",
          "in",
          "is",
          "lambda",
          "lazy",
          "match",
          "nonlocal|10",
          "not",
          "or",
          "pass",
          "raise",
          "return",
          "try",
          "while",
          "with",
          "yield"
        ];
        const BUILT_INS = [
          "__import__",
          "abs",
          "aiter",
          "all",
          "anext",
          "any",
          "ascii",
          "bin",
          "bool",
          "breakpoint",
          "bytearray",
          "bytes",
          "callable",
          "chr",
          "classmethod",
          "compile",
          "complex",
          "delattr",
          "dict",
          "dir",
          "divmod",
          "enumerate",
          "eval",
          "exec",
          "filter",
          "float",
          "format",
          "frozendict",
          "frozenset",
          "getattr",
          "globals",
          "hasattr",
          "hash",
          "help",
          "hex",
          "id",
          "input",
          "int",
          "isinstance",
          "issubclass",
          "iter",
          "len",
          "list",
          "locals",
          "map",
          "max",
          "memoryview",
          "min",
          "next",
          "object",
          "oct",
          "open",
          "ord",
          "pow",
          "print",
          "property",
          "range",
          "repr",
          "reversed",
          "round",
          "sentinel",
          "set",
          "setattr",
          "slice",
          "sorted",
          "staticmethod",
          "str",
          "sum",
          "super",
          "tuple",
          "type",
          "vars",
          "zip"
        ];
        const LITERALS = [
          "__debug__",
          "Ellipsis",
          "False",
          "None",
          "NotImplemented",
          "True"
        ];
        const TYPES = [
          "Any",
          "Callable",
          "Coroutine",
          "Dict",
          "List",
          "Literal",
          "Generic",
          "Optional",
          "Sequence",
          "Set",
          "Tuple",
          "Type",
          "Union"
        ];
        const KEYWORDS = {
          $pattern: /[A-Za-z]\w+|__\w+__/,
          keyword: RESERVED_WORDS,
          built_in: BUILT_INS,
          literal: LITERALS,
          type: TYPES
        };
        const PROMPT = {
          className: "meta",
          begin: /^(>>>|\.\.\.) /
        };
        const SUBST = {
          className: "subst",
          begin: /\{/,
          end: /\}/,
          keywords: KEYWORDS,
          illegal: /#/
        };
        const LITERAL_BRACKET = {
          begin: /\{\{/,
          relevance: 0
        };
        const STRING = {
          className: "string",
          contains: [hljs.BACKSLASH_ESCAPE],
          variants: [
            {
              begin: /([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,
              end: /'''/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                PROMPT
              ],
              relevance: 10
            },
            {
              begin: /([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,
              end: /"""/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                PROMPT
              ],
              relevance: 10
            },
            {
              begin: /([fFtT][rR]|[rR][fFtT]|[fFtT])'''/,
              end: /'''/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                PROMPT,
                LITERAL_BRACKET,
                SUBST
              ]
            },
            {
              begin: /([fFtT][rR]|[rR][fFtT]|[fFtT])"""/,
              end: /"""/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                PROMPT,
                LITERAL_BRACKET,
                SUBST
              ]
            },
            {
              begin: /([uU]|[rR])'/,
              end: /'/,
              relevance: 10
            },
            {
              begin: /([uU]|[rR])"/,
              end: /"/,
              relevance: 10
            },
            {
              begin: /([bB]|[bB][rR]|[rR][bB])'/,
              end: /'/
            },
            {
              begin: /([bB]|[bB][rR]|[rR][bB])"/,
              end: /"/
            },
            {
              begin: /([fFtT][rR]|[rR][fFtT]|[fFtT])'/,
              end: /'/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                LITERAL_BRACKET,
                SUBST
              ]
            },
            {
              begin: /([fFtT][rR]|[rR][fFtT]|[fFtT])"/,
              end: /"/,
              contains: [
                hljs.BACKSLASH_ESCAPE,
                LITERAL_BRACKET,
                SUBST
              ]
            },
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE
          ]
        };
        const digitpart = "[0-9](_?[0-9])*";
        const pointfloat = `(\\b(${digitpart}))?\\.(${digitpart})|\\b(${digitpart})\\.`;
        const lookahead = `\\b|${RESERVED_WORDS.join("|")}`;
        const NUMBER = {
          className: "number",
          relevance: 0,
          variants: [
            // exponentfloat, pointfloat
            // https://docs.python.org/3.9/reference/lexical_analysis.html#floating-point-literals
            // optionally imaginary
            // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
            // Note: no leading \b because floats can start with a decimal point
            // and we don't want to mishandle e.g. `fn(.5)`,
            // no trailing \b for pointfloat because it can end with a decimal point
            // and we don't want to mishandle e.g. `0..hex()`; this should be safe
            // because both MUST contain a decimal point and so cannot be confused with
            // the interior part of an identifier
            {
              begin: `(\\b(${digitpart})|(${pointfloat}))[eE][+-]?(${digitpart})[jJ]?(?=${lookahead})`
            },
            {
              begin: `(${pointfloat})[jJ]?`
            },
            // decinteger, bininteger, octinteger, hexinteger
            // https://docs.python.org/3.9/reference/lexical_analysis.html#integer-literals
            // optionally "long" in Python 2
            // https://docs.python.org/2.7/reference/lexical_analysis.html#integer-and-long-integer-literals
            // decinteger is optionally imaginary
            // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
            {
              begin: `\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=${lookahead})`
            },
            {
              begin: `\\b0[bB](_?[01])+[lL]?(?=${lookahead})`
            },
            {
              begin: `\\b0[oO](_?[0-7])+[lL]?(?=${lookahead})`
            },
            {
              begin: `\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=${lookahead})`
            },
            // imagnumber (digitpart-based)
            // https://docs.python.org/3.9/reference/lexical_analysis.html#imaginary-literals
            {
              begin: `\\b(${digitpart})[jJ](?=${lookahead})`
            }
          ]
        };
        const COMMENT_TYPE = {
          className: "comment",
          begin: regex.lookahead(/# type:/),
          end: /$/,
          keywords: KEYWORDS,
          contains: [
            {
              // prevent keywords from coloring `type`
              begin: /# type:/
            },
            // comment within a datatype comment includes no keywords
            {
              begin: /#/,
              end: /\b\B/,
              endsWithParent: true
            }
          ]
        };
        const PARAMS = {
          className: "params",
          variants: [
            // Exclude params in functions without params
            {
              className: "",
              begin: /\(\s*\)/,
              skip: true
            },
            {
              begin: /\(/,
              end: /\)/,
              excludeBegin: true,
              excludeEnd: true,
              keywords: KEYWORDS,
              contains: [
                "self",
                PROMPT,
                NUMBER,
                STRING,
                hljs.HASH_COMMENT_MODE
              ]
            }
          ]
        };
        SUBST.contains = [
          STRING,
          NUMBER,
          PROMPT
        ];
        return {
          name: "Python",
          aliases: [
            "py",
            "gyp",
            "ipython"
          ],
          unicodeRegex: true,
          keywords: KEYWORDS,
          illegal: /(<\/|\?)|=>/,
          contains: [
            PROMPT,
            NUMBER,
            {
              // very common convention
              scope: "variable.language",
              match: /\bself\b/
            },
            {
              // eat "if" prior to string so that it won't accidentally be
              // labeled as an f-string
              beginKeywords: "if",
              relevance: 0
            },
            { match: /\bor\b/, scope: "keyword" },
            STRING,
            COMMENT_TYPE,
            hljs.HASH_COMMENT_MODE,
            {
              match: [
                /\bdef/,
                /\s+/,
                IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "title.function"
              },
              contains: [PARAMS]
            },
            {
              variants: [
                {
                  match: [
                    /\bclass/,
                    /\s+/,
                    IDENT_RE,
                    /\s*/,
                    /\(\s*/,
                    IDENT_RE,
                    /\s*\)/
                  ]
                },
                {
                  match: [
                    /\bclass/,
                    /\s+/,
                    IDENT_RE
                  ]
                }
              ],
              scope: {
                1: "keyword",
                3: "title.class",
                6: "title.class.inherited"
              }
            },
            {
              className: "meta",
              begin: /^[\t ]*@/,
              end: /(?=#)|$/,
              contains: [
                NUMBER,
                PARAMS,
                STRING
              ]
            }
          ]
        };
      }
      module.exports = python;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/python-repl.js
  var require_python_repl = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/python-repl.js"(exports, module) {
      function pythonRepl(hljs) {
        return {
          aliases: ["pycon"],
          contains: [
            {
              className: "meta.prompt",
              starts: {
                // a space separates the REPL prefix from the actual code
                // this is purely for cleaner HTML output
                end: / |$/,
                starts: {
                  end: "$",
                  subLanguage: "python"
                }
              },
              variants: [
                { begin: /^>>>(?=[ ]|$)/ },
                { begin: /^\.\.\.(?=[ ]|$)/ }
              ]
            }
          ]
        };
      }
      module.exports = pythonRepl;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/r.js
  var require_r = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/r.js"(exports, module) {
      function r(hljs) {
        const regex = hljs.regex;
        const IDENT_RE = /(?:(?:[a-zA-Z]|\.[._a-zA-Z])[._a-zA-Z0-9]*)|\.(?!\d)/;
        const NUMBER_TYPES_RE = regex.either(
          // Special case: only hexadecimal binary powers can contain fractions
          /0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*[pP][+-]?\d+i?/,
          // Hexadecimal numbers without fraction and optional binary power
          /0[xX][0-9a-fA-F]+(?:[pP][+-]?\d+)?[Li]?/,
          // Decimal numbers
          /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[Li]?/
        );
        const OPERATORS_RE = /[=!<>:]=|\|\||&&|:::?|<-|<<-|->>|->|\|>|[-+*\/?!$&|:<=>@^~]|\*\*/;
        const PUNCTUATION_RE = regex.either(
          /[()]/,
          /[{}]/,
          /\[\[/,
          /[[\]]/,
          /\\/,
          /,/
        );
        return {
          name: "R",
          keywords: {
            $pattern: IDENT_RE,
            keyword: "function if in break next repeat else for while",
            literal: "NULL NA TRUE FALSE Inf NaN NA_integer_|10 NA_real_|10 NA_character_|10 NA_complex_|10",
            built_in: (
              // Builtin constants
              "LETTERS letters month.abb month.name pi T F abs acos acosh all any anyNA Arg as.call as.character as.complex as.double as.environment as.integer as.logical as.null.default as.numeric as.raw asin asinh atan atanh attr attributes baseenv browser c call ceiling class Conj cos cosh cospi cummax cummin cumprod cumsum digamma dim dimnames emptyenv exp expression floor forceAndCall gamma gc.time globalenv Im interactive invisible is.array is.atomic is.call is.character is.complex is.double is.environment is.expression is.finite is.function is.infinite is.integer is.language is.list is.logical is.matrix is.na is.name is.nan is.null is.numeric is.object is.pairlist is.raw is.recursive is.single is.symbol lazyLoadDBfetch length lgamma list log max min missing Mod names nargs nzchar oldClass on.exit pos.to.env proc.time prod quote range Re rep retracemem return round seq_along seq_len seq.int sign signif sin sinh sinpi sqrt standardGeneric substitute sum switch tan tanh tanpi tracemem trigamma trunc unclass untracemem UseMethod xtfrm"
            )
          },
          contains: [
            // Roxygen comments
            hljs.COMMENT(
              /#'/,
              /$/,
              { contains: [
                {
                  // Handle `@examples` separately to cause all subsequent code
                  // until the next `@`-tag on its own line to be kept as-is,
                  // preventing highlighting. This code is example R code, so nested
                  // doctags shouldn’t be treated as such. See
                  // `test/markup/r/roxygen.txt` for an example.
                  scope: "doctag",
                  match: /@examples/,
                  starts: {
                    end: regex.lookahead(regex.either(
                      // end if another doc comment
                      /\n^#'\s*(?=@[a-zA-Z]+)/,
                      // or a line with no comment
                      /\n^(?!#')/
                    )),
                    endsParent: true
                  }
                },
                {
                  // Handle `@param` to highlight the parameter name following
                  // after.
                  scope: "doctag",
                  begin: "@param",
                  end: /$/,
                  contains: [
                    {
                      scope: "variable",
                      variants: [
                        { match: IDENT_RE },
                        { match: /`(?:\\.|[^`\\])+`/ }
                      ],
                      endsParent: true
                    }
                  ]
                },
                {
                  scope: "doctag",
                  match: /@[a-zA-Z]+/
                },
                {
                  scope: "keyword",
                  match: /\\[a-zA-Z]+/
                }
              ] }
            ),
            hljs.HASH_COMMENT_MODE,
            {
              scope: "string",
              contains: [hljs.BACKSLASH_ESCAPE],
              variants: [
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]"(-*)\(/,
                  end: /\)(-*)"/
                }),
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]"(-*)\{/,
                  end: /\}(-*)"/
                }),
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]"(-*)\[/,
                  end: /\](-*)"/
                }),
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]'(-*)\(/,
                  end: /\)(-*)'/
                }),
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]'(-*)\{/,
                  end: /\}(-*)'/
                }),
                hljs.END_SAME_AS_BEGIN({
                  begin: /[rR]'(-*)\[/,
                  end: /\](-*)'/
                }),
                {
                  begin: '"',
                  end: '"',
                  relevance: 0
                },
                {
                  begin: "'",
                  end: "'",
                  relevance: 0
                }
              ]
            },
            // Matching numbers immediately following punctuation and operators is
            // tricky since we need to look at the character ahead of a number to
            // ensure the number is not part of an identifier, and we cannot use
            // negative look-behind assertions. So instead we explicitly handle all
            // possible combinations of (operator|punctuation), number.
            // TODO: replace with negative look-behind when available
            // { begin: /(?<![a-zA-Z0-9._])0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*[pP][+-]?\d+i?/ },
            // { begin: /(?<![a-zA-Z0-9._])0[xX][0-9a-fA-F]+([pP][+-]?\d+)?[Li]?/ },
            // { begin: /(?<![a-zA-Z0-9._])(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[Li]?/ }
            {
              relevance: 0,
              variants: [
                {
                  scope: {
                    1: "operator",
                    2: "number"
                  },
                  match: [
                    OPERATORS_RE,
                    NUMBER_TYPES_RE
                  ]
                },
                {
                  scope: {
                    1: "operator",
                    2: "number"
                  },
                  match: [
                    /%[^%]*%/,
                    NUMBER_TYPES_RE
                  ]
                },
                {
                  scope: {
                    1: "punctuation",
                    2: "number"
                  },
                  match: [
                    PUNCTUATION_RE,
                    NUMBER_TYPES_RE
                  ]
                },
                {
                  scope: { 2: "number" },
                  match: [
                    /[^a-zA-Z0-9._]|^/,
                    // not part of an identifier, or start of document
                    NUMBER_TYPES_RE
                  ]
                }
              ]
            },
            // Operators/punctuation when they're not directly followed by numbers
            {
              // Relevance boost for the most common assignment form.
              scope: { 3: "operator" },
              match: [
                IDENT_RE,
                /\s+/,
                /<-/,
                /\s+/
              ]
            },
            {
              scope: "operator",
              relevance: 0,
              variants: [
                { match: OPERATORS_RE },
                { match: /%[^%]*%/ }
              ]
            },
            {
              scope: "punctuation",
              relevance: 0,
              match: PUNCTUATION_RE
            },
            {
              // Escaped identifier
              begin: "`",
              end: "`",
              contains: [{ begin: /\\./ }]
            }
          ]
        };
      }
      module.exports = r;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/rust.js
  var require_rust = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/rust.js"(exports, module) {
      function rust(hljs) {
        const regex = hljs.regex;
        const RAW_IDENTIFIER = /(r#)?/;
        const UNDERSCORE_IDENT_RE = regex.concat(RAW_IDENTIFIER, hljs.UNDERSCORE_IDENT_RE);
        const IDENT_RE = regex.concat(RAW_IDENTIFIER, hljs.IDENT_RE);
        const FUNCTION_INVOKE = {
          scope: "title.function.invoke",
          relevance: 0,
          begin: regex.concat(
            /\b/,
            /(?!(?:let|for|while|if|else|match)\b)/,
            IDENT_RE,
            regex.lookahead(/\s*\(/)
          )
        };
        const NUMBER_SUFFIX = "([ui](8|16|32|64|128|size)|f(16|32|64|128))?";
        const KEYWORDS = [
          "abstract",
          "as",
          "async",
          "await",
          "become",
          "box",
          "break",
          "const",
          "continue",
          "crate",
          "do",
          "dyn",
          "else",
          "enum",
          "extern",
          "false",
          "final",
          "fn",
          "for",
          "if",
          "impl",
          "in",
          "let",
          "loop",
          "macro",
          "match",
          "mod",
          "move",
          "mut",
          "override",
          "priv",
          "pub",
          "raw",
          "ref",
          "return",
          "self",
          "Self",
          "static",
          "struct",
          "super",
          "trait",
          "true",
          "try",
          "type",
          "typeof",
          "union",
          "unsafe",
          "unsized",
          "use",
          "virtual",
          "where",
          "while",
          "yield"
        ];
        const LITERALS = [
          "true",
          "false",
          "Some",
          "None",
          "Ok",
          "Err"
        ];
        const BUILTINS = [
          // functions
          "drop ",
          // traits
          "Copy",
          "Send",
          "Sized",
          "Sync",
          "Drop",
          "Fn",
          "FnMut",
          "FnOnce",
          "ToOwned",
          "Clone",
          "Debug",
          "PartialEq",
          "PartialOrd",
          "Eq",
          "Ord",
          "AsRef",
          "AsMut",
          "Into",
          "From",
          "Default",
          "Iterator",
          "Extend",
          "IntoIterator",
          "DoubleEndedIterator",
          "ExactSizeIterator",
          "SliceConcatExt",
          "ToString",
          // macros
          "assert!",
          "assert_eq!",
          "bitflags!",
          "bytes!",
          "cfg!",
          "col!",
          "concat!",
          "concat_idents!",
          "debug_assert!",
          "debug_assert_eq!",
          "env!",
          "eprintln!",
          "panic!",
          "file!",
          "format!",
          "format_args!",
          "include_bytes!",
          "include_str!",
          "line!",
          "local_data_key!",
          "module_path!",
          "option_env!",
          "print!",
          "println!",
          "select!",
          "stringify!",
          "try!",
          "unimplemented!",
          "unreachable!",
          "vec!",
          "write!",
          "writeln!",
          "macro_rules!",
          "assert_ne!",
          "debug_assert_ne!"
        ];
        const TYPES = [
          "i8",
          "i16",
          "i32",
          "i64",
          "i128",
          "isize",
          "u8",
          "u16",
          "u32",
          "u64",
          "u128",
          "usize",
          "f16",
          "f32",
          "f64",
          "f128",
          "str",
          "char",
          "bool",
          "Box",
          "Option",
          "Result",
          "String",
          "Vec"
        ];
        return {
          name: "Rust",
          aliases: ["rs"],
          keywords: {
            $pattern: hljs.IDENT_RE + "!?",
            type: TYPES,
            keyword: KEYWORDS,
            literal: LITERALS,
            built_in: BUILTINS
          },
          illegal: "</",
          contains: [
            hljs.C_LINE_COMMENT_MODE,
            hljs.COMMENT("/\\*", "\\*/", { contains: ["self"] }),
            hljs.inherit(hljs.QUOTE_STRING_MODE, {
              begin: /b?"/,
              illegal: null
            }),
            {
              scope: "symbol",
              // negative lookahead to avoid matching `'`
              begin: /'[a-zA-Z_][a-zA-Z0-9_]*(?!')/
            },
            {
              scope: "string",
              variants: [
                { begin: /b?r(#*)"(.|\n)*?"\1(?!#)/ },
                {
                  begin: /b?'/,
                  end: /'/,
                  contains: [
                    {
                      scope: "char.escape",
                      match: /\\('|"|\\|\w|x\w{2}|u\w{4}|U\w{8})/
                    }
                  ]
                }
              ]
            },
            {
              scope: "number",
              variants: [
                { begin: "\\b0b([01_]+)" + NUMBER_SUFFIX },
                { begin: "\\b0o([0-7_]+)" + NUMBER_SUFFIX },
                { begin: "\\b0x([A-Fa-f0-9_]+)" + NUMBER_SUFFIX },
                { begin: "\\b(\\d[\\d_]*(\\.[0-9_]+)?([eE][+-]?[0-9_]+)?)" + NUMBER_SUFFIX }
              ],
              relevance: 0
            },
            {
              begin: [
                /\bsafe/,
                /\s+/,
                /extern/
              ],
              scope: {
                1: "keyword",
                3: "keyword"
              }
            },
            {
              begin: [
                /fn/,
                /\s+/,
                UNDERSCORE_IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "title.function"
              }
            },
            {
              scope: "meta",
              begin: "#!?\\[",
              end: "\\]",
              contains: [
                {
                  scope: "string",
                  begin: /"/,
                  end: /"/,
                  contains: [
                    hljs.BACKSLASH_ESCAPE
                  ]
                }
              ]
            },
            {
              begin: [
                /let/,
                /\s+/,
                /(?:mut\s+)?/,
                UNDERSCORE_IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "keyword",
                4: "variable"
              }
            },
            // must come before impl/for rule later
            {
              begin: [
                /for/,
                /\s+/,
                UNDERSCORE_IDENT_RE,
                /\s+/,
                /in/
              ],
              scope: {
                1: "keyword",
                3: "variable",
                5: "keyword"
              }
            },
            {
              begin: [
                /type/,
                /\s+/,
                UNDERSCORE_IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "title.class"
              }
            },
            {
              begin: [
                /(?:trait|enum|struct|union|impl|for)/,
                /\s+/,
                UNDERSCORE_IDENT_RE
              ],
              scope: {
                1: "keyword",
                3: "title.class"
              }
            },
            {
              begin: hljs.IDENT_RE + "::",
              keywords: {
                keyword: "Self",
                built_in: BUILTINS,
                type: TYPES
              }
            },
            {
              scope: "punctuation",
              begin: "->"
            },
            FUNCTION_INVOKE
          ]
        };
      }
      module.exports = rust;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/scss.js
  var require_scss = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/scss.js"(exports, module) {
      var MODES = (hljs) => {
        return {
          IMPORTANT: {
            scope: "meta",
            begin: "!important"
          },
          BLOCK_COMMENT: hljs.C_BLOCK_COMMENT_MODE,
          HEXCOLOR: {
            scope: "number",
            begin: /#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/
          },
          UNICODE_RANGE: {
            scope: "number",
            begin: /\b[Uu]\+[0-9A-Fa-f][0-9A-Fa-f?]{0,5}(-[0-9A-Fa-f][0-9A-Fa-f]{0,5})?/
          },
          FUNCTION_DISPATCH: {
            className: "built_in",
            begin: /[\w-]+(?=\()/
          },
          ATTRIBUTE_SELECTOR_MODE: {
            scope: "selector-attr",
            begin: /\[/,
            end: /\]/,
            illegal: "$",
            contains: [
              hljs.APOS_STRING_MODE,
              hljs.QUOTE_STRING_MODE
            ]
          },
          CSS_NUMBER_MODE: {
            scope: "number",
            begin: hljs.NUMBER_RE + "(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?",
            relevance: 0
          },
          CSS_VARIABLE: {
            className: "attr",
            begin: /--[A-Za-z_][A-Za-z0-9_-]*/
          }
        };
      };
      var HTML_TAGS = [
        "a",
        "abbr",
        "address",
        "article",
        "aside",
        "audio",
        "b",
        "blockquote",
        "body",
        "button",
        "canvas",
        "caption",
        "cite",
        "code",
        "dd",
        "del",
        "details",
        "dfn",
        "div",
        "dl",
        "dt",
        "em",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "html",
        "i",
        "iframe",
        "img",
        "input",
        "ins",
        "kbd",
        "label",
        "legend",
        "li",
        "main",
        "mark",
        "menu",
        "nav",
        "object",
        "ol",
        "optgroup",
        "option",
        "p",
        "picture",
        "q",
        "quote",
        "samp",
        "section",
        "select",
        "source",
        "span",
        "strong",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "textarea",
        "tfoot",
        "th",
        "thead",
        "time",
        "tr",
        "ul",
        "var",
        "video"
      ];
      var SVG_TAGS = [
        "defs",
        "g",
        "marker",
        "mask",
        "pattern",
        "svg",
        "switch",
        "symbol",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feFlood",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMorphology",
        "feOffset",
        "feSpecularLighting",
        "feTile",
        "feTurbulence",
        "linearGradient",
        "radialGradient",
        "stop",
        "circle",
        "ellipse",
        "image",
        "line",
        "path",
        "polygon",
        "polyline",
        "rect",
        "text",
        "use",
        "textPath",
        "tspan",
        "foreignObject",
        "clipPath"
      ];
      var TAGS = [
        ...HTML_TAGS,
        ...SVG_TAGS
      ];
      var MEDIA_FEATURES = [
        "any-hover",
        "any-pointer",
        "aspect-ratio",
        "color",
        "color-gamut",
        "color-index",
        "device-aspect-ratio",
        "device-height",
        "device-width",
        "display-mode",
        "forced-colors",
        "grid",
        "height",
        "hover",
        "inverted-colors",
        "monochrome",
        "orientation",
        "overflow-block",
        "overflow-inline",
        "pointer",
        "prefers-color-scheme",
        "prefers-contrast",
        "prefers-reduced-motion",
        "prefers-reduced-transparency",
        "resolution",
        "scan",
        "scripting",
        "update",
        "width",
        // TODO: find a better solution?
        "min-width",
        "max-width",
        "min-height",
        "max-height"
      ].sort().reverse();
      var PSEUDO_CLASSES = [
        "active",
        "any-link",
        "blank",
        "checked",
        "current",
        "default",
        "defined",
        "dir",
        // dir()
        "disabled",
        "drop",
        "empty",
        "enabled",
        "first",
        "first-child",
        "first-of-type",
        "fullscreen",
        "future",
        "focus",
        "focus-visible",
        "focus-within",
        "has",
        // has()
        "host",
        // host or host()
        "host-context",
        // host-context()
        "hover",
        "indeterminate",
        "in-range",
        "invalid",
        "is",
        // is()
        "lang",
        // lang()
        "last-child",
        "last-of-type",
        "left",
        "link",
        "local-link",
        "not",
        // not()
        "nth-child",
        // nth-child()
        "nth-col",
        // nth-col()
        "nth-last-child",
        // nth-last-child()
        "nth-last-col",
        // nth-last-col()
        "nth-last-of-type",
        //nth-last-of-type()
        "nth-of-type",
        //nth-of-type()
        "only-child",
        "only-of-type",
        "optional",
        "out-of-range",
        "past",
        "placeholder-shown",
        "read-only",
        "read-write",
        "required",
        "right",
        "root",
        "scope",
        "target",
        "target-within",
        "user-invalid",
        "valid",
        "visited",
        "where"
        // where()
      ].sort().reverse();
      var PSEUDO_ELEMENTS = [
        "after",
        "backdrop",
        "before",
        "cue",
        "cue-region",
        "first-letter",
        "first-line",
        "grammar-error",
        "marker",
        "part",
        "placeholder",
        "selection",
        "slotted",
        "spelling-error"
      ].sort().reverse();
      var ATTRIBUTES = [
        "accent-color",
        "align-content",
        "align-items",
        "align-self",
        "alignment-baseline",
        "all",
        "anchor-name",
        "animation",
        "animation-composition",
        "animation-delay",
        "animation-direction",
        "animation-duration",
        "animation-fill-mode",
        "animation-iteration-count",
        "animation-name",
        "animation-play-state",
        "animation-range",
        "animation-range-end",
        "animation-range-start",
        "animation-timeline",
        "animation-timing-function",
        "appearance",
        "aspect-ratio",
        "backdrop-filter",
        "backface-visibility",
        "background",
        "background-attachment",
        "background-blend-mode",
        "background-clip",
        "background-color",
        "background-image",
        "background-origin",
        "background-position",
        "background-position-x",
        "background-position-y",
        "background-repeat",
        "background-size",
        "baseline-shift",
        "block-size",
        "border",
        "border-block",
        "border-block-color",
        "border-block-end",
        "border-block-end-color",
        "border-block-end-style",
        "border-block-end-width",
        "border-block-start",
        "border-block-start-color",
        "border-block-start-style",
        "border-block-start-width",
        "border-block-style",
        "border-block-width",
        "border-bottom",
        "border-bottom-color",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
        "border-bottom-style",
        "border-bottom-width",
        "border-collapse",
        "border-color",
        "border-end-end-radius",
        "border-end-start-radius",
        "border-image",
        "border-image-outset",
        "border-image-repeat",
        "border-image-slice",
        "border-image-source",
        "border-image-width",
        "border-inline",
        "border-inline-color",
        "border-inline-end",
        "border-inline-end-color",
        "border-inline-end-style",
        "border-inline-end-width",
        "border-inline-start",
        "border-inline-start-color",
        "border-inline-start-style",
        "border-inline-start-width",
        "border-inline-style",
        "border-inline-width",
        "border-left",
        "border-left-color",
        "border-left-style",
        "border-left-width",
        "border-radius",
        "border-right",
        "border-right-color",
        "border-right-style",
        "border-right-width",
        "border-spacing",
        "border-start-end-radius",
        "border-start-start-radius",
        "border-style",
        "border-top",
        "border-top-color",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-top-style",
        "border-top-width",
        "border-width",
        "bottom",
        "box-align",
        "box-decoration-break",
        "box-direction",
        "box-flex",
        "box-flex-group",
        "box-lines",
        "box-ordinal-group",
        "box-orient",
        "box-pack",
        "box-shadow",
        "box-sizing",
        "break-after",
        "break-before",
        "break-inside",
        "caption-side",
        "caret-color",
        "clear",
        "clip",
        "clip-path",
        "clip-rule",
        "color",
        "color-interpolation",
        "color-interpolation-filters",
        "color-profile",
        "color-rendering",
        "color-scheme",
        "column-count",
        "column-fill",
        "column-gap",
        "column-rule",
        "column-rule-color",
        "column-rule-style",
        "column-rule-width",
        "column-span",
        "column-width",
        "columns",
        "contain",
        "contain-intrinsic-block-size",
        "contain-intrinsic-height",
        "contain-intrinsic-inline-size",
        "contain-intrinsic-size",
        "contain-intrinsic-width",
        "container",
        "container-name",
        "container-type",
        "content",
        "content-visibility",
        "corner-bottom-left-shape",
        "corner-bottom-right-shape",
        "corner-shape",
        "corner-top-left-shape",
        "corner-top-right-shape",
        "counter-increment",
        "counter-reset",
        "counter-set",
        "cue",
        "cue-after",
        "cue-before",
        "cursor",
        "cx",
        "cy",
        "direction",
        "display",
        "dominant-baseline",
        "empty-cells",
        "enable-background",
        "field-sizing",
        "fill",
        "fill-opacity",
        "fill-rule",
        "filter",
        "flex",
        "flex-basis",
        "flex-direction",
        "flex-flow",
        "flex-grow",
        "flex-shrink",
        "flex-wrap",
        "float",
        "flood-color",
        "flood-opacity",
        "flow",
        "font",
        "font-display",
        "font-family",
        "font-feature-settings",
        "font-kerning",
        "font-language-override",
        "font-optical-sizing",
        "font-palette",
        "font-size",
        "font-size-adjust",
        "font-smooth",
        "font-smoothing",
        "font-stretch",
        "font-style",
        "font-synthesis",
        "font-synthesis-position",
        "font-synthesis-small-caps",
        "font-synthesis-style",
        "font-synthesis-weight",
        "font-variant",
        "font-variant-alternates",
        "font-variant-caps",
        "font-variant-east-asian",
        "font-variant-emoji",
        "font-variant-ligatures",
        "font-variant-numeric",
        "font-variant-position",
        "font-variation-settings",
        "font-weight",
        "forced-color-adjust",
        "gap",
        "glyph-orientation-horizontal",
        "glyph-orientation-vertical",
        "grid",
        "grid-area",
        "grid-auto-columns",
        "grid-auto-flow",
        "grid-auto-rows",
        "grid-column",
        "grid-column-end",
        "grid-column-start",
        "grid-gap",
        "grid-row",
        "grid-row-end",
        "grid-row-start",
        "grid-template",
        "grid-template-areas",
        "grid-template-columns",
        "grid-template-rows",
        "hanging-punctuation",
        "height",
        "hyphenate-character",
        "hyphenate-limit-chars",
        "hyphens",
        "icon",
        "image-orientation",
        "image-rendering",
        "image-resolution",
        "ime-mode",
        "initial-letter",
        "initial-letter-align",
        "inline-size",
        "inset",
        "inset-area",
        "inset-block",
        "inset-block-end",
        "inset-block-start",
        "inset-inline",
        "inset-inline-end",
        "inset-inline-start",
        "isolation",
        "justify-content",
        "justify-items",
        "justify-self",
        "kerning",
        "left",
        "letter-spacing",
        "lighting-color",
        "line-break",
        "line-height",
        "line-height-step",
        "list-style",
        "list-style-image",
        "list-style-position",
        "list-style-type",
        "margin",
        "margin-block",
        "margin-block-end",
        "margin-block-start",
        "margin-bottom",
        "margin-inline",
        "margin-inline-end",
        "margin-inline-start",
        "margin-left",
        "margin-right",
        "margin-top",
        "margin-trim",
        "marker",
        "marker-end",
        "marker-mid",
        "marker-start",
        "marks",
        "mask",
        "mask-border",
        "mask-border-mode",
        "mask-border-outset",
        "mask-border-repeat",
        "mask-border-slice",
        "mask-border-source",
        "mask-border-width",
        "mask-clip",
        "mask-composite",
        "mask-image",
        "mask-mode",
        "mask-origin",
        "mask-position",
        "mask-repeat",
        "mask-size",
        "mask-type",
        "masonry-auto-flow",
        "math-depth",
        "math-shift",
        "math-style",
        "max-block-size",
        "max-height",
        "max-inline-size",
        "max-width",
        "min-block-size",
        "min-height",
        "min-inline-size",
        "min-width",
        "mix-blend-mode",
        "nav-down",
        "nav-index",
        "nav-left",
        "nav-right",
        "nav-up",
        "none",
        "normal",
        "object-fit",
        "object-position",
        "offset",
        "offset-anchor",
        "offset-distance",
        "offset-path",
        "offset-position",
        "offset-rotate",
        "opacity",
        "order",
        "orphans",
        "outline",
        "outline-color",
        "outline-offset",
        "outline-style",
        "outline-width",
        "overflow",
        "overflow-anchor",
        "overflow-block",
        "overflow-clip-margin",
        "overflow-inline",
        "overflow-wrap",
        "overflow-x",
        "overflow-y",
        "overlay",
        "overscroll-behavior",
        "overscroll-behavior-block",
        "overscroll-behavior-inline",
        "overscroll-behavior-x",
        "overscroll-behavior-y",
        "padding",
        "padding-block",
        "padding-block-end",
        "padding-block-start",
        "padding-bottom",
        "padding-inline",
        "padding-inline-end",
        "padding-inline-start",
        "padding-left",
        "padding-right",
        "padding-top",
        "page",
        "page-break-after",
        "page-break-before",
        "page-break-inside",
        "paint-order",
        "pause",
        "pause-after",
        "pause-before",
        "perspective",
        "perspective-origin",
        "place-content",
        "place-items",
        "place-self",
        "pointer-events",
        "position",
        "position-anchor",
        "position-visibility",
        "print-color-adjust",
        "quotes",
        "r",
        "resize",
        "rest",
        "rest-after",
        "rest-before",
        "right",
        "rotate",
        "row-gap",
        "ruby-align",
        "ruby-position",
        "scale",
        "scroll-behavior",
        "scroll-margin",
        "scroll-margin-block",
        "scroll-margin-block-end",
        "scroll-margin-block-start",
        "scroll-margin-bottom",
        "scroll-margin-inline",
        "scroll-margin-inline-end",
        "scroll-margin-inline-start",
        "scroll-margin-left",
        "scroll-margin-right",
        "scroll-margin-top",
        "scroll-padding",
        "scroll-padding-block",
        "scroll-padding-block-end",
        "scroll-padding-block-start",
        "scroll-padding-bottom",
        "scroll-padding-inline",
        "scroll-padding-inline-end",
        "scroll-padding-inline-start",
        "scroll-padding-left",
        "scroll-padding-right",
        "scroll-padding-top",
        "scroll-snap-align",
        "scroll-snap-stop",
        "scroll-snap-type",
        "scroll-timeline",
        "scroll-timeline-axis",
        "scroll-timeline-name",
        "scrollbar-color",
        "scrollbar-gutter",
        "scrollbar-width",
        "shape-image-threshold",
        "shape-margin",
        "shape-outside",
        "shape-rendering",
        "speak",
        "speak-as",
        "src",
        // @font-face
        "stop-color",
        "stop-opacity",
        "stroke",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-miterlimit",
        "stroke-opacity",
        "stroke-width",
        "tab-size",
        "table-layout",
        "text-align",
        "text-align-all",
        "text-align-last",
        "text-anchor",
        "text-combine-upright",
        "text-decoration",
        "text-decoration-color",
        "text-decoration-line",
        "text-decoration-skip",
        "text-decoration-skip-ink",
        "text-decoration-style",
        "text-decoration-thickness",
        "text-emphasis",
        "text-emphasis-color",
        "text-emphasis-position",
        "text-emphasis-style",
        "text-indent",
        "text-justify",
        "text-orientation",
        "text-overflow",
        "text-rendering",
        "text-shadow",
        "text-size-adjust",
        "text-transform",
        "text-underline-offset",
        "text-underline-position",
        "text-wrap",
        "text-wrap-mode",
        "text-wrap-style",
        "timeline-scope",
        "top",
        "touch-action",
        "transform",
        "transform-box",
        "transform-origin",
        "transform-style",
        "transition",
        "transition-behavior",
        "transition-delay",
        "transition-duration",
        "transition-property",
        "transition-timing-function",
        "translate",
        "unicode-bidi",
        "unicode-range",
        "user-modify",
        "user-select",
        "vector-effect",
        "vertical-align",
        "view-timeline",
        "view-timeline-axis",
        "view-timeline-inset",
        "view-timeline-name",
        "view-transition-name",
        "visibility",
        "voice-balance",
        "voice-duration",
        "voice-family",
        "voice-pitch",
        "voice-range",
        "voice-rate",
        "voice-stress",
        "voice-volume",
        "white-space",
        "white-space-collapse",
        "widows",
        "width",
        "will-change",
        "word-break",
        "word-spacing",
        "word-wrap",
        "writing-mode",
        "x",
        "y",
        "z-index",
        "zoom"
      ].sort().reverse();
      function scss(hljs) {
        const modes = MODES(hljs);
        const PSEUDO_ELEMENTS$1 = PSEUDO_ELEMENTS;
        const PSEUDO_CLASSES$1 = PSEUDO_CLASSES;
        const AT_IDENTIFIER = "@[a-z-]+";
        const AT_MODIFIERS = "and or not only";
        const IDENT_RE = "[a-zA-Z-][a-zA-Z0-9_-]*";
        const VARIABLE = {
          className: "variable",
          begin: "(\\$" + IDENT_RE + ")\\b",
          relevance: 0
        };
        return {
          name: "SCSS",
          case_insensitive: true,
          illegal: "[=/|']",
          contains: [
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            // to recognize keyframe 40% etc which are outside the scope of our
            // attribute value mode
            modes.CSS_NUMBER_MODE,
            {
              className: "selector-id",
              begin: "#[A-Za-z0-9_-]+",
              relevance: 0
            },
            {
              className: "selector-class",
              begin: "\\.[A-Za-z0-9_-]+",
              relevance: 0
            },
            modes.ATTRIBUTE_SELECTOR_MODE,
            {
              className: "selector-tag",
              begin: "\\b(" + TAGS.join("|") + ")\\b",
              // was there, before, but why?
              relevance: 0
            },
            {
              className: "selector-pseudo",
              begin: ":(" + PSEUDO_CLASSES$1.join("|") + ")"
            },
            {
              className: "selector-pseudo",
              begin: ":(:)?(" + PSEUDO_ELEMENTS$1.join("|") + ")"
            },
            VARIABLE,
            {
              // pseudo-selector params
              begin: /\(/,
              end: /\)/,
              contains: [modes.CSS_NUMBER_MODE]
            },
            modes.CSS_VARIABLE,
            {
              className: "attribute",
              begin: "\\b(" + ATTRIBUTES.join("|") + ")\\b"
            },
            { begin: "\\b(whitespace|wait|w-resize|visible|vertical-text|vertical-ideographic|uppercase|upper-roman|upper-alpha|underline|transparent|top|thin|thick|text|text-top|text-bottom|tb-rl|table-header-group|table-footer-group|sw-resize|super|strict|static|square|solid|small-caps|separate|se-resize|scroll|s-resize|rtl|row-resize|ridge|right|repeat|repeat-y|repeat-x|relative|progress|pointer|overline|outside|outset|oblique|nowrap|not-allowed|normal|none|nw-resize|no-repeat|no-drop|newspaper|ne-resize|n-resize|move|middle|medium|ltr|lr-tb|lowercase|lower-roman|lower-alpha|loose|list-item|line|line-through|line-edge|lighter|left|keep-all|justify|italic|inter-word|inter-ideograph|inside|inset|inline|inline-block|inherit|inactive|ideograph-space|ideograph-parenthesis|ideograph-numeric|ideograph-alpha|horizontal|hidden|help|hand|groove|fixed|ellipsis|e-resize|double|dotted|distribute|distribute-space|distribute-letter|distribute-all-lines|disc|disabled|default|decimal|dashed|crosshair|collapse|col-resize|circle|char|center|capitalize|break-word|break-all|bottom|both|bolder|bold|block|bidi-override|below|baseline|auto|always|all-scroll|absolute|table|table-cell)\\b" },
            {
              begin: /:/,
              end: /[;}{]/,
              relevance: 0,
              contains: [
                modes.BLOCK_COMMENT,
                VARIABLE,
                modes.HEXCOLOR,
                modes.CSS_NUMBER_MODE,
                modes.UNICODE_RANGE,
                hljs.QUOTE_STRING_MODE,
                hljs.APOS_STRING_MODE,
                modes.IMPORTANT,
                modes.FUNCTION_DISPATCH
              ]
            },
            // matching these here allows us to treat them more like regular CSS
            // rules so everything between the {} gets regular rule highlighting,
            // which is what we want for page and font-face
            {
              begin: "@(page|font-face)",
              keywords: {
                $pattern: AT_IDENTIFIER,
                keyword: "@page @font-face"
              }
            },
            {
              begin: "@",
              end: "[{;]",
              returnBegin: true,
              keywords: {
                $pattern: /[a-z-]+/,
                keyword: AT_MODIFIERS,
                attribute: MEDIA_FEATURES.join(" ")
              },
              contains: [
                {
                  begin: AT_IDENTIFIER,
                  className: "keyword"
                },
                {
                  begin: /[a-z-]+(?=:)/,
                  className: "attribute"
                },
                VARIABLE,
                hljs.QUOTE_STRING_MODE,
                hljs.APOS_STRING_MODE,
                modes.HEXCOLOR,
                modes.CSS_NUMBER_MODE
              ]
            },
            modes.FUNCTION_DISPATCH
          ]
        };
      }
      module.exports = scss;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/shell.js
  var require_shell = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/shell.js"(exports, module) {
      function shell(hljs) {
        return {
          name: "Shell Session",
          aliases: [
            "console",
            "shellsession"
          ],
          contains: [
            {
              className: "meta.prompt",
              // We cannot add \s (spaces) in the regular expression otherwise it will be too broad and produce unexpected result.
              // For instance, in the following example, it would match "echo /path/to/home >" as a prompt:
              // echo /path/to/home > t.exe
              begin: /^\s{0,3}[./~\w\d[\]()@-]*[>%$#][ ]?/,
              starts: {
                end: /[^\\](?=\s*$)/,
                subLanguage: "bash"
              }
            }
          ]
        };
      }
      module.exports = shell;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/sql.js
  var require_sql = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/sql.js"(exports, module) {
      function sql(hljs) {
        const regex = hljs.regex;
        const COMMENT_MODE = hljs.COMMENT("--", "$");
        const STRING = {
          scope: "string",
          variants: [
            {
              begin: /'/,
              end: /'/,
              contains: [{ match: /''/ }]
            }
          ]
        };
        const QUOTED_IDENTIFIER = {
          begin: /"/,
          end: /"/,
          contains: [{ match: /""/ }]
        };
        const LITERALS = [
          "true",
          "false",
          // Not sure it's correct to call NULL literal, and clauses like IS [NOT] NULL look strange that way.
          // "null",
          "unknown"
        ];
        const MULTI_WORD_TYPES = [
          "double precision",
          "large object",
          "with timezone",
          "without timezone"
        ];
        const TYPES = [
          "bigint",
          "binary",
          "blob",
          "boolean",
          "char",
          "character",
          "clob",
          "date",
          "dec",
          "decfloat",
          "decimal",
          "float",
          "int",
          "integer",
          "interval",
          "nchar",
          "nclob",
          "national",
          "numeric",
          "real",
          "row",
          "smallint",
          "time",
          "timestamp",
          "varchar",
          "varying",
          // modifier (character varying)
          "varbinary"
        ];
        const NON_RESERVED_WORDS = [
          "add",
          "asc",
          "collation",
          "desc",
          "final",
          "first",
          "last",
          "view"
        ];
        const RESERVED_WORDS = [
          "abs",
          "acos",
          "all",
          "allocate",
          "alter",
          "and",
          "any",
          "are",
          "array",
          "array_agg",
          "array_max_cardinality",
          "as",
          "asensitive",
          "asin",
          "asymmetric",
          "at",
          "atan",
          "atomic",
          "authorization",
          "avg",
          "begin",
          "begin_frame",
          "begin_partition",
          "between",
          "bigint",
          "binary",
          "blob",
          "boolean",
          "both",
          "by",
          "call",
          "called",
          "cardinality",
          "cascaded",
          "case",
          "cast",
          "ceil",
          "ceiling",
          "char",
          "char_length",
          "character",
          "character_length",
          "check",
          "classifier",
          "clob",
          "close",
          "coalesce",
          "collate",
          "collect",
          "column",
          "commit",
          "condition",
          "connect",
          "constraint",
          "contains",
          "convert",
          "copy",
          "corr",
          "corresponding",
          "cos",
          "cosh",
          "count",
          "covar_pop",
          "covar_samp",
          "create",
          "cross",
          "cube",
          "cume_dist",
          "current",
          "current_catalog",
          "current_date",
          "current_default_transform_group",
          "current_path",
          "current_role",
          "current_row",
          "current_schema",
          "current_time",
          "current_timestamp",
          "current_path",
          "current_role",
          "current_transform_group_for_type",
          "current_user",
          "cursor",
          "cycle",
          "date",
          "day",
          "deallocate",
          "dec",
          "decimal",
          "decfloat",
          "declare",
          "default",
          "define",
          "delete",
          "dense_rank",
          "deref",
          "describe",
          "deterministic",
          "disconnect",
          "distinct",
          "double",
          "drop",
          "dynamic",
          "each",
          "element",
          "else",
          "empty",
          "end",
          "end_frame",
          "end_partition",
          "end-exec",
          "equals",
          "escape",
          "every",
          "except",
          "exec",
          "execute",
          "exists",
          "exp",
          "external",
          "extract",
          "false",
          "fetch",
          "filter",
          "first_value",
          "float",
          "floor",
          "for",
          "foreign",
          "frame_row",
          "free",
          "from",
          "full",
          "function",
          "fusion",
          "get",
          "global",
          "grant",
          "group",
          "grouping",
          "groups",
          "having",
          "hold",
          "hour",
          "identity",
          "in",
          "indicator",
          "initial",
          "inner",
          "inout",
          "insensitive",
          "insert",
          "int",
          "integer",
          "intersect",
          "intersection",
          "interval",
          "into",
          "is",
          "join",
          "json_array",
          "json_arrayagg",
          "json_exists",
          "json_object",
          "json_objectagg",
          "json_query",
          "json_table",
          "json_table_primitive",
          "json_value",
          "lag",
          "language",
          "large",
          "last_value",
          "lateral",
          "lead",
          "leading",
          "left",
          "like",
          "like_regex",
          "listagg",
          "ln",
          "local",
          "localtime",
          "localtimestamp",
          "log",
          "log10",
          "lower",
          "match",
          "match_number",
          "match_recognize",
          "matches",
          "max",
          "member",
          "merge",
          "method",
          "min",
          "minute",
          "mod",
          "modifies",
          "module",
          "month",
          "multiset",
          "national",
          "natural",
          "nchar",
          "nclob",
          "new",
          "no",
          "none",
          "normalize",
          "not",
          "nth_value",
          "ntile",
          "null",
          "nullif",
          "numeric",
          "octet_length",
          "occurrences_regex",
          "of",
          "offset",
          "old",
          "omit",
          "on",
          "one",
          "only",
          "open",
          "or",
          "order",
          "out",
          "outer",
          "over",
          "overlaps",
          "overlay",
          "parameter",
          "partition",
          "pattern",
          "per",
          "percent",
          "percent_rank",
          "percentile_cont",
          "percentile_disc",
          "period",
          "portion",
          "position",
          "position_regex",
          "power",
          "precedes",
          "precision",
          "prepare",
          "primary",
          "procedure",
          "ptf",
          "range",
          "rank",
          "reads",
          "real",
          "recursive",
          "ref",
          "references",
          "referencing",
          "regr_avgx",
          "regr_avgy",
          "regr_count",
          "regr_intercept",
          "regr_r2",
          "regr_slope",
          "regr_sxx",
          "regr_sxy",
          "regr_syy",
          "release",
          "result",
          "return",
          "returns",
          "revoke",
          "right",
          "rollback",
          "rollup",
          "row",
          "row_number",
          "rows",
          "running",
          "savepoint",
          "scope",
          "scroll",
          "search",
          "second",
          "seek",
          "select",
          "sensitive",
          "session_user",
          "set",
          "show",
          "similar",
          "sin",
          "sinh",
          "skip",
          "smallint",
          "some",
          "specific",
          "specifictype",
          "sql",
          "sqlexception",
          "sqlstate",
          "sqlwarning",
          "sqrt",
          "start",
          "static",
          "stddev_pop",
          "stddev_samp",
          "submultiset",
          "subset",
          "substring",
          "substring_regex",
          "succeeds",
          "sum",
          "symmetric",
          "system",
          "system_time",
          "system_user",
          "table",
          "tablesample",
          "tan",
          "tanh",
          "then",
          "time",
          "timestamp",
          "timezone_hour",
          "timezone_minute",
          "to",
          "trailing",
          "translate",
          "translate_regex",
          "translation",
          "treat",
          "trigger",
          "trim",
          "trim_array",
          "true",
          "truncate",
          "uescape",
          "union",
          "unique",
          "unknown",
          "unnest",
          "update",
          "upper",
          "user",
          "using",
          "value",
          "values",
          "value_of",
          "var_pop",
          "var_samp",
          "varbinary",
          "varchar",
          "varying",
          "versioning",
          "when",
          "whenever",
          "where",
          "width_bucket",
          "window",
          "with",
          "within",
          "without",
          "year"
        ];
        const RESERVED_FUNCTIONS = [
          "abs",
          "acos",
          "array_agg",
          "asin",
          "atan",
          "avg",
          "cast",
          "ceil",
          "ceiling",
          "coalesce",
          "corr",
          "cos",
          "cosh",
          "count",
          "covar_pop",
          "covar_samp",
          "cume_dist",
          "dense_rank",
          "deref",
          "element",
          "exp",
          "extract",
          "first_value",
          "floor",
          "json_array",
          "json_arrayagg",
          "json_exists",
          "json_object",
          "json_objectagg",
          "json_query",
          "json_table",
          "json_table_primitive",
          "json_value",
          "lag",
          "last_value",
          "lead",
          "listagg",
          "ln",
          "log",
          "log10",
          "lower",
          "max",
          "min",
          "mod",
          "nth_value",
          "ntile",
          "nullif",
          "percent_rank",
          "percentile_cont",
          "percentile_disc",
          "position",
          "position_regex",
          "power",
          "rank",
          "regr_avgx",
          "regr_avgy",
          "regr_count",
          "regr_intercept",
          "regr_r2",
          "regr_slope",
          "regr_sxx",
          "regr_sxy",
          "regr_syy",
          "row_number",
          "sin",
          "sinh",
          "sqrt",
          "stddev_pop",
          "stddev_samp",
          "substring",
          "substring_regex",
          "sum",
          "tan",
          "tanh",
          "translate",
          "translate_regex",
          "treat",
          "trim",
          "trim_array",
          "unnest",
          "upper",
          "value_of",
          "var_pop",
          "var_samp",
          "width_bucket"
        ];
        const POSSIBLE_WITHOUT_PARENS = [
          "current_catalog",
          "current_date",
          "current_default_transform_group",
          "current_path",
          "current_role",
          "current_schema",
          "current_transform_group_for_type",
          "current_user",
          "session_user",
          "system_time",
          "system_user",
          "current_time",
          "localtime",
          "current_timestamp",
          "localtimestamp"
        ];
        const COMBOS = [
          "create table",
          "insert into",
          "primary key",
          "foreign key",
          "not null",
          "alter table",
          "add constraint",
          "grouping sets",
          "on overflow",
          "character set",
          "respect nulls",
          "ignore nulls",
          "nulls first",
          "nulls last",
          "depth first",
          "breadth first"
        ];
        const FUNCTIONS = RESERVED_FUNCTIONS;
        const KEYWORDS = [
          ...RESERVED_WORDS,
          ...NON_RESERVED_WORDS
        ].filter((keyword) => {
          return !RESERVED_FUNCTIONS.includes(keyword);
        });
        const VARIABLE = {
          scope: "variable",
          match: /@[a-z0-9][a-z0-9_]*/
        };
        const OPERATOR = {
          scope: "operator",
          match: /[-+*/=%^~]|&&?|\|\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,
          relevance: 0
        };
        const FUNCTION_CALL = {
          match: regex.concat(/\b/, regex.either(...FUNCTIONS), /\s*\(/),
          relevance: 0,
          keywords: { built_in: FUNCTIONS }
        };
        function kws_to_regex(list) {
          return regex.concat(
            /\b/,
            regex.either(...list.map((kw) => {
              return kw.replace(/\s+/, "\\s+");
            })),
            /\b/
          );
        }
        const MULTI_WORD_KEYWORDS = {
          scope: "keyword",
          match: kws_to_regex(COMBOS),
          relevance: 0
        };
        function reduceRelevancy(list, {
          exceptions,
          when
        } = {}) {
          const qualifyFn = when;
          exceptions = exceptions || [];
          return list.map((item) => {
            if (item.match(/\|\d+$/) || exceptions.includes(item)) {
              return item;
            } else if (qualifyFn(item)) {
              return `${item}|0`;
            } else {
              return item;
            }
          });
        }
        return {
          name: "SQL",
          case_insensitive: true,
          // does not include {} or HTML tags `</`
          illegal: /[{}]|<\//,
          keywords: {
            $pattern: /\b[\w\.]+/,
            keyword: reduceRelevancy(KEYWORDS, { when: (x) => x.length < 3 }),
            literal: LITERALS,
            type: TYPES,
            built_in: POSSIBLE_WITHOUT_PARENS
          },
          contains: [
            {
              scope: "type",
              match: kws_to_regex(MULTI_WORD_TYPES)
            },
            MULTI_WORD_KEYWORDS,
            FUNCTION_CALL,
            VARIABLE,
            STRING,
            QUOTED_IDENTIFIER,
            hljs.C_NUMBER_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            COMMENT_MODE,
            OPERATOR
          ]
        };
      }
      module.exports = sql;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/swift.js
  var require_swift = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/swift.js"(exports, module) {
      function source(re) {
        if (!re) return null;
        if (typeof re === "string") return re;
        return re.source;
      }
      function lookahead(re) {
        return concat("(?=", re, ")");
      }
      function concat(...args) {
        const joined = args.map((x) => source(x)).join("");
        return joined;
      }
      function stripOptionsFromArgs(args) {
        const opts = args[args.length - 1];
        if (typeof opts === "object" && opts.constructor === Object) {
          args.splice(args.length - 1, 1);
          return opts;
        } else {
          return {};
        }
      }
      function either(...args) {
        const opts = stripOptionsFromArgs(args);
        const joined = "(" + (opts.capture ? "" : "?:") + args.map((x) => source(x)).join("|") + ")";
        return joined;
      }
      new RegExp(either(
        /\[(?:[^\\\]]|\\.)*\]/,
        // a character class, inside which ( and \ lose their meaning
        /\(\?<(?![=!])[^>]+>/,
        // a named capture group `(?<name>` (not a lookbehind `(?<=` / `(?<!`)
        /\(\?'[^']+'/,
        // a named capture group `(?'name'`
        /\(\??/,
        // an opening parenthesis, capturing or non-capturing / lookahead
        /\\([1-9][0-9]*)/,
        // a backreference like `\1`
        /\\./
        // any other escape sequence
      ));
      var keywordWrapper = (keyword) => concat(
        /\b/,
        keyword,
        /\w$/.test(keyword) ? /\b/ : /\B/
      );
      var dotKeywords = [
        "Protocol",
        // contextual
        "Type"
        // contextual
      ].map(keywordWrapper);
      var optionalDotKeywords = [
        "init",
        "self"
      ].map(keywordWrapper);
      var keywordTypes = [
        "Any",
        "Self"
      ];
      var keywords = [
        // strings below will be fed into the regular `keywords` engine while regex
        // will result in additional modes being created to scan for those keywords to
        // avoid conflicts with other rules
        "actor",
        "any",
        // contextual
        "associatedtype",
        "async",
        "await",
        /as\?/,
        // operator
        /as!/,
        // operator
        "as",
        // operator
        "borrowing",
        // contextual
        "break",
        "case",
        "catch",
        "class",
        "consume",
        // contextual
        "consuming",
        // contextual
        "continue",
        "convenience",
        // contextual
        "copy",
        // contextual
        "default",
        "defer",
        "deinit",
        "didSet",
        // contextual
        "distributed",
        "do",
        "dynamic",
        // contextual
        "each",
        "else",
        "enum",
        "extension",
        "fallthrough",
        /fileprivate\(set\)/,
        "fileprivate",
        "final",
        // contextual
        "for",
        "func",
        "get",
        // contextual
        "guard",
        "if",
        "import",
        "indirect",
        // contextual
        "infix",
        // contextual
        /init\?/,
        /init!/,
        "inout",
        /internal\(set\)/,
        "internal",
        "in",
        "is",
        // operator
        "isolated",
        // contextual
        "nonisolated",
        // contextual
        "lazy",
        // contextual
        "let",
        "macro",
        "mutating",
        // contextual
        "nonmutating",
        // contextual
        /open\(set\)/,
        // contextual
        "open",
        // contextual
        "operator",
        "optional",
        // contextual
        "override",
        // contextual
        "package",
        "postfix",
        // contextual
        "precedencegroup",
        "prefix",
        // contextual
        /private\(set\)/,
        "private",
        "protocol",
        /public\(set\)/,
        "public",
        "repeat",
        "required",
        // contextual
        "rethrows",
        "return",
        "set",
        // contextual
        "some",
        // contextual
        "static",
        "struct",
        "subscript",
        "super",
        "switch",
        "throws",
        "throw",
        /try\?/,
        // operator
        /try!/,
        // operator
        "try",
        // operator
        "typealias",
        /unowned\(safe\)/,
        // contextual
        /unowned\(unsafe\)/,
        // contextual
        "unowned",
        // contextual
        "var",
        "weak",
        // contextual
        "where",
        "while",
        "willSet"
        // contextual
      ];
      var literals = [
        "false",
        "nil",
        "true"
      ];
      var precedencegroupKeywords = [
        "assignment",
        "associativity",
        "higherThan",
        "left",
        "lowerThan",
        "none",
        "right"
      ];
      var numberSignKeywords = [
        "#colorLiteral",
        "#column",
        "#dsohandle",
        "#else",
        "#elseif",
        "#endif",
        "#error",
        "#file",
        "#fileID",
        "#fileLiteral",
        "#filePath",
        "#function",
        "#if",
        "#imageLiteral",
        "#keyPath",
        "#line",
        "#selector",
        "#sourceLocation",
        "#warning"
      ];
      var builtIns = [
        "abs",
        "all",
        "any",
        "assert",
        "assertionFailure",
        "debugPrint",
        "dump",
        "fatalError",
        "getVaList",
        "isKnownUniquelyReferenced",
        "max",
        "min",
        "numericCast",
        "pointwiseMax",
        "pointwiseMin",
        "precondition",
        "preconditionFailure",
        "print",
        "readLine",
        "repeatElement",
        "sequence",
        "stride",
        "swap",
        "swift_unboxFromSwiftValueWithType",
        "transcode",
        "type",
        "unsafeBitCast",
        "unsafeDowncast",
        "withExtendedLifetime",
        "withUnsafeMutablePointer",
        "withUnsafePointer",
        "withVaList",
        "withoutActuallyEscaping",
        "zip"
      ];
      var operatorHead = either(
        /[/=\-+!*%<>&|^~?]/,
        /[\u00A1-\u00A7]/,
        /[\u00A9\u00AB]/,
        /[\u00AC\u00AE]/,
        /[\u00B0\u00B1]/,
        /[\u00B6\u00BB\u00BF\u00D7\u00F7]/,
        /[\u2016-\u2017]/,
        /[\u2020-\u2027]/,
        /[\u2030-\u203E]/,
        /[\u2041-\u2053]/,
        /[\u2055-\u205E]/,
        /[\u2190-\u23FF]/,
        /[\u2500-\u2775]/,
        /[\u2794-\u2BFF]/,
        /[\u2E00-\u2E7F]/,
        /[\u3001-\u3003]/,
        /[\u3008-\u3020]/,
        /[\u3030]/
      );
      var operatorCharacter = either(
        operatorHead,
        /[\u0300-\u036F]/,
        /[\u1DC0-\u1DFF]/,
        /[\u20D0-\u20FF]/,
        /[\uFE00-\uFE0F]/,
        /[\uFE20-\uFE2F]/
        // TODO: The following characters are also allowed, but the regex isn't supported yet.
        // /[\u{E0100}-\u{E01EF}]/u
      );
      var operator = concat(operatorHead, operatorCharacter, "*");
      var identifierHead = either(
        /[a-zA-Z_]/,
        /[\u00A8\u00AA\u00AD\u00AF\u00B2-\u00B5\u00B7-\u00BA]/,
        /[\u00BC-\u00BE\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/,
        /[\u0100-\u02FF\u0370-\u167F\u1681-\u180D\u180F-\u1DBF]/,
        /[\u1E00-\u1FFF]/,
        /[\u200B-\u200D\u202A-\u202E\u203F-\u2040\u2054\u2060-\u206F]/,
        /[\u2070-\u20CF\u2100-\u218F\u2460-\u24FF\u2776-\u2793]/,
        /[\u2C00-\u2DFF\u2E80-\u2FFF]/,
        /[\u3004-\u3007\u3021-\u302F\u3031-\u303F\u3040-\uD7FF]/,
        /[\uF900-\uFD3D\uFD40-\uFDCF\uFDF0-\uFE1F\uFE30-\uFE44]/,
        /[\uFE47-\uFEFE\uFF00-\uFFFD]/
        // Should be /[\uFE47-\uFFFD]/, but we have to exclude FEFF.
        // The following characters are also allowed, but the regexes aren't supported yet.
        // /[\u{10000}-\u{1FFFD}\u{20000-\u{2FFFD}\u{30000}-\u{3FFFD}\u{40000}-\u{4FFFD}]/u,
        // /[\u{50000}-\u{5FFFD}\u{60000-\u{6FFFD}\u{70000}-\u{7FFFD}\u{80000}-\u{8FFFD}]/u,
        // /[\u{90000}-\u{9FFFD}\u{A0000-\u{AFFFD}\u{B0000}-\u{BFFFD}\u{C0000}-\u{CFFFD}]/u,
        // /[\u{D0000}-\u{DFFFD}\u{E0000-\u{EFFFD}]/u
      );
      var identifierCharacter = either(
        identifierHead,
        /\d/,
        /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/
      );
      var identifier = concat(identifierHead, identifierCharacter, "*");
      var typeIdentifier = concat(/[A-Z]/, identifierCharacter, "*");
      var keywordAttributes = [
        "attached",
        "autoclosure",
        concat(/convention\(/, either("swift", "block", "c"), /\)/),
        "discardableResult",
        "dynamicCallable",
        "dynamicMemberLookup",
        "escaping",
        "freestanding",
        "frozen",
        "GKInspectable",
        "IBAction",
        "IBDesignable",
        "IBInspectable",
        "IBOutlet",
        "IBSegueAction",
        "inlinable",
        "main",
        "nonobjc",
        "NSApplicationMain",
        "NSCopying",
        "NSManaged",
        concat(/objc\(/, identifier, /\)/),
        "objc",
        "objcMembers",
        "propertyWrapper",
        "requires_stored_property_inits",
        "resultBuilder",
        "Sendable",
        "testable",
        "UIApplicationMain",
        "unchecked",
        "unknown",
        "usableFromInline",
        "warn_unqualified_access"
      ];
      var availabilityKeywords = [
        "iOS",
        "iOSApplicationExtension",
        "macOS",
        "macOSApplicationExtension",
        "macCatalyst",
        "macCatalystApplicationExtension",
        "watchOS",
        "watchOSApplicationExtension",
        "tvOS",
        "tvOSApplicationExtension",
        "swift"
      ];
      function swift(hljs) {
        const WHITESPACE = {
          match: /\s+/,
          relevance: 0
        };
        const BLOCK_COMMENT = hljs.COMMENT(
          "/\\*",
          "\\*/",
          { contains: ["self"] }
        );
        const COMMENTS = [
          hljs.C_LINE_COMMENT_MODE,
          BLOCK_COMMENT
        ];
        const DOT_KEYWORD = {
          match: [
            /\./,
            either(...dotKeywords, ...optionalDotKeywords)
          ],
          className: { 2: "keyword" }
        };
        const KEYWORD_GUARD = {
          // Consume .keyword to prevent highlighting properties and methods as keywords.
          match: concat(/\./, either(...keywords)),
          relevance: 0
        };
        const PLAIN_KEYWORDS = keywords.filter((kw) => typeof kw === "string").concat(["_|0"]);
        const REGEX_KEYWORDS = keywords.filter((kw) => typeof kw !== "string").concat(keywordTypes).map(keywordWrapper);
        const KEYWORD = { variants: [
          {
            className: "keyword",
            match: either(...REGEX_KEYWORDS, ...optionalDotKeywords)
          }
        ] };
        const KEYWORDS = {
          $pattern: either(
            /\b\w+/,
            // regular keywords
            /#\w+/
            // number keywords
          ),
          keyword: PLAIN_KEYWORDS.concat(numberSignKeywords),
          literal: literals
        };
        const KEYWORD_MODES = [
          DOT_KEYWORD,
          KEYWORD_GUARD,
          KEYWORD
        ];
        const BUILT_IN_GUARD = {
          // Consume .built_in to prevent highlighting properties and methods.
          match: concat(/\./, either(...builtIns)),
          relevance: 0
        };
        const BUILT_IN = {
          className: "built_in",
          match: concat(/\b/, either(...builtIns), /(?=\()/)
        };
        const BUILT_INS = [
          BUILT_IN_GUARD,
          BUILT_IN
        ];
        const OPERATOR_GUARD = {
          // Prevent -> from being highlighting as an operator.
          match: /->/,
          relevance: 0
        };
        const OPERATOR = {
          className: "operator",
          relevance: 0,
          variants: [
            { match: operator },
            {
              // dot-operator: only operators that start with a dot are allowed to use dots as
              // characters (..., ...<, .*, etc). So there rule here is: a dot followed by one or more
              // characters that may also include dots.
              match: `\\.(\\.|${operatorCharacter})+`
            }
          ]
        };
        const OPERATORS = [
          OPERATOR_GUARD,
          OPERATOR
        ];
        const decimalDigits = "([0-9]_*)+";
        const hexDigits = "([0-9a-fA-F]_*)+";
        const NUMBER = {
          className: "number",
          relevance: 0,
          variants: [
            // decimal floating-point-literal (subsumes decimal-literal)
            { match: `\\b(${decimalDigits})(\\.(${decimalDigits}))?([eE][+-]?(${decimalDigits}))?\\b` },
            // hexadecimal floating-point-literal (subsumes hexadecimal-literal)
            { match: `\\b0x(${hexDigits})(\\.(${hexDigits}))?([pP][+-]?(${decimalDigits}))?\\b` },
            // octal-literal
            { match: /\b0o([0-7]_*)+\b/ },
            // binary-literal
            { match: /\b0b([01]_*)+\b/ }
          ]
        };
        const ESCAPED_CHARACTER = (rawDelimiter = "") => ({
          className: "subst",
          variants: [
            { match: concat(/\\/, rawDelimiter, /[0\\tnr"']/) },
            { match: concat(/\\/, rawDelimiter, /u\{[0-9a-fA-F]{1,8}\}/) }
          ]
        });
        const ESCAPED_NEWLINE = (rawDelimiter = "") => ({
          className: "subst",
          match: concat(/\\/, rawDelimiter, /[\t ]*(?:[\r\n]|\r\n)/)
        });
        const INTERPOLATION = (rawDelimiter = "") => ({
          className: "subst",
          label: "interpol",
          begin: concat(/\\/, rawDelimiter, /\(/),
          end: /\)/
        });
        const MULTILINE_STRING = (rawDelimiter = "") => ({
          begin: concat(rawDelimiter, /"""/),
          end: concat(/"""/, rawDelimiter),
          contains: [
            ESCAPED_CHARACTER(rawDelimiter),
            ESCAPED_NEWLINE(rawDelimiter),
            INTERPOLATION(rawDelimiter)
          ]
        });
        const SINGLE_LINE_STRING = (rawDelimiter = "") => ({
          begin: concat(rawDelimiter, /"/),
          end: concat(/"/, rawDelimiter),
          contains: [
            ESCAPED_CHARACTER(rawDelimiter),
            INTERPOLATION(rawDelimiter)
          ]
        });
        const STRING = {
          className: "string",
          variants: [
            MULTILINE_STRING(),
            MULTILINE_STRING("#"),
            MULTILINE_STRING("##"),
            MULTILINE_STRING("###"),
            SINGLE_LINE_STRING(),
            SINGLE_LINE_STRING("#"),
            SINGLE_LINE_STRING("##"),
            SINGLE_LINE_STRING("###")
          ]
        };
        const REGEXP_CONTENTS = [
          hljs.BACKSLASH_ESCAPE,
          {
            begin: /\[/,
            end: /\]/,
            relevance: 0,
            contains: [hljs.BACKSLASH_ESCAPE]
          }
        ];
        const BARE_REGEXP_LITERAL = {
          begin: /\/[^\s](?=[^/\n]*\/)/,
          end: /\//,
          contains: REGEXP_CONTENTS
        };
        const EXTENDED_REGEXP_LITERAL = (rawDelimiter) => {
          const begin = concat(rawDelimiter, /\//);
          const end = concat(/\//, rawDelimiter);
          return {
            begin,
            end,
            contains: [
              ...REGEXP_CONTENTS,
              {
                scope: "comment",
                begin: `#(?!.*${end})`,
                end: /$/
              }
            ]
          };
        };
        const REGEXP = {
          scope: "regexp",
          variants: [
            EXTENDED_REGEXP_LITERAL("###"),
            EXTENDED_REGEXP_LITERAL("##"),
            EXTENDED_REGEXP_LITERAL("#"),
            BARE_REGEXP_LITERAL
          ]
        };
        const QUOTED_IDENTIFIER = { match: concat(/`/, identifier, /`/) };
        const IMPLICIT_PARAMETER = {
          className: "variable",
          match: /\$\d+/
        };
        const PROPERTY_WRAPPER_PROJECTION = {
          className: "variable",
          match: `\\$${identifierCharacter}+`
        };
        const IDENTIFIERS = [
          QUOTED_IDENTIFIER,
          IMPLICIT_PARAMETER,
          PROPERTY_WRAPPER_PROJECTION
        ];
        const AVAILABLE_ATTRIBUTE = {
          match: /(@|#(un)?)available/,
          scope: "keyword",
          starts: { contains: [
            {
              begin: /\(/,
              end: /\)/,
              keywords: availabilityKeywords,
              contains: [
                ...OPERATORS,
                NUMBER,
                STRING
              ]
            }
          ] }
        };
        const KEYWORD_ATTRIBUTE = {
          scope: "keyword",
          match: concat(/@/, either(...keywordAttributes), lookahead(either(/\(/, /\s+/)))
        };
        const USER_DEFINED_ATTRIBUTE = {
          scope: "meta",
          match: concat(/@/, identifier)
        };
        const ATTRIBUTES = [
          AVAILABLE_ATTRIBUTE,
          KEYWORD_ATTRIBUTE,
          USER_DEFINED_ATTRIBUTE
        ];
        const TYPE = {
          match: lookahead(/\b[A-Z]/),
          relevance: 0,
          contains: [
            {
              // Common Apple frameworks, for relevance boost
              className: "type",
              match: concat(/(AV|CA|CF|CG|CI|CL|CM|CN|CT|MK|MP|MTK|MTL|NS|SCN|SK|UI|WK|XC)/, identifierCharacter, "+")
            },
            {
              // Type identifier
              className: "type",
              match: typeIdentifier,
              relevance: 0
            },
            {
              // Optional type
              match: /[?!]+/,
              relevance: 0
            },
            {
              // Variadic parameter
              match: /\.\.\./,
              relevance: 0
            },
            {
              // Protocol composition
              match: concat(/\s+&\s+/, lookahead(typeIdentifier)),
              relevance: 0
            }
          ]
        };
        const GENERIC_ARGUMENTS = {
          begin: /</,
          end: />/,
          keywords: KEYWORDS,
          contains: [
            ...COMMENTS,
            ...KEYWORD_MODES,
            ...ATTRIBUTES,
            OPERATOR_GUARD,
            TYPE
          ]
        };
        TYPE.contains.push(GENERIC_ARGUMENTS);
        const TUPLE_ELEMENT_NAME = {
          match: concat(identifier, /\s*:/),
          keywords: "_|0",
          relevance: 0
        };
        const TUPLE = {
          begin: /\(/,
          end: /\)/,
          relevance: 0,
          keywords: KEYWORDS,
          contains: [
            "self",
            TUPLE_ELEMENT_NAME,
            ...COMMENTS,
            REGEXP,
            ...KEYWORD_MODES,
            ...BUILT_INS,
            ...OPERATORS,
            NUMBER,
            STRING,
            ...IDENTIFIERS,
            ...ATTRIBUTES,
            TYPE
          ]
        };
        const GENERIC_PARAMETERS = {
          begin: /</,
          end: />/,
          keywords: "repeat each",
          contains: [
            ...COMMENTS,
            TYPE
          ]
        };
        const FUNCTION_PARAMETER_NAME = {
          begin: either(
            lookahead(concat(identifier, /\s*:/)),
            lookahead(concat(identifier, /\s+/, identifier, /\s*:/))
          ),
          end: /:/,
          relevance: 0,
          contains: [
            {
              className: "keyword",
              match: /\b_\b/
            },
            {
              className: "params",
              match: identifier
            }
          ]
        };
        const FUNCTION_PARAMETERS = {
          begin: /\(/,
          end: /\)/,
          keywords: KEYWORDS,
          contains: [
            FUNCTION_PARAMETER_NAME,
            ...COMMENTS,
            ...KEYWORD_MODES,
            ...OPERATORS,
            NUMBER,
            STRING,
            ...ATTRIBUTES,
            TYPE,
            TUPLE
          ],
          endsParent: true,
          illegal: /["']/
        };
        const FUNCTION_OR_MACRO = {
          match: [
            /(func|macro)/,
            /\s+/,
            either(QUOTED_IDENTIFIER.match, identifier, operator)
          ],
          className: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            GENERIC_PARAMETERS,
            FUNCTION_PARAMETERS,
            WHITESPACE
          ],
          illegal: [
            /\[/,
            /%/
          ]
        };
        const INIT_SUBSCRIPT = {
          match: [
            /\b(?:subscript|init[?!]?)/,
            /\s*(?=[<(])/
          ],
          className: { 1: "keyword" },
          contains: [
            GENERIC_PARAMETERS,
            FUNCTION_PARAMETERS,
            WHITESPACE
          ],
          illegal: /\[|%/
        };
        const OPERATOR_DECLARATION = {
          match: [
            /operator/,
            /\s+/,
            operator
          ],
          className: {
            1: "keyword",
            3: "title"
          }
        };
        const PRECEDENCEGROUP = {
          begin: [
            /precedencegroup/,
            /\s+/,
            typeIdentifier
          ],
          className: {
            1: "keyword",
            3: "title"
          },
          contains: [TYPE],
          keywords: [
            ...precedencegroupKeywords,
            ...literals
          ],
          end: /}/
        };
        const CLASS_FUNC_DECLARATION = {
          match: [
            /class\b/,
            /\s+/,
            /func\b/,
            /\s+/,
            /\b[A-Za-z_][A-Za-z0-9_]*\b/
          ],
          scope: {
            1: "keyword",
            3: "keyword",
            5: "title.function"
          }
        };
        const CLASS_VAR_DECLARATION = {
          match: [
            /class\b/,
            /\s+/,
            /var\b/
          ],
          scope: {
            1: "keyword",
            3: "keyword"
          }
        };
        const TYPE_DECLARATION = {
          begin: [
            /(struct|protocol|class|extension|enum|actor)/,
            /\s+/,
            identifier,
            /\s*/
          ],
          beginScope: {
            1: "keyword",
            3: "title.class"
          },
          keywords: KEYWORDS,
          contains: [
            GENERIC_PARAMETERS,
            ...KEYWORD_MODES,
            {
              begin: /:/,
              end: /\{/,
              keywords: KEYWORDS,
              contains: [
                {
                  scope: "title.class.inherited",
                  match: typeIdentifier
                },
                ...KEYWORD_MODES
              ],
              relevance: 0
            }
          ]
        };
        for (const variant of STRING.variants) {
          const interpolation = variant.contains.find((mode) => mode.label === "interpol");
          interpolation.keywords = KEYWORDS;
          const submodes = [
            ...KEYWORD_MODES,
            ...BUILT_INS,
            ...OPERATORS,
            NUMBER,
            STRING,
            ...IDENTIFIERS
          ];
          interpolation.contains = [
            ...submodes,
            {
              begin: /\(/,
              end: /\)/,
              contains: [
                "self",
                ...submodes
              ]
            }
          ];
        }
        return {
          name: "Swift",
          keywords: KEYWORDS,
          contains: [
            ...COMMENTS,
            FUNCTION_OR_MACRO,
            INIT_SUBSCRIPT,
            CLASS_FUNC_DECLARATION,
            CLASS_VAR_DECLARATION,
            TYPE_DECLARATION,
            OPERATOR_DECLARATION,
            PRECEDENCEGROUP,
            {
              beginKeywords: "import",
              end: /$/,
              contains: [...COMMENTS],
              relevance: 0
            },
            REGEXP,
            ...KEYWORD_MODES,
            ...BUILT_INS,
            ...OPERATORS,
            NUMBER,
            STRING,
            ...IDENTIFIERS,
            ...ATTRIBUTES,
            TYPE,
            TUPLE
          ]
        };
      }
      module.exports = swift;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/yaml.js
  var require_yaml = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/yaml.js"(exports, module) {
      function yaml(hljs) {
        const LITERALS = "true false yes no null";
        const URI_CHARACTERS = "[\\w#;/?:@&=+$,.~*'()[\\]]+";
        const KEY = {
          className: "attr",
          variants: [
            // added brackets support and special char support
            { begin: /[\w*@][\w*@ :()\./-]*:(?=[ \t]|$)/ },
            {
              // double quoted keys - with brackets and special char support
              begin: /"[\w*@][\w*@ :()\./-]*":(?=[ \t]|$)/
            },
            {
              // single quoted keys - with brackets and special char support
              begin: /'[\w*@][\w*@ :()\./-]*':(?=[ \t]|$)/
            }
          ]
        };
        const TEMPLATE_VARIABLES = {
          className: "template-variable",
          variants: [
            {
              // jinja templates Ansible
              begin: /\{\{/,
              end: /\}\}/
            },
            {
              // Ruby i18n
              begin: /%\{/,
              end: /\}/
            }
          ]
        };
        const SINGLE_QUOTE_STRING = {
          className: "string",
          relevance: 0,
          begin: /'/,
          end: /'/,
          contains: [
            {
              match: /''/,
              scope: "char.escape",
              relevance: 0
            }
          ]
        };
        const STRING = {
          className: "string",
          relevance: 0,
          variants: [
            {
              begin: /"/,
              end: /"/
            },
            { begin: /\S+/ }
          ],
          contains: [
            hljs.BACKSLASH_ESCAPE,
            TEMPLATE_VARIABLES
          ]
        };
        const CONTAINER_STRING = hljs.inherit(STRING, { variants: [
          {
            begin: /'/,
            end: /'/,
            contains: [
              {
                begin: /''/,
                relevance: 0
              }
            ]
          },
          {
            begin: /"/,
            end: /"/
          },
          { begin: /[^\s,{}[\]]+/ }
        ] });
        const DATE_RE = "[0-9]{4}(-[0-9][0-9]){0,2}";
        const TIME_RE = "([Tt \\t][0-9][0-9]?(:[0-9][0-9]){2})?";
        const FRACTION_RE = "(\\.[0-9]*)?";
        const ZONE_RE = "([ \\t])*(Z|[-+][0-9][0-9]?(:[0-9][0-9])?)?";
        const TIMESTAMP = {
          className: "number",
          begin: "\\b" + DATE_RE + TIME_RE + FRACTION_RE + ZONE_RE + "\\b"
        };
        const VALUE_CONTAINER = {
          end: ",",
          endsWithParent: true,
          excludeEnd: true,
          keywords: LITERALS,
          relevance: 0
        };
        const OBJECT = {
          begin: /\{/,
          end: /\}/,
          contains: [VALUE_CONTAINER],
          illegal: "\\n",
          relevance: 0
        };
        const ARRAY = {
          begin: "\\[",
          end: "\\]",
          contains: [VALUE_CONTAINER],
          illegal: "\\n",
          relevance: 0
        };
        const MODES = [
          KEY,
          {
            className: "meta",
            begin: "^---\\s*$",
            relevance: 10
          },
          {
            // multi line string
            // Blocks start with a | or > followed by a newline
            //
            // Indentation of subsequent lines must be the same to
            // be considered part of the block
            className: "string",
            begin: "[\\|>]([1-9]?[+-])?[ ]*\\n( +)[^ ][^\\n]*\\n(\\2[^\\n]+\\n?)*"
          },
          {
            // Ruby/Rails erb
            begin: "<%[%=-]?",
            end: "[%-]?%>",
            subLanguage: "ruby",
            excludeBegin: true,
            excludeEnd: true,
            relevance: 0
          },
          {
            // named tags
            className: "type",
            begin: "!\\w+!" + URI_CHARACTERS
          },
          // https://yaml.org/spec/1.2/spec.html#id2784064
          {
            // verbatim tags
            className: "type",
            begin: "!<" + URI_CHARACTERS + ">"
          },
          {
            // primary tags
            className: "type",
            begin: "!" + URI_CHARACTERS
          },
          {
            // secondary tags
            className: "type",
            begin: "!!" + URI_CHARACTERS
          },
          {
            // fragment id &ref
            className: "meta",
            begin: "&" + hljs.UNDERSCORE_IDENT_RE + "$"
          },
          {
            // fragment reference *ref
            className: "meta",
            begin: "\\*" + hljs.UNDERSCORE_IDENT_RE + "$"
          },
          {
            // array listing
            className: "bullet",
            // TODO: remove |$ hack when we have proper look-ahead support
            begin: "-(?=[ ]|$)",
            relevance: 0
          },
          hljs.HASH_COMMENT_MODE,
          {
            beginKeywords: LITERALS,
            keywords: { literal: LITERALS }
          },
          TIMESTAMP,
          // numbers are any valid C-style number that
          // sit isolated from other words
          {
            className: "number",
            begin: hljs.C_NUMBER_RE + "\\b",
            relevance: 0
          },
          OBJECT,
          ARRAY,
          SINGLE_QUOTE_STRING,
          STRING
        ];
        const VALUE_MODES = [...MODES];
        VALUE_MODES.pop();
        VALUE_MODES.push(CONTAINER_STRING);
        VALUE_CONTAINER.contains = VALUE_MODES;
        return {
          name: "YAML",
          case_insensitive: true,
          aliases: ["yml"],
          contains: MODES
        };
      }
      module.exports = yaml;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/typescript.js
  var require_typescript = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/typescript.js"(exports, module) {
      var IDENT_RE = "[A-Za-z$_][0-9A-Za-z$_]*";
      var KEYWORDS = [
        "as",
        // for exports
        "in",
        "of",
        "if",
        "for",
        "while",
        "finally",
        "var",
        "new",
        "function",
        "do",
        "return",
        "void",
        "else",
        "break",
        "catch",
        "instanceof",
        "with",
        "throw",
        "case",
        "default",
        "try",
        "switch",
        "continue",
        "typeof",
        "delete",
        "let",
        "yield",
        "const",
        "class",
        // JS handles these with a special rule
        // "get",
        // "set",
        "debugger",
        "async",
        "await",
        "static",
        "import",
        "from",
        "export",
        "extends",
        // It's reached stage 3, which is "recommended for implementation":
        "using"
      ];
      var LITERALS = [
        "true",
        "false",
        "null",
        "undefined",
        "NaN",
        "Infinity"
      ];
      var TYPES = [
        // Fundamental objects
        "Object",
        "Function",
        "Boolean",
        "Symbol",
        // numbers and dates
        "Math",
        "Date",
        "Number",
        "BigInt",
        // text
        "String",
        "RegExp",
        // Indexed collections
        "Array",
        "Float32Array",
        "Float64Array",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Int32Array",
        "Uint16Array",
        "Uint32Array",
        "BigInt64Array",
        "BigUint64Array",
        // Keyed collections
        "Set",
        "Map",
        "WeakSet",
        "WeakMap",
        // Structured data
        "ArrayBuffer",
        "SharedArrayBuffer",
        "Atomics",
        "DataView",
        "JSON",
        // Control abstraction objects
        "Promise",
        "Generator",
        "GeneratorFunction",
        "AsyncFunction",
        // Reflection
        "Reflect",
        "Proxy",
        // Internationalization
        "Intl",
        // WebAssembly
        "WebAssembly"
      ];
      var ERROR_TYPES = [
        "Error",
        "EvalError",
        "InternalError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "TypeError",
        "URIError"
      ];
      var BUILT_IN_GLOBALS = [
        "setInterval",
        "setTimeout",
        "clearInterval",
        "clearTimeout",
        "require",
        "exports",
        "eval",
        "isFinite",
        "isNaN",
        "parseFloat",
        "parseInt",
        "decodeURI",
        "decodeURIComponent",
        "encodeURI",
        "encodeURIComponent",
        "escape",
        "unescape"
      ];
      var BUILT_IN_VARIABLES = [
        "arguments",
        "this",
        "super",
        "console",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "module",
        "self",
        "global"
        // Node.js
      ];
      var BUILT_INS = [].concat(
        BUILT_IN_GLOBALS,
        TYPES,
        ERROR_TYPES
      );
      function javascript(hljs) {
        const regex = hljs.regex;
        const hasClosingTag = (match, { after }) => {
          const tag = "</" + match[0].slice(1);
          const pos = match.input.indexOf(tag, after);
          return pos !== -1;
        };
        const IDENT_RE$1 = IDENT_RE;
        const FRAGMENT = {
          begin: "<>",
          end: "</>"
        };
        const XML_SELF_CLOSING = /<[A-Za-z0-9\\._:-]+\s*\/>/;
        const XML_TAG = {
          begin: /<[A-Za-z0-9\\._:-]+/,
          end: /\/[A-Za-z0-9\\._:-]+>|\/>/,
          /**
           * @param {RegExpMatchArray} match
           * @param {CallbackResponse} response
           */
          isTrulyOpeningTag: (match, response) => {
            const afterMatchIndex = match[0].length + match.index;
            const nextChar = match.input[afterMatchIndex];
            if (
              // HTML should not include another raw `<` inside a tag
              // nested type?
              // `<Array<Array<number>>`, etc.
              nextChar === "<" || // the , gives away that this is not HTML
              // `<T, A extends keyof T, V>`
              nextChar === ","
            ) {
              response.ignoreMatch();
              return;
            }
            if (nextChar === ">") {
              if (!hasClosingTag(match, { after: afterMatchIndex })) {
                response.ignoreMatch();
              }
            }
            let m;
            const afterMatch = match.input.substring(afterMatchIndex);
            if (m = afterMatch.match(/^\s*=/)) {
              response.ignoreMatch();
              return;
            }
            if (m = afterMatch.match(/^\s+extends\s+/)) {
              if (m.index === 0) {
                response.ignoreMatch();
                return;
              }
            }
          }
        };
        const KEYWORDS$1 = {
          $pattern: IDENT_RE,
          keyword: KEYWORDS,
          literal: LITERALS,
          built_in: BUILT_INS,
          "variable.language": BUILT_IN_VARIABLES
        };
        const decimalDigits = "[0-9](_?[0-9])*";
        const frac = `\\.(${decimalDigits})`;
        const decimalInteger = `0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`;
        const NUMBER = {
          className: "number",
          variants: [
            // DecimalLiteral
            { begin: `(\\b(${decimalInteger})((${frac})|\\.)?|(${frac}))[eE][+-]?(${decimalDigits})\\b` },
            { begin: `\\b(${decimalInteger})\\b((${frac})\\b|\\.)?|(${frac})\\b` },
            // DecimalBigIntegerLiteral
            { begin: `\\b(0|[1-9](_?[0-9])*)n\\b` },
            // NonDecimalIntegerLiteral
            { begin: "\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b" },
            { begin: "\\b0[bB][0-1](_?[0-1])*n?\\b" },
            { begin: "\\b0[oO][0-7](_?[0-7])*n?\\b" },
            // LegacyOctalIntegerLiteral (does not include underscore separators)
            // https://tc39.es/ecma262/#sec-additional-syntax-numeric-literals
            { begin: "\\b0[0-7]+n?\\b" }
          ],
          relevance: 0
        };
        const SUBST = {
          className: "subst",
          begin: "\\$\\{",
          end: "\\}",
          keywords: KEYWORDS$1,
          contains: []
          // defined later
        };
        const HTML_TEMPLATE = {
          begin: ".?html`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "xml"
          }
        };
        const CSS_TEMPLATE = {
          begin: ".?css`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "css"
          }
        };
        const GRAPHQL_TEMPLATE = {
          begin: ".?gql`",
          end: "",
          starts: {
            end: "`",
            returnEnd: false,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              SUBST
            ],
            subLanguage: "graphql"
          }
        };
        const TEMPLATE_STRING = {
          className: "string",
          begin: "`",
          end: "`",
          contains: [
            hljs.BACKSLASH_ESCAPE,
            SUBST
          ]
        };
        const JSDOC_COMMENT = hljs.COMMENT(
          /\/\*\*(?!\/)/,
          "\\*/",
          {
            relevance: 0,
            contains: [
              {
                begin: "(?=@[A-Za-z]+)",
                relevance: 0,
                contains: [
                  {
                    className: "doctag",
                    begin: "@[A-Za-z]+"
                  },
                  {
                    className: "type",
                    begin: "\\{",
                    end: "\\}",
                    excludeEnd: true,
                    excludeBegin: true,
                    relevance: 0
                  },
                  {
                    className: "variable",
                    begin: IDENT_RE$1 + "(?=\\s*(-)|$)",
                    endsParent: true,
                    relevance: 0
                  },
                  // eat spaces (not newlines) so we can find
                  // types or variables
                  {
                    begin: /(?=[^\n])\s/,
                    relevance: 0
                  }
                ]
              }
            ]
          }
        );
        const COMMENT = {
          className: "comment",
          variants: [
            JSDOC_COMMENT,
            hljs.C_BLOCK_COMMENT_MODE,
            hljs.C_LINE_COMMENT_MODE
          ]
        };
        const SUBST_INTERNALS = [
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          HTML_TEMPLATE,
          CSS_TEMPLATE,
          GRAPHQL_TEMPLATE,
          TEMPLATE_STRING,
          // Skip numbers when they are part of a variable name
          { match: /\$\d+/ },
          NUMBER
          // This is intentional:
          // See https://github.com/highlightjs/highlight.js/issues/3288
          // hljs.REGEXP_MODE
        ];
        SUBST.contains = SUBST_INTERNALS.concat({
          // we need to pair up {} inside our subst to prevent
          // it from ending too early by matching another }
          begin: /\{/,
          end: /\}/,
          keywords: KEYWORDS$1,
          contains: [
            "self"
          ].concat(SUBST_INTERNALS)
        });
        const SUBST_AND_COMMENTS = [].concat(COMMENT, SUBST.contains);
        const PARAMS_CONTAINS = SUBST_AND_COMMENTS.concat([
          // eat recursive parens in sub expressions
          {
            begin: /(\s*)\(/,
            end: /\)/,
            keywords: KEYWORDS$1,
            contains: ["self"].concat(SUBST_AND_COMMENTS)
          }
        ]);
        const PARAMS = {
          className: "params",
          // convert this to negative lookbehind in v12
          begin: /(\s*)\(/,
          // to match the parms with
          end: /\)/,
          excludeBegin: true,
          excludeEnd: true,
          keywords: KEYWORDS$1,
          contains: PARAMS_CONTAINS
        };
        const CLASS_OR_EXTENDS = {
          variants: [
            // class Car extends vehicle
            {
              match: [
                /class/,
                /\s+/,
                IDENT_RE$1,
                /\s+/,
                /extends/,
                /\s+/,
                regex.concat(IDENT_RE$1, "(", regex.concat(/\./, IDENT_RE$1), ")*")
              ],
              scope: {
                1: "keyword",
                3: "title.class",
                5: "keyword",
                7: "title.class.inherited"
              }
            },
            // class Car
            {
              match: [
                /class/,
                /\s+/,
                IDENT_RE$1
              ],
              scope: {
                1: "keyword",
                3: "title.class"
              }
            }
          ]
        };
        const CLASS_REFERENCE = {
          relevance: 0,
          match: regex.either(
            // Hard coded exceptions
            /\bJSON/,
            // Float32Array, OutT
            /\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,
            // CSSFactory, CSSFactoryT
            /\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,
            // FPs, FPsT
            /\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/
            // P
            // single letters are not highlighted
            // BLAH
            // this will be flagged as a UPPER_CASE_CONSTANT instead
          ),
          className: "title.class",
          keywords: {
            _: [
              // se we still get relevance credit for JS library classes
              ...TYPES,
              ...ERROR_TYPES
            ]
          }
        };
        const USE_STRICT = {
          label: "use_strict",
          className: "meta",
          relevance: 10,
          begin: /^\s*['"]use (strict|asm)['"]/
        };
        const FUNCTION_DEFINITION = {
          variants: [
            {
              match: [
                /function/,
                /\s+/,
                IDENT_RE$1,
                /(?=\s*\()/
              ]
            },
            // anonymous function
            {
              match: [
                /function/,
                /\s*(?=\()/
              ]
            }
          ],
          className: {
            1: "keyword",
            3: "title.function"
          },
          label: "func.def",
          contains: [PARAMS],
          illegal: /%/
        };
        const UPPER_CASE_CONSTANT = {
          relevance: 0,
          match: /\b[A-Z][A-Z_0-9]+\b/,
          className: "variable.constant"
        };
        function noneOf(list) {
          return regex.concat("(?!", list.join("|"), ")");
        }
        const FUNCTION_CALL = {
          match: regex.concat(
            /\b/,
            noneOf([
              ...BUILT_IN_GLOBALS,
              "super",
              "import",
              "await"
            ].map((x) => `${x}\\s*\\(`)),
            IDENT_RE$1,
            regex.lookahead(/\s*\(/)
          ),
          className: "title.function",
          relevance: 0
        };
        const PROPERTY_ACCESS = {
          begin: regex.concat(/\./, regex.lookahead(
            regex.concat(IDENT_RE$1, /(?![0-9A-Za-z$_(])/)
          )),
          end: IDENT_RE$1,
          excludeBegin: true,
          keywords: "prototype",
          className: "property",
          relevance: 0
        };
        const GETTER_OR_SETTER = {
          match: [
            /get|set/,
            /\s+/,
            IDENT_RE$1,
            /(?=\()/
          ],
          className: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            {
              // eat to avoid empty params
              begin: /\(\)/
            },
            PARAMS
          ]
        };
        const FUNC_LEAD_IN_RE = "(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|" + hljs.UNDERSCORE_IDENT_RE + ")\\s*=>";
        const FUNCTION_VARIABLE = {
          match: [
            /const|var|let/,
            /\s+/,
            IDENT_RE$1,
            /\s*/,
            /=\s*/,
            /(async\s*)?/,
            // async is optional
            regex.lookahead(FUNC_LEAD_IN_RE)
          ],
          keywords: "async",
          className: {
            1: "keyword",
            3: "title.function"
          },
          contains: [
            PARAMS
          ]
        };
        return {
          name: "JavaScript",
          aliases: ["js", "jsx", "mjs", "cjs"],
          keywords: KEYWORDS$1,
          // this will be extended by TypeScript
          exports: { PARAMS_CONTAINS, CLASS_REFERENCE },
          illegal: /#(?![$_A-Za-z])/,
          contains: [
            hljs.SHEBANG({
              label: "shebang",
              binary: "node",
              relevance: 5
            }),
            USE_STRICT,
            hljs.APOS_STRING_MODE,
            hljs.QUOTE_STRING_MODE,
            HTML_TEMPLATE,
            CSS_TEMPLATE,
            GRAPHQL_TEMPLATE,
            TEMPLATE_STRING,
            COMMENT,
            // Skip numbers when they are part of a variable name
            { match: /\$\d+/ },
            NUMBER,
            CLASS_REFERENCE,
            {
              scope: "attr",
              match: IDENT_RE$1 + regex.lookahead(":"),
              relevance: 0
            },
            FUNCTION_VARIABLE,
            {
              // "value" container
              begin: "(" + hljs.RE_STARTERS_RE + "|\\b(case|return|throw)\\b)\\s*",
              keywords: "return throw case",
              relevance: 0,
              contains: [
                COMMENT,
                hljs.REGEXP_MODE,
                {
                  className: "function",
                  // we have to count the parens to make sure we actually have the
                  // correct bounding ( ) before the =>.  There could be any number of
                  // sub-expressions inside also surrounded by parens.
                  begin: FUNC_LEAD_IN_RE,
                  returnBegin: true,
                  end: "\\s*=>",
                  contains: [
                    {
                      className: "params",
                      variants: [
                        {
                          begin: hljs.UNDERSCORE_IDENT_RE,
                          relevance: 0
                        },
                        {
                          className: null,
                          begin: /\(\s*\)/,
                          skip: true
                        },
                        {
                          begin: /(\s*)\(/,
                          end: /\)/,
                          excludeBegin: true,
                          excludeEnd: true,
                          keywords: KEYWORDS$1,
                          contains: PARAMS_CONTAINS
                        }
                      ]
                    }
                  ]
                },
                {
                  // could be a comma delimited list of params to a function call
                  begin: /,/,
                  relevance: 0
                },
                {
                  match: /\s+/,
                  relevance: 0
                },
                {
                  // JSX
                  variants: [
                    { begin: FRAGMENT.begin, end: FRAGMENT.end },
                    { match: XML_SELF_CLOSING },
                    {
                      begin: XML_TAG.begin,
                      // we carefully check the opening tag to see if it truly
                      // is a tag and not a false positive
                      "on:begin": XML_TAG.isTrulyOpeningTag,
                      end: XML_TAG.end
                    }
                  ],
                  subLanguage: "xml",
                  contains: [
                    {
                      begin: XML_TAG.begin,
                      end: XML_TAG.end,
                      skip: true,
                      contains: ["self"]
                    }
                  ]
                }
              ]
            },
            FUNCTION_DEFINITION,
            {
              // prevent this from getting swallowed up by function
              // since they appear "function like"
              beginKeywords: "while if switch catch for"
            },
            {
              // we have to count the parens to make sure we actually have the correct
              // bounding ( ).  There could be any number of sub-expressions inside
              // also surrounded by parens.
              begin: "\\b(?!function)" + hljs.UNDERSCORE_IDENT_RE + "\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{",
              // end parens
              returnBegin: true,
              label: "func.def",
              contains: [
                PARAMS,
                hljs.inherit(hljs.TITLE_MODE, { begin: IDENT_RE$1, className: "title.function" })
              ]
            },
            // catch ... so it won't trigger the property rule below
            {
              match: /\.\.\./,
              relevance: 0
            },
            PROPERTY_ACCESS,
            // hack: prevents detection of keywords in some circumstances
            // .keyword()
            // $keyword = x
            {
              match: "\\$" + IDENT_RE$1,
              relevance: 0
            },
            {
              match: [/\bconstructor(?=\s*\()/],
              className: { 1: "title.function" },
              contains: [PARAMS]
            },
            FUNCTION_CALL,
            UPPER_CASE_CONSTANT,
            CLASS_OR_EXTENDS,
            GETTER_OR_SETTER,
            {
              match: /\$[(.]/
              // relevance booster for a pattern common to JS libs: `$(something)` and `$.something`
            }
          ]
        };
      }
      function typescript(hljs) {
        const regex = hljs.regex;
        const tsLanguage = javascript(hljs);
        const IDENT_RE$1 = IDENT_RE;
        const TYPES2 = [
          "any",
          "void",
          "number",
          "boolean",
          "string",
          "object",
          "never",
          "symbol",
          "bigint",
          "unknown"
        ];
        const NAMESPACE = {
          begin: [
            /namespace/,
            /\s+/,
            hljs.IDENT_RE
          ],
          beginScope: {
            1: "keyword",
            3: "title.class"
          }
        };
        const INTERFACE = {
          beginKeywords: "interface",
          end: /\{/,
          excludeEnd: true,
          keywords: {
            keyword: "interface extends",
            built_in: TYPES2
          },
          contains: [tsLanguage.exports.CLASS_REFERENCE]
        };
        const USE_STRICT = {
          className: "meta",
          relevance: 10,
          begin: /^\s*['"]use strict['"]/
        };
        const TS_SPECIFIC_KEYWORDS = [
          "type",
          // "namespace",
          "interface",
          "public",
          "private",
          "protected",
          "implements",
          "declare",
          "abstract",
          "readonly",
          "enum",
          "override",
          "satisfies"
        ];
        const KEYWORDS$1 = {
          $pattern: IDENT_RE,
          keyword: KEYWORDS.concat(TS_SPECIFIC_KEYWORDS),
          literal: LITERALS,
          built_in: BUILT_INS.concat(TYPES2),
          "variable.language": BUILT_IN_VARIABLES
        };
        const DECORATOR = {
          className: "meta",
          begin: "@" + IDENT_RE$1
        };
        const swapMode = (mode, label, replacement) => {
          const indx = mode.contains.findIndex((m) => m.label === label);
          if (indx === -1) {
            throw new Error("can not find mode to replace");
          }
          mode.contains.splice(indx, 1, replacement);
        };
        Object.assign(tsLanguage.keywords, KEYWORDS$1);
        tsLanguage.exports.PARAMS_CONTAINS.push(DECORATOR);
        const ATTRIBUTE_HIGHLIGHT = tsLanguage.contains.find((c) => c.scope === "attr");
        const OPTIONAL_KEY_OR_ARGUMENT = Object.assign(
          {},
          ATTRIBUTE_HIGHLIGHT,
          { match: regex.concat(IDENT_RE$1, regex.lookahead(/\s*\?:/)) }
        );
        tsLanguage.exports.PARAMS_CONTAINS.push([
          tsLanguage.exports.CLASS_REFERENCE,
          // class reference for highlighting the params types
          ATTRIBUTE_HIGHLIGHT,
          // highlight the params key
          OPTIONAL_KEY_OR_ARGUMENT
          // Added for optional property assignment highlighting
        ]);
        tsLanguage.contains = tsLanguage.contains.concat([
          DECORATOR,
          NAMESPACE,
          INTERFACE,
          OPTIONAL_KEY_OR_ARGUMENT
          // Added for optional property assignment highlighting
        ]);
        swapMode(tsLanguage, "shebang", hljs.SHEBANG());
        swapMode(tsLanguage, "use_strict", USE_STRICT);
        const functionDeclaration = tsLanguage.contains.find((m) => m.label === "func.def");
        functionDeclaration.relevance = 0;
        Object.assign(tsLanguage, {
          name: "TypeScript",
          aliases: [
            "ts",
            "tsx",
            "mts",
            "cts"
          ]
        });
        return tsLanguage;
      }
      module.exports = typescript;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/vbnet.js
  var require_vbnet = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/vbnet.js"(exports, module) {
      function vbnet(hljs) {
        const regex = hljs.regex;
        const CHARACTER = {
          className: "string",
          begin: /"(""|[^/n])"C\b/
        };
        const STRING = {
          className: "string",
          begin: /"/,
          end: /"/,
          illegal: /\n/,
          contains: [
            {
              // double quote escape
              begin: /""/
            }
          ]
        };
        const MM_DD_YYYY = /\d{1,2}\/\d{1,2}\/\d{4}/;
        const YYYY_MM_DD = /\d{4}-\d{1,2}-\d{1,2}/;
        const TIME_12H = /(\d|1[012])(:\d+){0,2} *(AM|PM)/;
        const TIME_24H = /\d{1,2}(:\d{1,2}){1,2}/;
        const DATE2 = {
          className: "literal",
          variants: [
            {
              // #YYYY-MM-DD# (ISO-Date) or #M/D/YYYY# (US-Date)
              begin: regex.concat(/# */, regex.either(YYYY_MM_DD, MM_DD_YYYY), / *#/)
            },
            {
              // #H:mm[:ss]# (24h Time)
              begin: regex.concat(/# */, TIME_24H, / *#/)
            },
            {
              // #h[:mm[:ss]] A# (12h Time)
              begin: regex.concat(/# */, TIME_12H, / *#/)
            },
            {
              // date plus time
              begin: regex.concat(
                /# */,
                regex.either(YYYY_MM_DD, MM_DD_YYYY),
                / +/,
                regex.either(TIME_12H, TIME_24H),
                / *#/
              )
            }
          ]
        };
        const NUMBER = {
          className: "number",
          relevance: 0,
          variants: [
            {
              // Float
              begin: /\b\d[\d_]*((\.[\d_]+(E[+-]?[\d_]+)?)|(E[+-]?[\d_]+))[RFD@!#]?/
            },
            {
              // Integer (base 10)
              begin: /\b\d[\d_]*((U?[SIL])|[%&])?/
            },
            {
              // Integer (base 16)
              begin: /&H[\dA-F_]+((U?[SIL])|[%&])?/
            },
            {
              // Integer (base 8)
              begin: /&O[0-7_]+((U?[SIL])|[%&])?/
            },
            {
              // Integer (base 2)
              begin: /&B[01_]+((U?[SIL])|[%&])?/
            }
          ]
        };
        const LABEL = {
          className: "label",
          begin: /^\w+:/
        };
        const DOC_COMMENT = hljs.COMMENT(/'''/, /$/, { contains: [
          {
            className: "doctag",
            begin: /<\/?/,
            end: />/
          }
        ] });
        const COMMENT = hljs.COMMENT(null, /$/, { variants: [
          { begin: /'/ },
          {
            // TODO: Use multi-class for leading spaces
            begin: /([\t ]|^)REM(?=\s)/
          }
        ] });
        const DIRECTIVES = {
          className: "meta",
          // TODO: Use multi-class for indentation once available
          begin: /[\t ]*#(const|disable|else|elseif|enable|end|externalsource|if|region)\b/,
          end: /$/,
          keywords: { keyword: "const disable else elseif enable end externalsource if region then" },
          contains: [COMMENT]
        };
        return {
          name: "Visual Basic .NET",
          aliases: ["vb"],
          case_insensitive: true,
          classNameAliases: { label: "symbol" },
          keywords: {
            keyword: "addhandler alias aggregate ansi as async assembly auto binary by byref byval call case catch class compare const continue custom declare default delegate dim distinct do each equals else elseif end enum erase error event exit explicit finally for friend from function get global goto group handles if implements imports in inherits interface into iterator join key let lib loop me mid module mustinherit mustoverride mybase myclass namespace narrowing new next notinheritable notoverridable of off on operator option optional order overloads overridable overrides paramarray partial preserve private property protected public raiseevent readonly redim removehandler resume return select set shadows shared skip static step stop structure strict sub synclock take text then throw to try unicode until using when where while widening with withevents writeonly yield",
            built_in: (
              // Operators https://docs.microsoft.com/dotnet/visual-basic/language-reference/operators
              "addressof and andalso await directcast gettype getxmlnamespace is isfalse isnot istrue like mod nameof new not or orelse trycast typeof xor cbool cbyte cchar cdate cdbl cdec cint clng cobj csbyte cshort csng cstr cuint culng cushort"
            ),
            type: (
              // Data types https://docs.microsoft.com/dotnet/visual-basic/language-reference/data-types
              "boolean byte char date decimal double integer long object sbyte short single string uinteger ulong ushort"
            ),
            literal: "true false nothing"
          },
          illegal: "//|\\{|\\}|endif|gosub|variant|wend|^\\$ ",
          contains: [
            CHARACTER,
            STRING,
            DATE2,
            NUMBER,
            LABEL,
            DOC_COMMENT,
            COMMENT,
            DIRECTIVES
          ]
        };
      }
      module.exports = vbnet;
    }
  });

  // ../tide/node_modules/highlight.js/lib/languages/wasm.js
  var require_wasm = __commonJS({
    "../tide/node_modules/highlight.js/lib/languages/wasm.js"(exports, module) {
      function wasm(hljs) {
        hljs.regex;
        const BLOCK_COMMENT = hljs.COMMENT(/\(;/, /;\)/);
        BLOCK_COMMENT.contains.push("self");
        const LINE_COMMENT = hljs.COMMENT(/;;/, /$/);
        const KWS = [
          "anyfunc",
          "block",
          "br",
          "br_if",
          "br_table",
          "call",
          "call_indirect",
          "data",
          "drop",
          "elem",
          "else",
          "end",
          "export",
          "func",
          "global.get",
          "global.set",
          "local.get",
          "local.set",
          "local.tee",
          "get_global",
          "get_local",
          "global",
          "if",
          "import",
          "local",
          "loop",
          "memory",
          "memory.grow",
          "memory.size",
          "module",
          "mut",
          "nop",
          "offset",
          "param",
          "result",
          "return",
          "select",
          "set_global",
          "set_local",
          "start",
          "table",
          "tee_local",
          "then",
          "type",
          "unreachable"
        ];
        const FUNCTION_REFERENCE = {
          begin: [
            /(?:func|call|call_indirect)/,
            /\s+/,
            /\$[^\s)]+/
          ],
          className: {
            1: "keyword",
            3: "title.function"
          }
        };
        const ARGUMENT = {
          className: "variable",
          begin: /\$[\w_]+/
        };
        const PARENS = {
          match: /(\((?!;)|\))+/,
          className: "punctuation",
          relevance: 0
        };
        const NUMBER = {
          className: "number",
          relevance: 0,
          // borrowed from Prism, TODO: split out into variants
          match: /[+-]?\b(?:\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?|0x[\da-fA-F](?:_?[\da-fA-F])*(?:\.[\da-fA-F](?:_?[\da-fA-D])*)?(?:[pP][+-]?\d(?:_?\d)*)?)\b|\binf\b|\bnan(?::0x[\da-fA-F](?:_?[\da-fA-D])*)?\b/
        };
        const TYPE = {
          // look-ahead prevents us from gobbling up opcodes
          match: /(i32|i64|f32|f64)(?!\.)/,
          className: "type"
        };
        const MATH_OPERATIONS = {
          className: "keyword",
          // borrowed from Prism, TODO: split out into variants
          match: /\b(f32|f64|i32|i64)(?:\.(?:abs|add|and|ceil|clz|const|convert_[su]\/i(?:32|64)|copysign|ctz|demote\/f64|div(?:_[su])?|eqz?|extend_[su]\/i32|floor|ge(?:_[su])?|gt(?:_[su])?|le(?:_[su])?|load(?:(?:8|16|32)_[su])?|lt(?:_[su])?|max|min|mul|nearest|neg?|or|popcnt|promote\/f32|reinterpret\/[fi](?:32|64)|rem_[su]|rot[lr]|shl|shr_[su]|store(?:8|16|32)?|sqrt|sub|trunc(?:_[su]\/f(?:32|64))?|wrap\/i64|xor))\b/
        };
        const OFFSET_ALIGN = {
          match: [
            /(?:offset|align)/,
            /\s*/,
            /=/
          ],
          className: {
            1: "keyword",
            3: "operator"
          }
        };
        return {
          name: "WebAssembly",
          keywords: {
            $pattern: /[\w.]+/,
            keyword: KWS
          },
          contains: [
            LINE_COMMENT,
            BLOCK_COMMENT,
            OFFSET_ALIGN,
            ARGUMENT,
            PARENS,
            FUNCTION_REFERENCE,
            hljs.QUOTE_STRING_MODE,
            TYPE,
            MATH_OPERATIONS,
            NUMBER
          ]
        };
      }
      module.exports = wasm;
    }
  });

  // ../tide/node_modules/highlight.js/lib/common.js
  var require_common = __commonJS({
    "../tide/node_modules/highlight.js/lib/common.js"(exports, module) {
      var hljs = require_core();
      hljs.registerLanguage("xml", require_xml());
      hljs.registerLanguage("bash", require_bash());
      hljs.registerLanguage("c", require_c());
      hljs.registerLanguage("cpp", require_cpp());
      hljs.registerLanguage("csharp", require_csharp());
      hljs.registerLanguage("css", require_css());
      hljs.registerLanguage("markdown", require_markdown());
      hljs.registerLanguage("diff", require_diff());
      hljs.registerLanguage("ruby", require_ruby());
      hljs.registerLanguage("go", require_go());
      hljs.registerLanguage("graphql", require_graphql());
      hljs.registerLanguage("ini", require_ini());
      hljs.registerLanguage("java", require_java());
      hljs.registerLanguage("javascript", require_javascript());
      hljs.registerLanguage("json", require_json());
      hljs.registerLanguage("kotlin", require_kotlin());
      hljs.registerLanguage("less", require_less());
      hljs.registerLanguage("lua", require_lua());
      hljs.registerLanguage("makefile", require_makefile());
      hljs.registerLanguage("perl", require_perl());
      hljs.registerLanguage("objectivec", require_objectivec());
      hljs.registerLanguage("php", require_php());
      hljs.registerLanguage("php-template", require_php_template());
      hljs.registerLanguage("plaintext", require_plaintext());
      hljs.registerLanguage("python", require_python());
      hljs.registerLanguage("python-repl", require_python_repl());
      hljs.registerLanguage("r", require_r());
      hljs.registerLanguage("rust", require_rust());
      hljs.registerLanguage("scss", require_scss());
      hljs.registerLanguage("shell", require_shell());
      hljs.registerLanguage("sql", require_sql());
      hljs.registerLanguage("swift", require_swift());
      hljs.registerLanguage("yaml", require_yaml());
      hljs.registerLanguage("typescript", require_typescript());
      hljs.registerLanguage("vbnet", require_vbnet());
      hljs.registerLanguage("wasm", require_wasm());
      hljs.HighlightJS = hljs;
      hljs.default = hljs;
      module.exports = hljs;
    }
  });

  // ../tide/node_modules/highlight.js/es/common.js
  var import_common = __toESM(require_common(), 1);
  var common_default = import_common.default;

  // src/shared/lab.ts
  function parseChartRequest(body) {
    let raw;
    try {
      raw = JSON.parse(body);
    } catch (e) {
      return { error: `This chart block isn't valid JSON: ${e.message}` };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: 'A chart block needs a JSON object with a "sql" key.' };
    const o = raw;
    if (typeof o.sql !== "string" || !o.sql.trim()) return { error: 'A chart block needs a "sql" key holding the query to draw.' };
    const type = o.type === "bar" || o.type === "line" || o.type === "scatter" ? o.type : void 0;
    const y = Array.isArray(o.y) ? o.y.filter((c) => typeof c === "string") : typeof o.y === "string" ? [o.y] : void 0;
    return { sql: o.sql, type, x: typeof o.x === "string" ? o.x : void 0, y: y?.length ? y : void 0, title: typeof o.title === "string" ? o.title : void 0 };
  }
  var formatMs = (ms) => ms < 0.05 ? "under 0.1 ms" : ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1e3 ? `${Math.round(ms)} ms` : `${(ms / 1e3).toFixed(1)} s`;
  var plural = (n, word) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
  function resultSummary(r) {
    const what = r.columns.length ? plural(r.rowCount, "row") : r.changes != null ? `${plural(r.changes, "row")} changed` : "Done";
    return `${what} \xB7 ${formatMs(r.elapsedMs)}`;
  }

  // src/shared/labChart.ts
  var MAX_BARS = 30;
  var MAX_SERIES = 6;
  var DATE = /^\d{4}-\d{2}(-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?)?$/;
  function columnKinds(r) {
    return r.columns.map((_, c) => {
      const values = r.rows.map((row) => row[c]).filter((v) => v !== null);
      if (!values.length) return "empty";
      if (values.every((v) => typeof v === "number")) return "number";
      if (values.every((v) => typeof v === "string" && DATE.test(v))) return "date";
      return "category";
    });
  }
  function isSequence(values) {
    return values.length > 1 && values.every((v, i) => typeof v === "number" && Number.isInteger(v) && (i === 0 || v > values[i - 1]));
  }
  var num = (v) => typeof v === "number" ? v : null;
  var text = (v) => v === null ? "(none)" : String(v);
  function chooseChart(r, ask = {}) {
    if (r.error) return { kind: "none", reason: r.error };
    if (!r.columns.length || !r.rows.length) return { kind: "none", reason: "There are no rows to draw." };
    const kinds = columnKinds(r);
    const col = (name) => name ? r.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase()) : -1;
    const column = (c) => r.rows.map((row) => row[c]);
    const numeric = kinds.flatMap((k, c) => k === "number" ? [c] : []);
    if (r.rows.length === 1 && numeric.length === 1 && r.columns.length <= 2 && !ask.type) {
      const other = r.columns.length === 2 ? r.rows[0][1 - numeric[0]] : null;
      return { kind: "number", label: other !== null ? `${r.columns[numeric[0]]} \xB7 ${other}` : r.columns[numeric[0]], value: r.rows[0][numeric[0]] };
    }
    if (!numeric.length) return { kind: "none", reason: "A chart needs at least one column of numbers." };
    if (r.rows.length === 1 && numeric.length >= 2 && col(ask.x) < 0) {
      const cols = numeric.slice(0, MAX_BARS);
      return { kind: "chart", type: ask.type === "line" ? "line" : "bar", types: ["bar", "line"], xName: "", xKind: "category", x: cols.map((c) => r.columns[c]), series: [{ name: "value", values: cols.map((c) => num(r.rows[0][c])) }] };
    }
    const asked = col(ask.x);
    let x = asked >= 0 ? asked : kinds.indexOf("date");
    if (x < 0) x = kinds.indexOf("category");
    if (x < 0) x = numeric[0];
    const wanted2 = (ask.y ?? []).map(col).filter((c) => c >= 0 && c !== x && kinds[c] === "number");
    let ys = wanted2.length ? wanted2 : numeric.filter((c) => c !== x);
    if (!ys.length) {
      if (r.rows.length > 1 && numeric.length === 1 && r.columns.length === 1) {
        const few = r.rows.length <= MAX_BARS;
        return { kind: "chart", type: ask.type === "bar" && few ? "bar" : ask.type === "line" || !few ? "line" : "bar", types: few ? ["bar", "line"] : ["line"], xName: "row", xKind: "number", x: r.rows.map((_, i) => i + 1), series: [{ name: r.columns[0], values: column(0).map(num) }] };
      }
      return { kind: "none", reason: "A chart needs a column of numbers beside the one that names each row." };
    }
    const notes = [];
    const xKind = kinds[x] === "date" ? "date" : kinds[x] === "number" ? "number" : "category";
    const canScatter = numeric.length >= 2;
    const scatterCols = () => {
      const a = kinds[x] === "number" ? x : numeric[0];
      return [a, wanted2.find((c) => c !== a) ?? numeric.find((c) => c !== a)];
    };
    const scatter = () => {
      const [a, b] = scatterCols();
      const label = kinds.findIndex((k) => k === "category" || k === "date");
      const rows = r.rows.filter((row) => row[a] !== null && row[b] !== null);
      return {
        kind: "chart",
        type: "scatter",
        types,
        xName: r.columns[a],
        xKind: "number",
        x: rows.map((row) => row[a]),
        series: [{ name: r.columns[b], values: rows.map((row) => row[b]) }],
        labels: label >= 0 ? rows.map((row) => text(row[label])) : void 0
      };
    };
    const second = kinds.findIndex((k, c) => c !== x && (k === "category" || k === "date"));
    let xs;
    let series;
    if (xKind !== "number" && second >= 0 && ys.length === 1 && new Set(column(x).map(text)).size < r.rows.length) {
      const names = [...new Set(column(second).map(text))];
      const keys = [...new Set(column(x).map(text))];
      if (names.length > MAX_SERIES) notes.push(`Only the first ${MAX_SERIES} of ${names.length} ${r.columns[second]} values are drawn.`);
      const at = new Map(keys.map((k, i) => [k, i]));
      series = names.slice(0, MAX_SERIES).map((name) => ({ name, values: keys.map(() => null) }));
      for (const row of r.rows) {
        const s = series[names.indexOf(text(row[second]))];
        if (s) s.values[at.get(text(row[x]))] = num(row[ys[0]]);
      }
      xs = keys;
    } else {
      if (ys.length > MAX_SERIES) {
        notes.push(`Only the first ${MAX_SERIES} of ${ys.length} numeric columns are drawn.`);
        ys = ys.slice(0, MAX_SERIES);
      }
      xs = column(x).map((v) => xKind === "number" ? v : text(v));
      series = ys.map((c) => ({ name: r.columns[c], values: column(c).map(num) }));
    }
    const canBar = xKind !== "number" || isSequence(xs);
    const canLine = canBar && xs.length > 1;
    const types = [...canBar ? ["bar"] : [], ...canLine ? ["line"] : [], ...canScatter ? ["scatter"] : []];
    const related = xKind === "category" && numeric.length === 2 && !wanted2.length && xs.length > 12 && second < 0;
    const natural = !canBar || related ? "scatter" : xKind !== "category" && canLine ? "line" : "bar";
    const type = ask.type && types.includes(ask.type) ? ask.type : natural;
    if (type === "scatter") return scatter();
    if (type === "bar" && xs.length > MAX_BARS) {
      notes.push(`The first ${MAX_BARS} of ${xs.length} are drawn. Use ORDER BY and LIMIT to choose which.`);
      xs = xs.slice(0, MAX_BARS);
      series = series.map((s) => ({ ...s, values: s.values.slice(0, MAX_BARS) }));
    }
    return { kind: "chart", type, types, xName: r.columns[x], xKind, x: xs, series, note: notes.join(" ") || void 0 };
  }
  function niceStep(span, count = 5) {
    if (!(span > 0)) return 1;
    const raw = span / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / power;
    return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
  }
  function valueScale(values, fromZero, count = 5) {
    const real = values.filter((v) => v !== null && Number.isFinite(v));
    let lo = real.length ? Math.min(...real) : 0;
    let hi = real.length ? Math.max(...real) : 1;
    if (fromZero || lo >= 0 && lo <= hi * 0.5) lo = Math.min(0, lo);
    if (fromZero || hi <= 0 && hi >= lo * 0.5) hi = Math.max(0, hi);
    if (lo === hi) {
      const pad = Math.abs(lo) || 1;
      lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
      hi += pad;
    }
    const step = niceStep(hi - lo, count);
    const min = Math.floor(lo / step + 1e-9) * step + 0;
    const max = Math.ceil(hi / step - 1e-9) * step + 0;
    const ticks = [];
    for (let i = 0; min + i * step <= max + step * 1e-6; i++) ticks.push(Number((min + i * step).toPrecision(12)) + 0);
    return { min, max, ticks };
  }
  var place = (v, min, max, length) => max === min ? length / 2 : (v - min) / (max - min) * length;
  function dateMs(s) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?)?/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : NaN;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(s, withYear = false) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
    if (!m) return s;
    const month = MONTHS[+m[2] - 1] ?? m[2];
    if (!m[3]) return `${month} ${m[1]}`;
    return `${+m[3]} ${month}${withYear ? ` ${m[1]}` : ""}`;
  }
  function labelEvery(n, room) {
    return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(room))));
  }
  var trim = (s) => s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return `${trim((v / 1e9).toFixed(1))}B`;
    if (a >= 1e6) return `${trim((v / 1e6).toFixed(1))}M`;
    if (a >= 1e3) return `${trim((v / 1e3).toFixed(1))}K`;
    if (a >= 100 || Number.isInteger(v)) return trim(v.toFixed(0));
    if (a >= 1) return trim(v.toFixed(1));
    return trim(v.toPrecision(2));
  }
  function fullNumber(v, grouped = true) {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return grouped ? v.toLocaleString("en-GB") : String(v);
    const a = Math.abs(v);
    const digits = a >= 100 ? 2 : a >= 1 ? 3 : 4;
    return v.toLocaleString("en-GB", { maximumFractionDigits: digits, useGrouping: grouped });
  }
  var isIdColumn = (name) => /(^|_)(id|year|yr)$/i.test(name) || /^(id|year)$/i.test(name);

  // src/renderer/src/lib/labChart.ts
  var CHAR = 6.3;
  var DASHES = ["", "6 4", "2 4", "9 4 2 4", "12 4", "2 2"];
  var ROWS_MAX = 12;
  var esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var clipText = (s, n) => s.length > n ? `${s.slice(0, Math.max(1, n - 1))}\u2026` : s;
  var r1 = (n) => Math.round(n * 10) / 10;
  function el(tag, className = "", text2 = "") {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text2) e.textContent = text2;
    return e;
  }
  function barPath(x, y, w, h, end) {
    const r = Math.min(3, w / 2, h / 2, end === "right" ? h / 2 : w / 2);
    if (h <= 0 || w <= 0) return "";
    if (end === "top") return `M${r1(x)},${r1(y + h)}V${r1(y + r)}q0,${-r} ${r},${-r}H${r1(x + w - r)}q${r},0 ${r},${r}V${r1(y + h)}Z`;
    if (end === "bottom") return `M${r1(x)},${r1(y)}V${r1(y + h - r)}q0,${r} ${r},${r}H${r1(x + w - r)}q${r},0 ${r},${-r}V${r1(y)}Z`;
    return `M${r1(x)},${r1(y)}H${r1(x + w - r)}q${r},0 ${r},${r}V${r1(y + h - r)}q0,${r} ${-r},${r}H${r1(x)}Z`;
  }
  var xLabel = (chart, i, year = false) => chart.xKind === "date" ? shortDate(String(chart.x[i]), year) : chart.xKind === "number" ? fullNumber(chart.x[i], false) : String(chart.x[i]);
  function drawRows(chart, width2) {
    const values = chart.series[0].values;
    const scale = valueScale(values, true, 4);
    const labels = chart.x.map((_, i) => xLabel(chart, i, true));
    const labelW = Math.min(Math.round(width2 * 0.4), Math.max(...labels.map((l) => l.length)) * CHAR + 14);
    const texts = values.map((v) => v === null ? "\u2013" : fullNumber(v));
    const valueW = Math.max(...texts.map((t) => t.length)) * CHAR + 10;
    const row = 26;
    const top = 4;
    const plotW = Math.max(40, width2 - labelW - valueW);
    const height = top + row * values.length + 4;
    const points = [];
    let out = "";
    values.forEach((v, i) => {
      const y = top + i * row;
      const w = v === null ? 0 : Math.max(1, place(v, 0, scale.max, plotW));
      points.push({ x: labelW + w, y: y + row / 2 });
      out += `<text class="lab-tick lab-cat" x="${labelW - 10}" y="${y + row / 2}" text-anchor="end" dominant-baseline="central">${esc(clipText(labels[i], Math.floor((labelW - 14) / CHAR)))}</text>`;
      out += `<path class="lab-mark s1" data-i="${i}" d="${barPath(labelW, y + 6, w, row - 12, "right")}"/>`;
      out += `<text class="lab-value" x="${r1(labelW + w + 7)}" y="${y + row / 2}" dominant-baseline="central">${esc(texts[i])}</text>`;
    });
    const axis = `<line class="lab-axis" x1="${labelW}" x2="${labelW}" y1="${top}" y2="${height - 4}"/>`;
    return { svg: axis + out, height, points, seek: "y", cursor: "band-y", band: row, plot: { left: 0, top, width: width2, height: row * values.length } };
  }
  function drawPlot(chart, width2) {
    const n = chart.x.length;
    const k = chart.series.length;
    const scatter = chart.type === "scatter";
    const all = chart.series.flatMap((s) => s.values);
    const scale = valueScale(all, chart.type === "bar");
    const tickText = scale.ticks.map(compact);
    const left = Math.max(...tickText.map((t) => t.length)) * CHAR + 12;
    const right = 14;
    const top = 12;
    const titled = scatter || chart.xKind === "number";
    const bottom = titled ? 40 : 24;
    const height = width2 < 520 ? 220 : 260;
    const plotW = Math.max(60, width2 - left - right);
    const plotH = height - top - bottom;
    const yAt = (v) => top + plotH - place(v, scale.min, scale.max, plotH);
    let out = "";
    scale.ticks.forEach((t, i) => {
      out += `<line class="${t === 0 ? "lab-axis" : "lab-grid"}" x1="${left}" x2="${left + plotW}" y1="${r1(yAt(t))}" y2="${r1(yAt(t))}"/>`;
      out += `<text class="lab-tick" x="${left - 8}" y="${r1(yAt(t))}" text-anchor="end" dominant-baseline="central">${esc(tickText[i])}</text>`;
    });
    let xAt;
    let xTicks = [];
    const slot = plotW / Math.max(1, n);
    if (scatter) {
      const xs = valueScale(chart.x, false);
      xAt = (i) => left + place(chart.x[i], xs.min, xs.max, plotW);
      xTicks = xs.ticks.map((t) => ({ at: left + place(t, xs.min, xs.max, plotW), text: compact(t) }));
      for (const t of xTicks) out = `<line class="lab-grid" x1="${r1(t.at)}" x2="${r1(t.at)}" y1="${top}" y2="${top + plotH}"/>` + out;
    } else {
      const times = chart.xKind === "date" ? chart.x.map((d) => dateMs(String(d))) : [];
      const timed = chart.type === "line" && chart.xKind === "date" && n > 1 && times.every((t, i) => Number.isFinite(t) && (i === 0 || t > times[i - 1]));
      const numbered = chart.type === "line" && chart.xKind === "number" && n > 1;
      const inset = chart.type === "line" ? Math.min(12, slot / 2) : 0;
      if (timed) xAt = (i) => left + inset + place(times[i], times[0], times[n - 1], plotW - inset * 2);
      else if (numbered) xAt = (i) => left + inset + place(chart.x[i], chart.x[0], chart.x[n - 1], plotW - inset * 2);
      else if (chart.type === "line") xAt = (i) => left + inset + (n === 1 ? (plotW - inset * 2) / 2 : i / (n - 1) * (plotW - inset * 2));
      else xAt = (i) => left + slot * (i + 0.5);
      const longest = Math.min(14, Math.max(...chart.x.map((_, i) => xLabel(chart, i).length)));
      const every = labelEvery(n, plotW / (longest * CHAR + 18));
      let lastYear = "";
      for (let i = 0; i < n; i += every) {
        const year = chart.xKind === "date" ? String(chart.x[i]).slice(0, 4) : "";
        const isDay = chart.xKind === "date" && String(chart.x[i]).length > 7;
        xTicks.push({ at: xAt(i), text: clipText(xLabel(chart, i, isDay && year !== lastYear), 16) });
        lastYear = year;
      }
    }
    let inked = -Infinity;
    for (const t of xTicks) {
      const w = t.text.length * CHAR;
      const anchor = t.at - w / 2 < 2 ? "start" : t.at + w / 2 > width2 - 2 ? "end" : "middle";
      const x = anchor === "middle" ? t.at : anchor === "start" ? Math.max(0, t.at - 8) : Math.min(width2, t.at + 8);
      const from = anchor === "middle" ? x - w / 2 : anchor === "start" ? x : x - w;
      if (from < inked + 10) continue;
      inked = from + w;
      out += `<text class="lab-tick" x="${r1(x)}" y="${top + plotH + 15}" text-anchor="${anchor}">${esc(t.text)}</text>`;
    }
    if (titled) out += `<text class="lab-axis-title" x="${left + plotW / 2}" y="${height - 6}" text-anchor="middle">${esc(clipText(chart.xName, 40))}</text>`;
    const points = [];
    let dots;
    const zero = yAt(Math.min(Math.max(0, scale.min), scale.max));
    if (chart.type === "bar") {
      const group = Math.min(slot * 0.72, k * 24 + (k - 1) * 2);
      const w = Math.max(1, (group - (k - 1) * 2) / k);
      for (let i = 0; i < n; i++) {
        points.push({ x: xAt(i), y: top });
        chart.series.forEach((s, j) => {
          const v = s.values[i];
          if (v === null) return;
          const y = yAt(v);
          const x = xAt(i) - group / 2 + j * (w + 2);
          out += `<path class="lab-mark s${j + 1}" data-i="${i}" d="${v >= 0 ? barPath(x, y, w, Math.max(1, zero - y), "top") : barPath(x, zero, w, Math.max(1, y - zero), "bottom")}"/>`;
        });
      }
    } else if (chart.type === "line") {
      dots = chart.series.map((s) => s.values.map((v) => v === null ? null : yAt(v)));
      for (let i = 0; i < n; i++) points.push({ x: xAt(i), y: top });
      chart.series.forEach((s, j) => {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) return void (pen = false);
          d += `${pen ? "L" : "M"}${r1(xAt(i))},${r1(yAt(v))}`;
          pen = true;
        });
        out += `<path class="lab-line s${j + 1}" d="${d}"${DASHES[j] ? ` stroke-dasharray="${DASHES[j]}"` : ""}/>`;
        if (n <= 24) s.values.forEach((v, i) => v !== null && (out += `<circle class="lab-dot s${j + 1}" cx="${r1(xAt(i))}" cy="${r1(yAt(v))}" r="3"/>`));
      });
    } else {
      chart.series[0].values.forEach((v, i) => {
        const p = { x: xAt(i), y: yAt(v) };
        points.push(p);
        out += `<circle class="lab-dot lab-point s1" cx="${r1(p.x)}" cy="${r1(p.y)}" r="4"/>`;
      });
    }
    return {
      svg: out,
      height,
      points,
      seek: scatter ? "near" : "x",
      cursor: scatter ? "ring" : chart.type === "line" ? "line" : "band-x",
      band: slot,
      plot: { left, top, width: plotW, height: plotH },
      dots
    };
  }
  var TYPE_NAME = { bar: "Bar chart", line: "Line chart", scatter: "Scatter plot" };
  function describeChart(chart, title) {
    const what = chart.type === "scatter" ? `${chart.series[0].name} against ${chart.xName}` : `${chart.series.map((s) => s.name).join(", ")}${chart.xName ? ` by ${chart.xName}` : ""}`;
    return `${title ? `${title}. ` : ""}${TYPE_NAME[chart.type]} of ${what}, ${chart.x.length} ${chart.type === "scatter" ? "points" : "values"}. Use the arrow keys to read each value.`;
  }
  function drawChart(host, chart, title) {
    host.textContent = "";
    host.classList.add("lab-chart");
    const many = chart.series.length > 1;
    const rows = chart.type === "bar" && !many && chart.xKind !== "number" && chart.x.length <= ROWS_MAX && chart.series[0].values.every((v) => v === null || v >= 0);
    if (many) {
      const legend = el("div", "lab-legend");
      chart.series.forEach((s, j) => {
        const item = el("span", "lab-legend-item");
        const key = el("i", `lab-key ${chart.type === "line" ? "line" : "box"} s${j + 1}`);
        if (chart.type === "line") key.dataset.dash = String(j);
        item.append(key, el("span", "", s.name));
        legend.append(item);
      });
      host.append(legend);
    } else if (chart.type !== "scatter" || chart.series[0].name) {
      host.append(el("div", "lab-caption", rows && chart.xName ? `${chart.series[0].name} by ${chart.xName}` : chart.series[0].name === "value" ? "" : chart.series[0].name));
    }
    const plot = el("div", "lab-plot");
    plot.tabIndex = 0;
    plot.setAttribute("role", "group");
    plot.setAttribute("aria-label", describeChart(chart, title));
    const tip = el("div", "lab-tip");
    tip.setAttribute("role", "status");
    tip.hidden = true;
    host.append(plot);
    let drawn = null;
    let active = -1;
    let svg = null;
    let lastWidth = 0;
    const render = () => {
      const width2 = Math.floor(plot.clientWidth);
      if (!width2 || width2 === lastWidth) return;
      lastWidth = width2;
      drawn = rows ? drawRows(chart, width2) : drawPlot(chart, width2);
      const p = drawn.plot;
      const cursor = drawn.cursor === "band-x" ? `<rect class="lab-band" y="${p.top}" width="${r1(drawn.band)}" height="${p.height}" visibility="hidden"/>` : drawn.cursor === "band-y" ? `<rect class="lab-band" x="0" width="${width2}" height="${drawn.band}" visibility="hidden"/>` : drawn.cursor === "line" ? `<line class="lab-cross" y1="${p.top}" y2="${p.top + p.height}" visibility="hidden"/>` : "";
      const hover = drawn.cursor === "ring" ? '<circle class="lab-ring" r="7" visibility="hidden"/>' : drawn.cursor === "line" ? chart.series.map((_, j) => `<circle class="lab-dot lab-hover s${j + 1}" r="4" visibility="hidden"/>`).join("") : "";
      plot.innerHTML = `<svg class="lab-svg" viewBox="0 0 ${width2} ${drawn.height}" width="${width2}" height="${drawn.height}" role="img" aria-hidden="true" focusable="false">${cursor}${drawn.svg}${hover}</svg>`;
      svg = plot.querySelector("svg");
      plot.append(tip);
      show(active);
    };
    const show = (i) => {
      active = i;
      if (!drawn || !svg) return;
      const on = i >= 0 && i < drawn.points.length;
      const band = svg.querySelector(".lab-band");
      const cross = svg.querySelector(".lab-cross");
      const ring = svg.querySelector(".lab-ring");
      const hovers = svg.querySelectorAll(".lab-hover");
      for (const m of [band, cross, ring, ...hovers]) m?.setAttribute("visibility", on ? "visible" : "hidden");
      svg.querySelectorAll(".lab-mark.on").forEach((m) => m.classList.remove("on"));
      tip.hidden = !on || rows;
      if (!on) return;
      const pt = drawn.points[i];
      if (band && drawn.cursor === "band-x") band.setAttribute("x", String(r1(pt.x - drawn.band / 2)));
      if (band && drawn.cursor === "band-y") band.setAttribute("y", String(r1(pt.y - drawn.band / 2)));
      if (cross) cross.setAttribute("x1", String(r1(pt.x))), cross.setAttribute("x2", String(r1(pt.x)));
      if (ring) ring.setAttribute("cx", String(r1(pt.x))), ring.setAttribute("cy", String(r1(pt.y)));
      hovers.forEach((h2, j) => {
        const y = drawn.dots?.[j]?.[i];
        h2.setAttribute("visibility", y == null ? "hidden" : "visible");
        if (y != null) h2.setAttribute("cx", String(r1(pt.x))), h2.setAttribute("cy", String(r1(y)));
      });
      svg.querySelectorAll(`.lab-mark[data-i="${i}"]`).forEach((m) => m.classList.add("on"));
      if (rows) return;
      tip.textContent = "";
      const head = chart.type === "scatter" ? chart.labels?.[i] ?? "" : xLabel(chart, i, true);
      if (head) tip.append(el("div", "lab-tip-x", head));
      const line = (name, value, j = -1) => {
        const row = el("div", "lab-tip-row");
        if (j >= 0) {
          const key = el("i", `lab-key line s${j + 1}`);
          if (chart.type === "line") key.dataset.dash = String(j);
          row.append(key);
        }
        row.append(el("span", "lab-tip-name", name), el("b", "lab-tip-value", value));
        tip.append(row);
      };
      if (chart.type === "scatter") {
        line(chart.xName, fullNumber(chart.x[i]));
        line(chart.series[0].name, fullNumber(chart.series[0].values[i]));
      } else {
        chart.series.forEach((s, j) => line(s.name === "value" ? chart.xName || "value" : s.name, s.values[i] === null ? "\u2013" : fullNumber(s.values[i]), many ? j : -1));
      }
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const anchorY = drawn.seek === "x" ? drawn.plot.top + 4 : pt.y - h / 2;
      let x = pt.x + 12;
      if (x + w > plot.clientWidth - 2) x = pt.x - 12 - w;
      tip.style.left = `${Math.max(2, Math.min(x, plot.clientWidth - w - 2))}px`;
      tip.style.top = `${Math.max(2, Math.min(anchorY, drawn.height - h - 2))}px`;
    };
    const nearest = (e) => {
      if (!drawn || !svg) return -1;
      const box = svg.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      let best = -1;
      let bestD = Infinity;
      drawn.points.forEach((p, i) => {
        const d = drawn.seek === "x" ? Math.abs(p.x - x) : drawn.seek === "y" ? Math.abs(p.y - y) : Math.hypot(p.x - x, p.y - y);
        if (d < bestD) bestD = d, best = i;
      });
      return drawn.seek === "near" && bestD > 36 ? -1 : best;
    };
    plot.addEventListener("pointermove", (e) => {
      const i = nearest(e);
      if (i !== active) show(i);
    });
    plot.addEventListener("pointerleave", () => show(-1));
    plot.addEventListener("blur", () => show(-1));
    plot.addEventListener("keydown", (e) => {
      const n = drawn?.points.length ?? 0;
      if (!n) return;
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (step) show(active < 0 ? step > 0 ? 0 : n - 1 : Math.max(0, Math.min(n - 1, active + step)));
      else if (e.key === "Home") show(0);
      else if (e.key === "End") show(n - 1);
      else if (e.key === "Escape") show(-1);
      else return;
      e.preventDefault();
    });
    if (chart.note) host.append(el("p", "lab-note", chart.note));
    render();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(render);
    watch?.observe(plot);
    return () => watch?.disconnect();
  }
  function drawFigure(host, label, value) {
    host.textContent = "";
    const figure = el("div", "lab-figure");
    figure.append(el("div", "lab-figure-value", fullNumber(value)), el("div", "lab-figure-label", label));
    host.append(figure);
  }

  // src/renderer/src/lib/lab.ts
  var TABLE_ROWS = 200;
  var TYPE_LABEL = { bar: "Bars", line: "Line", scatter: "Scatter" };
  function el2(tag, className = "", text2 = "") {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text2) e.textContent = text2;
    return e;
  }
  function button(className, text2, title) {
    const b = el2("button", className, text2);
    b.type = "button";
    if (title) b.title = title;
    return b;
  }
  function choice(label, options, value, onPick) {
    const group = el2("div", "segmented text lab-choice");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    for (const [key, text2] of options) {
      const b = button(key === value ? "on" : "", text2);
      b.setAttribute("aria-pressed", String(key === value));
      b.addEventListener("click", () => key !== value && onPick(key));
      group.append(b);
    }
    return group;
  }
  function resultTable(r) {
    const wrap = el2("div", "lab-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", `Result: ${resultSummary(r)}`);
    const kinds = columnKinds(r);
    const table = el2("table", "lab-table");
    const head = el2("tr");
    r.columns.forEach((name, c) => {
      const th = el2("th", kinds[c] === "number" ? "num" : "", name);
      th.scope = "col";
      if (r.types[c]) th.title = r.types[c];
      head.append(th);
    });
    const thead = el2("thead");
    thead.append(head);
    const body = el2("tbody");
    const plain = r.columns.map(isIdColumn);
    for (const row of r.rows.slice(0, TABLE_ROWS)) {
      const tr = el2("tr");
      row.forEach((v, c) => {
        const td = el2("td", [v === null ? "null" : "", kinds[c] === "number" ? "num" : ""].join(" ").trim(), v === null ? "null" : typeof v === "number" ? fullNumber(v, !plain[c]) : v);
        if (typeof v === "string" && v.length > 60) td.title = v.slice(0, 600);
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(thead, body);
    wrap.append(table);
    return wrap;
  }
  function labBlock(sql, ask) {
    const charting = !!ask;
    const root = el2("div", `lab-block${charting ? " lab-chart-block" : ""}`);
    let view = charting ? "chart" : "table";
    let type = ask?.type;
    let result = null;
    let stopChart = null;
    let turn = 0;
    const editor = el2("div", "lab-editor");
    const code = el2("div", "lab-code");
    const shown = el2("pre", "lab-hl");
    shown.setAttribute("aria-hidden", "true");
    const shownCode = el2("code", "hljs");
    shown.append(shownCode);
    const input = el2("textarea", "lab-sql");
    input.value = sql;
    input.spellcheck = false;
    input.autocapitalize = "off";
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", "SQL query. Command and Enter runs it.");
    input.rows = 1;
    const paint = () => {
      shownCode.innerHTML = common_default.highlight(input.value, { language: "sql", ignoreIllegals: true }).value + " ";
    };
    paint();
    input.addEventListener("input", paint);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void run();
      }
    });
    code.append(shown, input);
    const actions = el2("div", "lab-actions");
    const lang = el2("span", "lab-lang", "SQL");
    lang.title = "Runs on SQLite, on the sample data kept for this conversation";
    const engine = el2("span", "lab-engine", "SQLite \xB7 sample data");
    const copy = button("lab-quiet", "Copy", "Copy the query");
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(input.value);
      copy.textContent = "Copied";
      setTimeout(() => copy.textContent = "Copy", 1200);
    });
    const runButton = button("lab-run", "", "Run the query (Cmd+Enter)");
    const runLabel = el2("span", "", "Run");
    const keys = el2("kbd", "lab-kbd", "\u2318\u21B5");
    keys.setAttribute("aria-hidden", "true");
    runButton.append(runLabel, keys);
    runButton.addEventListener("click", () => void run());
    actions.append(lang, engine, el2("span", "lab-space"), copy, runButton);
    editor.append(actions, code);
    const out = el2("div", "lab-result");
    out.setAttribute("aria-live", "polite");
    out.hidden = true;
    let disclose = null;
    const openQuery = (open) => {
      editor.hidden = !open;
      disclose?.setAttribute("aria-expanded", String(open));
      if (disclose) disclose.textContent = open ? "Hide the query" : "Show the query";
    };
    if (charting) {
      const head = el2("div", "lab-head");
      head.append(el2("div", "lab-title", ask.title ?? ""));
      disclose = button("lab-quiet lab-disclose", "Show the query");
      disclose.addEventListener("click", () => openQuery(editor.hidden));
      head.append(disclose);
      openQuery(false);
      root.append(head, out, editor);
    } else {
      root.append(editor, out);
    }
    const labId = () => root.closest("[data-lab]")?.dataset.lab || "scratch";
    const render = () => {
      stopChart?.();
      stopChart = null;
      out.textContent = "";
      out.hidden = !result;
      if (!result) return;
      const r = result;
      if (r.error) {
        const box = el2("div", "lab-error");
        box.setAttribute("role", "alert");
        box.append(el2("span", "lab-error-label", "SQLite says"), el2("code", "lab-error-text", r.error));
        out.append(box);
        if (charting) openQuery(true);
        return;
      }
      const bar = el2("div", "lab-result-bar");
      const meta = el2("span", "lab-meta", resultSummary(r));
      if (!r.columns.length) {
        const reset = button("lab-quiet", "Reset data", "Put the sample data back as it was");
        reset.addEventListener("click", async () => {
          reset.disabled = true;
          await window.tide.lab.reset(labId());
          meta.textContent = "The sample data is back as it was";
          reset.remove();
        });
        bar.append(meta, el2("span", "lab-space"), reset);
        out.append(bar);
        return;
      }
      const picture = chooseChart(r, { type, x: ask?.x, y: ask?.y });
      bar.append(choice("Show the result as", [["table", "Table"], ["chart", "Chart"]], view, (v) => (view = v, render())));
      if (view === "chart" && picture.kind === "chart" && picture.types.length > 1) {
        bar.append(choice("Chart form", picture.types.map((t) => [t, TYPE_LABEL[t]]), picture.type, (t) => (type = t, render())));
      }
      bar.append(el2("span", "lab-space"), meta);
      out.append(bar);
      if (view === "table") {
        out.append(resultTable(r));
        const hidden = r.rowCount - Math.min(r.rows.length, TABLE_ROWS);
        if (hidden > 0) out.append(el2("p", "lab-note", `${hidden.toLocaleString("en-GB")} more ${hidden === 1 ? "row" : "rows"} not shown. Add a LIMIT or a WHERE to see the ones you want.`));
        return;
      }
      const host = el2("div", "lab-view");
      out.append(host);
      if (picture.kind === "none") host.append(el2("p", "lab-empty", picture.reason));
      else if (picture.kind === "number") drawFigure(host, picture.label, picture.value);
      else {
        stopChart = drawChart(host, picture, ask?.title);
        if (r.truncated) out.append(el2("p", "lab-note", `Drawn from the first ${r.rows.length.toLocaleString("en-GB")} of ${r.rowCount.toLocaleString("en-GB")} rows.`));
      }
    };
    async function run() {
      const mine = ++turn;
      runButton.disabled = true;
      runLabel.textContent = "Running";
      root.classList.add("running");
      let r;
      try {
        r = await window.tide.lab.query(labId(), input.value);
      } catch (e) {
        r = { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0, error: e.message };
      }
      if (mine !== turn) return;
      runButton.disabled = false;
      runLabel.textContent = "Run";
      root.classList.remove("running");
      result = r;
      render();
    }
    return { root, run };
  }
  var DONE = "labDone";
  function mountSql(pre) {
    const code = (pre.querySelector("code")?.textContent ?? "").replace(/\s+$/, "");
    pre.dataset[DONE] = "1";
    if (!code.trim()) return;
    pre.replaceWith(labBlock(code).root);
  }
  function mountChart(pre) {
    const body = pre.querySelector("code")?.textContent ?? "";
    if (!body.trim()) return;
    const ask = parseChartRequest(body);
    if ("error" in ask) {
      if (pre.dataset.labTried === body) {
        pre.dataset[DONE] = "1";
        const note = el2("div", "lab-error lab-under-code");
        note.setAttribute("role", "alert");
        note.append(el2("span", "lab-error-label", "Chart"), el2("code", "lab-error-text", ask.error));
        pre.after(note);
      } else {
        pre.dataset.labTried = body;
        setTimeout(scan, 2500);
      }
      return;
    }
    pre.dataset[DONE] = "1";
    const block = labBlock(ask.sql.trim(), ask);
    pre.replaceWith(block.root);
    void block.run();
  }
  var timer;
  function scan() {
    document.querySelectorAll("pre.code-block[data-lang]").forEach((pre) => {
      const lang = (pre.dataset.lang ?? "").toLowerCase();
      if (pre.dataset[DONE] || !pre.isConnected) return;
      if (lang === "chart") mountChart(pre);
      else if (lang === "sql" || lang === "sqlite") mountSql(pre);
    });
  }
  function startLab() {
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
  }

  // design/prototype/lab/fixtures.json
  var fixtures_default = { blocks: [{ set: "table", name: "A joined result, 2,495 rows", lang: "sql", body: "SELECT o.order_id, c.name AS customer, c.country, o.order_date, o.status,\n       round(sum(i.quantity * i.unit_price), 2) AS total\nFROM orders o\nJOIN customers c USING (customer_id)\nJOIN order_items i USING (order_id)\nGROUP BY o.order_id\nORDER BY o.order_date DESC, total DESC" }, { set: "table", name: "Nulls and a wide text column", lang: "sql", body: "SELECT event_id, user_id, event, ts, item_id, category, amount\nFROM events\nWHERE user_id = 12\nLIMIT 9" }, { set: "table", name: "A mistake", lang: "sql", body: "SELECT nme, country\nFROM customers\nWHERE segment = 'enterprise'" }, { set: "table", name: "A write", lang: "sql", body: "UPDATE orders SET status = 'completed' WHERE status = 'processing'" }, { set: "table", name: "One number", lang: "sql", then: ["Chart"], body: "SELECT round(sum(quantity * unit_price), 2) AS revenue\nFROM order_items" }, { set: "bars", name: "Few categories, one measure: horizontal bars", lang: "chart", body: '{\n  "title": "Revenue by category",\n  "sql": "SELECT p.category, round(sum(i.quantity * i.unit_price)) AS revenue FROM order_items i JOIN products p USING (product_id) GROUP BY 1 ORDER BY 2 DESC"\n}' }, { set: "bars", name: "One row of numbers: a funnel", lang: "chart", body: `{
  "title": "Users reaching each step",
  "sql": "SELECT count(DISTINCT CASE WHEN event = 'signup' THEN user_id END) AS signed_up, count(DISTINCT CASE WHEN event = 'view_item' THEN user_id END) AS viewed, count(DISTINCT CASE WHEN event = 'add_to_cart' THEN user_id END) AS added_to_cart, count(DISTINCT CASE WHEN event = 'checkout_started' THEN user_id END) AS started_checkout, count(DISTINCT CASE WHEN event = 'purchase' THEN user_id END) AS purchased FROM events"
}` }, { set: "bars", name: "Columns: 18 months, asked for as bars", lang: "chart", body: `{
  "title": "Orders per month",
  "type": "bar",
  "sql": "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders FROM orders GROUP BY 1 ORDER BY 1"
}` }, { set: "bars", name: "Grouped columns: two measures", lang: "chart", body: '{\n  "title": "Customers and orders by country",\n  "type": "bar",\n  "sql": "SELECT c.country, count(DISTINCT c.customer_id) AS customers, count(DISTINCT o.order_id) / 10 AS orders_in_tens FROM customers c LEFT JOIN orders o USING (customer_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 8"\n}' }, { set: "bars", name: "Thirty of forty products", lang: "sql", then: ["Chart"], body: "SELECT p.name, sum(i.quantity) AS units\nFROM order_items i JOIN products p USING (product_id)\nGROUP BY 1 ORDER BY 2 DESC" }, { set: "lines", name: "A date and a measure: a line", lang: "chart", body: `{
  "title": "Revenue per week",
  "sql": "SELECT date(o.order_date, 'weekday 0', '-6 days') AS week, round(sum(i.quantity * i.unit_price)) AS revenue FROM orders o JOIN order_items i USING (order_id) GROUP BY 1 ORDER BY 1"
}` }, { set: "lines", name: "Long form: one series per platform", lang: "chart", body: `{
  "title": "Purchases per month by platform",
  "sql": "SELECT strftime('%Y-%m', ts) AS month, platform, count(*) AS purchases FROM events WHERE event = 'purchase' GROUP BY 1, 2 ORDER BY 1, 2"
}` }, { set: "lines", name: "A run of whole numbers: weekly retention", lang: "chart", body: `{
  "title": "Share of users active, by week since signup",
  "sql": "WITH active AS (SELECT DISTINCT e.user_id, CAST((julianday(date(e.ts)) - julianday(u.signup_date)) / 7 AS INTEGER) AS week FROM events e JOIN users u USING (user_id)), sized AS (SELECT w.week, (SELECT count(*) FROM users WHERE julianday('2025-07-14') - julianday(signup_date) >= (w.week + 1) * 7) AS cohort FROM (SELECT DISTINCT week FROM active) w) SELECT a.week, round(100.0 * count(*) / s.cohort, 1) AS percent_active FROM active a JOIN sized s USING (week) JOIN users u USING (user_id) WHERE julianday('2025-07-14') - julianday(u.signup_date) >= (a.week + 1) * 7 AND a.week <= 12 GROUP BY a.week ORDER BY a.week"
}` }, { set: "lines", name: "Two numeric columns: a scatter", lang: "chart", body: '{\n  "title": "Price against units sold",\n  "sql": "SELECT p.name, p.price, sum(i.quantity) AS units FROM order_items i JOIN products p USING (product_id) GROUP BY p.product_id"\n}' }, { set: "edge", name: "A chart block that is not JSON", lang: "chart", body: '{ "sql": "SELECT country, count(*) FROM customers GROUP BY 1", title: Customers }' }, { set: "edge", name: "A chart block whose query fails", lang: "chart", body: `{
  "title": "Signups per week",
  "sql": "SELECT strftime('%Y-%W', signup_date) AS week, count(*) AS signups FROM user GROUP BY 1"
}` }, { set: "edge", name: "Nothing to draw", lang: "sql", then: ["Chart"], body: "SELECT name, country, segment FROM customers LIMIT 4" }, { set: "edge", name: "The line of the months, switched to a table", lang: "chart", then: ["Table"], body: `{
  "title": "Orders per month",
  "sql": "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders, count(DISTINCT customer_id) AS customers FROM orders GROUP BY 1 ORDER BY 1"
}` }], results: { "SELECT o.order_id, c.name AS customer, c.country, o.order_date, o.status,\n       round(sum(i.quantity * i.unit_price), 2) AS total\nFROM orders o\nJOIN customers c USING (customer_id)\nJOIN order_items i USING (order_id)\nGROUP BY o.order_id\nORDER BY o.order_date DESC, total DESC": { columns: ["order_id", "customer", "country", "order_date", "status", "total"], types: ["integer", "text", "text", "date", "text", "real"], rows: [[2492, "Noah Visser", "United States", "2025-06-30", "processing", 687.6], [2495, "Ngozi Brown", "United States", "2025-06-30", "completed", 401], [2491, "Tom Weber", "United Kingdom", "2025-06-30", "processing", 327], [2494, "Omar Okafor", "France", "2025-06-30", "processing", 147], [2493, "Ada Martin", "United Kingdom", "2025-06-30", "processing", 129], [2486, "Leon Fischer", "United States", "2025-06-29", "completed", 259.7], [2489, "Ngozi Smith", "France", "2025-06-29", "processing", 225], [2488, "Sophie Visser", "United States", "2025-06-29", "processing", 213], [2484, "Grace Nguyen", "United Kingdom", "2025-06-29", "processing", 146], [2487, "Ben Garc\xEDa", "United States", "2025-06-29", "processing", 144], [2490, "Chidi Bello", "United Kingdom", "2025-06-29", "completed", 54], [2485, "Tom Jansen", "United States", "2025-06-29", "processing", 9], [2483, "Amara Adeyemi", "United States", "2025-06-28", "processing", 296], [2482, "Sophie Visser", "United States", "2025-06-28", "processing", 213], [2477, "Hugo Bello", "United Kingdom", "2025-06-28", "completed", 129], [2478, "Ngozi Okafor", "United States", "2025-06-28", "processing", 118.75], [2481, "Leon Fischer", "United States", "2025-06-28", "completed", 102], [2480, "Felix Patel", "United Kingdom", "2025-06-28", "processing", 92], [2479, "Maya Nguyen", "Canada", "2025-06-28", "processing", 62], [2474, "Ada Weber", "United States", "2025-06-27", "refunded", 283.8], [2471, "Amara Patel", "France", "2025-06-27", "processing", 127], [2475, "Amara Murphy", "Germany", "2025-06-27", "processing", 109.65], [2473, "Priya Brown", "United States", "2025-06-27", "processing", 105], [2472, "Sophie Visser", "United States", "2025-06-27", "processing", 60], [2476, "Ines Smith", "Spain", "2025-06-27", "processing", 38], [2467, "Lukas Jansen", "United States", "2025-06-26", "processing", 616], [2469, "Lukas Smith", "France", "2025-06-26", "refunded", 596], [2468, "Amara Nguyen", "Nigeria", "2025-06-26", "processing", 170], [2470, "Grace Nguyen", "United Kingdom", "2025-06-26", "completed", 74], [2466, "Freya Kelly", "United Kingdom", "2025-06-26", "processing", 59], [2464, "Clara Bello", "France", "2025-06-25", "completed", 359], [2462, "Ngozi Smith", "France", "2025-06-25", "completed", 220], [2463, "Daniel Jones", "Spain", "2025-06-25", "completed", 110], [2465, "Sophie Visser", "United States", "2025-06-25", "completed", 45], [2461, "Clara Visser", "France", "2025-06-25", "completed", 42], [2458, "Clara Visser", "France", "2025-06-24", "completed", 769.2], [2456, "Chidi Patel", "Canada", "2025-06-24", "completed", 530], [2457, "Lukas Smith", "France", "2025-06-24", "completed", 481.95], [2460, "Sophie Jones", "Germany", "2025-06-24", "completed", 49.4], [2459, "Ines Patel", "Germany", "2025-06-24", "cancelled", 22.95], [2451, "Hannah Taylor", "Australia", "2025-06-23", "completed", 271], [2452, "Ines Smith", "Spain", "2025-06-23", "completed", 270], [2454, "Mateo Fischer", "United Kingdom", "2025-06-23", "completed", 236], [2455, "Sophie Jones", "Germany", "2025-06-23", "completed", 139], [2453, "Maya Jansen", "Netherlands", "2025-06-23", "completed", 95], [2449, "Emeka Fischer", "United States", "2025-06-22", "completed", 214.4], [2445, "Tunde Nguyen", "Ireland", "2025-06-22", "completed", 189], [2448, "Amara Murphy", "Germany", "2025-06-22", "completed", 92], [2447, "Hannah Weber", "Spain", "2025-06-22", "completed", 48], [2446, "Freya Dubois", "Germany", "2025-06-22", "completed", 46], [2450, "Amara Eze", "Nigeria", "2025-06-22", "completed", 17], [2443, "Grace Weber", "United States", "2025-06-21", "completed", 758], [2439, "Lukas Fischer", "Canada", "2025-06-21", "completed", 190], [2444, "Lukas Visser", "Australia", "2025-06-21", "completed", 188.3], [2442, "Felix Eze", "France", "2025-06-21", "completed", 173], [2440, "Emeka Taylor", "United Kingdom", "2025-06-21", "completed", 158], [2441, "Leon Patel", "Germany", "2025-06-21", "completed", 9], [2433, "Amara Martin", "United Kingdom", "2025-06-20", "completed", 855], [2438, "Freya Fischer", "United Kingdom", "2025-06-20", "completed", 214], [2437, "Daniel Patel", "United Kingdom", "2025-06-20", "completed", 179], [2436, "Tom Okonkwo", "United Kingdom", "2025-06-20", "completed", 128], [2435, "Maya Jones", "Canada", "2025-06-20", "completed", 60], [2434, "Freya Fischer", "United Kingdom", "2025-06-20", "cancelled", 12], [2431, "Ngozi Okafor", "United States", "2025-06-19", "completed", 295], [2432, "Clara Visser", "Australia", "2025-06-19", "completed", 157], [2429, "Noah Martin", "Canada", "2025-06-19", "completed", 137], [2430, "Daniel Weber", "Nigeria", "2025-06-19", "completed", 84.9], [2428, "Ada Weber", "United States", "2025-06-19", "completed", 75], [2426, "Amara Adeyemi", "Canada", "2025-06-18", "completed", 613.8], [2423, "Daniel Jones", "Germany", "2025-06-18", "completed", 245], [2424, "Emeka M\xFCller", "Germany", "2025-06-18", "completed", 243], [2425, "Lukas Visser", "Nigeria", "2025-06-18", "completed", 232], [2427, "Aisha Murphy", "Germany", "2025-06-18", "completed", 216.75], [2419, "Elena Patel", "Nigeria", "2025-06-17", "completed", 393], [2418, "Zara Smith", "France", "2025-06-17", "cancelled", 220], [2420, "Tom Wilson", "Netherlands", "2025-06-17", "completed", 218.1], [2421, "Ngozi Patel", "Ireland", "2025-06-17", "completed", 184], [2422, "Priya Schmidt", "Ireland", "2025-06-17", "completed", 129.25], [2413, "Leon Fischer", "United States", "2025-06-16", "completed", 407], [2415, "Mateo Jansen", "Canada", "2025-06-16", "completed", 178], [2417, "Emeka Smith", "Canada", "2025-06-16", "completed", 131], [2416, "Sophie Bello", "France", "2025-06-16", "completed", 42], [2414, "Isla Garc\xEDa", "Ireland", "2025-06-16", "completed", 14.45], [2407, "Kofi Dubois", "United Kingdom", "2025-06-15", "completed", 1555], [2408, "Ada Brown", "United Kingdom", "2025-06-15", "completed", 336], [2411, "Ada Brown", "United Kingdom", "2025-06-15", "completed", 256], [2409, "Sophie Visser", "United States", "2025-06-15", "completed", 237], [2410, "Lukas Jones", "Nigeria", "2025-06-15", "completed", 175.45], [2412, "Elena M\xFCller", "United States", "2025-06-15", "completed", 89], [2405, "Freya Jones", "United States", "2025-06-14", "completed", 996], [2402, "Sophie Jones", "Germany", "2025-06-14", "completed", 611], [2401, "Daniel Patel", "United Kingdom", "2025-06-14", "completed", 596], [2406, "Hannah Schmidt", "Australia", "2025-06-14", "refunded", 171], [2403, "Mateo Eze", "Netherlands", "2025-06-14", "refunded", 142.55], [2404, "Leon Jones", "Spain", "2025-06-14", "completed", 128], [2400, "Ngozi Okafor", "United States", "2025-06-14", "completed", 12], [2395, "Ben Martin", "Netherlands", "2025-06-13", "cancelled", 524], [2396, "Felix Brown", "Netherlands", "2025-06-13", "completed", 339], [2398, "Tunde Patel", "Netherlands", "2025-06-13", "completed", 148], [2399, "Tom Bello", "United Kingdom", "2025-06-13", "refunded", 129], [2397, "Maya Weber", "United States", "2025-06-13", "completed", 7], [2392, "Maya Jones", "Canada", "2025-06-12", "completed", 457], [2391, "Tom Wilson", "Netherlands", "2025-06-12", "completed", 324], [2390, "Lukas Fischer", "Canada", "2025-06-12", "completed", 225.8], [2394, "Noah Martin", "Canada", "2025-06-12", "completed", 138.95], [2393, "Isla Garc\xEDa", "Ireland", "2025-06-12", "completed", 36], [2385, "Tom Wilson", "Netherlands", "2025-06-11", "completed", 714.9], [2386, "Hannah Smith", "United States", "2025-06-11", "cancelled", 513], [2387, "Grace Nguyen", "Netherlands", "2025-06-11", "completed", 178], [2388, "Ines Smith", "Spain", "2025-06-11", "completed", 159], [2389, "Tom Jansen", "United States", "2025-06-11", "completed", 117], [2381, "Chidi Patel", "Canada", "2025-06-10", "completed", 422], [2384, "Ngozi Okafor", "United States", "2025-06-10", "completed", 186], [2380, "Amara Brown", "Australia", "2025-06-10", "completed", 174], [2382, "Grace Nguyen", "United Kingdom", "2025-06-10", "cancelled", 111], [2383, "Sophie Bello", "France", "2025-06-10", "completed", 29], [2376, "Emeka Jones", "United States", "2025-06-09", "completed", 476], [2379, "Emeka Jones", "United States", "2025-06-09", "completed", 66], [2377, "Freya Dubois", "Germany", "2025-06-09", "completed", 65], [2375, "Emeka Taylor", "United Kingdom", "2025-06-09", "completed", 12], [2378, "Clara Wilson", "United Kingdom", "2025-06-09", "completed", 7], [2372, "Elena Nguyen", "United Kingdom", "2025-06-08", "refunded", 773.8], [2369, "Amara Patel", "France", "2025-06-08", "completed", 362.25], [2374, "Hannah Murphy", "Nigeria", "2025-06-08", "refunded", 314], [2370, "Tom Weber", "United Kingdom", "2025-06-08", "completed", 194.65], [2373, "Mateo Murphy", "France", "2025-06-08", "completed", 189], [2371, "Amara Adeyemi", "Canada", "2025-06-08", "completed", 171], [2367, "Aisha Bello", "Canada", "2025-06-07", "completed", 573], [2366, "Omar Visser", "Germany", "2025-06-07", "completed", 516], [2365, "Emeka Taylor", "United Kingdom", "2025-06-07", "completed", 310.15], [2364, "Felix Bello", "United States", "2025-06-07", "completed", 188], [2363, "Sophie Bello", "France", "2025-06-07", "completed", 172], [2368, "Emeka M\xFCller", "Germany", "2025-06-07", "completed", 97], [2357, "Aisha Bello", "Canada", "2025-06-06", "completed", 991.4], [2362, "Ngozi Smith", "France", "2025-06-06", "refunded", 545], [2360, "Priya Adeyemi", "Australia", "2025-06-06", "completed", 380], [2361, "Felix Moreau", "United States", "2025-06-06", "cancelled", 260], [2358, "Elena Kelly", "Germany", "2025-06-06", "completed", 117.3], [2359, "Grace Martin", "Nigeria", "2025-06-06", "cancelled", 23], [2355, "Mateo Eze", "Netherlands", "2025-06-05", "completed", 601], [2352, "Kofi Clarke", "United States", "2025-06-05", "completed", 350], [2356, "Grace Nguyen", "Netherlands", "2025-06-05", "completed", 350], [2353, "Hannah Smith", "United States", "2025-06-05", "completed", 236], [2354, "Isla Garc\xEDa", "Ireland", "2025-06-05", "cancelled", 76], [2349, "Tunde Adeyemi", "Germany", "2025-06-04", "completed", 1062.3], [2347, "Kofi Jones", "United States", "2025-06-04", "completed", 474], [2350, "Grace Wilson", "United Kingdom", "2025-06-04", "completed", 378], [2351, "James Fischer", "Germany", "2025-06-04", "completed", 359], [2348, "Leon Wilson", "United States", "2025-06-04", "completed", 276], [2345, "Hugo Okafor", "United Kingdom", "2025-06-03", "completed", 164], [2343, "Emeka Schmidt", "United States", "2025-06-03", "completed", 67], [2342, "Aisha Bello", "Canada", "2025-06-03", "completed", 58], [2344, "Sophie Jones", "Germany", "2025-06-03", "completed", 12], [2346, "Maya Smith", "Germany", "2025-06-03", "completed", 7], [2338, "Sophie Bello", "France", "2025-06-02", "completed", 382], [2341, "Emeka Smith", "Canada", "2025-06-02", "completed", 186], [2340, "Ada Nguyen", "Australia", "2025-06-02", "cancelled", 154], [2339, "Hannah Smith", "United States", "2025-06-02", "completed", 48], [2337, "Clara Schmidt", "United States", "2025-06-02", "completed", 12], [2335, "Aisha Wilson", "Germany", "2025-06-01", "completed", 593], [2334, "Ben Garc\xEDa", "United States", "2025-06-01", "completed", 261], [2336, "Elena Kelly", "Germany", "2025-06-01", "completed", 207], [2332, "Grace Nguyen", "Netherlands", "2025-06-01", "completed", 204], [2333, "Chidi Wilson", "United States", "2025-06-01", "completed", 83], [2331, "Kofi Clarke", "United States", "2025-06-01", "completed", 54], [2329, "Omar Okafor", "France", "2025-05-31", "completed", 596], [2330, "Leon Fischer", "United States", "2025-05-31", "completed", 278], [2327, "Amara Fischer", "Spain", "2025-05-31", "completed", 270], [2326, "Daniel Jones", "Germany", "2025-05-31", "completed", 248.4], [2328, "Ines Smith", "United Kingdom", "2025-05-31", "refunded", 99.15], [2325, "Omar Okafor", "France", "2025-05-31", "completed", 22], [2323, "Aisha Bello", "Canada", "2025-05-30", "completed", 832], [2324, "Tom Okonkwo", "United Kingdom", "2025-05-30", "completed", 273.3], [2321, "Ada Martin", "United Kingdom", "2025-05-30", "completed", 172], [2322, "Lukas Jones", "Nigeria", "2025-05-30", "cancelled", 65], [2320, "Grace Clarke", "Canada", "2025-05-30", "cancelled", 59], [2318, "Clara Wilson", "United Kingdom", "2025-05-29", "completed", 393.25], [2316, "Ngozi Taylor", "United Kingdom", "2025-05-29", "refunded", 334], [2314, "Ngozi Okafor", "United States", "2025-05-29", "completed", 255], [2317, "Amara Dubois", "United Kingdom", "2025-05-29", "completed", 233], [2315, "Amara Patel", "France", "2025-05-29", "cancelled", 211], [2319, "Grace Martin", "Nigeria", "2025-05-29", "completed", 37], [2309, "Elena M\xFCller", "United States", "2025-05-28", "completed", 149], [2311, "Felix Brown", "Netherlands", "2025-05-28", "completed", 92], [2313, "Noah Visser", "United States", "2025-05-28", "completed", 92], [2312, "Daniel Weber", "Nigeria", "2025-05-28", "completed", 71], [2310, "Emeka Taylor", "United Kingdom", "2025-05-28", "completed", 47.6], [2305, "Aisha Patel", "United Kingdom", "2025-05-27", "completed", 339], [2308, "Elena Kelly", "Germany", "2025-05-27", "completed", 122], [2304, "Felix Eze", "France", "2025-05-27", "completed", 116], [2306, "Hannah Murphy", "Nigeria", "2025-05-27", "completed", 60], [2307, "Hugo Murphy", "Germany", "2025-05-27", "completed", 34], [2303, "Noah Nguyen", "Canada", "2025-05-26", "completed", 375], [2299, "Leon Brown", "United Kingdom", "2025-05-26", "completed", 191.25], [2302, "Elena M\xFCller", "United States", "2025-05-26", "completed", 157], [2300, "Ngozi Jones", "Germany", "2025-05-26", "completed", 105.8], [2301, "Ngozi Okafor", "United States", "2025-05-26", "completed", 84], [2297, "Priya Adeyemi", "Australia", "2025-05-25", "completed", 1164], [2294, "Noah Weber", "Netherlands", "2025-05-25", "cancelled", 550.9], [2298, "Emeka Smith", "Canada", "2025-05-25", "completed", 448], [2295, "Elena Kelly", "Germany", "2025-05-25", "completed", 249], [2293, "Grace Jansen", "France", "2025-05-25", "completed", 188], [2296, "Felix Eze", "France", "2025-05-25", "completed", 117.5], [2287, "Leon Bello", "Ireland", "2025-05-24", "completed", 283], [2289, "Ada Martin", "United Kingdom", "2025-05-24", "completed", 223], [2290, "Hugo Okonkwo", "United States", "2025-05-24", "completed", 202], [2291, "Daniel Jones", "Germany", "2025-05-24", "completed", 189], [2292, "Leon Murphy", "France", "2025-05-24", "completed", 163.75], [2288, "Emeka Fischer", "United States", "2025-05-24", "completed", 84.7], [2284, "Lukas Jansen", "United States", "2025-05-23", "refunded", 2129.2], [2283, "Felix Visser", "Germany", "2025-05-23", "completed", 611], [2286, "Emeka Weber", "United States", "2025-05-23", "completed", 386.3], [2282, "Leon Jones", "United States", "2025-05-23", "completed", 279], [2285, "Kofi Clarke", "United States", "2025-05-23", "completed", 35], [2281, "Leon Jones", "United States", "2025-05-22", "completed", 582], [2280, "Tom Jansen", "United States", "2025-05-22", "completed", 253.25], [2277, "Omar Dubois", "United States", "2025-05-22", "completed", 223], [2278, "Grace Garc\xEDa", "United Kingdom", "2025-05-22", "completed", 207], [2276, "Ngozi Garc\xEDa", "United Kingdom", "2025-05-22", "completed", 122.4], [2279, "Kofi Schmidt", "United Kingdom", "2025-05-22", "completed", 79.25], [2274, "Felix Bello", "United Kingdom", "2025-05-21", "completed", 976], [2271, "Sophie Visser", "United States", "2025-05-21", "completed", 480.6], [2273, "Grace Garc\xEDa", "United Kingdom", "2025-05-21", "completed", 404.2], [2275, "Daniel Patel", "United Kingdom", "2025-05-21", "completed", 130], [2272, "Mateo Jansen", "Canada", "2025-05-21", "completed", 36], [2269, "Ben Garc\xEDa", "United States", "2025-05-20", "completed", 776.65], [2270, "Leon Murphy", "France", "2025-05-20", "cancelled", 535], [2266, "Emeka Smith", "Canada", "2025-05-20", "completed", 409.6], [2268, "Leon Nguyen", "United Kingdom", "2025-05-20", "completed", 330], [2267, "Lukas Eze", "United Kingdom", "2025-05-20", "completed", 179], [2261, "Elena Nguyen", "United Kingdom", "2025-05-19", "completed", 574], [2265, "Omar Dubois", "United States", "2025-05-19", "completed", 204], [2262, "Noah Nguyen", "France", "2025-05-19", "completed", 157], [2264, "Ngozi Okafor", "United States", "2025-05-19", "completed", 138], [2263, "Sophie Jones", "Germany", "2025-05-19", "completed", 54], [2258, "Ines Clarke", "United States", "2025-05-18", "completed", 438], [2257, "Isla Patel", "Spain", "2025-05-18", "completed", 304.15], [2259, "Sophie Martin", "United States", "2025-05-18", "completed", 227], [2255, "Noah Fischer", "United States", "2025-05-18", "completed", 88], [2256, "Emeka Smith", "Canada", "2025-05-18", "completed", 59], [2260, "Emeka Schmidt", "United States", "2025-05-18", "cancelled", 59], [2253, "Emeka M\xFCller", "Germany", "2025-05-17", "completed", 341], [2250, "Lukas Jansen", "United States", "2025-05-17", "completed", 173], [2252, "Ngozi Okafor", "United States", "2025-05-17", "completed", 136], [2248, "Sophie Bello", "France", "2025-05-17", "completed", 129], [2251, "Ada Nguyen", "Australia", "2025-05-17", "completed", 36], [2254, "Sophie Visser", "United States", "2025-05-17", "refunded", 30.6], [2249, "Ngozi Jones", "Germany", "2025-05-17", "completed", 23], [2245, "Priya Adeyemi", "Australia", "2025-05-16", "completed", 815], [2246, "Noah Visser", "United Kingdom", "2025-05-16", "completed", 576], [2247, "Hannah Murphy", "Nigeria", "2025-05-16", "cancelled", 257], [2243, "Leon Visser", "United Kingdom", "2025-05-16", "completed", 249.15], [2244, "Hugo Patel", "United Kingdom", "2025-05-16", "completed", 59], [2239, "Sophie Bello", "France", "2025-05-15", "completed", 691], [2238, "Clara Patel", "United States", "2025-05-15", "completed", 394], [2241, "Lukas Okafor", "United States", "2025-05-15", "cancelled", 204.4], [2240, "Leon Fischer", "United States", "2025-05-15", "completed", 87], [2242, "Sophie Martin", "United States", "2025-05-15", "completed", 87], [2236, "Leon Wilson", "United States", "2025-05-14", "completed", 368.95], [2233, "Sophie Bello", "France", "2025-05-14", "completed", 336], [2235, "Hugo M\xFCller", "Nigeria", "2025-05-14", "completed", 195], [2237, "Elena M\xFCller", "United States", "2025-05-14", "completed", 170], [2234, "Kofi Clarke", "United States", "2025-05-14", "completed", 22], [2228, "Tom Okonkwo", "United Kingdom", "2025-05-13", "completed", 583], [2232, "Leon Patel", "United Kingdom", "2025-05-13", "completed", 329.2], [2231, "Maya Jansen", "Netherlands", "2025-05-13", "completed", 179], [2229, "Elena M\xFCller", "United States", "2025-05-13", "completed", 35], [2230, "Emeka Weber", "United States", "2025-05-13", "completed", 34], [2227, "Tunde Nguyen", "Ireland", "2025-05-12", "completed", 498], [2223, "Ines Fischer", "France", "2025-05-12", "completed", 219], [2226, "Maya Murphy", "United Kingdom", "2025-05-12", "refunded", 94], [2224, "Mateo Eze", "Netherlands", "2025-05-12", "completed", 48], [2225, "Clara Patel", "United States", "2025-05-12", "completed", 36], [2218, "Felix Moreau", "United States", "2025-05-11", "completed", 344], [2221, "Tom Weber", "Spain", "2025-05-11", "completed", 316.65], [2220, "Ngozi Okafor", "United States", "2025-05-11", "completed", 220], [2219, "Emeka M\xFCller", "Germany", "2025-05-11", "completed", 199.2], [2222, "Hannah Smith", "United States", "2025-05-11", "completed", 189], [2217, "Ngozi Smith", "France", "2025-05-11", "completed", 59], [2214, "Hugo Murphy", "Germany", "2025-05-10", "cancelled", 424], [2213, "Amara Adeyemi", "Canada", "2025-05-10", "completed", 399], [2212, "Leon Nguyen", "United Kingdom", "2025-05-10", "refunded", 287], [2216, "Emeka Taylor", "United Kingdom", "2025-05-10", "completed", 274], [2215, "Hugo M\xFCller", "Nigeria", "2025-05-10", "completed", 230], [2210, "Mateo Eze", "Netherlands", "2025-05-10", "completed", 163.95], [2211, "Emeka M\xFCller", "Germany", "2025-05-10", "completed", 142], [2208, "Daniel Jones", "Spain", "2025-05-09", "completed", 374], [2205, "Amara Martin", "United Kingdom", "2025-05-09", "completed", 333], [2209, "Ada Jones", "United Kingdom", "2025-05-09", "completed", 124], [2206, "Isla Brown", "Ireland", "2025-05-09", "completed", 46], [2207, "Maya Visser", "United States", "2025-05-09", "completed", 39], [2204, "Elena Kelly", "Germany", "2025-05-08", "completed", 729.6], [2202, "Ben Okonkwo", "Australia", "2025-05-08", "completed", 209], [2201, "Tunde Nguyen", "Ireland", "2025-05-08", "completed", 129], [2203, "Hugo Okonkwo", "United States", "2025-05-08", "completed", 122], [2200, "Daniel Weber", "Nigeria", "2025-05-08", "completed", 95], [2198, "Amara Patel", "France", "2025-05-07", "completed", 283], [2196, "Maya Nguyen", "Canada", "2025-05-07", "completed", 253], [2195, "Lukas Visser", "Australia", "2025-05-07", "completed", 146], [2197, "Elena Patel", "Nigeria", "2025-05-07", "completed", 101.1], [2199, "Mateo Jansen", "Canada", "2025-05-07", "completed", 58], [2193, "Priya Adeyemi", "Australia", "2025-05-06", "completed", 1004], [2191, "Grace Clarke", "Canada", "2025-05-06", "completed", 786], [2192, "Leon Patel", "Germany", "2025-05-06", "completed", 44], [2194, "Lukas Fischer", "Canada", "2025-05-06", "completed", 28.9], [2186, "Ines Wilson", "United Kingdom", "2025-05-05", "completed", 382.25], [2189, "Amara Okafor", "Netherlands", "2025-05-05", "completed", 376], [2190, "Elena Kelly", "Germany", "2025-05-05", "cancelled", 106], [2188, "Tom Wilson", "Netherlands", "2025-05-05", "completed", 104], [2187, "Leon Dubois", "United States", "2025-05-05", "completed", 39], [2185, "Priya Schmidt", "Ireland", "2025-05-04", "refunded", 323], [2182, "Felix Jones", "Germany", "2025-05-04", "completed", 256.95], [2181, "Noah Nguyen", "France", "2025-05-04", "completed", 216], [2184, "Amara Nguyen", "Nigeria", "2025-05-04", "completed", 174], [2180, "Omar Weber", "United States", "2025-05-04", "completed", 97.75], [2183, "Hugo Dubois", "Australia", "2025-05-04", "completed", 88], [2175, "Amara Martin", "United Kingdom", "2025-05-03", "cancelled", 776], [2178, "Sophie Weber", "Netherlands", "2025-05-03", "completed", 336], [2174, "Tom Okafor", "Nigeria", "2025-05-03", "refunded", 248], [2179, "Elena Weber", "Spain", "2025-05-03", "completed", 192], [2176, "Ngozi Smith", "France", "2025-05-03", "completed", 120.7], [2177, "Clara Patel", "United States", "2025-05-03", "completed", 116], [2169, "Sophie Bello", "France", "2025-05-02", "completed", 328], [2172, "Emeka Visser", "United Kingdom", "2025-05-02", "completed", 264], [2173, "Felix Bello", "United States", "2025-05-02", "completed", 141], [2170, "Hugo M\xFCller", "Nigeria", "2025-05-02", "completed", 50.15], [2171, "Freya Dubois", "Germany", "2025-05-02", "cancelled", 48], [2166, "Isla Garc\xEDa", "Ireland", "2025-05-01", "refunded", 480.3], [2168, "Hugo M\xFCller", "Nigeria", "2025-05-01", "completed", 113.45], [2164, "Isla Jones", "United States", "2025-05-01", "completed", 102], [2167, "Maya Smith", "Germany", "2025-05-01", "completed", 96], [2165, "Freya Kelly", "United Kingdom", "2025-05-01", "completed", 89], [2160, "Ines Patel", "Germany", "2025-04-30", "completed", 484], [2162, "Sophie Bello", "France", "2025-04-30", "completed", 321.3], [2163, "Freya Fischer", "United Kingdom", "2025-04-30", "completed", 183.7], [2161, "Clara Schmidt", "United States", "2025-04-30", "completed", 65], [2159, "Sophie Bello", "France", "2025-04-29", "completed", 84], [2157, "Hannah Smith", "United States", "2025-04-29", "completed", 80.95], [2158, "Leon Jones", "United States", "2025-04-29", "completed", 38], [2156, "Amara Brown", "Australia", "2025-04-29", "completed", 6], [2155, "Grace Clarke", "Canada", "2025-04-28", "completed", 440.95], [2152, "Daniel Weber", "Nigeria", "2025-04-28", "cancelled", 422.9], [2154, "Tom Okonkwo", "United Kingdom", "2025-04-28", "completed", 218], [2153, "Leon Nguyen", "United Kingdom", "2025-04-28", "completed", 102], [2151, "Kofi Schmidt", "Netherlands", "2025-04-28", "completed", 87.95], [2149, "Isla Clarke", "Germany", "2025-04-27", "completed", 167.9], [2146, "Maya Schmidt", "Nigeria", "2025-04-27", "completed", 146], [2148, "Ines Smith", "United Kingdom", "2025-04-27", "completed", 78], [2150, "Ada Kelly", "United States", "2025-04-27", "completed", 75.65], [2147, "Kofi Clarke", "United States", "2025-04-27", "completed", 55], [2145, "Sophie Bello", "France", "2025-04-27", "refunded", 12], [2144, "Mateo Jansen", "Canada", "2025-04-26", "completed", 547.75], [2142, "Amara Okafor", "Netherlands", "2025-04-26", "completed", 415.15], [2139, "Grace Wilson", "United Kingdom", "2025-04-26", "completed", 212], [2141, "Isla Brown", "Ireland", "2025-04-26", "completed", 93], [2140, "Amara Martin", "United Kingdom", "2025-04-26", "completed", 72], [2143, "Ngozi Smith", "France", "2025-04-26", "completed", 29], [2135, "Clara Schmidt", "United States", "2025-04-25", "completed", 635.65], [2136, "Sophie Jones", "Germany", "2025-04-25", "cancelled", 510], [2134, "Hannah Schmidt", "Australia", "2025-04-25", "cancelled", 443.3], [2138, "Aisha Patel", "United Kingdom", "2025-04-25", "completed", 77], [2137, "Leon Patel", "United Kingdom", "2025-04-25", "completed", 17], [2131, "Noah Nguyen", "France", "2025-04-24", "completed", 663.1], [2133, "Isla Brown", "Ireland", "2025-04-24", "completed", 292.2], [2130, "Grace Nguyen", "United Kingdom", "2025-04-24", "completed", 136], [2132, "Amara Murphy", "Germany", "2025-04-24", "completed", 81], [2127, "Hannah Smith", "United States", "2025-04-23", "completed", 326.3], [2128, "Mateo Clarke", "United Kingdom", "2025-04-23", "completed", 55], [2129, "Aisha Taylor", "Germany", "2025-04-23", "completed", 45], [2126, "Elena Nguyen", "United Kingdom", "2025-04-23", "completed", 39], [2125, "Clara Dubois", "United States", "2025-04-22", "completed", 177], [2123, "Felix Brown", "Netherlands", "2025-04-22", "completed", 110], [2122, "Leon Fischer", "United States", "2025-04-22", "completed", 36], [2124, "Clara Schmidt", "United States", "2025-04-22", "completed", 11.9], [2119, "Sophie Bello", "France", "2025-04-21", "completed", 778], [2117, "Hannah Smith", "United States", "2025-04-21", "completed", 284], [2121, "Daniel Jones", "Germany", "2025-04-21", "completed", 196], [2120, "Tom Okonkwo", "United Kingdom", "2025-04-21", "completed", 158], [2118, "Ada Jones", "United Kingdom", "2025-04-21", "completed", 146], [2112, "Leon Jones", "United States", "2025-04-20", "cancelled", 189], [2115, "Tunde Nguyen", "Ireland", "2025-04-20", "completed", 45], [2113, "Kofi Clarke", "United States", "2025-04-20", "completed", 22], [2114, "Noah Nguyen", "France", "2025-04-20", "completed", 10.2], [2116, "Tom Okafor", "Nigeria", "2025-04-20", "completed", 7], [2107, "Daniel Jones", "Germany", "2025-04-19", "completed", 293], [2108, "Ines Smith", "Spain", "2025-04-19", "cancelled", 285], [2111, "Elena Nguyen", "United Kingdom", "2025-04-19", "completed", 236.6], [2109, "Zara Smith", "France", "2025-04-19", "completed", 188], [2110, "Noah Dubois", "United Kingdom", "2025-04-19", "completed", 147], [2106, "Hugo M\xFCller", "Nigeria", "2025-04-19", "completed", 42], [2102, "Kofi Clarke", "United States", "2025-04-18", "completed", 563], [2101, "Tunde Nguyen", "Ireland", "2025-04-18", "completed", 389], [2105, "Hugo Murphy", "Germany", "2025-04-18", "completed", 331.3], [2103, "Amara Martin", "United Kingdom", "2025-04-18", "completed", 72], [2104, "Ada Martin", "United Kingdom", "2025-04-18", "completed", 62], [2100, "Leon Nguyen", "United Kingdom", "2025-04-17", "completed", 501], [2097, "Clara Visser", "France", "2025-04-17", "completed", 222.3], [2098, "Ada Martin", "United Kingdom", "2025-04-17", "completed", 218], [2099, "Ngozi Okafor", "United States", "2025-04-17", "completed", 114.55], [2096, "Grace Jansen", "France", "2025-04-17", "completed", 46.75], [2093, "Priya Adeyemi", "Australia", "2025-04-16", "completed", 2010.3], [2094, "Maya Nguyen", "Canada", "2025-04-16", "completed", 645], [2092, "Ada Nguyen", "Australia", "2025-04-16", "completed", 584], [2095, "Mateo Brown", "United States", "2025-04-16", "completed", 137.65], [2088, "Felix Moreau", "United States", "2025-04-15", "completed", 541], [2089, "Daniel Jones", "Spain", "2025-04-15", "completed", 268], [2091, "Clara Fischer", "Ireland", "2025-04-15", "completed", 169], [2090, "Isla Brown", "Ireland", "2025-04-15", "completed", 80.75], [2087, "Noah Visser", "United States", "2025-04-15", "completed", 24], [2082, "Mateo Fischer", "United Kingdom", "2025-04-14", "completed", 290.6], [2084, "Clara Patel", "United States", "2025-04-14", "completed", 236], [2083, "Ines Clarke", "United States", "2025-04-14", "completed", 178], [2086, "Daniel Weber", "Nigeria", "2025-04-14", "cancelled", 95], [2085, "Ngozi Dubois", "Netherlands", "2025-04-14", "completed", 28], [2080, "Sophie Visser", "United States", "2025-04-13", "completed", 742], [2081, "Elena Adeyemi", "Germany", "2025-04-13", "completed", 469], [2078, "Lukas Jansen", "United States", "2025-04-13", "completed", 408], [2079, "Priya Brown", "United Kingdom", "2025-04-13", "completed", 141], [2076, "Isla Brown", "Ireland", "2025-04-13", "completed", 131], [2077, "Hugo Dubois", "Australia", "2025-04-13", "completed", 36], [2072, "Ada Brown", "United Kingdom", "2025-04-12", "completed", 394], [2074, "Hannah Okonkwo", "Netherlands", "2025-04-12", "refunded", 321.6], [2075, "Clara Bello", "France", "2025-04-12", "completed", 181], [2071, "Elena M\xFCller", "United States", "2025-04-12", "completed", 128.65], [2073, "Elena Patel", "Nigeria", "2025-04-12", "completed", 110], [2068, "Mateo Fischer", "United Kingdom", "2025-04-11", "cancelled", 698.6], [2066, "Clara Schmidt", "United States", "2025-04-11", "completed", 189], [2069, "Noah Dubois", "United Kingdom", "2025-04-11", "completed", 158.3], [2070, "Ada Visser", "Canada", "2025-04-11", "completed", 99], [2067, "Isla Jones", "United States", "2025-04-11", "completed", 62], [2061, "Felix Taylor", "United Kingdom", "2025-04-10", "completed", 723.05], [2063, "Ngozi Dubois", "Netherlands", "2025-04-10", "completed", 304.8], [2062, "Amara Fischer", "Spain", "2025-04-10", "completed", 300.75], [2065, "Maya Nguyen", "Canada", "2025-04-10", "completed", 76], [2064, "Tom Okafor", "Nigeria", "2025-04-10", "completed", 16], [2059, "Daniel Weber", "Nigeria", "2025-04-09", "completed", 179], [2058, "Ada Nguyen", "Australia", "2025-04-09", "cancelled", 170], [2056, "James Fischer", "Germany", "2025-04-09", "completed", 129], [2057, "Ngozi Garc\xEDa", "United Kingdom", "2025-04-09", "completed", 7], [2060, "Lukas Schmidt", "United States", "2025-04-09", "completed", 7], [2053, "Elena Kelly", "Germany", "2025-04-08", "completed", 337], [2055, "Ngozi Okafor", "United States", "2025-04-08", "completed", 159], [2054, "Aisha Wilson", "Germany", "2025-04-08", "completed", 107], [2052, "Noah Visser", "United States", "2025-04-08", "completed", 41], [2051, "Sophie Martin", "United States", "2025-04-08", "completed", 12], [2048, "Ada Jones", "United Kingdom", "2025-04-07", "completed", 476.25], [2050, "Noah Visser", "United States", "2025-04-07", "completed", 65.2], [2047, "Ines Smith", "United Kingdom", "2025-04-07", "completed", 48], [2049, "Leon Jones", "United States", "2025-04-07", "completed", 46], [2043, "Clara Visser", "France", "2025-04-06", "completed", 288], [2045, "Lukas Dubois", "United States", "2025-04-06", "completed", 247.8], [2046, "Lukas Kelly", "Nigeria", "2025-04-06", "completed", 183], [2041, "Ngozi Okafor", "United States", "2025-04-06", "completed", 55], [2044, "Hugo Okafor", "United Kingdom", "2025-04-06", "completed", 27], [2042, "Ben Garc\xEDa", "United States", "2025-04-06", "completed", 12], [2036, "Maya Bello", "United Kingdom", "2025-04-05", "refunded", 782], [2035, "Noah Visser", "United Kingdom", "2025-04-05", "completed", 382], [2038, "Hugo Murphy", "Germany", "2025-04-05", "completed", 205.65], [2039, "Daniel Jones", "Germany", "2025-04-05", "completed", 201.65], [2037, "Mateo Brown", "United States", "2025-04-05", "refunded", 21], [2040, "Emeka Schmidt", "United States", "2025-04-05", "cancelled", 20.4], [2029, "Noah Dubois", "United Kingdom", "2025-04-04", "completed", 503.15], [2032, "Leon Fischer", "United States", "2025-04-04", "completed", 469], [2033, "Tom Okafor", "Nigeria", "2025-04-04", "completed", 190], [2034, "Clara Fischer", "United Kingdom", "2025-04-04", "completed", 178], [2031, "Priya Brown", "United States", "2025-04-04", "completed", 118], [2030, "Hugo Dubois", "Australia", "2025-04-04", "cancelled", 9], [2025, "Ada Nguyen", "Australia", "2025-04-03", "refunded", 170], [2026, "Mateo Jansen", "Canada", "2025-04-03", "completed", 169], [2028, "Elena Nguyen", "United Kingdom", "2025-04-03", "completed", 57.6], [2027, "Isla Garc\xEDa", "Ireland", "2025-04-03", "refunded", 36], [2024, "Daniel Weber", "Nigeria", "2025-04-02", "completed", 603], [2021, "Aisha Patel", "United Kingdom", "2025-04-02", "completed", 387], [2022, "Chidi Patel", "Canada", "2025-04-02", "completed", 198.65], [2020, "Noah Nguyen", "Canada", "2025-04-02", "completed", 196], [2023, "Ben Martin", "Netherlands", "2025-04-02", "completed", 190.95], [2019, "Hannah Moreau", "United States", "2025-04-01", "completed", 758], [2015, "Noah Visser", "United States", "2025-04-01", "completed", 306], [2017, "Isla Brown", "Ireland", "2025-04-01", "cancelled", 278], [2016, "Lukas Smith", "France", "2025-04-01", "completed", 204], [2018, "Maya Weber", "United States", "2025-04-01", "refunded", 106], [2014, "Mateo Jansen", "Canada", "2025-03-31", "completed", 783], [2013, "Hugo Dubois", "Australia", "2025-03-31", "completed", 762.3], [2011, "Elena Dubois", "Australia", "2025-03-31", "cancelled", 161.25], [2012, "Hugo Okonkwo", "United States", "2025-03-31", "cancelled", 152.15], [2006, "Freya Kelly", "United Kingdom", "2025-03-30", "completed", 422], [2009, "Emeka Visser", "United Kingdom", "2025-03-30", "cancelled", 383.3], [2008, "Ines Wilson", "United Kingdom", "2025-03-30", "completed", 301], [2007, "Noah Patel", "United States", "2025-03-30", "completed", 258], [2010, "Clara Visser", "France", "2025-03-30", "completed", 196], [2005, "Chidi Patel", "Canada", "2025-03-29", "completed", 597], [2001, "Ben Okonkwo", "Australia", "2025-03-29", "completed", 303.7], [2004, "Hannah Murphy", "Nigeria", "2025-03-29", "completed", 96], [2003, "Emeka Fischer", "United States", "2025-03-29", "completed", 65], [2e3, "Ngozi Smith", "France", "2025-03-29", "completed", 29.2], [2002, "Elena M\xFCller", "United Kingdom", "2025-03-29", "completed", 28.9], [1997, "Hannah Okonkwo", "Netherlands", "2025-03-28", "completed", 295.2], [1998, "Freya Jones", "United States", "2025-03-28", "completed", 286], [1995, "Lukas Garc\xEDa", "United States", "2025-03-28", "completed", 125], [1996, "Priya Eze", "France", "2025-03-28", "completed", 90], [1999, "Lukas Jansen", "United States", "2025-03-28", "completed", 90], [1993, "Felix Patel", "United Kingdom", "2025-03-27", "refunded", 470], [1991, "Priya Brown", "United States", "2025-03-27", "completed", 278], [1992, "Elena Nguyen", "United Kingdom", "2025-03-27", "completed", 240.1], [1994, "Lukas Okafor", "United States", "2025-03-27", "completed", 12], [1989, "Felix Eze", "France", "2025-03-26", "completed", 400.3], [1988, "Hannah Murphy", "Nigeria", "2025-03-26", "completed", 301], [1990, "Ada Brown", "United Kingdom", "2025-03-26", "completed", 222], [1986, "Clara Schmidt", "United States", "2025-03-26", "completed", 102], [1987, "Grace Clarke", "Canada", "2025-03-26", "completed", 28], [1984, "Felix Bello", "United States", "2025-03-25", "completed", 210], [1985, "Priya Schmidt", "Ireland", "2025-03-25", "completed", 183], [1983, "Clara Schmidt", "United States", "2025-03-25", "completed", 137], [1982, "Leon Wilson", "United States", "2025-03-25", "completed", 60], [1979, "Hugo M\xFCller", "Nigeria", "2025-03-24", "completed", 344], [1981, "Aisha Bello", "Canada", "2025-03-24", "completed", 272], [1978, "Sophie Bello", "France", "2025-03-24", "refunded", 268], [1980, "Maya Nguyen", "Canada", "2025-03-24", "completed", 195], [1977, "Noah Nguyen", "France", "2025-03-24", "completed", 184.45], [1974, "Mateo Fischer", "United Kingdom", "2025-03-23", "completed", 961], [1975, "Sophie Weber", "Netherlands", "2025-03-23", "completed", 667.6], [1972, "Ben Martin", "Netherlands", "2025-03-23", "cancelled", 401], [1976, "Freya Kelly", "United Kingdom", "2025-03-23", "completed", 242], [1973, "Ines Fischer", "France", "2025-03-23", "completed", 24], [1966, "Hugo Patel", "United Kingdom", "2025-03-22", "completed", 457], [1968, "Freya Dubois", "Germany", "2025-03-22", "completed", 380], [1967, "Noah Visser", "United States", "2025-03-22", "cancelled", 284], [1971, "Sophie Martin", "United States", "2025-03-22", "completed", 211.65], [1969, "Sophie Weber", "Netherlands", "2025-03-22", "completed", 88], [1970, "Maya Schmidt", "Nigeria", "2025-03-22", "completed", 32], [1964, "Tom Murphy", "United Kingdom", "2025-03-21", "completed", 323.1], [1963, "Sophie Visser", "United States", "2025-03-21", "completed", 242.65], [1965, "Daniel Weber", "Nigeria", "2025-03-21", "completed", 108], [1962, "Ngozi Smith", "France", "2025-03-21", "completed", 29], [1961, "Emeka Visser", "United Kingdom", "2025-03-20", "completed", 990], [1957, "Amara Dubois", "United Kingdom", "2025-03-20", "completed", 482], [1958, "Felix Taylor", "United Kingdom", "2025-03-20", "completed", 287], [1959, "Ada Nguyen", "Australia", "2025-03-20", "completed", 212], [1960, "Emeka Fischer", "United States", "2025-03-20", "completed", 78.15], [1954, "Tom Okafor", "Nigeria", "2025-03-19", "completed", 1045.75], [1955, "Amara Patel", "France", "2025-03-19", "completed", 605], [1953, "Emeka Schmidt", "United States", "2025-03-19", "completed", 122], [1956, "Amara Adeyemi", "Canada", "2025-03-19", "completed", 23], [1952, "Amara Dubois", "United Kingdom", "2025-03-18", "completed", 437], [1949, "Elena Smith", "United Kingdom", "2025-03-18", "completed", 387], [1950, "Mateo Brown", "United States", "2025-03-18", "completed", 74], [1951, "Ngozi Jones", "Germany", "2025-03-18", "completed", 16], [1945, "Tom Bello", "United Kingdom", "2025-03-17", "completed", 281.8], [1947, "Ada Martin", "United Kingdom", "2025-03-17", "completed", 220], [1948, "Felix Patel", "United Kingdom", "2025-03-17", "completed", 102.25], [1946, "Chidi Patel", "Canada", "2025-03-17", "completed", 101], [1942, "Tom Fischer", "United States", "2025-03-16", "completed", 457.25], [1944, "Felix Patel", "United Kingdom", "2025-03-16", "cancelled", 147], [1941, "Amara Patel", "France", "2025-03-16", "completed", 126], [1943, "Lukas Dubois", "United States", "2025-03-16", "completed", 14], [1940, "Lukas M\xFCller", "United Kingdom", "2025-03-16", "completed", 12], [1935, "Amara Murphy", "Germany", "2025-03-15", "completed", 334], [1938, "Felix Bello", "United States", "2025-03-15", "completed", 328], [1936, "Felix Eze", "France", "2025-03-15", "completed", 167], [1937, "Tunde Nguyen", "United Kingdom", "2025-03-15", "completed", 108], [1939, "Maya Smith", "Germany", "2025-03-15", "completed", 47], [1932, "Clara Patel", "United States", "2025-03-14", "completed", 1299], [1933, "Priya Adeyemi", "Australia", "2025-03-14", "completed", 1106], [1930, "Hugo Martin", "Nigeria", "2025-03-14", "completed", 150], [1934, "Kofi Jones", "United States", "2025-03-14", "completed", 76], [1931, "Hannah Taylor", "Australia", "2025-03-14", "completed", 74], [1929, "Maya Murphy", "United Kingdom", "2025-03-13", "completed", 410.1], [1927, "Tom Wilson", "Netherlands", "2025-03-13", "completed", 292], [1928, "Lukas Garc\xEDa", "United States", "2025-03-13", "completed", 123.1], [1926, "James Fischer", "Germany", "2025-03-13", "completed", 106], [1925, "Amara Eze", "Nigeria", "2025-03-12", "completed", 751.45], [1923, "Emeka Taylor", "United Kingdom", "2025-03-12", "completed", 194.25], [1924, "Ben Bello", "France", "2025-03-12", "refunded", 164.85], [1922, "Elena M\xFCller", "United States", "2025-03-12", "cancelled", 141], [1919, "Clara Patel", "United States", "2025-03-11", "completed", 1081], [1921, "Hannah Smith", "United States", "2025-03-11", "completed", 615], [1920, "Sophie Visser", "United States", "2025-03-11", "completed", 69], [1918, "Ines Garc\xEDa", "United States", "2025-03-11", "completed", 62], [1915, "Aisha Patel", "United Kingdom", "2025-03-10", "completed", 343.8], [1916, "Grace Weber", "United States", "2025-03-10", "completed", 179.3], [1914, "Sophie Bello", "France", "2025-03-10", "completed", 55], [1917, "Chidi Patel", "Canada", "2025-03-10", "refunded", 9], [1910, "Emeka Smith", "Canada", "2025-03-09", "completed", 596], [1909, "Elena Okonkwo", "United States", "2025-03-09", "completed", 524.6], [1913, "Amara Martin", "United Kingdom", "2025-03-09", "completed", 358], [1912, "Ines Smith", "United Kingdom", "2025-03-09", "refunded", 39.95], [1911, "Aisha Patel", "United Kingdom", "2025-03-09", "completed", 27.2], [1905, "Chidi Bello", "United Kingdom", "2025-03-08", "cancelled", 476.95], [1906, "Maya Smith", "Germany", "2025-03-08", "completed", 89], [1908, "Maya Brown", "Canada", "2025-03-08", "completed", 49.9], [1907, "Ines Smith", "Spain", "2025-03-08", "completed", 40.8], [1904, "Tom Okonkwo", "United Kingdom", "2025-03-08", "completed", 28], [1901, "Priya Adeyemi", "Australia", "2025-03-07", "refunded", 2902], [1900, "Priya Adeyemi", "Australia", "2025-03-07", "completed", 842], [1903, "Clara Visser", "France", "2025-03-07", "completed", 202.6], [1902, "Ben Garc\xEDa", "United States", "2025-03-07", "completed", 16], [1897, "Clara Weber", "United Kingdom", "2025-03-06", "completed", 427], [1896, "Hugo Okonkwo", "United States", "2025-03-06", "completed", 307], [1899, "Tunde Nguyen", "Ireland", "2025-03-06", "completed", 178], [1898, "Ines Patel", "Germany", "2025-03-06", "completed", 28.9], [1892, "Leon Fischer", "United States", "2025-03-05", "refunded", 1156], [1895, "Hannah Smith", "United States", "2025-03-05", "completed", 471], [1894, "Lukas Jansen", "United States", "2025-03-05", "completed", 364], [1893, "Maya Weber", "United States", "2025-03-05", "completed", 78], [1888, "Sophie Jones", "Germany", "2025-03-04", "completed", 527.3], [1889, "Emeka Weber", "United States", "2025-03-04", "completed", 238], [1890, "Sophie Moreau", "Germany", "2025-03-04", "completed", 96], [1891, "Ben Okonkwo", "Australia", "2025-03-04", "refunded", 59], [1884, "Leon Murphy", "France", "2025-03-03", "refunded", 195], [1887, "Hannah Moreau", "United States", "2025-03-03", "completed", 135], [1885, "Ines Smith", "United Kingdom", "2025-03-03", "cancelled", 68], [1886, "Emeka Visser", "United Kingdom", "2025-03-03", "completed", 45], [1879, "Maya Smith", "Germany", "2025-03-02", "completed", 1245], [1883, "Lukas Smith", "France", "2025-03-02", "completed", 633], [1880, "Ngozi Jones", "Germany", "2025-03-02", "completed", 350.15], [1882, "Ada Garc\xEDa", "Nigeria", "2025-03-02", "completed", 217.6], [1881, "Daniel Dubois", "Germany", "2025-03-02", "completed", 10.2], [1877, "Ada Nguyen", "Australia", "2025-03-01", "completed", 345], [1875, "Hannah Smith", "United States", "2025-03-01", "completed", 225.2], [1876, "Tom Wilson", "Netherlands", "2025-03-01", "completed", 99], [1878, "Hannah Murphy", "Nigeria", "2025-03-01", "completed", 83], [1874, "Noah Patel", "United States", "2025-03-01", "completed", 69], [1872, "Daniel Weber", "Nigeria", "2025-02-28", "completed", 232], [1870, "Sophie Weber", "Netherlands", "2025-02-28", "completed", 221], [1871, "Emeka Weber", "United States", "2025-02-28", "completed", 175.6], [1873, "Leon Fischer", "United States", "2025-02-28", "completed", 152.15], [1868, "Noah Visser", "United States", "2025-02-27", "cancelled", 291], [1866, "Emeka Martin", "Australia", "2025-02-27", "completed", 139], [1869, "Maya Smith", "Germany", "2025-02-27", "completed", 111], [1867, "Sophie Moreau", "Spain", "2025-02-27", "completed", 92.15], [1863, "Sophie Moreau", "Spain", "2025-02-26", "completed", 513], [1865, "Ngozi Smith", "France", "2025-02-26", "completed", 195], [1864, "Emeka Fischer", "United States", "2025-02-26", "completed", 19.55], [1860, "Sophie Visser", "United States", "2025-02-25", "completed", 166], [1862, "Clara Dubois", "United States", "2025-02-25", "completed", 108], [1861, "Daniel Weber", "Nigeria", "2025-02-25", "completed", 24], [1859, "Mateo Brown", "United States", "2025-02-24", "completed", 380], [1858, "Leon Patel", "United Kingdom", "2025-02-24", "completed", 123], [1857, "Lukas Smith", "France", "2025-02-24", "completed", 99.45], [1853, "Ines Clarke", "United States", "2025-02-23", "completed", 316], [1854, "Ngozi Garc\xEDa", "United Kingdom", "2025-02-23", "completed", 277], [1856, "Emeka Jansen", "United Kingdom", "2025-02-23", "completed", 57.8], [1855, "Aisha Wilson", "Germany", "2025-02-23", "completed", 55], [1851, "Leon Dubois", "United States", "2025-02-22", "completed", 1182], [1849, "Lukas Jansen", "United States", "2025-02-22", "completed", 161.5], [1852, "Leon Brown", "United States", "2025-02-22", "completed", 123.95], [1850, "Maya Smith", "Germany", "2025-02-22", "completed", 6], [1846, "Felix Eze", "France", "2025-02-21", "completed", 251], [1848, "Ben Brown", "United States", "2025-02-21", "completed", 59], [1845, "Elena Kelly", "Germany", "2025-02-21", "completed", 51], [1847, "Lukas Smith", "France", "2025-02-21", "completed", 46], [1842, "Tunde Nguyen", "Ireland", "2025-02-20", "completed", 331], [1841, "Zara Smith", "France", "2025-02-20", "completed", 190], [1844, "Sophie Moreau", "Germany", "2025-02-20", "refunded", 62], [1843, "Ngozi Brown", "Canada", "2025-02-20", "completed", 50.15], [1840, "Priya Adeyemi", "Australia", "2025-02-19", "completed", 758.6], [1837, "Kofi Schmidt", "Netherlands", "2025-02-19", "completed", 217], [1839, "Felix Patel", "United Kingdom", "2025-02-19", "completed", 182.4], [1838, "Sophie Visser", "United States", "2025-02-19", "completed", 123], [1836, "Clara Patel", "United States", "2025-02-18", "refunded", 1294], [1833, "Lukas Garc\xEDa", "United States", "2025-02-18", "refunded", 282.45], [1835, "Kofi Brown", "Australia", "2025-02-18", "completed", 130.65], [1834, "Ada Brown", "United Kingdom", "2025-02-18", "completed", 54], [1832, "Elena Kelly", "Germany", "2025-02-17", "completed", 757.15], [1830, "Grace Nguyen", "United Kingdom", "2025-02-17", "refunded", 194], [1831, "Leon Patel", "Germany", "2025-02-17", "completed", 48], [1829, "Sophie Kelly", "Nigeria", "2025-02-16", "completed", 406], [1826, "Ngozi Jones", "Germany", "2025-02-16", "completed", 188], [1828, "Sophie Moreau", "Spain", "2025-02-16", "completed", 40.8], [1827, "Emeka M\xFCller", "Germany", "2025-02-16", "completed", 27], [1821, "Tom Murphy", "United Kingdom", "2025-02-15", "completed", 1771], [1823, "Maya Weber", "United States", "2025-02-15", "completed", 283], [1825, "Kofi Clarke", "United States", "2025-02-15", "completed", 272], [1822, "Amara Patel", "France", "2025-02-15", "completed", 129], [1824, "Felix Bello", "United Kingdom", "2025-02-15", "cancelled", 24], [1819, "Noah Patel", "United States", "2025-02-14", "refunded", 1086.75], [1817, "Amara Murphy", "Germany", "2025-02-14", "completed", 409.5], [1820, "Ngozi Okafor", "United States", "2025-02-14", "completed", 167.15], [1818, "Ngozi Smith", "France", "2025-02-14", "completed", 22], [1813, "Noah Visser", "United Kingdom", "2025-02-13", "completed", 1662.2], [1815, "Elena Smith", "United Kingdom", "2025-02-13", "completed", 294.75], [1816, "Lukas Garc\xEDa", "United States", "2025-02-13", "completed", 274], [1814, "Hannah Murphy", "Nigeria", "2025-02-13", "completed", 56], [1810, "Leon Jones", "United States", "2025-02-12", "cancelled", 633], [1811, "Lukas Visser", "Australia", "2025-02-12", "completed", 268.4], [1812, "Hugo M\xFCller", "Nigeria", "2025-02-12", "completed", 59], [1808, "Felix Patel", "United Kingdom", "2025-02-11", "completed", 258], [1807, "Elena M\xFCller", "United Kingdom", "2025-02-11", "completed", 95], [1806, "Felix Eze", "France", "2025-02-11", "completed", 79], [1809, "Clara Schmidt", "United States", "2025-02-11", "completed", 64], [1804, "Ngozi Okafor", "United States", "2025-02-10", "completed", 492], [1803, "Maya Jansen", "Netherlands", "2025-02-10", "completed", 277.45], [1805, "Sophie Visser", "United States", "2025-02-10", "completed", 47], [1801, "Priya Adeyemi", "Australia", "2025-02-09", "completed", 375], [1800, "Amara Nguyen", "Nigeria", "2025-02-09", "completed", 210], [1799, "Omar Weber", "United States", "2025-02-09", "completed", 165], [1802, "Elena M\xFCller", "United States", "2025-02-09", "completed", 139], [1797, "Kofi Clarke", "United States", "2025-02-08", "completed", 452.95], [1794, "Noah Weber", "Australia", "2025-02-08", "completed", 267], [1795, "Tunde Nguyen", "Ireland", "2025-02-08", "cancelled", 264], [1798, "Tom Wilson", "Netherlands", "2025-02-08", "completed", 145], [1796, "Noah Nguyen", "France", "2025-02-08", "completed", 36], [1793, "Ada Weber", "United States", "2025-02-07", "completed", 405], [1791, "Leon Patel", "Germany", "2025-02-07", "completed", 314], [1792, "Grace Visser", "Nigeria", "2025-02-07", "completed", 275], [1790, "Tom Okonkwo", "United Kingdom", "2025-02-07", "completed", 212], [1787, "Lukas Jansen", "United States", "2025-02-06", "completed", 318], [1788, "Ines Patel", "Germany", "2025-02-06", "completed", 209.1], [1789, "Tom Okonkwo", "United Kingdom", "2025-02-06", "completed", 38], [1785, "Elena M\xFCller", "United States", "2025-02-05", "completed", 573], [1786, "Ngozi Patel", "Ireland", "2025-02-05", "completed", 136], [1784, "Felix Jones", "Germany", "2025-02-05", "completed", 81.8], [1781, "Ngozi Okafor", "United States", "2025-02-04", "completed", 262], [1783, "Aisha Murphy", "Germany", "2025-02-04", "completed", 166.1], [1782, "Ngozi Okafor", "United States", "2025-02-04", "completed", 134], [1780, "Hannah Moreau", "United States", "2025-02-03", "cancelled", 3544], [1778, "Sophie Moreau", "Germany", "2025-02-03", "completed", 437.65], [1779, "Lukas Jones", "Nigeria", "2025-02-03", "completed", 394], [1777, "Felix Kelly", "United States", "2025-02-03", "completed", 309.65], [1773, "Priya Adeyemi", "Australia", "2025-02-02", "completed", 358], [1775, "Daniel Smith", "Germany", "2025-02-02", "completed", 213], [1774, "Amara Nguyen", "Nigeria", "2025-02-02", "completed", 203], [1776, "Leon Nguyen", "United Kingdom", "2025-02-02", "completed", 84.15], [1772, "Ngozi Jones", "Germany", "2025-02-01", "completed", 667.8], [1771, "James Bello", "Ireland", "2025-02-01", "completed", 201], [1768, "Sophie Moreau", "Germany", "2025-02-01", "completed", 101.55], [1770, "Amara Kelly", "Spain", "2025-02-01", "completed", 38], [1769, "Clara Patel", "United States", "2025-02-01", "refunded", 18], [1766, "Tom Weber", "Spain", "2025-01-31", "completed", 456], [1765, "Amara Adeyemi", "United Kingdom", "2025-01-31", "completed", 105.2], [1764, "Clara Visser", "France", "2025-01-31", "completed", 85], [1767, "Emeka Weber", "United States", "2025-01-31", "completed", 12], [1762, "Zara Smith", "France", "2025-01-30", "completed", 311.65], [1763, "Ben Martin", "Netherlands", "2025-01-30", "completed", 137], [1761, "Tom Bello", "United Kingdom", "2025-01-30", "completed", 6], [1760, "Emeka Schmidt", "United States", "2025-01-29", "completed", 420.3], [1759, "Tunde Nguyen", "Ireland", "2025-01-29", "completed", 321], [1758, "Maya Smith", "Germany", "2025-01-29", "completed", 55], [1757, "Ngozi Dubois", "Netherlands", "2025-01-28", "completed", 124], [1754, "Kofi Clarke", "United States", "2025-01-28", "completed", 91], [1756, "Leon Nguyen", "United Kingdom", "2025-01-28", "completed", 89], [1755, "Lukas Fischer", "Canada", "2025-01-28", "completed", 57], [1752, "Leon Wilson", "United States", "2025-01-27", "completed", 603], [1753, "Aisha Patel", "United Kingdom", "2025-01-27", "completed", 118], [1751, "Hugo Patel", "United Kingdom", "2025-01-27", "completed", 51], [1749, "Clara Dubois", "United States", "2025-01-26", "completed", 448.15], [1750, "Sophie Martin", "United States", "2025-01-26", "completed", 340.15], [1747, "Sophie Visser", "United States", "2025-01-26", "completed", 298], [1748, "Ada Nguyen", "Australia", "2025-01-26", "completed", 163], [1746, "Sophie Weber", "Netherlands", "2025-01-26", "completed", 39.3], [1743, "Ines Fischer", "France", "2025-01-25", "completed", 683], [1742, "Elena M\xFCller", "United States", "2025-01-25", "completed", 388], [1744, "Ngozi Jones", "Germany", "2025-01-25", "completed", 201], [1745, "Sophie Moreau", "Spain", "2025-01-25", "completed", 57], [1740, "Kofi Jones", "United States", "2025-01-24", "completed", 1286], [1738, "Leon Fischer", "United States", "2025-01-24", "completed", 214.65], [1741, "Sophie Moreau", "Spain", "2025-01-24", "completed", 56], [1739, "Ada Martin", "United Kingdom", "2025-01-24", "completed", 48], [1736, "Ngozi Jones", "Germany", "2025-01-23", "completed", 291], [1735, "Amara Patel", "France", "2025-01-23", "completed", 114], [1737, "Lukas Fischer", "Canada", "2025-01-23", "completed", 86], [1734, "Lukas Okafor", "United States", "2025-01-23", "completed", 75], [1731, "Felix Patel", "United Kingdom", "2025-01-22", "completed", 252.1], [1732, "Maya Jansen", "Netherlands", "2025-01-22", "completed", 45.15], [1733, "Hugo M\xFCller", "Nigeria", "2025-01-22", "completed", 44], [1730, "Felix Patel", "United Kingdom", "2025-01-21", "completed", 806], [1729, "Ines Smith", "Spain", "2025-01-21", "completed", 207.9], [1728, "Sophie Martin", "United States", "2025-01-21", "completed", 95], [1727, "Lukas Jansen", "United States", "2025-01-20", "completed", 396], [1725, "Kofi Clarke", "United States", "2025-01-20", "completed", 164], [1724, "Aisha Wilson", "Germany", "2025-01-20", "completed", 153], [1726, "Ada Kelly", "United States", "2025-01-20", "refunded", 124], [1723, "Elena M\xFCller", "United States", "2025-01-19", "completed", 548], [1722, "Sophie Moreau", "Spain", "2025-01-19", "cancelled", 237], [1720, "Maya Jones", "Canada", "2025-01-19", "completed", 90], [1721, "Clara Dubois", "United States", "2025-01-19", "completed", 40], [1717, "Grace Nguyen", "Netherlands", "2025-01-18", "completed", 669], [1718, "Sophie Eze", "France", "2025-01-18", "completed", 493], [1719, "Aisha Murphy", "Germany", "2025-01-18", "refunded", 148.6], [1716, "Sophie Jones", "Germany", "2025-01-18", "completed", 58], [1715, "Maya Nguyen", "Canada", "2025-01-18", "completed", 16], [1711, "Felix Patel", "United Kingdom", "2025-01-17", "completed", 129], [1713, "Leon Jones", "United States", "2025-01-17", "completed", 107], [1712, "Omar Weber", "United States", "2025-01-17", "completed", 74], [1714, "Grace Nguyen", "Netherlands", "2025-01-17", "completed", 64], [1710, "Ines Clarke", "United States", "2025-01-16", "completed", 471.25], [1709, "Amara Adeyemi", "United Kingdom", "2025-01-16", "completed", 192], [1708, "Ines Smith", "United Kingdom", "2025-01-16", "completed", 77], [1704, "Ines Clarke", "United States", "2025-01-15", "completed", 152], [1706, "Hannah Smith", "United States", "2025-01-15", "completed", 118], [1705, "Kofi Clarke", "United States", "2025-01-15", "completed", 29], [1707, "Maya Jansen", "Netherlands", "2025-01-15", "completed", 12], [1703, "Tunde Nguyen", "Ireland", "2025-01-14", "completed", 569], [1702, "Leon Fischer", "United States", "2025-01-14", "completed", 432], [1701, "Felix Bello", "United States", "2025-01-14", "completed", 153], [1700, "Ben Martin", "Netherlands", "2025-01-14", "completed", 61.15], [1696, "Lukas Fischer", "Canada", "2025-01-13", "completed", 233], [1698, "Tom Okonkwo", "United Kingdom", "2025-01-13", "completed", 228.3], [1697, "Hannah Taylor", "Australia", "2025-01-13", "completed", 213.75], [1699, "Hugo M\xFCller", "Nigeria", "2025-01-13", "completed", 9], [1692, "Sophie Jones", "Germany", "2025-01-12", "completed", 263.8], [1695, "Lukas Kelly", "Nigeria", "2025-01-12", "completed", 247.15], [1691, "Sophie Martin", "United States", "2025-01-12", "completed", 243], [1693, "Freya Jones", "United States", "2025-01-12", "completed", 196.3], [1694, "James Fischer", "Germany", "2025-01-12", "completed", 18.7], [1689, "Clara Bello", "France", "2025-01-11", "completed", 177], [1687, "Sophie Jones", "Germany", "2025-01-11", "completed", 85], [1688, "Clara Schmidt", "United States", "2025-01-11", "completed", 45], [1690, "Omar Weber", "United States", "2025-01-11", "completed", 39.1], [1683, "Ada Visser", "Ireland", "2025-01-10", "completed", 392], [1686, "Ada Martin", "United Kingdom", "2025-01-10", "completed", 261], [1685, "Tom Murphy", "United Kingdom", "2025-01-10", "completed", 138], [1684, "Tom Okonkwo", "United Kingdom", "2025-01-10", "completed", 106], [1680, "Maya Wilson", "United States", "2025-01-09", "completed", 492], [1679, "Tom Bello", "United Kingdom", "2025-01-09", "cancelled", 166.65], [1682, "Noah Nguyen", "France", "2025-01-09", "completed", 120], [1681, "Chidi Okonkwo", "United Kingdom", "2025-01-09", "completed", 45], [1678, "Lukas Eze", "United Kingdom", "2025-01-08", "completed", 151.15], [1677, "Felix Moreau", "United States", "2025-01-08", "completed", 90], [1676, "Tom Okonkwo", "United Kingdom", "2025-01-08", "completed", 59], [1675, "Priya Adeyemi", "Australia", "2025-01-07", "completed", 308], [1673, "Amara Okafor", "Netherlands", "2025-01-07", "completed", 130.2], [1674, "Aisha Murphy", "Germany", "2025-01-07", "completed", 68.45], [1672, "Daniel Jones", "Germany", "2025-01-06", "completed", 246], [1669, "Leon Brown", "United Kingdom", "2025-01-06", "completed", 168.1], [1671, "Lukas Fischer", "Canada", "2025-01-06", "completed", 144.4], [1670, "Ada Visser", "Ireland", "2025-01-06", "completed", 129], [1667, "Sophie Weber", "Netherlands", "2025-01-05", "completed", 282], [1665, "Leon Nguyen", "United Kingdom", "2025-01-05", "completed", 231], [1666, "Sophie Martin", "United States", "2025-01-05", "completed", 192], [1668, "Lukas M\xFCller", "United States", "2025-01-05", "completed", 188], [1664, "Amara Eze", "Nigeria", "2025-01-05", "completed", 112], [1660, "Noah Visser", "United Kingdom", "2025-01-04", "completed", 3180], [1663, "Hannah Moreau", "United States", "2025-01-04", "completed", 524], [1661, "Leon Nguyen", "United Kingdom", "2025-01-04", "completed", 308], [1662, "Ines Clarke", "United States", "2025-01-04", "completed", 69], [1658, "Tom Jansen", "United States", "2025-01-03", "completed", 443], [1659, "Omar Okafor", "France", "2025-01-03", "completed", 382.6], [1656, "Daniel Jones", "Germany", "2025-01-03", "completed", 238.4], [1657, "Lukas Okafor", "United States", "2025-01-03", "cancelled", 129.5], [1654, "Hugo Murphy", "Germany", "2025-01-02", "completed", 540], [1655, "Sophie Weber", "Netherlands", "2025-01-02", "completed", 250.5], [1653, "Isla Brown", "Ireland", "2025-01-02", "completed", 35], [1652, "Daniel Jones", "Germany", "2025-01-01", "completed", 335.1], [1650, "Felix Patel", "United Kingdom", "2025-01-01", "completed", 249], [1651, "Noah Visser", "United Kingdom", "2025-01-01", "completed", 110], [1644, "Daniel Weber", "Nigeria", "2024-12-31", "completed", 308.45], [1643, "Tom Wilson", "Netherlands", "2024-12-31", "completed", 235.15], [1646, "Amara Nguyen", "Nigeria", "2024-12-31", "completed", 177.25], [1647, "Hugo Martin", "Nigeria", "2024-12-31", "cancelled", 163.95], [1645, "Maya Bello", "United Kingdom", "2024-12-31", "completed", 153], [1648, "Tunde Nguyen", "Ireland", "2024-12-31", "completed", 96], [1649, "Amara Kelly", "Spain", "2024-12-31", "completed", 24], [1635, "Sophie Jones", "Germany", "2024-12-30", "completed", 1358.75], [1638, "Tom Murphy", "United Kingdom", "2024-12-30", "completed", 1134], [1637, "Tom Bello", "United Kingdom", "2024-12-30", "completed", 279], [1640, "Felix Visser", "Germany", "2024-12-30", "completed", 249], [1642, "Sophie Jones", "Germany", "2024-12-30", "completed", 186], [1641, "Freya Okonkwo", "United Kingdom", "2024-12-30", "cancelled", 110], [1639, "Amara Patel", "France", "2024-12-30", "completed", 82], [1636, "Sophie Moreau", "Spain", "2024-12-30", "completed", 40.8], [1627, "Hannah Moreau", "United States", "2024-12-29", "completed", 554], [1633, "Hannah Taylor", "United Kingdom", "2024-12-29", "completed", 441.3], [1632, "Sophie Jones", "Germany", "2024-12-29", "completed", 351.5], [1631, "Maya Weber", "United States", "2024-12-29", "completed", 319], [1634, "Grace Nguyen", "United Kingdom", "2024-12-29", "completed", 268], [1628, "Ada Jones", "United Kingdom", "2024-12-29", "completed", 167], [1630, "Maya Smith", "Germany", "2024-12-29", "completed", 137.45], [1626, "Isla Brown", "Ireland", "2024-12-29", "completed", 127], [1629, "Elena Adeyemi", "Germany", "2024-12-29", "completed", 32], [1621, "Hannah Moreau", "United States", "2024-12-28", "refunded", 1212], [1625, "Mateo Fischer", "United Kingdom", "2024-12-28", "completed", 897], [1622, "Maya Jansen", "Netherlands", "2024-12-28", "completed", 368.8], [1618, "Ada Visser", "Ireland", "2024-12-28", "completed", 279], [1619, "Kofi Clarke", "United States", "2024-12-28", "completed", 175], [1623, "Leon Nguyen", "United Kingdom", "2024-12-28", "completed", 172.3], [1617, "Hugo Murphy", "Germany", "2024-12-28", "completed", 149], [1624, "Leon Jones", "United States", "2024-12-28", "completed", 60], [1620, "Hugo Murphy", "Germany", "2024-12-28", "completed", 55], [1610, "Tom Weber", "Spain", "2024-12-27", "completed", 882], [1612, "Sophie Moreau", "Germany", "2024-12-27", "completed", 438.6], [1608, "Emeka Taylor", "United Kingdom", "2024-12-27", "completed", 288], [1615, "Tom Murphy", "United Kingdom", "2024-12-27", "completed", 220], [1611, "Aisha Wilson", "Germany", "2024-12-27", "completed", 148.8], [1613, "Maya Schmidt", "Nigeria", "2024-12-27", "completed", 128.2], [1614, "James Bello", "Ireland", "2024-12-27", "completed", 123], [1609, "Leon Dubois", "United States", "2024-12-27", "completed", 91.8], [1616, "Tunde Adeyemi", "Germany", "2024-12-27", "completed", 61], [1607, "James Bello", "Ireland", "2024-12-26", "completed", 542], [1606, "Omar Weber", "United States", "2024-12-26", "completed", 344], [1603, "Grace Garc\xEDa", "United Kingdom", "2024-12-26", "completed", 333.15], [1601, "Tunde Nguyen", "Ireland", "2024-12-26", "completed", 174], [1604, "Tom Wilson", "Netherlands", "2024-12-26", "completed", 36.2], [1602, "Sophie Visser", "United States", "2024-12-26", "completed", 24], [1605, "Clara Visser", "France", "2024-12-26", "completed", 18], [1594, "Ines Clarke", "United States", "2024-12-25", "completed", 350], [1595, "Hannah Okonkwo", "Netherlands", "2024-12-25", "completed", 341.3], [1596, "Aisha Murphy", "Germany", "2024-12-25", "completed", 313], [1599, "Daniel Dubois", "Germany", "2024-12-25", "completed", 184.15], [1600, "Hugo M\xFCller", "Nigeria", "2024-12-25", "completed", 157], [1598, "Kofi Clarke", "United States", "2024-12-25", "completed", 118], [1597, "Sophie Moreau", "Germany", "2024-12-25", "completed", 102], [1587, "Sophie Bello", "France", "2024-12-24", "completed", 564], [1591, "Sophie Bello", "France", "2024-12-24", "completed", 343], [1592, "Clara Fischer", "United Kingdom", "2024-12-24", "completed", 249], [1588, "Freya Fischer", "United Kingdom", "2024-12-24", "completed", 236], [1590, "Elena Patel", "Nigeria", "2024-12-24", "completed", 197], [1593, "Maya Weber", "United States", "2024-12-24", "completed", 142], [1589, "Tunde Patel", "Netherlands", "2024-12-24", "completed", 82.75], [1580, "Felix Eze", "France", "2024-12-23", "completed", 549], [1581, "Hannah Murphy", "Nigeria", "2024-12-23", "cancelled", 346.55], [1582, "Emeka Smith", "Canada", "2024-12-23", "completed", 176], [1585, "Ada Jones", "United Kingdom", "2024-12-23", "completed", 116], [1583, "Amara Martin", "United Kingdom", "2024-12-23", "completed", 90.8], [1584, "Zara Smith", "France", "2024-12-23", "completed", 84], [1586, "Emeka Taylor", "United Kingdom", "2024-12-23", "cancelled", 59], [1571, "Ines Smith", "Spain", "2024-12-22", "refunded", 1090], [1575, "Priya Adeyemi", "Australia", "2024-12-22", "completed", 540], [1573, "Maya Bello", "United Kingdom", "2024-12-22", "completed", 313.4], [1572, "Maya Jones", "Canada", "2024-12-22", "completed", 268], [1577, "Daniel Jones", "Spain", "2024-12-22", "completed", 134.1], [1576, "Aisha Patel", "United Kingdom", "2024-12-22", "completed", 129], [1579, "Daniel Jones", "Germany", "2024-12-22", "completed", 60], [1574, "Elena Nguyen", "United Kingdom", "2024-12-22", "completed", 59], [1578, "Hugo Murphy", "Germany", "2024-12-22", "completed", 24], [1566, "Noah Weber", "Netherlands", "2024-12-21", "completed", 1376], [1568, "Elena Smith", "United Kingdom", "2024-12-21", "completed", 597], [1563, "Hugo Patel", "United Kingdom", "2024-12-21", "completed", 369.65], [1569, "Leon Jones", "United States", "2024-12-21", "completed", 308], [1567, "Sophie Weber", "Netherlands", "2024-12-21", "completed", 233], [1570, "Ines Patel", "Germany", "2024-12-21", "completed", 143], [1562, "Freya Fischer", "United Kingdom", "2024-12-21", "refunded", 129], [1564, "Sophie Jones", "Germany", "2024-12-21", "completed", 108], [1565, "Maya Nguyen", "Canada", "2024-12-21", "completed", 48], [1555, "Sophie Moreau", "Germany", "2024-12-20", "completed", 448.6], [1554, "Amara Jansen", "Germany", "2024-12-20", "completed", 281.3], [1560, "Hannah Moreau", "United States", "2024-12-20", "completed", 277], [1557, "Elena Smith", "United Kingdom", "2024-12-20", "refunded", 137], [1556, "Clara Schmidt", "United States", "2024-12-20", "completed", 113], [1558, "Grace Nguyen", "United Kingdom", "2024-12-20", "completed", 56.15], [1559, "Leon Wilson", "United States", "2024-12-20", "completed", 42.7], [1561, "Elena Nguyen", "United Kingdom", "2024-12-20", "completed", 28.9], [1551, "Priya Adeyemi", "Australia", "2024-12-19", "completed", 1056], [1550, "Elena Nguyen", "United Kingdom", "2024-12-19", "completed", 498], [1549, "Hugo Martin", "Nigeria", "2024-12-19", "cancelled", 290], [1553, "Ngozi Smith", "France", "2024-12-19", "completed", 233], [1547, "Ada Martin", "United Kingdom", "2024-12-19", "completed", 186], [1546, "Grace Nguyen", "Netherlands", "2024-12-19", "completed", 177], [1548, "Freya Fischer", "United Kingdom", "2024-12-19", "completed", 156], [1552, "Hugo Dubois", "Australia", "2024-12-19", "completed", 34], [1545, "Maya Brown", "Canada", "2024-12-18", "completed", 878], [1541, "Aisha Wilson", "Germany", "2024-12-18", "completed", 528.5], [1544, "Sophie Bello", "France", "2024-12-18", "completed", 388], [1543, "Lukas Visser", "Australia", "2024-12-18", "completed", 214.8], [1539, "Felix Patel", "United Kingdom", "2024-12-18", "completed", 196], [1542, "Leon Adeyemi", "United States", "2024-12-18", "completed", 154], [1540, "Lukas Dubois", "United States", "2024-12-18", "completed", 133], [1533, "Clara Fischer", "United Kingdom", "2024-12-17", "completed", 542.6], [1535, "Tunde Nguyen", "Ireland", "2024-12-17", "completed", 434], [1536, "Lukas Visser", "Nigeria", "2024-12-17", "completed", 227], [1532, "Amara Nguyen", "Nigeria", "2024-12-17", "completed", 177], [1537, "Tunde Nguyen", "Ireland", "2024-12-17", "completed", 45], [1534, "Ada Martin", "United Kingdom", "2024-12-17", "completed", 27], [1538, "Chidi Patel", "Canada", "2024-12-17", "completed", 12], [1528, "Mateo Murphy", "France", "2024-12-16", "completed", 1944], [1529, "Priya Brown", "United Kingdom", "2024-12-16", "completed", 618.65], [1525, "Emeka Weber", "United States", "2024-12-16", "completed", 315], [1526, "Omar Okafor", "France", "2024-12-16", "completed", 283], [1531, "Amara Eze", "Nigeria", "2024-12-16", "cancelled", 216], [1530, "Clara Dubois", "United States", "2024-12-16", "completed", 55], [1527, "Grace Nguyen", "United Kingdom", "2024-12-16", "completed", 38], [1519, "Emeka Weber", "United States", "2024-12-15", "completed", 634], [1521, "James Fischer", "Germany", "2024-12-15", "completed", 573], [1516, "Ada Brown", "United Kingdom", "2024-12-15", "completed", 425], [1520, "Tunde Nguyen", "Ireland", "2024-12-15", "completed", 174], [1523, "Ada Visser", "Ireland", "2024-12-15", "completed", 166], [1517, "Amara Patel", "France", "2024-12-15", "completed", 158], [1524, "Amara Martin", "United Kingdom", "2024-12-15", "completed", 141.5], [1522, "Noah Visser", "United States", "2024-12-15", "refunded", 53.1], [1518, "Tunde Nguyen", "Ireland", "2024-12-15", "refunded", 23], [1512, "Tom Wilson", "Netherlands", "2024-12-14", "completed", 534], [1507, "Grace Nguyen", "United Kingdom", "2024-12-14", "completed", 320], [1515, "Ben Garc\xEDa", "United States", "2024-12-14", "cancelled", 254.8], [1506, "Elena Nguyen", "United Kingdom", "2024-12-14", "completed", 208], [1509, "Isla Jones", "United States", "2024-12-14", "completed", 111], [1511, "Kofi Jones", "United States", "2024-12-14", "completed", 84], [1508, "Hugo Dubois", "Australia", "2024-12-14", "completed", 82], [1513, "Freya Fischer", "United Kingdom", "2024-12-14", "completed", 82], [1510, "Noah Taylor", "France", "2024-12-14", "completed", 72], [1514, "Elena M\xFCller", "United Kingdom", "2024-12-14", "cancelled", 19], [1501, "Tom Weber", "Spain", "2024-12-13", "completed", 1723], [1502, "Noah Visser", "United Kingdom", "2024-12-13", "completed", 1074], [1497, "Noah Weber", "Netherlands", "2024-12-13", "cancelled", 573.6], [1499, "Kofi Clarke", "United States", "2024-12-13", "completed", 376], [1500, "Tom Okonkwo", "United Kingdom", "2024-12-13", "completed", 294], [1505, "Ines Clarke", "United States", "2024-12-13", "completed", 251.45], [1498, "Aisha Taylor", "Germany", "2024-12-13", "completed", 212.6], [1503, "Tunde Nguyen", "Ireland", "2024-12-13", "completed", 180.55], [1504, "Tom Murphy", "United Kingdom", "2024-12-13", "completed", 144], [1496, "Tom Okonkwo", "United Kingdom", "2024-12-12", "cancelled", 507]], rowCount: 2495, truncated: true, elapsedMs: 3.007 }, "SELECT event_id, user_id, event, ts, item_id, category, amount\nFROM events\nWHERE user_id = 12\nLIMIT 9": { columns: ["event_id", "user_id", "event", "ts", "item_id", "category", "amount"], types: ["integer", "integer", "text", "timestamp", "integer", "text", "real"], rows: [[49, 12, "signup", "2025-01-11 13:54:33", null, null, null], [444, 12, "view_item", "2025-01-24 13:38:49", 23, "Home", null], [445, 12, "view_item", "2025-01-24 13:40:33", 36, "Stationery", null], [446, 12, "view_item", "2025-01-24 13:41:49", 3, "Audio", null], [447, 12, "view_item", "2025-01-24 13:44:13", 30, "Outdoors", null], [448, 12, "view_item", "2025-01-24 13:46:21", 23, "Home", null], [449, 12, "view_item", "2025-01-24 13:46:40", 2, "Audio", null], [484, 12, "view_item", "2025-01-25 10:52:11", 2, "Audio", null], [486, 12, "view_item", "2025-01-25 10:53:36", 17, "Home", null]], rowCount: 9, truncated: false, elapsedMs: 0.024 }, "SELECT nme, country\nFROM customers\nWHERE segment = 'enterprise'": { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 5e-3, error: "no such column: nme" }, "UPDATE orders SET status = 'completed' WHERE status = 'processing'": { columns: [], types: [], rows: [], rowCount: 0, truncated: false, changes: 22, elapsedMs: 0.077 }, "SELECT round(sum(quantity * unit_price), 2) AS revenue\nFROM order_items": { columns: ["revenue"], types: ["real"], rows: [[643545.2]], rowCount: 1, truncated: false, elapsedMs: 0.292 }, "SELECT p.category, round(sum(i.quantity * i.unit_price)) AS revenue FROM order_items i JOIN products p USING (product_id) GROUP BY 1 ORDER BY 2 DESC": { columns: ["category", "revenue"], types: ["text", "real"], rows: [["Audio", 192122], ["Computing", 167349], ["Outdoors", 144885], ["Home", 103194], ["Stationery", 35995]], rowCount: 5, truncated: false, elapsedMs: 1.548 }, "SELECT count(DISTINCT CASE WHEN event = 'signup' THEN user_id END) AS signed_up, count(DISTINCT CASE WHEN event = 'view_item' THEN user_id END) AS viewed, count(DISTINCT CASE WHEN event = 'add_to_cart' THEN user_id END) AS added_to_cart, count(DISTINCT CASE WHEN event = 'checkout_started' THEN user_id END) AS started_checkout, count(DISTINCT CASE WHEN event = 'purchase' THEN user_id END) AS purchased FROM events": { columns: ["signed_up", "viewed", "added_to_cart", "started_checkout", "purchased"], types: ["integer", "integer", "integer", "integer", "integer"], rows: [[800, 714, 547, 417, 295]], rowCount: 1, truncated: false, elapsedMs: 8.983 }, "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders FROM orders GROUP BY 1 ORDER BY 1": { columns: ["month", "orders"], types: ["text", "integer"], rows: [["2024-01", 90], ["2024-02", 85], ["2024-03", 111], ["2024-04", 111], ["2024-05", 126], ["2024-06", 131], ["2024-07", 127], ["2024-08", 133], ["2024-09", 134], ["2024-10", 150], ["2024-11", 203], ["2024-12", 248], ["2025-01", 118], ["2025-02", 106], ["2025-03", 141], ["2025-04", 149], ["2025-05", 167], ["2025-06", 165]], rowCount: 18, truncated: false, elapsedMs: 0.611 }, "SELECT c.country, count(DISTINCT c.customer_id) AS customers, count(DISTINCT o.order_id) / 10 AS orders_in_tens FROM customers c LEFT JOIN orders o USING (customer_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 8": { columns: ["country", "customers", "orders_in_tens"], types: ["text", "integer", "integer"], rows: [["United States", 73, 66], ["United Kingdom", 73, 49], ["Germany", 33, 28], ["France", 27, 21], ["Nigeria", 22, 18], ["Canada", 18, 17], ["Australia", 17, 14], ["Netherlands", 15, 13]], rowCount: 8, truncated: false, elapsedMs: 0.687 }, "SELECT p.name, sum(i.quantity) AS units\nFROM order_items i JOIN products p USING (product_id)\nGROUP BY 1 ORDER BY 2 DESC": { columns: ["name", "units"], types: ["text", "integer"], rows: [["Dotted notebook", 493], ["Wireless earbuds", 440], ["Pour-over kettle", 400], ["Cast-iron pan", 377], ["Mechanical keyboard", 376], ["Two-person tent", 348], ["Over-ear headphones", 338], ["Fountain pen", 338], ["Weekly planner", 310], ["Insulated bottle", 309], ["Ergonomic mouse", 306], ["Bluetooth speaker", 303], ["Trail backpack", 296], ["Linen throw", 279], ["Studio microphone", 274], ["Gel pen set", 274], ["27-inch monitor", 270], ["Turntable", 267], ["Sticky notes pack", 266], ["Ceramic mug set", 260], ["Head torch", 258], ["Camping stove", 236], ["Webcam", 232], ["Portable SSD 1TB", 232], ["Desk lamp", 224], ["Soundbar", 223], ["Desk organiser", 213], ["Trekking poles", 207], ["USB-C hub", 197], ["Sleeping bag", 197], ["Laptop stand", 189], ["Clip-on radio", 188], ["Highlighter set", 181], ["Wall clock", 180], ["Air purifier", 171], ["Scented candle", 169], ["Desk mat", 166], ["Headphone stand", 163], ["A3 sketchbook", 163], ["Picnic blanket", 154]], rowCount: 40, truncated: false, elapsedMs: 1.347 }, "SELECT date(o.order_date, 'weekday 0', '-6 days') AS week, round(sum(i.quantity * i.unit_price)) AS revenue FROM orders o JOIN order_items i USING (order_id) GROUP BY 1 ORDER BY 1": { columns: ["week", "revenue"], types: ["text", "real"], rows: [["2024-01-01", 6299], ["2024-01-08", 4165], ["2024-01-15", 4976], ["2024-01-22", 5962], ["2024-01-29", 5306], ["2024-02-05", 5128], ["2024-02-12", 4787], ["2024-02-19", 7045], ["2024-02-26", 5665], ["2024-03-04", 7421], ["2024-03-11", 5990], ["2024-03-18", 8208], ["2024-03-25", 8005], ["2024-04-01", 5592], ["2024-04-08", 5446], ["2024-04-15", 5884], ["2024-04-22", 5849], ["2024-04-29", 8621], ["2024-05-06", 6750], ["2024-05-13", 8361], ["2024-05-20", 8513], ["2024-05-27", 6140], ["2024-06-03", 7410], ["2024-06-10", 8583], ["2024-06-17", 8355], ["2024-06-24", 9357], ["2024-07-01", 7953], ["2024-07-08", 6065], ["2024-07-15", 9740], ["2024-07-22", 6228], ["2024-07-29", 6059], ["2024-08-05", 4755], ["2024-08-12", 7283], ["2024-08-19", 9554], ["2024-08-26", 5702], ["2024-09-02", 6133], ["2024-09-09", 8775], ["2024-09-16", 7213], ["2024-09-23", 4061], ["2024-09-30", 9357], ["2024-10-07", 8838], ["2024-10-14", 10444], ["2024-10-21", 7826], ["2024-10-28", 10292], ["2024-11-04", 11007], ["2024-11-11", 14451], ["2024-11-18", 9811], ["2024-11-25", 12015], ["2024-12-02", 14967], ["2024-12-09", 15150], ["2024-12-16", 17370], ["2024-12-23", 14419], ["2024-12-30", 12396], ["2025-01-06", 4530], ["2025-01-13", 5624], ["2025-01-20", 7075], ["2025-01-27", 4927], ["2025-02-03", 9863], ["2025-02-10", 9386], ["2025-02-17", 7261], ["2025-02-24", 6319], ["2025-03-03", 10566], ["2025-03-10", 9042], ["2025-03-17", 9915], ["2025-03-24", 7473], ["2025-03-31", 9412], ["2025-04-07", 7473], ["2025-04-14", 9272], ["2025-04-21", 7121], ["2025-04-28", 7191], ["2025-05-05", 9160], ["2025-05-12", 8610], ["2025-05-19", 14154], ["2025-05-26", 7816], ["2025-06-02", 11430], ["2025-06-09", 10864], ["2025-06-16", 7747], ["2025-06-23", 7942], ["2025-06-30", 1692]], rowCount: 79, truncated: false, elapsedMs: 1.491 }, "SELECT strftime('%Y-%m', ts) AS month, platform, count(*) AS purchases FROM events WHERE event = 'purchase' GROUP BY 1, 2 ORDER BY 1, 2": { columns: ["month", "platform", "purchases"], types: ["text", "text", "integer"], rows: [["2025-01", "android", 1], ["2025-01", "ios", 5], ["2025-01", "web", 4], ["2025-02", "android", 8], ["2025-02", "ios", 14], ["2025-02", "web", 15], ["2025-03", "android", 7], ["2025-03", "ios", 22], ["2025-03", "web", 11], ["2025-04", "android", 12], ["2025-04", "ios", 22], ["2025-04", "web", 30], ["2025-05", "android", 21], ["2025-05", "ios", 43], ["2025-05", "web", 33], ["2025-06", "android", 23], ["2025-06", "ios", 50], ["2025-06", "web", 35], ["2025-07", "android", 14], ["2025-07", "ios", 22], ["2025-07", "web", 19]], rowCount: 21, truncated: false, elapsedMs: 0.222 }, "WITH active AS (SELECT DISTINCT e.user_id, CAST((julianday(date(e.ts)) - julianday(u.signup_date)) / 7 AS INTEGER) AS week FROM events e JOIN users u USING (user_id)), sized AS (SELECT w.week, (SELECT count(*) FROM users WHERE julianday('2025-07-14') - julianday(signup_date) >= (w.week + 1) * 7) AS cohort FROM (SELECT DISTINCT week FROM active) w) SELECT a.week, round(100.0 * count(*) / s.cohort, 1) AS percent_active FROM active a JOIN sized s USING (week) JOIN users u USING (user_id) WHERE julianday('2025-07-14') - julianday(u.signup_date) >= (a.week + 1) * 7 AND a.week <= 12 GROUP BY a.week ORDER BY a.week": { columns: ["week", "percent_active"], types: ["integer", "real"], rows: [[0, 100], [1, 38.4], [2, 35.3], [3, 29], [4, 25.9], [5, 25.4], [6, 21.2], [7, 23.2], [8, 17.9], [9, 15.4], [10, 13.6], [11, 13.5], [12, 13.9]], rowCount: 13, truncated: false, elapsedMs: 5.704 }, "SELECT p.name, p.price, sum(i.quantity) AS units FROM order_items i JOIN products p USING (product_id) GROUP BY p.product_id": { columns: ["name", "price", "units"], types: ["text", "real", "integer"], rows: [["Wireless earbuds", 59, 440], ["Over-ear headphones", 129, 338], ["Bluetooth speaker", 45, 303], ["Studio microphone", 89, 274], ["Turntable", 179, 267], ["Soundbar", 149, 223], ["Clip-on radio", 24, 188], ["Headphone stand", 19, 163], ["Mechanical keyboard", 95, 376], ["Ergonomic mouse", 39, 306], ["27-inch monitor", 249, 270], ["USB-C hub", 34, 197], ["Laptop stand", 42, 189], ["Webcam", 65, 232], ["Portable SSD 1TB", 99, 232], ["Desk mat", 18, 166], ["Pour-over kettle", 55, 400], ["Cast-iron pan", 48, 377], ["Linen throw", 62, 279], ["Desk lamp", 36, 224], ["Ceramic mug set", 28, 260], ["Air purifier", 139, 171], ["Scented candle", 16, 169], ["Wall clock", 32, 180], ["Two-person tent", 189, 348], ["Trail backpack", 85, 296], ["Insulated bottle", 22, 309], ["Head torch", 27, 258], ["Camping stove", 58, 236], ["Sleeping bag", 74, 197], ["Trekking poles", 46, 207], ["Picnic blanket", 29, 154], ["Dotted notebook", 12, 493], ["Fountain pen", 38, 338], ["Weekly planner", 17, 310], ["Gel pen set", 9, 274], ["Sticky notes pack", 6, 266], ["Desk organiser", 23, 213], ["Highlighter set", 7, 181], ["A3 sketchbook", 14, 163]], rowCount: 40, truncated: false, elapsedMs: 0.825 }, "SELECT strftime('%Y-%W', signup_date) AS week, count(*) AS signups FROM user GROUP BY 1": { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 4e-3, error: "no such table: user" }, "SELECT name, country, segment FROM customers LIMIT 4": { columns: ["name", "country", "segment"], types: ["text", "text", "text"], rows: [["Tunde Nguyen", "Ireland", "small business"], ["Noah Fischer", "United States", "small business"], ["Hannah Bello", "France", "consumer"], ["James Fischer", "Germany", "consumer"]], rowCount: 4, truncated: false, elapsedMs: 7e-3 }, "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders, count(DISTINCT customer_id) AS customers FROM orders GROUP BY 1 ORDER BY 1": { columns: ["month", "orders", "customers"], types: ["text", "integer", "integer"], rows: [["2024-01", 90, 65], ["2024-02", 85, 57], ["2024-03", 111, 71], ["2024-04", 111, 72], ["2024-05", 126, 76], ["2024-06", 131, 81], ["2024-07", 127, 84], ["2024-08", 133, 89], ["2024-09", 134, 87], ["2024-10", 150, 91], ["2024-11", 203, 114], ["2024-12", 248, 127], ["2025-01", 118, 77], ["2025-02", 106, 79], ["2025-03", 141, 106], ["2025-04", 149, 98], ["2025-05", 167, 116], ["2025-06", 165, 109]], rowCount: 18, truncated: false, elapsedMs: 0.798 } } };

  // design/prototype/lab/harness.ts
  var params = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = params.get("theme") ?? "light";
  var width = Number(params.get("w") ?? 420);
  var set = params.get("set") ?? "bars";
  var results = fixtures_default.results;
  window.tide = {
    lab: {
      query: async (_id, sql) => results[sql.trim()] ?? { columns: [], types: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 0.1, error: "The harness only knows the queries it was built with." },
      schema: async () => [],
      reset: async () => {
      }
    }
  };
  var page = document.getElementById("page");
  page.style.setProperty("--w", `${width}px`);
  var wanted = fixtures_default.blocks.filter((b) => b.set === set);
  for (const b of wanted) {
    const cell = document.createElement("section");
    const label = document.createElement("h2");
    label.textContent = b.name;
    const prose = document.createElement("div");
    prose.className = "prose msg-prose";
    const pre = document.createElement("pre");
    pre.className = "code-block";
    pre.dataset.lang = b.lang;
    const code = document.createElement("code");
    code.className = "hljs";
    code.textContent = b.body;
    pre.append(code);
    prose.append(pre);
    cell.append(label, prose);
    cell.dataset.then = (b.then ?? []).join(",");
    page.append(cell);
  }
  startLab();
  var press = (root, text2) => [...root.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(text2))?.click();
  setTimeout(() => {
    for (const cell of page.querySelectorAll("section")) press(cell, "Run");
    setTimeout(() => {
      for (const cell of page.querySelectorAll("section")) for (const t of (cell.dataset.then ?? "").split(",").filter(Boolean)) press(cell, t);
      if (params.get("hover") !== "0") {
        for (const plot of page.querySelectorAll(".lab-plot")) {
          const box = plot.getBoundingClientRect();
          plot.dispatchEvent(new PointerEvent("pointermove", { clientX: box.left + box.width * 0.62, clientY: box.top + box.height * 0.45, bubbles: true }));
        }
      }
    }, 300);
  }, 900);
})();
