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

/**
 * The quant pack: what the notebook and the quant lab need on top of the data libraries. The
 * Jupyter kernel (ipykernel, jupyter_client) and the statistics, data, optimisation and pricing
 * libraries. Measured on an Apple silicon Mac with Python 3.15, from an environment that had only
 * the data libraries (168 MB): 175 MB downloaded, and the environment grew to 886 MB, so the pack
 * takes about 720 MB on disk. Measured again cold through Tide's own installer (uv, an empty cache, Python
 * 3.15): 164 s, and the environment grew by 781 MB (762,344 KiB), Jinja2 for pandas' styled tables included. On Python 3.15, cvxpy, qdldl and sparsediffpy have no wheels yet and
 * are built on the Mac (it needs Apple's command-line tools); OSQP's build fetches its sources
 * from GitHub, so when that fails cvxpy is installed without it and uses Clarabel, SCS and HiGHS.
 */
export const QUANT_PACK = {
  /** What the installer is asked for (cvxpy comes after, see below) */
  packages: ['ipykernel', 'jupyter_client', 'scipy', 'statsmodels', 'scikit-learn', 'polars', 'duckdb', 'pyarrow', 'QuantLib', 'arch', 'plotly', 'jinja2', 'clarabel', 'scs', 'qdldl', 'highspy', 'sparsediffpy>=0.6,<0.7'],
  /** cvxpy on its own: first with all its solvers, else without OSQP */
  optimiser: 'cvxpy',
  /** Package names as installed (importlib.metadata), for the status check */
  dists: ['ipykernel', 'jupyter_client', 'scipy', 'statsmodels', 'scikit-learn', 'polars', 'duckdb', 'pyarrow', 'QuantLib', 'arch', 'plotly', 'cvxpy'],
  /** Import names, in the same order */
  modules: ['ipykernel', 'jupyter_client', 'scipy', 'statsmodels', 'sklearn', 'polars', 'duckdb', 'pyarrow', 'QuantLib', 'arch', 'plotly', 'cvxpy'],
  contents: 'the Jupyter kernel, SciPy, statsmodels, scikit-learn, Polars, DuckDB, PyArrow, cvxpy, QuantLib, arch and Plotly',
  size: 'about 780 MB',
  download: 'about 180 MB',
  needsBytes: 1_300_000_000,
  where: 'Settings › Tools › Quant pack'
}

/** Yahoo Finance prices through yfinance (Apache-2.0): off unless turned on, because of Yahoo's terms */
export const YAHOO_PACK = { packages: ['yfinance'], modules: ['yfinance'] }
