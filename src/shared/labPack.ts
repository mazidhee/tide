/**
 * The lab pack: scientific and machine-learning libraries for Python, added once from Settings ›
 * Tools to Tide's own Python environment. Sizes were measured installing it into a fresh
 * environment that already had the data libraries, on an Apple silicon Mac with Python 3.15 and
 * torch 2.15: 175.7 MB of wheels downloaded, and the environment grew by 899 MB (857 MiB) on disk.
 */
export const LAB_PACK = {
  /** What pip is asked for */
  packages: ['torch', 'scikit-learn', 'scipy', 'pytest', 'tqdm', 'requests', 'httpx', 'aiohttp'],
  /** The names they are imported by, in the same order */
  modules: ['torch', 'sklearn', 'scipy', 'pytest', 'tqdm', 'requests', 'httpx', 'aiohttp'],
  contents: 'PyTorch, scikit-learn, SciPy, pytest, tqdm, requests, httpx, aiohttp',
  size: 'about 900 MB',
  download: 'about 180 MB',
  /** Free space asked for before starting: the pack, its downloads, and room to unpack */
  needsBytes: 1_500_000_000,
  where: 'Settings › Tools › Lab pack'
}
