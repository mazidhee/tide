/**
 * The real datasets kept under <Tide data>/datasets, for SQL, pandas and ML lessons: what each
 * table is, where its file is, and a short catalogue the tutor reads to pick real data. The lab
 * loads a table the first time a query names it (main/datasets).
 */

export interface DatasetTable {
  /** The lab's table name */
  name: string
  /** The dataset folder it's in */
  dataset: string
  /** The file, from the datasets folder: one file, or a glob of monthly files (nyc-taxi/yellow_*.parquet) */
  file: string
  /** What it is, in a few words */
  about: string
  /** What it's good for in a lesson */
  goodFor: string
  /** Rows the lab loads at most (a sample spread over the file); the file itself may have more */
  labRows?: number
  delimiter?: string
}

/** The tables Tide knows how to describe; files that aren't there are left out of the catalogue */
export const DATASET_TABLES: DatasetTable[] = [
  { name: 'nyc_taxi_trips', dataset: 'nyc-taxi', file: 'nyc-taxi/yellow_*.parquet', about: 'NYC yellow-taxi trips (pickup and drop-off times and zones, distance, fare, tip, total, payment type)', goodFor: 'time-series GROUP BY, window functions, outliers, tip prediction, demand by hour', labRows: 150_000 },
  { name: 'taxi_zones', dataset: 'nyc-taxi', file: 'nyc-taxi/taxi_zone_lookup.csv', about: 'NYC taxi zones: LocationID to borough, zone and service area', goodFor: 'joins with nyc_taxi_trips (PULocationID, DOLocationID)' },
  { name: 'online_retail', dataset: 'uci', file: 'uci/extracted/online_retail_II.csv', about: 'UCI Online Retail II: a UK online shop’s invoice lines 2009-2011 (invoice, stock code, quantity, price, customer, country)', goodFor: 'cohorts, RFM, retention, basket analysis, returns (negative quantities)', labRows: 200_000 },
  { name: 'bank_marketing', dataset: 'uci', file: 'uci/extracted/bank-additional-full.csv', about: 'UCI Bank Marketing: a Portuguese bank’s phone campaign, client attributes and whether they subscribed (y)', goodFor: 'classification, class imbalance, logistic regression, conversion rates', delimiter: ';' },
  { name: 'credit_default', dataset: 'uci', file: 'uci/extracted/default_of_credit_card_clients.csv', about: 'UCI Default of Credit Card Clients (Taiwan, 2005): limit, demographics, six months of bills and payments, default next month', goodFor: 'credit risk, classification, feature engineering on payment history' },
  { name: 'housing', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/housing.csv', about: 'California housing (1990 census blocks): location, rooms, income, median house value', goodFor: 'linear regression, feature scaling, train/validation splits' },
  { name: 'car_fuel_efficiency', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/car_fuel_efficiency.csv', about: 'Cars: engine, weight, horsepower, origin and fuel efficiency', goodFor: 'regression, missing values, categorical encoding' },
  { name: 'airbnb_nyc', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/AB_NYC_2019.csv', about: 'Airbnb NYC 2019 listings: neighbourhood, room type, price, reviews, availability', goodFor: 'price regression, GROUP BY by area, skewed targets (log price)' },
  { name: 'bank_full', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/bank-full.csv', about: 'Bank Marketing (older full version) with balance and contact month', goodFor: 'classification, mutual information, one-hot encoding', delimiter: ';' },
  { name: 'credit_card_aer', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/AER_credit_card_data.csv', about: 'AER credit card applications: income, age, expenditure, whether the card was granted', goodFor: 'logistic regression, ROC AUC' },
  { name: 'course_lead_scoring', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/course_lead_scoring.csv', about: 'Course leads: source, industry, interactions and whether they converted', goodFor: 'classification, missing values, lead scoring' },
  { name: 'laptops', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/laptops.csv', about: 'Laptops: brand, RAM, storage, screen and final price', goodFor: 'regression, regularisation' },
  { name: 'jamb_exam_results', dataset: 'ml-zoomcamp', file: 'ml-zoomcamp/jamb_exam_results.csv', about: 'Nigerian JAMB exam scores with study hours, attendance and background', goodFor: 'tree models, feature importance' }
]

export interface DatasetInfo extends DatasetTable {
  /** The file's absolute path (the first month for a monthly set), for pandas */
  abs: string
  /** Every file of a monthly set */
  files: string[]
  rows: number
  columns: { name: string; type: string }[]
  bytes: number
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

/**
 * The catalogue the tutor reads: one line a table with rows, the first columns, what it suits and
 * the path pandas reads it from. `parquet` says whether pandas can read Parquet here.
 */
export function datasetCatalogue(tables: DatasetInfo[], o: { parquet?: boolean; maxColumns?: number } = {}): string {
  if (!tables.length) return ''
  const max = o.maxColumns ?? 10
  const lines = tables.map((t) => {
    const cols = t.columns.slice(0, max).map((c) => c.name).join(', ') + (t.columns.length > max ? `, … (${t.columns.length} columns)` : '')
    const sample = t.labRows && t.rows > t.labRows ? (t.abs.endsWith('.parquet') ? ` (the lab holds a ${fmt(t.labRows)}-row sample spread across it)` : ` (the lab holds the first ${fmt(t.labRows)})`) : ''
    const where = t.files.length > 1 ? `${t.files.length} files like ${t.abs}` : t.abs
    return `- ${t.name}: ${t.about}. ${fmt(t.rows)} rows${sample}; columns ${cols}. Good for ${t.goodFor}. File: ${where}`
  })
  const note = o.parquet === false ? ' The student’s python3 has pandas but not pyarrow, so pandas can’t read .parquet yet: query those in the lab, or have them run `python3 -m pip install pyarrow`.' : ''
  return `Real datasets on this Mac. In the SQL lab, query a table by name with run_sql (it loads the first time a query names it). In Python, read the file by its path (pd.read_csv / pd.read_parquet).${note}\n${lines.join('\n')}`
}

/** The dataset tables a query names, so the lab loads only those */
export function tablesNamed(sql: string, names: string[]): string[] {
  const low = sql.toLowerCase()
  return names.filter((n) => new RegExp(`\\b${n}\\b`).test(low))
}

/** Evenly spaced row ranges covering `total` rows, `want` rows in all, in `slices` pieces */
export function sampleRanges(total: number, want: number, slices = 24): [number, number][] {
  if (total <= want) return [[0, total]]
  const per = Math.max(1, Math.floor(want / slices))
  const step = Math.floor(total / slices)
  const out: [number, number][] = []
  for (let i = 0; i < slices; i++) out.push([i * step, Math.min(total, i * step + per)])
  return out
}
