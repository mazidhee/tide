/**
 * Track tool packs: one-click installs that make a track hands-on. Each is added only when the
 * learner presses Install (Settings › Tools, or the card a lesson shows when it needs one), runs in
 * the background with progress, and lands in Tide's own tools folder; nothing is installed into
 * the system. Python libraries go into Tide's own Python, like the lab and quant packs.
 *
 * - C++: clang, clangd and lldb-dap come with Apple's command-line tools, which Tide only detects
 *   (and offers `xcode-select --install`, Apple's own dialog); the pack adds CMake.
 * - Foundry: forge, cast, anvil and chisel, the Solidity compiler they build with (Foundry would
 *   otherwise fetch it on first use, and lessons run with no network), and forge-std for tests.
 * - Big data: a portable Temurin JRE for Spark, PySpark and kafka-python in Tide's Python, and
 *   Nisshi, a Kafka-compatible broker in one binary (no JVM). Redpanda was the first choice, but
 *   its broker is under the Business Source License and has no macOS build at all (on a Mac it
 *   runs in Docker), so it can't be a one-click local install; Nisshi (Apache-2.0, formerly
 *   Tansu) speaks the Kafka protocol and keeps topics in memory.
 * - Postgres: PostgreSQL's own server binaries, as packaged for embedding by zonky (the build
 *   embedded-postgres uses), with a database per lesson, and a learner role that is not a superuser.
 * - Run tracker: built in. MLflow pulls in a web server, a database layer and 90 packages
 *   (measured into a fresh environment: about 150 MB to download, 688 MB on disk) and runs a server
 *   of its own, to show what a small JSON-lines file per run and a chart in the notebook show here.
 *
 * Sizes were measured installing each pack into an empty scratch tools folder on an Apple silicon
 * Mac (test/trackPacks.test.ts does it again when TIDE_PACK_CACHE holds the downloads).
 */

export type TrackPackId = 'cpp' | 'foundry' | 'bigdata' | 'postgres' | 'runs'
export type MacArch = 'arm64' | 'x64'

/** One download: an archive or a single binary */
export interface PackFile {
  id: string
  name: string
  version: string
  url: Partial<Record<MacArch, string>>
  /** SHA-256 where the publisher gives one; SHA-1 where only that is published (Maven Central) */
  sha256?: Partial<Record<MacArch, string>>
  sha1?: Partial<Record<MacArch, string>>
  /** Download size in bytes, for progress and the free-space check */
  bytes: Partial<Record<MacArch, number>>
  /** tar: a .tar.gz or .tar.xz; jar-txz: a Maven jar holding one .txz; binary: the file itself */
  unpack: 'tar' | 'jar-txz' | 'binary'
  /** Where it goes, under the pack's folder */
  into: string
  /** For tar: leading path parts to drop, and only the paths (after stripping) to keep */
  strip?: number
  only?: string[]
  /** For a binary: its name in `into` */
  as?: string
  /** Universal binaries thinned to this Mac's architecture with lipo, when Apple's tools are there */
  thin?: string[]
}

export interface TrackPack {
  id: TrackPackId
  title: string
  /** The ready roadmaps (shared/finance/roadmaps) it makes hands-on */
  roadmaps: string[]
  /** One line: what it lets lessons and projects do */
  about: string
  contents: string
  /** Measured, as shown before installing */
  download: string
  size: string
  /** Free space asked for: the pack, its downloads and room to unpack */
  needsBytes: number
  where: string
  /** Its folder under Tide's tools folder; '' for one with nothing to download */
  folder: string
  files: PackFile[]
  /** pip packages for Tide's own Python, and the names they import as */
  python?: { packages: string[]; modules: string[] }
}

const GH = 'https://github.com'

export const FOUNDRY = { version: '1.9.0', solc: '0.8.38', forgeStd: '1.17.0' }
export const JRE = { version: '21.0.13+9' }
export const NISSHI = { version: '0.8.2' }
export const POSTGRES = { version: '18.6.0' }
export const CMAKE = { version: '4.5.0' }

export const TRACK_PACKS: TrackPack[] = [
  {
    id: 'cpp',
    title: 'C++ pack',
    roadmaps: ['cpp'],
    about: 'C++ lessons and projects: clang with sanitizers, clangd, lldb-dap and CMake builds',
    contents: 'CMake, with clang, clangd and lldb-dap from Apple’s command-line tools',
    // CMake's command-line programs and modules, thinned to this Mac: 92.8 MB down, 51 MB on disk
    download: 'about 93 MB',
    size: 'about 51 MB',
    needsBytes: 400_000_000,
    where: 'Settings › Tools › C++ pack',
    folder: 'cpp',
    files: [
      {
        id: 'cmake',
        name: 'CMake',
        version: CMAKE.version,
        url: { arm64: `${GH}/Kitware/CMake/releases/download/v4.5.0/cmake-4.5.0-macos-universal.tar.gz`, x64: `${GH}/Kitware/CMake/releases/download/v4.5.0/cmake-4.5.0-macos-universal.tar.gz` },
        sha256: { arm64: 'a645d69fd21e521759cc0c64e7c60462d43faf0c7214ac05f75c80f7c5037dde', x64: 'a645d69fd21e521759cc0c64e7c60462d43faf0c7214ac05f75c80f7c5037dde' },
        bytes: { arm64: 92_795_915, x64: 92_795_915 },
        unpack: 'tar',
        into: 'cmake',
        // The command-line programs and their modules; not the Qt window, the manuals or cpack
        strip: 3,
        only: ['bin/cmake', 'bin/ctest', 'share/cmake-4.5', 'doc/cmake/LICENSE.rst'],
        thin: ['bin/cmake', 'bin/ctest']
      }
    ]
  },
  {
    id: 'foundry',
    title: 'Foundry pack',
    roadmaps: ['blockchain-engineering', 'blockchain', 'stablecoins'],
    about: 'Solidity lessons and projects: forge test in the sandbox, a local anvil chain, and the Solidity language server',
    contents: 'Foundry (forge, cast, anvil, chisel), the Solidity compiler and forge-std',
    // 153.5 MB down; 282 MB on disk (forge alone is 99 MB)
    download: 'about 153 MB',
    size: 'about 282 MB',
    needsBytes: 800_000_000,
    where: 'Settings › Tools › Foundry pack',
    folder: 'foundry',
    files: [
      {
        id: 'foundry',
        name: 'Foundry',
        version: FOUNDRY.version,
        url: { arm64: `${GH}/foundry-rs/foundry/releases/download/v1.9.0/foundry_v1.9.0_darwin_arm64.tar.gz`, x64: `${GH}/foundry-rs/foundry/releases/download/v1.9.0/foundry_v1.9.0_darwin_amd64.tar.gz` },
        sha256: { arm64: '38f9af72b266c38ce2e4dfc659ae9cbd1f78c01b34738a76b6c4cb9610579426', x64: '88f234f458652878499d9e363dea37eb06653a948dbe709adef8d8389e0a9025' },
        bytes: { arm64: 122_020_568, x64: 133_899_711 },
        unpack: 'tar',
        into: 'bin',
        only: ['forge', 'cast', 'anvil', 'chisel']
      },
      {
        id: 'solc',
        name: 'the Solidity compiler',
        version: FOUNDRY.solc,
        url: { arm64: `${GH}/ethereum/solidity/releases/download/v0.8.38/solc-macos`, x64: `${GH}/ethereum/solidity/releases/download/v0.8.38/solc-macos` },
        sha256: { arm64: 'b18ac1d1f48394c71ca9aefbf0fb94fef24c87b358f48578de5941e234e0a2a9', x64: 'b18ac1d1f48394c71ca9aefbf0fb94fef24c87b358f48578de5941e234e0a2a9' },
        bytes: { arm64: 31_317_720, x64: 31_317_720 },
        unpack: 'binary',
        into: 'bin',
        as: 'solc',
        thin: ['solc']
      },
      {
        id: 'forge-std',
        name: 'forge-std',
        version: FOUNDRY.forgeStd,
        url: { arm64: `${GH}/foundry-rs/forge-std/archive/refs/tags/v1.17.0.tar.gz`, x64: `${GH}/foundry-rs/forge-std/archive/refs/tags/v1.17.0.tar.gz` },
        sha256: { arm64: 'f104cf27931254c647377aa46e308189a694dbd207f9af2e891c2547e8c03300', x64: 'f104cf27931254c647377aa46e308189a694dbd207f9af2e891c2547e8c03300' },
        bytes: { arm64: 138_313, x64: 138_313 },
        unpack: 'tar',
        into: 'forge-std',
        strip: 1,
        only: ['src', 'LICENSE-APACHE', 'LICENSE-MIT']
      }
    ]
  },
  {
    id: 'bigdata',
    title: 'Big data pack',
    roadmaps: ['big-data', 'data-engineering'],
    about: 'Spark jobs and Kafka topics in lessons and projects: PySpark on a portable Java, and a Kafka-compatible broker that needs no JVM',
    contents: 'PySpark and kafka-python in Tide’s Python, a Temurin Java runtime and the Nisshi broker',
    // 109.5 MB of Java and broker plus PySpark's 456 MB source archive, which bundles Spark's jars:
    // 566 MB down; 887 MB on disk, of which PySpark is 498 MB in Tide's Python (measured into a
    // fresh environment), the broker 184 MB and Java 151 MB
    download: 'about 566 MB',
    size: 'about 890 MB',
    needsBytes: 2_200_000_000,
    where: 'Settings › Tools › Big data pack',
    folder: 'bigdata',
    files: [
      {
        id: 'jre',
        name: 'the Java runtime (Temurin)',
        version: JRE.version,
        url: { arm64: `${GH}/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz`, x64: `${GH}/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_mac_hotspot_21.0.13_9.tar.gz` },
        sha256: { arm64: '225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a', x64: 'c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89' },
        bytes: { arm64: 47_935_740, x64: 41_902_098 },
        unpack: 'tar',
        into: 'jre',
        strip: 1
      },
      {
        id: 'nisshi',
        name: 'the Nisshi broker',
        version: NISSHI.version,
        // Apple silicon only: there is no Intel Mac build
        url: { arm64: `${GH}/tansu-io/tansu/releases/download/v0.8.2/nisshi-aarch64-apple-darwin.tar.gz` },
        sha256: { arm64: '3879f05603a596e66496693c51cae20619b57e0a7521194e619097f18e7ecd00' },
        bytes: { arm64: 61_581_593 },
        unpack: 'tar',
        into: 'nisshi',
        // Its members start ./, which tar matches without
        only: ['bin/nisshi', 'LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSE.html']
      }
    ],
    python: { packages: ['pyspark==4.3.0', 'kafka-python'], modules: ['pyspark', 'kafka'] }
  },
  {
    id: 'postgres',
    title: 'Postgres pack',
    roadmaps: ['backend', 'data-engineering', 'core-banking', 'payment-infrastructure'],
    about: 'Real Postgres in the SQL lab: indexes, EXPLAIN, transactions and isolation levels, beside SQLite',
    contents: 'PostgreSQL 18 (server binaries for embedding, from zonky)',
    // 71.2 MB down; 154 MB on disk once the libraries the archive holds three times are linked (325 MB before)
    download: 'about 71 MB',
    size: 'about 154 MB',
    needsBytes: 700_000_000,
    where: 'Settings › Tools › Postgres pack',
    folder: 'postgres',
    files: [
      {
        id: 'postgres',
        name: 'PostgreSQL',
        version: POSTGRES.version,
        url: {
          arm64: 'https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/18.6.0/embedded-postgres-binaries-darwin-arm64v8-18.6.0.jar',
          x64: 'https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-amd64/18.6.0/embedded-postgres-binaries-darwin-amd64-18.6.0.jar'
        },
        sha256: { arm64: '8f6ed6f38195b50a40712ada8b2a12060b6193c1a6977a6eb5cff053bb5a1b89' },
        sha1: { arm64: '0c063aa31534219dd76a4bd6a59bec83480030cc', x64: 'ae110557f4cedaa57a835577d810a80af7e5478a' },
        bytes: { arm64: 71_185_174, x64: 71_185_174 },
        unpack: 'jar-txz',
        into: 'pg'
      }
    ]
  },
  {
    id: 'runs',
    title: 'Run tracker',
    roadmaps: ['mle', 'machine-learning'],
    about: 'Parameters, metrics and curves for each training run, compared side by side in the notebook',
    contents: 'tide_runs, built into Tide’s Python helpers',
    download: 'nothing',
    size: 'nothing',
    needsBytes: 0,
    where: 'the notebook’s Runs tab',
    folder: '',
    files: []
  }
]

export const trackPack = (id: string): TrackPack | undefined => TRACK_PACKS.find((p) => p.id === id)

/** The pack that makes a ready roadmap hands-on, if one does */
export const packForRoadmap = (roadmapId: string): TrackPack | undefined => TRACK_PACKS.find((p) => p.id !== 'runs' && p.roadmaps.includes(roadmapId)) ?? TRACK_PACKS.find((p) => p.roadmaps.includes(roadmapId))

/** What one part of a pack is doing on this Mac */
export interface PackPart {
  name: string
  ready: boolean
  /** Its version, or what it needs */
  detail: string
}

export interface TrackPackStatus {
  id: TrackPackId
  ready: boolean
  /** One line for Settings */
  detail: string
  parts: PackPart[]
  /** Measured after installing: the pack's folder and the growth of Tide's Python */
  sizeMb?: number
  seconds?: number
  /** Something outside Tide must come first (Apple's command-line tools) */
  needs?: 'xcode'
  /** Install can't help on this Mac (no build for its architecture), and why */
  unavailable?: string
}

/** The track packs to the window (preload/index) */
export interface PacksApi {
  list(): Promise<Pick<TrackPack, 'id' | 'title' | 'about' | 'contents' | 'download' | 'size' | 'where' | 'roadmaps'>[]>
  status(id: TrackPackId): Promise<TrackPackStatus>
  /** Starts (or joins) the install; resolves when it has finished */
  install(id: TrackPackId): Promise<TrackPackStatus>
  /** The packs installing now */
  installing(): Promise<TrackPackId[]>
  onProgress(cb: (p: { id: TrackPackId; step: string }) => void): () => void
  /** Opens Apple's installer for the command-line tools */
  appleTools(): Promise<{ started: boolean; detail: string }>
  /** The run tracker's runs of an experiment (a notebook's name, or "lessons") */
  runs(experiment: string): Promise<import('./runs').TrainingRun[]>
  deleteRun(experiment: string, id: string): Promise<void>
}

/** The file for this Mac, or null when there is no build for it */
export function fileFor(f: PackFile, arch: MacArch): { url: string; sha256?: string; sha1?: string; bytes: number } | null {
  const url = f.url[arch]
  if (!url) return null
  return { url, sha256: f.sha256?.[arch], sha1: f.sha1?.[arch], bytes: f.bytes[arch] ?? 0 }
}

/** "122 MB", "1.2 GB" */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

/** "Downloading Foundry 1.9.0: 45% of 122 MB…" */
export function downloadLine(f: PackFile, got: number, total: number): string {
  const pct = total ? Math.min(100, Math.floor((got / total) * 100)) : 0
  return `Downloading ${f.name} ${f.version}${total ? `: ${pct}% of ${sizeText(total)}` : `: ${sizeText(got)}`}…`
}

/** Why a download or an install failed, in a sentence the learner can act on */
export function packFailureText(pack: TrackPack, err: string): string {
  if (/ENOSPC|No space left/i.test(err)) return `Couldn't install the ${pack.title}: the disk is full. It needs ${pack.size}.`
  if (/checksum/i.test(err)) return `Couldn't install the ${pack.title}: a download was damaged on the way (its checksum didn't match). Try again.`
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket hang up|timed out|answered 5\d\d/i.test(err)) return `Couldn't download the ${pack.title}: check the internet connection and try again. What was already installed is kept.`
  return `Couldn't install the ${pack.title}: ${err.trim().split('\n').pop()?.slice(0, 200) || 'the installer stopped without saying why'}`
}

/** The line a lesson or a run shows when it needs a pack that isn't installed */
export function packMissingText(id: TrackPackId, what: string): string {
  const p = trackPack(id)!
  return `${what} needs the ${p.title} (${p.contents}), which isn't installed. The learner can add it in ${p.where}: ${p.download} to download, ${p.size} on disk. Until then this code is shown as written and not run.`
}
