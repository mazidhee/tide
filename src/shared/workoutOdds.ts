/**
 * Round 3, estimate and odds: Fermi questions marked by orders of magnitude off (a curated bank
 * with the reference value and where it comes from), then dice, cards, expected value, quick Bayes
 * and percentage change, all worked out exactly here.
 */
import { fmt, frac, round, sci, type Rng, type WorkoutItem } from './workoutItems'
import type { Tier } from './workoutSpeed'

export interface Fermi {
  q: string
  value: number
  unit?: string
  /** How to get there by estimation */
  how: string[]
  /** Where the reference value comes from */
  source: string
  difficulty: number
}

/**
 * Reference values are rounded; marking only cares about orders of magnitude (within about ×3 is
 * right). Values worked out from definitions say so.
 */
export const FERMI: Fermi[] = [
  { q: 'How many seconds are there in a year?', value: 3.156e7, how: ['365 × 24 × 3600', '≈ 365 × 86,400 ≈ 3.2 × 10⁷'], source: 'Worked out: 365.25 days × 86,400 s', difficulty: 1000 },
  { q: 'How many people live in the world?', value: 8.1e9, how: ['Asia alone holds over 4 billion', 'About 8 billion in all'], source: 'UN World Population Prospects 2024: about 8.1 billion in 2024', difficulty: 900 },
  { q: 'How many people live in the UK?', value: 6.8e7, how: ['England about 57 million, then Scotland, Wales and Northern Ireland', '≈ 7 × 10⁷'], source: 'ONS mid-2023 estimate: 68.3 million', difficulty: 950 },
  { q: 'How many people live in the United States?', value: 3.4e8, how: ['About five times the UK’s 68 million', '≈ 3.4 × 10⁸'], source: 'US Census Bureau, 2024 estimate: about 340 million', difficulty: 950 },
  { q: 'How far is the Moon from the Earth, in km?', value: 3.844e5, how: ['Light takes about 1.3 s to get there', '1.3 × 300,000 km ≈ 4 × 10⁵ km'], source: 'NASA Moon fact sheet: mean distance 384,400 km', difficulty: 1100 },
  { q: 'How far is the Sun from the Earth, in km?', value: 1.496e8, how: ['Sunlight takes about 8 minutes 20 s (500 s)', '500 × 300,000 km = 1.5 × 10⁸ km'], source: 'IAU astronomical unit: 149,597,870.7 km', difficulty: 1200 },
  { q: 'How many times does a heart beat in an 80-year life?', value: 3e9, how: ['About 70 beats a minute', '70 × 60 × 24 × 365 × 80 ≈ 2.9 × 10⁹'], source: 'Worked out from a resting rate of about 70 a minute', difficulty: 1250 },
  { q: 'What is the mass of the Earth, in kg?', value: 5.97e24, how: ['Radius 6400 km, so volume ≈ 4/3 π r³ ≈ 1.1 × 10²¹ m³', 'Average density about 5500 kg/m³: ≈ 6 × 10²⁴ kg'], source: 'NASA Earth fact sheet: 5.97 × 10²⁴ kg', difficulty: 1600 },
  { q: 'How many base pairs are in one copy of the human genome?', value: 3.1e9, how: ['Remember it as "3 billion letters"'], source: 'NHGRI: about 3.1 billion base pairs', difficulty: 1300 },
  { q: 'How many neurons are in a human brain?', value: 8.6e10, how: ['About 100 billion is the usual round figure', 'Measured more carefully: 86 billion'], source: 'Azevedo et al. (2009), J. Comp. Neurol.: 86 billion', difficulty: 1300 },
  { q: 'How many cells are in a human body (not counting bacteria)?', value: 3e13, how: ['Body volume about 0.07 m³; a typical cell about 10⁻¹⁵ m³ gives about 10¹⁴', 'Most cells are small red blood cells, so fewer by volume share: ≈ 3 × 10¹³'], source: 'Sender, Fuchs and Milo (2016), PLoS Biology: about 30 trillion', difficulty: 1550 },
  { q: 'What is the circumference of the Earth, in km?', value: 4.0075e4, how: ['The metre was first defined so that pole to equator is 10,000 km', 'So all the way round ≈ 40,000 km'], source: 'WGS 84 equatorial circumference: 40,075 km', difficulty: 1000 },
  { q: 'How many litres of water fill an Olympic swimming pool?', value: 2.5e6, how: ['50 m × 25 m × 2 m = 2500 m³', '1000 litres a cubic metre: 2.5 × 10⁶'], source: 'World Aquatics facility rules: 50 m × 25 m, at least 2 m deep', difficulty: 1150 },
  { q: 'How many flights take off around the world on a typical day?', value: 1e5, how: ['Busy hub airports handle about 1000–1500 flights a day', 'Thousands of airports, most far quieter: ≈ 10⁵'], source: 'ICAO and IATA: about 100,000 flights a day before 2020, similar since', difficulty: 1350 },
  { q: 'How much foreign exchange is traded each day, in US dollars?', value: 7.5e12, how: ['World GDP is about $100 trillion a year', 'FX turnover dwarfs it: trillions a day, ≈ $7 trillion'], source: 'BIS Triennial Central Bank Survey 2022: $7.5 trillion a day', difficulty: 1500 },
  { q: 'What is world GDP in a year, in US dollars?', value: 1.05e14, how: ['US about $27 trillion, about a quarter of the world', '≈ $100 trillion'], source: 'IMF World Economic Outlook: about $105 trillion in 2023', difficulty: 1350 },
  { q: 'How many card payments did Visa process in a year (fiscal 2023)?', value: 2.13e11, how: ['About 4 billion cards worldwide', 'Each used about 50 times a year: ≈ 2 × 10¹¹'], source: 'Visa fiscal 2023 annual report: 212.6 billion processed transactions', difficulty: 1500 },
  { q: 'How many ACH payments went through the US network in 2023?', value: 3.15e10, how: ['About 130 million US households, plus businesses', 'Payroll, bills and transfers: a few hundred a year each ≈ 3 × 10¹⁰'], source: 'Nacha: 31.5 billion ACH payments in 2023', difficulty: 1650 },
  { q: 'How many Swift FIN messages are sent on an average day?', value: 4.5e7, how: ['About 11,000 member institutions', 'Thousands of messages each a day ≈ 4 × 10⁷'], source: 'Swift annual figures: about 45–48 million FIN messages a day in 2023', difficulty: 1700 },
  { q: 'How many bitcoins will ever exist?', value: 2.1e7, how: ['The block reward halves every 210,000 blocks, starting at 50', '50 × 210,000 × 2 = 21 million'], source: 'Bitcoin protocol: 21 million cap', difficulty: 1150 },
  { q: 'How many stars are in the Milky Way?', value: 2e11, how: ['Galaxy mass about 10¹² Suns, much of it dark matter', 'Stars: 100 to 400 billion'], source: 'NASA: an estimated 100–400 billion stars', difficulty: 1300 },
  { q: 'How many projects are on PyPI, the Python package index?', value: 5.5e5, how: ['Hundreds of thousands, not millions'], source: 'pypi.org front page, 2024: about 550,000 projects', difficulty: 1450 },
  { q: 'How many transistors are on an Apple M1 chip?', value: 1.6e10, how: ['Modern chips: billions to tens of billions', '≈ 1.6 × 10¹⁰'], source: 'Apple, M1 announcement (2020): 16 billion transistors', difficulty: 1400 },
  { q: 'How many bytes is one uncompressed 4K video frame (8-bit RGB)?', value: 2.49e7, how: ['3840 × 2160 ≈ 8.3 million pixels', '× 3 bytes ≈ 2.5 × 10⁷'], source: 'Worked out: 3840 × 2160 × 3 bytes', difficulty: 1250 },
  { q: 'How many grains of rice are in a 1 kg bag?', value: 5e4, how: ['A grain weighs about 20–25 mg', '1,000,000 mg ÷ 20 mg ≈ 5 × 10⁴'], source: 'IRRI Rice Knowledge Bank: 1000 grains weigh about 20–25 g', difficulty: 1300 },
  { q: 'How many journeys are made on the London Underground in a year?', value: 1.2e9, how: ['About 3–4 million a day', '× 365 ≈ 1.2 × 10⁹'], source: 'TfL annual report 2023/24: about 1.2 billion journeys', difficulty: 1400 },
  { q: 'How many seconds old is a 30-year-old?', value: 9.47e8, how: ['A year ≈ 3.2 × 10⁷ s', '× 30 ≈ 9.5 × 10⁸, just under a billion'], source: 'Worked out: 30 × 365.25 × 86,400 s', difficulty: 1100 },
  { q: 'How tall is Mount Everest, in metres?', value: 8849, how: ['Cruising altitude for jets is about 10–11 km', 'Everest is a bit under: ≈ 9000 m'], source: '2020 China–Nepal survey: 8,848.86 m', difficulty: 900 },
  { q: 'How many public repositories and projects are on GitHub (2023)?', value: 4.2e8, how: ['Over 100 million developers', 'A few repositories each: ≈ 4 × 10⁸'], source: 'GitHub Octoverse 2023: over 420 million projects', difficulty: 1500 },
  { q: 'How many keystrokes are in typing a 300-page novel?', value: 6e5, how: ['About 100,000 words', 'About 6 characters each including the space: 6 × 10⁵'], source: 'Worked out: 300 pages × 330 words × 6 characters', difficulty: 1200 }
]

const item = (kind: string, difficulty: number, rule: string, prompt: string, answer: WorkoutItem['answer'], steps: string[], source?: string): WorkoutItem => ({ round: 'odds', kind: `odds.${kind}`, difficulty, prompt, answer, steps, rule, ...(source ? { source } : {}) })

/** Ways two dice make each total */
const twoDice = (s: number) => 6 - Math.abs(s - 7)

export const ODDS_TIERS: Tier[] = [
  {
    id: 'fermi-easy',
    title: 'Fermi estimates',
    difficulty: 1050,
    make: (r) => fermi(r, 900, 1200)
  },
  {
    id: 'fermi-hard',
    title: 'Fermi estimates',
    difficulty: 1450,
    make: (r) => fermi(r, 1250, 1750)
  },
  {
    id: 'pct',
    title: 'Percentage change',
    difficulty: 1000,
    make(r) {
      if (r.next() < 0.5) {
        const from = r.pick([40, 50, 80, 120, 160, 200, 250, 400, 800])
        const p = r.pick([-40, -25, -20, -12.5, -10, 5, 15, 20, 37.5, 50, 60])
        const to = round(from * (1 + p / 100), 4)
        return item('pct', 1000, '(new − old) ÷ old', `From ${fmt(from)} to ${fmt(to)}: % change`, { type: 'number', value: p, tolerance: 0.1 }, [`Change: ${fmt(to)} − ${fmt(from)} = ${fmt(round(to - from, 4))}`, `÷ ${fmt(from)} = ${p}%`])
      }
      const p = r.pick([10, 20, 25, 50])
      const back = round((1 / (1 - p / 100) - 1) * 100, 2)
      return item('pct', 1000, 'A fall needs a bigger rise to recover', `A price falls ${p}%. What % rise takes it back?`, { type: 'number', value: back, tolerance: 0.1 }, [`After the fall it is ${1 - p / 100} of the start`, `To get back: × 1/${1 - p / 100} = ${round(1 / (1 - p / 100), 4)}, a rise of ${back}%`])
    }
  },
  {
    id: 'dice',
    title: 'Dice',
    difficulty: 1150,
    make(r) {
      const pick = r.next()
      if (pick < 0.4) {
        const s = r.int(3, 11)
        const w = twoDice(s)
        return item('dice', 1150, 'Count the ways out of 36', `Two fair dice: P(total = ${s})? (a fraction)`, { type: 'number', value: w / 36, tolerance: 1e-4 }, [`Pairs that make ${s}: ${pairs(s)}`, `${w} of 36 = ${frac(w, 36)}`])
      }
      if (pick < 0.75) {
        const n = r.int(2, 4)
        const p = 1 - (5 / 6) ** n
        return item('dice', 1250, 'At least one = 1 − none', `P(at least one six in ${n} rolls), to 3 decimal places`, { type: 'number', value: round(p, 3), tolerance: 0.0015 }, [`P(no six) = (5/6)^${n} = ${round((5 / 6) ** n, 4)}`, `1 − ${round((5 / 6) ** n, 4)} = ${round(p, 3)}`])
      }
      const n = r.int(2, 3)
      const ev = 3.5 * n
      return item('dice', 1050, 'Expectations add', `Expected total of ${n} fair dice`, { type: 'number', value: ev }, ['One die: (1+…+6)/6 = 3.5', `${n} dice: ${n} × 3.5 = ${ev}`])
    }
  },
  {
    id: 'ev',
    title: 'Expected value',
    difficulty: 1300,
    make(r) {
      if (r.next() < 0.5) {
        const win = r.pick([2, 3, 4, 5, 6, 10])
        const lose = r.pick([1, 2, 3])
        const v = round((3 * win - 3 * lose) / 6, 4)
        return item('ev', 1300, 'EV = Σ value × probability', `Roll a die: even pays £${win}, odd costs £${lose}. EV per roll in £?`, { type: 'number', value: v, tolerance: 0.005 }, [`P(even) = P(odd) = 1/2`, `½ × ${win} − ½ × ${lose} = ${v}`])
      }
      const k = r.pick([1, 2, 3])
      const pay = r.pick([4, 5, 6, 8])
      const cost = 1
      const v = round((k / 6) * pay - cost, 4)
      return item('ev', 1350, 'EV = Σ value × probability, minus the stake', `Pay £${cost} to roll a die. Rolling ${k === 1 ? 'a 6' : k === 2 ? 'a 5 or 6' : '4, 5 or 6'} pays £${pay}. EV of playing in £?`, { type: 'number', value: v, tolerance: 0.005 }, [`P(win) = ${k}/6`, `${k}/6 × ${pay} = ${round((k / 6) * pay, 4)}`, `Minus the £${cost}: ${v}`])
    }
  },
  {
    id: 'cards',
    title: 'Cards',
    difficulty: 1400,
    make(r) {
      const pick = r.next()
      if (pick < 0.35) return item('cards', 1350, 'Multiply along the draws, without replacement', 'Two cards from a shuffled deck: P(both hearts)? (a fraction)', { type: 'number', value: (13 / 52) * (12 / 51), tolerance: 1e-4 }, ['13/52 for the first', '12/51 for the second', `13/52 × 12/51 = ${frac(13 * 12, 52 * 51)}`])
      if (pick < 0.7) return item('cards', 1400, 'Multiply along the draws, without replacement', 'Two cards: P(an ace, then a king)? (a fraction)', { type: 'number', value: (4 / 52) * (4 / 51), tolerance: 1e-5 }, ['4/52 for an ace', '4/51 for a king after it', `= ${frac(16, 52 * 51)}`])
      return item('cards', 1450, 'P(a pair) = the second card matches the first', 'Two cards: P(they make a pair)? (a fraction)', { type: 'number', value: 3 / 51, tolerance: 1e-5 }, ['Whatever the first card is, 3 of the 51 left match it', `= ${frac(3, 51)}`])
    }
  },
  {
    id: 'bayes',
    title: 'Quick Bayes',
    difficulty: 1550,
    make(r) {
      const prev = r.pick([1, 2, 5, 10])
      const sens = r.pick([80, 90, 95, 99])
      const fp = r.pick([5, 10, 2])
      const pop = 1000
      const sick = (pop * prev) / 100
      const tp = (sick * sens) / 100
      const fpN = ((pop - sick) * fp) / 100
      const v = round((tp / (tp + fpN)) * 100, 1)
      return item('bayes', 1550, 'Count people: true positives ÷ all positives', `${prev}% have a condition. A test catches ${sens}% of them and flags ${fp}% of healthy people. You test positive: % chance you have it? (nearest whole %)`, { type: 'number', value: v, tolerance: 0.6 }, [`Of ${pop} people, ${sick} have it, ${pop - sick} don’t`, `True positives: ${sens}% of ${sick} = ${fmt(tp)}`, `False positives: ${fp}% of ${pop - sick} = ${fmt(fpN)}`, `${fmt(tp)} ÷ (${fmt(tp)} + ${fmt(fpN)}) = ${v}%`])
    }
  },
  {
    id: 'odds-hard',
    title: 'Conditional odds',
    difficulty: 1700,
    make(r) {
      if (r.next() < 0.5) {
        const n = r.pick([2, 3])
        // P(all n children boys | at least one boy)
        const v = 1 / (2 ** n - 1)
        return item('odds-hard', 1700, 'Condition by removing the cases ruled out', `A family has ${n} children, at least one a boy. P(all boys)? (a fraction)`, { type: 'number', value: v, tolerance: 1e-4 }, [`${2 ** n} equally likely orders`, `"At least one boy" rules out only all-girls: ${2 ** n - 1} left`, `All boys is 1 of them: 1/${2 ** n - 1}`])
      }
      const target = r.pick([6, 5])
      return item('odds-hard', 1700, 'E[rolls until a success] = 1/p', `Expected number of rolls of a fair die to see a ${target}`, { type: 'number', value: 6 }, ['Each roll succeeds with p = 1/6', 'A geometric wait has mean 1/p = 6'])
    }
  }
]

function fermi(r: Rng, lo: number, hi: number): WorkoutItem {
  const pool = FERMI.filter((f) => f.difficulty >= lo && f.difficulty <= hi)
  const f = pool[Math.floor(r.next() * pool.length)]
  return {
    round: 'odds',
    kind: 'odds.fermi',
    difficulty: f.difficulty,
    prompt: f.q,
    answer: { type: 'magnitude', value: f.value },
    steps: [...f.how, `Reference: ${sci(f.value)}`],
    rule: 'Estimate the order of magnitude',
    source: f.source
  }
}

function pairs(s: number): string {
  const out: string[] = []
  for (let a = 1; a <= 6; a++) {
    const b = s - a
    if (b >= 1 && b <= 6) out.push(`${a}+${b}`)
  }
  return out.join(', ')
}

