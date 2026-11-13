"""
tide_finance: Tide's finance lab helpers, for lessons on payments, banking, stablecoins and quant.

Built on NumPy and pandas only, so everything runs without SciPy. The same models as Tide's live
simulations (src/shared/finance), so a number in a simulation and a number here agree.

    import tide_finance as tf
    tf.black_scholes(100, 105, 1, 0.03, 0.2, "call")
    tf.historical_var(tf.sample_prices("TIDX").pct_change().dropna(), 0.99)

Money in ledgers and payments is whole minor units (cents), never floats.
The sample prices are synthetic (made by Tide, CC0): not real market data.
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass

import numpy as np

try:  # pandas is in Tide's environment; the helpers that return tables need it
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None

try:  # SciPy is optional: used only to cross-check when it is there
    from scipy.stats import norm as _scipy_norm  # noqa: F401
    HAVE_SCIPY = True
except ImportError:
    HAVE_SCIPY = False

DATA = os.environ.get("TIDE_FINANCE_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tide_market"))

# ---------------------------------------------------------------- the normal distribution


def norm_cdf(x):
    """Phi(x), the standard normal CDF, from math.erfc (works on arrays too)."""
    if np.ndim(x):
        return np.vectorize(lambda v: 0.5 * math.erfc(-v / math.sqrt(2)))(x)
    return 0.5 * math.erfc(-x / math.sqrt(2))


def norm_pdf(x):
    return np.exp(-0.5 * np.asarray(x) ** 2) / math.sqrt(2 * math.pi)


def norm_inv(p: float) -> float:
    """Phi^-1(p): Acklam's approximation refined by one Halley step (as accurate as SciPy's ppf to ~1e-12)."""
    if not 0 < p < 1:
        return -math.inf if p == 0 else math.inf if p == 1 else math.nan
    a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
    b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    lo = 0.02425
    if p < lo:
        q = math.sqrt(-2 * math.log(p))
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    elif p <= 1 - lo:
        q = p - 0.5
        r = q * q
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    else:
        q = math.sqrt(-2 * math.log(1 - p))
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    e = norm_cdf(x) - p
    u = e * math.sqrt(2 * math.pi) * math.exp(x * x / 2)
    return x - u / (1 + x * u / 2)


# ---------------------------------------------------------------- options


def black_scholes(s, k, t, r, sigma, kind="call", q=0.0):
    """Black-Scholes-Merton price and Greeks of a European option."""
    sq = sigma * math.sqrt(t)
    d1 = (math.log(s / k) + (r - q + sigma * sigma / 2) * t) / sq
    d2 = d1 - sq
    dq, dr = math.exp(-q * t), math.exp(-r * t)
    if kind == "call":
        price = s * dq * norm_cdf(d1) - k * dr * norm_cdf(d2)
        delta = dq * norm_cdf(d1)
    else:
        price = k * dr * norm_cdf(-d2) - s * dq * norm_cdf(-d1)
        delta = dq * (norm_cdf(d1) - 1)
    gamma = dq * float(norm_pdf(d1)) / (s * sq)
    vega = s * dq * float(norm_pdf(d1)) * math.sqrt(t)
    return {"price": price, "delta": delta, "gamma": gamma, "vega": vega, "d1": d1, "d2": d2}


def mc_european(s, k, t, r, sigma, kind="call", n=100_000, seed=1, antithetic=False):
    """A European option by Monte Carlo under GBM (exact one-step), with its standard error."""
    rng = np.random.default_rng(seed)
    z = rng.standard_normal(n)
    drift = (r - sigma * sigma / 2) * t
    vol = sigma * math.sqrt(t)

    def pay(st):
        return np.maximum(st - k, 0) if kind == "call" else np.maximum(k - st, 0)

    x = pay(s * np.exp(drift + vol * z))
    if antithetic:
        x = (x + pay(s * np.exp(drift - vol * z))) / 2
    disc = math.exp(-r * t)
    return {"price": float(disc * x.mean()), "se": float(disc * x.std(ddof=1) / math.sqrt(n)), "n": n}


def gbm_paths(s0, mu, sigma, years, steps, paths, seed=1):
    """Geometric Brownian motion paths: an array of shape (paths, steps + 1)."""
    rng = np.random.default_rng(seed)
    dt = years / steps
    inc = (mu - sigma * sigma / 2) * dt + sigma * math.sqrt(dt) * rng.standard_normal((paths, steps))
    return s0 * np.exp(np.concatenate([np.zeros((paths, 1)), np.cumsum(inc, axis=1)], axis=1))


# ---------------------------------------------------------------- risk


def historical_var(returns, level=0.99):
    """VaR and expected shortfall from a sample of returns, as positive losses (fractions of the position)."""
    r = np.asarray(returns, dtype=float)
    cut = np.quantile(r, 1 - level)
    tail = r[r <= cut]
    return {"var": float(-cut), "es": float(-tail.mean()) if tail.size else float(-cut)}


def parametric_var(mu, sigma, level=0.99):
    """Normal (variance-covariance) VaR and ES."""
    z = norm_inv(1 - level)
    return {"var": float(-(mu + sigma * z)), "es": float(-mu + sigma * float(norm_pdf(z)) / (1 - level))}


def monte_carlo_var(mu, sigma, level=0.99, n=10_000, seed=1):
    rng = np.random.default_rng(seed)
    return historical_var(mu + sigma * rng.standard_normal(n), level)


def portfolio_var(weights, cov, level=0.99, value=1.0):
    """Parametric VaR of a portfolio: sigma_p = sqrt(w' S w)."""
    w = np.asarray(weights, dtype=float)
    sp = math.sqrt(float(w @ np.asarray(cov) @ w))
    return value * parametric_var(0.0, sp, level)["var"]


def kupiec(exceptions, days, level=0.99):
    """Kupiec's proportion-of-failures test; rejects the VaR model at 95% when LR > 3.841."""
    p, x, n = 1 - level, exceptions, days

    def ll(q):
        return (n - x) * math.log(1 - q) + (x * math.log(q) if x > 0 else 0.0)

    alt = 0.0 if x in (0, n) else ll(x / n)
    lr = -2 * (ll(p) - alt)
    return {"lr": lr, "reject": lr > 3.841, "expected": n * p}


def var_backtest(returns, window=250, level=0.99):
    """Rolling historical VaR from the previous `window` days, the days it was exceeded, Kupiec and Basel's zone."""
    r = np.asarray(returns, dtype=float)
    exc = 0
    days = 0
    for t in range(window, len(r)):
        v = -np.quantile(r[t - window:t], 1 - level)
        days += 1
        exc += int(r[t] < -v)
    zone = "green" if exc * 250 / max(days, 1) <= 4 else "amber" if exc * 250 / max(days, 1) <= 9 else "red"
    return {"days": days, "exceptions": exc, "kupiec": kupiec(exc, days, level), "zone_per_250_days": zone}


STRESS_SCENARIOS = {
    "Equity crash (2008-style)": {"equity": -0.4, "credit": -0.15, "rates": 0.03, "fx": -0.1, "crypto": -0.6},
    "Rate shock (+200 bp, 2022-style)": {"equity": -0.2, "credit": -0.08, "rates": -0.12, "fx": 0.05, "crypto": -0.5},
    "Pandemic week (March 2020-style)": {"equity": -0.3, "credit": -0.1, "rates": 0.02, "fx": -0.05, "crypto": -0.45},
    "Stablecoin depeg (2023-style)": {"equity": -0.02, "credit": -0.01, "rates": 0.0, "fx": 0.0, "crypto": -0.12},
}


def stress_test(positions, scenarios=None):
    """Profit or loss in money for each scenario; positions are money exposures per factor."""
    scenarios = scenarios or STRESS_SCENARIOS
    return {name: sum(v * shocks.get(f, 0.0) for f, v in positions.items()) for name, shocks in scenarios.items()}


# ---------------------------------------------------------------- backtests


def max_drawdown(equity):
    e = np.asarray(equity, dtype=float)
    return float(np.max(1 - e / np.maximum.accumulate(e)))


def sma_crossover(prices, fast=20, slow=100, cost=0.0):
    """Long when the fast moving average was above the slow one at yesterday's close; no look-ahead."""
    p = np.asarray(prices, dtype=float)
    f = pd.Series(p).rolling(fast).mean().to_numpy()
    s = pd.Series(p).rolling(slow).mean().to_numpy()
    pos = np.zeros(len(p))
    pos[1:] = np.where(np.isfinite(f[:-1]) & np.isfinite(s[:-1]) & (f[:-1] > s[:-1]), 1.0, 0.0)
    r = np.zeros(len(p))
    r[1:] = p[1:] / p[:-1] - 1
    changed = np.zeros(len(p))
    changed[1:] = pos[1:] != pos[:-1]
    net = pos * r - changed * cost
    equity = np.cumprod(1 + net)
    daily = net[1:]
    sd = daily.std(ddof=1)
    return {
        "equity": equity,
        "trades": int(changed.sum()),
        "total_return": float(equity[-1] - 1),
        "hold_return": float(p[-1] / p[0] - 1),
        "sharpe": float(daily.mean() / sd * math.sqrt(252)) if sd > 0 else 0.0,
        "max_drawdown": max_drawdown(equity),
    }


# ---------------------------------------------------------------- market data


def _csv(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"{name} isn't here: Tide adds the market data when the code imports tide_finance")
    return pd.read_csv(path, parse_dates=["date"]).set_index("date")


def sample_prices(ticker=None):
    """Synthetic daily closes (TIDX, PAYX, LEDG, STBL, UTIL), 2020 to 2025: one Series, or a table of all."""
    wide = _csv("sample_prices.csv")
    return wide[ticker] if ticker else wide


def treasury_yields():
    """US Treasury daily par yield curve, percent (public domain)."""
    return _csv("us_treasury_yields.csv")


def fx_rates():
    """ECB euro reference rates (source: ECB Data Portal)."""
    return _csv("ecb_fx_rates.csv")


# ---------------------------------------------------------------- ledgers and a core bank

DEBIT_NORMAL = {"asset", "expense"}


class LedgerError(Exception):
    pass


class Ledger:
    """Double entry: every posting's debits equal its credits, so the books always balance."""

    def __init__(self):
        self.accounts = {}
        self.balances = {}
        self.entries = []

    def open(self, account_id, name, kind, owner=None, rate=0.0, no_overdraft=False):
        if account_id in self.accounts:
            raise LedgerError(f"Account {account_id} already exists")
        self.accounts[account_id] = {"name": name, "type": kind, "owner": owner, "rate": rate, "no_overdraft": no_overdraft}
        self.balances[account_id] = 0
        return account_id

    def post(self, date, memo, legs):
        """legs: (account, amount_minor, 'debit' | 'credit'). Refused whole if it doesn't balance or overdraws."""
        if len(legs) < 2:
            raise LedgerError("An entry needs at least two legs")
        dr = sum(a for _, a, side in legs if side == "debit")
        cr = sum(a for _, a, side in legs if side == "credit")
        for acct, amt, _ in legs:
            if acct not in self.accounts:
                raise LedgerError(f"No account {acct}")
            if not isinstance(amt, (int, np.integer)) or amt <= 0:
                raise LedgerError(f"Amounts are whole minor units above zero (got {amt})")
        if dr != cr:
            raise LedgerError(f"Debits ({dr}) don't equal credits ({cr})")
        new = {}
        for acct, amt, side in legs:
            sign = 1 if (side == "debit") == (self.accounts[acct]["type"] in DEBIT_NORMAL) else -1
            new[acct] = new.get(acct, self.balances[acct]) + sign * amt
        for acct, b in new.items():
            if b < 0 and self.accounts[acct]["no_overdraft"]:
                raise LedgerError(f"Insufficient funds in {self.accounts[acct]['name']}")
        self.balances.update(new)
        self.entries.append({"id": len(self.entries) + 1, "date": date, "memo": memo, "legs": list(legs)})

    def balance(self, account_id):
        return self.balances[account_id]

    def trial_balance(self):
        rows = []
        for a, info in self.accounts.items():
            b = self.balances[a] if info["type"] in DEBIT_NORMAL else -self.balances[a]
            rows.append({"account": a, "name": info["name"], "debit": max(b, 0), "credit": max(-b, 0)})
        table = pd.DataFrame(rows) if pd is not None else rows
        return table

    def balanced(self):
        rows = self.trial_balance()
        return int(rows["debit"].sum()) == int(rows["credit"].sum())


def round_half_even(x):
    f = math.floor(x)
    d = x - f
    if abs(d - 0.5) < 1e-9:
        return f if f % 2 == 0 else f + 1
    return round(x)


def daily_interest(balance, rate, basis=365):
    return round_half_even(balance * rate / basis)


class CoreBank:
    """A bank's core over its general ledger: deposits, transfers, loans, fees and end of day."""

    def __init__(self, capital=0, date="2026-01-01"):
        self.gl = Ledger()
        self.date = date
        self._n = 0
        for i, n, k in [
            ("reserves", "Reserves at the central bank", "asset"),
            ("cash", "Cash in the vault", "asset"),
            ("loans", "Loans to customers", "asset"),
            ("interest-receivable", "Interest receivable", "asset"),
            ("interest-payable", "Interest payable", "liability"),
            ("suspense", "Suspense (unreconciled)", "liability"),
            ("capital", "Share capital", "equity"),
            ("interest-income", "Interest income", "income"),
            ("fee-income", "Fee income", "income"),
            ("interest-expense", "Interest expense", "expense"),
        ]:
            self.gl.open(i, n, k)
        if capital:
            self.gl.post(self.date, "Capital paid in", [("reserves", capital, "debit"), ("capital", capital, "credit")])

    def open_deposit(self, owner, rate=0.0):
        self._n += 1
        return self.gl.open(f"dep-{self._n}", f"{owner}'s current account", "liability", owner, rate, True)

    def deposit_cash(self, acct, amount):
        self.gl.post(self.date, "Cash deposit", [("cash", amount, "debit"), (acct, amount, "credit")])

    def withdraw_cash(self, acct, amount):
        self.gl.post(self.date, "Cash withdrawal", [(acct, amount, "debit"), ("cash", amount, "credit")])

    def transfer(self, src, dst, amount, fee=0):
        legs = [(src, amount + fee, "debit"), (dst, amount, "credit")]
        if fee:
            legs.append(("fee-income", fee, "credit"))
        self.gl.post(self.date, "Transfer", legs)

    def pay_out(self, acct, amount):
        self.gl.post(self.date, "Outgoing payment (settled in reserves)", [(acct, amount, "debit"), ("reserves", amount, "credit")])

    def pay_in(self, acct, amount):
        self.gl.post(self.date, "Incoming payment (settled in reserves)", [("reserves", amount, "debit"), (acct, amount, "credit")])

    def disburse_loan(self, acct, amount, rate):
        self._n += 1
        owner = self.gl.accounts[acct]["owner"]
        loan = self.gl.open(f"loan-{self._n}", f"{owner}'s loan", "asset", owner, rate)
        self.gl.post(self.date, "Loan disbursed", [(loan, amount, "debit"), (acct, amount, "credit")])
        return loan

    def repay_loan(self, acct, loan, amount):
        self.gl.post(self.date, "Loan repayment", [(acct, amount, "debit"), (loan, amount, "credit")])

    def charge_fee(self, acct, amount, memo="Monthly fee"):
        self.gl.post(self.date, memo, [(acct, amount, "debit"), ("fee-income", amount, "credit")])

    def end_of_day(self):
        payable = receivable = 0
        for a, info in list(self.gl.accounts.items()):
            if not info["rate"] or not info["owner"]:
                continue
            amt = daily_interest(self.gl.balance(a), info["rate"])
            if amt <= 0:
                continue
            if info["type"] == "liability":
                self.gl.post(self.date, f"Interest accrued on {info['name']}", [("interest-expense", amt, "debit"), ("interest-payable", amt, "credit")])
                payable += amt
            elif info["type"] == "asset":
                self.gl.post(self.date, f"Interest accrued on {info['name']}", [("interest-receivable", amt, "debit"), ("interest-income", amt, "credit")])
                receivable += amt
        d = np.datetime64(self.date) + np.timedelta64(1, "D")
        self.date = str(d)
        return {"accrued_payable": payable, "accrued_receivable": receivable}


# ---------------------------------------------------------------- settlement


def rtgs(opening, payments):
    """Real-time gross settlement with a FIFO queue. payments: (from, to, amount)."""
    bal = dict(opening)
    for f, t, _ in payments:
        bal.setdefault(f, 0)
        bal.setdefault(t, 0)
    settled, queue = [], []

    def try_one(i, f, t, a):
        if bal[f] < a:
            return False
        bal[f] -= a
        bal[t] += a
        settled.append(i)
        return True

    def drain():
        moved = True
        while moved:
            moved = False
            for j, q in enumerate(queue):
                if try_one(*q):
                    queue.pop(j)
                    moved = True
                    break

    for i, (f, t, a) in enumerate(payments):
        if any(q[1] == f for q in queue) or not try_one(i, f, t, a):
            queue.append((i, f, t, a))
        else:
            drain()
    return {"settled": settled, "queued": [q[0] for q in queue], "balances": bal}


def multilateral_net(payments):
    net = {}
    for f, t, a in payments:
        net[f] = net.get(f, 0) - a
        net[t] = net.get(t, 0) + a
    return net


def netting_summary(payments):
    gross = sum(a for _, _, a in payments)
    pair = {}
    for f, t, a in payments:
        key = tuple(sorted((f, t)))
        pair[key] = pair.get(key, 0) + (a if f == key[0] else -a)
    bilateral = sum(abs(v) for v in pair.values())
    multi = sum(-v for v in multilateral_net(payments).values() if v < 0)
    return {"gross": gross, "bilateral": bilateral, "multilateral": multi, "saving": 1 - multi / gross if gross else 0.0}


def card_purchase(amount, interchange=0.002, scheme=0.0005, acquirer=0.005):
    """Who gets what from a card purchase (minor units): EU consumer debit interchange is capped at 0.2%."""
    ic, sc, aq = (int(math.floor(amount * x + 0.5)) for x in (interchange, scheme, acquirer))
    msc = ic + sc + aq
    return {"msc": msc, "merchant_gets": amount - msc, "issuer_gets": ic, "scheme_gets": sc, "acquirer_gets": aq}


# ---------------------------------------------------------------- ISO 20022

DECIMALS = {"EUR": 2, "USD": 2, "GBP": 2, "CHF": 2, "JPY": 0, "NGN": 2, "INR": 2, "BHD": 3}


def _mod97(s):
    rem = 0
    for ch in s:
        for digit in ch if ch.isdigit() else str(ord(ch) - 55):
            rem = (rem * 10 + int(digit)) % 97
    return rem


def valid_iban(iban):
    s = re.sub(r"\s+", "", iban).upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", s):
        return False
    return _mod97(s[4:] + s[:4]) == 1


def make_iban(country, bban):
    check = 98 - _mod97((bban + country + "00").upper())
    return f"{country.upper()}{check:02d}{bban.upper()}"


def valid_bic(bic):
    return re.fullmatch(r"[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?", bic) is not None


@dataclass
class Party:
    name: str
    iban: str
    bic: str


@dataclass
class Transfer:
    end_to_end_id: str
    amount: int
    currency: str
    debtor: Party
    creditor: Party
    remittance: str = ""


EXAMPLE_PARTIES = {
    "ada": Party("Ada Okafor", make_iban("DE", "370400440532013000"), "COBADEFFXXX"),
    "bo": Party("Bo Lindqvist", make_iban("FR", "20041010050500013M02606"), "BNPAFRPPXXX"),
    "shop": Party("Corner Shop Ltd", make_iban("GB", "NWBK60161331926819"), "NWBKGB2LXXX"),
}


def amount_text(minor, ccy):
    d = DECIMALS.get(ccy, 2)
    return f"{minor / 10 ** d:.{d}f}" if d else str(minor)


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def pacs008(msg_id, created, settlement_date, txs, method="CLRG"):
    """An FI-to-FI customer credit transfer (pacs.008.001.08), trimmed to the fields that matter for learning it."""
    ccy = txs[0].currency if txs else "EUR"
    total = sum(t.amount for t in txs)
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">',
        "  <FIToFICstmrCdtTrf>",
        f"    <GrpHdr><MsgId>{_esc(msg_id)}</MsgId><CreDtTm>{created}</CreDtTm><NbOfTxs>{len(txs)}</NbOfTxs>"
        f'<TtlIntrBkSttlmAmt Ccy="{ccy}">{amount_text(total, ccy)}</TtlIntrBkSttlmAmt><IntrBkSttlmDt>{settlement_date}</IntrBkSttlmDt>'
        f"<SttlmInf><SttlmMtd>{method}</SttlmMtd></SttlmInf></GrpHdr>",
    ]
    for i, t in enumerate(txs):
        out.append(
            f"    <CdtTrfTxInf><PmtId><InstrId>{_esc(msg_id)}-{i + 1}</InstrId><EndToEndId>{_esc(t.end_to_end_id)}</EndToEndId></PmtId>"
            f'<IntrBkSttlmAmt Ccy="{t.currency}">{amount_text(t.amount, t.currency)}</IntrBkSttlmAmt><ChrgBr>SLEV</ChrgBr>'
            f"<Dbtr><Nm>{_esc(t.debtor.name)}</Nm></Dbtr><DbtrAcct><Id><IBAN>{t.debtor.iban}</IBAN></Id></DbtrAcct>"
            f"<DbtrAgt><FinInstnId><BICFI>{t.debtor.bic}</BICFI></FinInstnId></DbtrAgt>"
            f"<Cdtr><Nm>{_esc(t.creditor.name)}</Nm></Cdtr><CdtrAcct><Id><IBAN>{t.creditor.iban}</IBAN></Id></CdtrAcct>"
            f"<CdtrAgt><FinInstnId><BICFI>{t.creditor.bic}</BICFI></FinInstnId></CdtrAgt>"
            + (f"<RmtInf><Ustrd>{_esc(t.remittance)}</Ustrd></RmtInf>" if t.remittance else "")
            + "</CdtTrfTxInf>"
        )
    out += ["  </FIToFICstmrCdtTrf>", "</Document>"]
    return "\n".join(out) + "\n"


def read_message(xml):
    """Reads a pain.001, pacs.008 or camt.053 with ElementTree and checks it as a gateway would."""
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml)
    ns = root.tag[1:].split("}")[0] if root.tag.startswith("{") else ""
    kind = ns.split(":")[-1][:8]

    def all_(el, tag):
        return el.iter("{%s}%s" % (ns, tag)) if ns else el.iter(tag)

    def text(el, tag):
        for x in all_(el, tag):
            return (x.text or "").strip()
        return ""

    problems = []
    msg_id = text(root, "MsgId")
    if not msg_id:
        problems.append("GrpHdr/MsgId: missing")
    elif len(msg_id) > 35:
        problems.append("GrpHdr/MsgId: longer than 35 characters")
    for tag in ("IBAN",):
        for x in all_(root, tag):
            if not valid_iban(x.text or ""):
                problems.append(f"IBAN {x.text}: fails the mod-97 check")
    for x in all_(root, "BICFI"):
        if not valid_bic(x.text or ""):
            problems.append(f"BIC {x.text}: not a BIC")
    txs = list(all_(root, "CdtTrfTxInf"))
    if kind in ("pain.001", "pacs.008"):
        said = text(root, "NbOfTxs")
        if said and int(said) != len(txs):
            problems.append(f"GrpHdr/NbOfTxs: says {said}, there are {len(txs)}")
    return {"type": kind, "msg_id": msg_id, "transactions": len(txs), "problems": problems}


# ---------------------------------------------------------------- stablecoins

STABLECOIN_DEFAULTS = {
    "calm": dict(supply=1000, cash_share=0.2, fee=0.001, capacity=0.1, fire_sale=0.01, stuck=0, panic=0.5, days=20),
    "bank-failure": dict(supply=1000, cash_share=0.25, fee=0.001, capacity=0.1, fire_sale=0.01, stuck=0.33, panic=1.5, days=20),
    "run": dict(supply=1000, cash_share=0.1, fee=0.001, capacity=0.08, fire_sale=0.05, stuck=0, panic=2, days=20),
    "algorithmic": dict(supply=1000, cash_share=0, fee=0.001, capacity=0.25, fire_sale=0, stuck=0, panic=2, days=20),
}


def stablecoin(scenario="calm", **overrides):
    """Day-by-day model of a stablecoin under a scenario: a list of dicts (price, backing, supply...). Millions of dollars."""
    p = dict(STABLECOIN_DEFAULTS[scenario], **overrides)
    algo = scenario == "algorithmic"
    cash = 0.0 if algo else p["supply"] * p["cash_share"]
    prev = dict(day=0, supply=float(p["supply"]), cash=cash, bills=0.0 if algo else p["supply"] - cash, frozen=0.0, backing=1.0, price=1.0, redeemed=0.0, open=True)
    if algo:
        prev.update(token_price=3.0, token_supply=p["supply"] * 0.4)
    days = [prev]
    for _ in range(p["days"]):
        d = prev["day"] + 1
        supply, cash, bills, frozen = prev["supply"], prev["cash"], prev["bills"], prev["frozen"]
        tp, ts = prev.get("token_price"), prev.get("token_supply")
        if scenario == "bank-failure" and d == 2:
            frozen = cash * p["stuck"]
            cash -= frozen
        if scenario == "bank-failure" and d == 5:
            cash += frozen
            frozen = 0.0
        is_open = not (scenario == "bank-failure" and 2 <= d <= 4)
        if supply > 0:
            backing = min(1.0, (tp or 0) * (ts or 0) / supply) if algo else (cash + bills + frozen * 0.5) / supply
        else:
            backing = 1.0
        worry = max(0.0, 1 - backing) + 0.5 * max(0.0, 1 - prev["price"])
        shock = 0.12 if scenario == "run" and 2 <= d <= 6 else 0.2 if algo and 2 <= d <= 4 else 0.0
        selling = supply * min(0.6, 0.005 + shock + p["panic"] * worry)
        cap = supply * p["capacity"] if is_open else 0.0
        redeemed = min(selling, cap)
        if algo:
            minted = redeemed / tp if tp > 1e-9 else 0.0
            new_ts = ts + minted
            value = tp * ts * math.exp(-3 * p["panic"] * (redeemed / max(1e-9, ts * tp)) - p["panic"] * max(0.0, 1 - prev["price"]))
            tp = 0.0 if value / new_ts < 1e-9 else value / new_ts
            ts = new_ts
            supply -= redeemed
        else:
            from_cash = min(cash, redeemed * (1 - p["fee"]))
            cash -= from_cash
            paid = from_cash
            need = redeemed * (1 - p["fee"]) - from_cash
            if need > 0:
                sold = min(bills, need / (1 - p["fire_sale"]))
                bills -= sold
                raised = sold * (1 - p["fire_sale"])
                paid += raised
                need -= raised
                if need > 1e-9:
                    redeemed = paid / (1 - p["fee"])
            supply -= redeemed
        left = max(0.0, selling - redeemed)
        if supply > 0:
            after = min(1.0, (tp or 0) * (ts or 0) / supply) if algo else (cash + bills + frozen * 0.5) / supply
        else:
            after = 1.0
        price = min(1 + p["fee"], max(0.0, min(1.0, after) - p["fee"] - 0.25 * (left / max(1.0, supply))))
        if left < 1e-9 and after >= 1:
            price = 1 - p["fee"] * 0.5
        prev = dict(day=d, supply=supply, cash=cash, bills=bills, frozen=frozen, backing=after, price=price, redeemed=redeemed, open=is_open)
        if algo:
            prev.update(token_price=tp, token_supply=ts)
        days.append(prev)
    return days


def depeg_stats(days):
    low = min(days, key=lambda d: d["price"])
    back = next((d["day"] for d in days if d["day"] > low["day"] and d["price"] >= 0.995), None)
    return {"low": low["price"], "low_day": low["day"], "recovered": back}
