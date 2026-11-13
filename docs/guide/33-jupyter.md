---
title: Jupyter notebooks and the quant lab
group: Everyday
summary: Open and write .ipynb notebooks on a real Jupyter kernel, see which cells are out of date, and work through the quant lab with the tutor in the margin.
---
## Notebooks

Any `.ipynb` file in your notes opens as a notebook, and so does one in a project you have open in the Code view. **New Jupyter notebook** is in the **+** menu and on a folder's right-click menu. Notebooks save themselves as you go, in the same format Jupyter writes, so they open unchanged in JupyterLab or VS Code.

Code cells are the same editor as the Code view, with completions and hovers. Text cells are Markdown with maths: double-click to write, **⇧↩** to show it.

- **⇧↩** runs a cell and moves to the next; **⌘↩** runs it in place.
- **Run all**, **Interrupt** (stops the running cell, keeps your variables) and **Restart** (a fresh kernel).
- **Variables** lists what the kernel holds: types, shapes and values.

Outputs are drawn the way you'd expect: plots in Tide's own colours, pandas tables, Plotly charts you can zoom, LaTeX, and errors with their traceback.

## Out of date

Tide reads which names each cell defines and uses. When you edit a cell, or run it again, the cells below that use what it defines turn amber: **Out of date**, with the names that changed. **Run stale** runs just those, in order.

## The tutor in the margin

The tutor reads the notebook: its cells, outputs and errors. **Explain** and **Debug** on a cell's output ask about that output; **Suggest the next cell** asks for a proposal, which appears in the notebook for you to edit, **Keep** or **Drop**. You write the code: the tutor proposes code only when you ask for it. **Set me an exercise** adds a checked exercise to the notebook; its tests are hidden, and the tutor's own answer has passed them before you see it.

Claude is the tutor when it's set up. Without it, Gemma answers from the notebook's text.

## The quant lab

**Practice › Quant › Quant lab notebooks** has eight guided notebooks on Tide's bundled market data (US Treasury yields, ECB rates and synthetic prices): yield-curve bootstrapping, options and Greeks with QuantLib, Monte Carlo pricing, VaR and backtesting, the efficient frontier with cvxpy, GARCH volatility, DuckDB and Polars, and a payments reconciliation. Each has exercises you check with **Run and check**. Some outputs move: scrub a yield curve through six years, drag an option's spot and volatility, hover along the efficient frontier, or send a market order through an order book.

`import tide_nb as tn` gives the same pictures in your own notebooks: `tn.yield_curve`, `tn.option`, `tn.frontier`, `tn.order_book` and `tn.graph`.

## The quant pack

Notebooks run on Jupyter's kernel, which comes with the quant pack: SciPy, statsmodels, scikit-learn, Polars, DuckDB, PyArrow, cvxpy, QuantLib, arch and Plotly, about 180 MB to download and 780 MB on disk. Install it from a notebook's first-use card or **Settings › Tools › Quant pack**; it installs in the background, with uv when your Mac has it. Yahoo Finance prices (yfinance) are a separate switch there, off by default.
