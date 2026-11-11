/**
 * The lab pack: scientific and machine-learning libraries for Python, added once from Settings ›
 * Tools to Tide's own Python environment. Sizes were measured installing it on an Apple silicon
 * Mac with Python 3.15 (torch 2.15 is 636 MB of the 857 MB).
 */
export const LAB_PACK = {
  /** What pip is asked for */
  packages: ['torch', 'scikit-learn', 'scipy', 'pytest', 'tqdm', 'requests', 'httpx', 'aiohttp'],
  /** The names they are imported by, in the same order */
  modules: ['torch', 'sklearn', 'scipy', 'pytest', 'tqdm', 'requests', 'httpx', 'aiohttp'],
  contents: 'PyTorch, scikit-learn, SciPy, pytest, tqdm, requests, httpx, aiohttp',
  size: 'about 860 MB',
  download: 'about 180 MB',
  /** Free space asked for before starting: the pack, its downloads, and room to unpack */
  needsBytes: 1_500_000_000,
  where: 'Settings › Tools › Lab pack'
}
