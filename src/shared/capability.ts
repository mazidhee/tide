/**
 * Capability honesty: when a topic needs something Tide can't do (a lab bench, a physical skill,
 * a language whose toolchain is missing, live market data, real hardware), the tutor says so in
 * one line and offers the best substitute. Decided here, from the subject's profile, the topic's
 * words and what this Mac can run (main/subjects gathers that from the runner and the lab).
 */
import type { SubjectProfile } from "./subjects";
import type { Need } from "./subjectMap";
import { trackPack, type TrackPackId } from "./trackPacks";

export interface CapabilityStatus {
  /** Languages whose toolchain answered, by runner id (python, javascript, c, rust, go...) */
  languages: { id: string; name: string; ready: boolean; install: string }[];
  /** Python with SymPy, for exact maths checks */
  maths: boolean;
  /** The lab pack (PyTorch, scikit-learn, SciPy, pytest) */
  labPack: boolean;
  /** Web search is on for this lesson */
  web: boolean;
  /** The track packs, installed or not (absent: not known, nothing is said) */
  packs?: Partial<Record<TrackPackId, boolean>>;
}

export interface Gap {
  need: Need | "maths" | "lab-pack" | `pack:${TrackPackId}`;
  /** One line for the tutor to say, with the substitute */
  line: string;
}

/** Languages a topic may name, to the runner's id; one not run here at all maps to '' */
const LANGUAGE_WORDS: [RegExp, string, string][] = [
  [/\brust\b/i, "rust", "Rust"],
  [/\b(golang|go language|goroutines?|go programming)\b/i, "go", "Go"],
  [/\bswift(ui)?\b(?! (messages?|network|gpi|codes?|mt))/i, "swift", "Swift"],
  [/\bjava\b(?!script)/i, "java", "Java"],
  [/\bruby\b|\brails\b/i, "ruby", "Ruby"],
  [/\bkotlin\b/i, "", "Kotlin"],
  [/\bhaskell\b/i, "", "Haskell"],
  [/\bocaml\b/i, "", "OCaml"],
  [/\belixir\b|\berlang\b/i, "", "Elixir and Erlang"],
  [/\bscala\b/i, "", "Scala"],
  [/\bc#|\.net\b/i, "", "C#"],
  [/\bphp\b/i, "", "PHP"],
  [/\bzig\b/i, "", "Zig"],
  [/\bjulia\b/i, "", "Julia"],
  [/\blua\b/i, "", "Lua"],
  [/\bdart\b|\bflutter\b/i, "", "Dart"],
  [/\bclojure\b|\blisp\b|\bscheme\b/i, "", "Lisp"],
];

const PHYSICAL_LINE =
  "This is a physical skill: it can't be practised in Tide. I'll teach the technique and the faults to watch for, and give you a practice plan with drills and checkpoints to do away from the screen.";

/** What a topic needs that this Mac can't give, each with its substitute: the tested decision */
export function capabilityGaps(
  topic: string,
  p: SubjectProfile,
  s: CapabilityStatus,
): Gap[] {
  const out: Gap[] = [];
  const needs = new Set<Need>(p.needs ?? []);
  if (p.kinds.includes("physical")) needs.add("body");
  const t = topic.toLowerCase();
  // A practical in the topic's own words: titration, dissection, "lab experiment"
  if (
    /\b(titrations?|dissections?|lab(oratory)? (experiments?|practicals?|work)|practicals?|wet lab|pipett\w*|gel electrophoresis|pcr|culturing)\b/.test(
      t,
    )
  )
    needs.add("wet-lab");
  if (
    /\b(live|real[- ]time|today'?s|current) (prices?|quotes?|market data|order books?|feeds?)\b|\b(day trading|trading bot|order book)\b/.test(
      t,
    )
  )
    needs.add("live-data");

  for (const need of needs) {
    if (need === "wet-lab") {
      // A theory topic in a lab science doesn't need a bench; only a practical one does
      const practical =
        /\b(titrations?|dissections?|experiments?|practicals?|lab(oratory)?|pipett\w*|electrophoresis|pcr|culturing|measur\w+|synthes\w+ of)\b/.test(
          t,
        );
      if (practical)
        out.push({
          need,
          line: "Tide can't run a wet-lab experiment. Substitute: we work it through with real published data, run the numbers in Python, use a simulation where one fits, and write the method and safety steps out so you can do it at a real bench.",
        });
    } else if (need === "body") out.push({ need, line: PHYSICAL_LINE });
    else if (need === "instrument") {
      if (!needs.has("body"))
        out.push({
          need,
          line: "Tide can't hear you play. I'll teach the theory and notation, and give you a practice plan; record yourself and describe what you hear for feedback.",
        });
    } else if (need === "live-data") {
      if (
        /\b(live|real[- ]time|current|today'?s|trading|prices?|quotes?|market data|order books?)\b/.test(
          t,
        )
      )
        out.push({
          need,
          line: `Tide has no live market data feed${s.web ? " (web search gives dated snapshots, which I will date)" : ""}. Substitute: a historical dataset loaded into the SQL lab (a CSV you download, with load_table), so every figure is real and reproducible.`,
        });
    } else if (need === "hardware")
      out.push({
        need,
        line: "Tide can't reach real hardware (a board, a circuit, a robot). Substitute: the logic in C or Python that runs here, simulated inputs, and a parts list to try it on a real board.",
      });
    else if (need === "engine") {
      if (
        /\b(godot|unity|unreal|engine|editor|scene|gdscript|blueprints?)\b/.test(
          t,
        )
      )
        out.push({
          need,
          line: "Tide can't run a game engine's editor. Substitute: the same idea in code that runs here (a game loop and a physics step in Python or JavaScript), with engine code shown exactly as written and marked not run; install the engine to try it.",
        });
    } else if (need === "gpu") {
      if (/\b(cuda|gpu|shaders?|vulkan|metal|webgpu|kernels?)\b/.test(t))
        out.push({
          need,
          line: "Tide can't run GPU code (shaders, CUDA). Substitute: the same maths run on the CPU in Python or C so every number is checked, with the GPU code shown as written and marked not run.",
        });
    } else if (need === "clinic")
      out.push({
        need,
        line: "Tide teaches medicine; it never advises on a real case. Cases here are textbook scenarios, checked against NIH and WHO sources.",
      });
  }

  // A language the topic names that won't run on this Mac
  for (const [re, id, name] of LANGUAGE_WORDS) {
    if (!re.test(topic)) continue;
    if (!id)
      out.push({
        need: `lang:${name.toLowerCase()}`,
        line: `${name} doesn't run in Tide. Substitute: I'll show ${name} exactly as written, marked not run, and run the same idea in Python or another language that runs here.`,
      });
    else {
      const lang = s.languages.find((l) => l.id === id);
      if (lang && !lang.ready)
        out.push({
          need: `lang:${id}`,
          line: `${lang.name} isn't installed on this Mac, so its code won't run here yet. Install ${lang.install || "its toolchain"}; until then I'll show the code as written, marked not run.`,
        });
    }
    break;
  }

  if (p.kinds.includes("quant") && !s.maths)
    out.push({
      need: "maths",
      line: "Exact maths checks (Python with SymPy) aren't set up, so I can't run the algebra to check it. Set it up in Settings › Tools › Maths checker; until then I'll work every step by hand and show it.",
    });
  if (
    /\b(pytorch|torch|scikit|sklearn|scipy|pytest)\b/i.test(topic) &&
    !s.labPack
  )
    out.push({
      need: "lab-pack",
      line: "The lab pack (PyTorch, scikit-learn, SciPy, pytest) isn't installed, so that code won't run yet. Add it in Settings › Tools; until then I'll show it marked not run.",
    });
  out.push(...packGaps(topic, s));
  return out;
}

/** Topics a track pack makes hands-on, and what the lesson does until it is installed */
const PACK_TOPICS: { id: TrackPackId; words: RegExp; what: string; meanwhile: string }[] = [
  {
    id: "foundry",
    words: /\b(solidity|foundry|forge test|smart contracts?|evm|erc-?20|erc-?721|anvil|hardhat|vyper)\b/i,
    what: "Solidity can't be compiled, tested or deployed to a local chain here yet",
    meanwhile: "I'll show Solidity exactly as written, marked not run, and run the same logic in Python where it helps",
  },
  {
    id: "bigdata",
    words: /\b(spark|pyspark|kafka|stream processing|structured streaming|dataframes? at scale|rdds?|consumer groups?|topics? and partitions)\b/i,
    what: "Spark jobs and Kafka topics can't run here yet",
    meanwhile: "I'll run the same ideas on one machine with pandas or DuckDB and plain Python queues, and show Spark and Kafka code as written, marked not run",
  },
  {
    id: "postgres",
    words: /\b(postgres(ql)?|explain analy[sz]e|isolation levels?|mvcc|vacuum|jsonb|row[- ]level locks?|serializable|repeatable read|pg_\w+|b-?tree index(es)?|query planner)\b/i,
    what: "real Postgres isn't set up, so its planner, isolation levels and locks can't be shown live",
    meanwhile: "I'll use the SQLite lab for the SQL itself and show Postgres-only features and plans as written, marked not run",
  },
  {
    id: "cpp",
    words: /\b(cmake|ctest|clangd)\b/i,
    what: "CMake isn't installed, so a CMake build can't run here yet (single files still compile with clang)",
    meanwhile: "I'll build with clang directly and show the CMake files as written",
  },
];

/** One line per track pack the topic needs that isn't installed, saying where to add it */
export function packGaps(topic: string, s: Pick<CapabilityStatus, "packs">): Gap[] {
  const out: Gap[] = [];
  for (const p of PACK_TOPICS) {
    if (s.packs?.[p.id] !== false || !p.words.test(topic)) continue;
    const pack = trackPack(p.id)!;
    out.push({
      need: `pack:${p.id}`,
      line: `The ${pack.title} isn't installed, so ${p.what}. Offer it once: it installs in ${pack.where} (${pack.download} to download, ${pack.size} on disk, into Tide's own tools folder). Until then ${p.meanwhile}.`,
    });
  }
  return out;
}

/** The hidden note a lesson's first turn carries: '' when nothing is missing */
export function capabilityNote(
  topic: string,
  p: SubjectProfile,
  s: CapabilityStatus,
): string {
  const gaps = capabilityGaps(topic, p, s);
  if (!gaps.length) return "";
  return `What Tide can't do for this topic. Say it once, in one line each, early in the lesson, then teach with the substitute; don't apologise or repeat it:\n${gaps.map((g) => `- ${g.line}`).join("\n")}`;
}
