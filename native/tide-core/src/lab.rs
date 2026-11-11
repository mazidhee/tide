//! The data lab: a small SQLite database a lesson can run real queries against, so SQL and
//! product analytics are learnt on data rather than read about. It holds sample datasets made by
//! a seeded generator (the same rows on every Mac, every time), runs what the tutor or the
//! learner writes, and hands back the result as columns and rows.
//!
//! It is safe by construction rather than by inspecting the SQL. An authoriser refuses ATTACH,
//! DETACH, load_extension and every pragma that isn't a plain look at the schema; the limit on
//! attached databases is zero (which also stops VACUUM INTO); a progress handler stops a query
//! after about two seconds; the database can't grow past about 100 MB; and what comes back is
//! capped in rows and in the size of each cell.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::ValueRef;
use rusqlite::{Batch, Connection};
use serde_json::Value;

/// How long one call to `query` may run
const QUERY_MS: u64 = 2_000;
/// Never more rows than this, whatever the caller asks for
const MAX_ROWS: usize = 5_000;
/// Text longer than this many characters is cut, with an ellipsis
const MAX_CELL: usize = 2_000;
/// About 100 MB of 4 KB pages
const MAX_PAGES: u32 = 25_000;
/// The most columns `load_table` will make
const LOAD_COLUMNS: usize = 200;

/// Pragmas that only read the schema or change how this one connection compares and checks
const PRAGMAS: &[&str] = &[
  "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list", "foreign_key_check", "foreign_keys",
  "collation_list", "function_list", "pragma_list", "compile_options", "case_sensitive_like", "integrity_check", "quick_check", "user_version",
];

fn err<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
}

#[napi(object)]
#[derive(Debug, Default)]
pub struct LabResult {
  pub columns: Vec<String>,
  /// One per column: the declared type in lower case ("integer", "date"), or for an expression the kind of its first value ("integer", "real", "text", "blob"); "" when unknown
  pub types: Vec<String>,
  pub rows: Vec<Vec<Value>>,
  /// Every row the last statement produced, including those not returned
  pub row_count: u32,
  pub truncated: bool,
  /// Rows inserted, updated or deleted, when the last statement was a write
  pub changes: Option<u32>,
  pub elapsed_ms: f64,
  /// SQLite's own message when a statement failed; the rest is then empty
  pub error: Option<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct LabColumn {
  pub name: String,
  #[napi(js_name = "type")]
  pub kind: String,
  pub primary_key: bool,
  pub not_null: bool,
}

#[napi(object)]
#[derive(Debug)]
pub struct LabForeignKey {
  pub column: String,
  pub table: String,
  pub to: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct LabTable {
  pub name: String,
  /// "table" or "view"
  pub kind: String,
  pub columns: Vec<LabColumn>,
  pub rows: u32,
  pub foreign_keys: Vec<LabForeignKey>,
}

/// The clock the progress handler watches: a deadline in milliseconds since `start`, 0 when nothing is being timed
struct Watch {
  start: Instant,
  deadline: AtomicU64,
  stopped: AtomicBool,
}

#[napi]
pub struct Lab {
  conn: Mutex<Connection>,
  watch: Arc<Watch>,
  seeded: Mutex<Vec<String>>,
}

fn authorise(ctx: AuthContext<'_>) -> Authorization {
  match ctx.action {
    AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
    AuthAction::Function { function_name } if function_name.eq_ignore_ascii_case("load_extension") => Authorization::Deny,
    AuthAction::Pragma { pragma_name, .. } if !PRAGMAS.contains(&pragma_name.to_ascii_lowercase().as_str()) => Authorization::Deny,
    _ => Authorization::Allow,
  }
}

fn open(path: Option<&str>, watch: &Arc<Watch>) -> rusqlite::Result<Connection> {
  let conn = match path {
    Some(p) => Connection::open(p)?,
    None => Connection::open_in_memory()?,
  };
  // Sorting never spills to a file, and a runaway INSERT can't eat the Mac's memory
  conn.execute_batch(&format!("PRAGMA temp_store = MEMORY; PRAGMA max_page_count = {MAX_PAGES};"))?;
  let _ = conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
  conn.authorizer(Some(authorise));
  let w = watch.clone();
  conn.progress_handler(
    2_000,
    Some(move || {
      let deadline = w.deadline.load(Ordering::Relaxed);
      let over = deadline != 0 && w.start.elapsed().as_millis() as u64 > deadline;
      if over {
        w.stopped.store(true, Ordering::Relaxed);
      }
      over
    }),
  );
  Ok(conn)
}

fn cell(v: ValueRef<'_>) -> Value {
  match v {
    ValueRef::Null => Value::Null,
    ValueRef::Integer(i) => Value::from(i),
    ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
    ValueRef::Text(t) => {
      let s = String::from_utf8_lossy(t);
      if s.chars().count() > MAX_CELL {
        Value::String(s.chars().take(MAX_CELL).chain(std::iter::once('…')).collect())
      } else {
        Value::String(s.into_owned())
      }
    }
    ValueRef::Blob(b) => Value::String(format!("<blob, {} bytes>", b.len())),
  }
}

fn kind_of(v: ValueRef<'_>) -> &'static str {
  match v {
    ValueRef::Null => "",
    ValueRef::Integer(_) => "integer",
    ValueRef::Real(_) => "real",
    ValueRef::Text(_) => "text",
    ValueRef::Blob(_) => "blob",
  }
}

/// Runs each statement in turn and keeps the result of the last one
fn run(conn: &Connection, sql: &str, max_rows: usize) -> rusqlite::Result<LabResult> {
  let mut out = LabResult::default();
  let mut batch = Batch::new(conn, sql);
  while let Some(mut stmt) = batch.next()? {
    out = LabResult::default();
    let n = stmt.column_count();
    if n == 0 {
      out.changes = Some(stmt.raw_execute()? as u32);
      // CREATE, DROP and the like report whatever the write before them changed: say nothing instead
      if stmt.readonly() || !is_write(&stmt.expanded_sql().unwrap_or_default()) {
        out.changes = None;
      }
      continue;
    }
    out.columns = stmt.column_names().into_iter().map(String::from).collect();
    out.types = stmt.columns().iter().map(|c| c.decl_type().unwrap_or("").to_ascii_lowercase()).collect();
    let mut rows = stmt.raw_query();
    let mut total = 0usize;
    while let Some(row) = rows.next()? {
      total += 1;
      if out.rows.len() >= max_rows {
        continue;
      }
      let mut cells = Vec::with_capacity(n);
      for i in 0..n {
        let v = row.get_ref(i)?;
        if out.types[i].is_empty() {
          out.types[i] = kind_of(v).to_string();
        }
        cells.push(cell(v));
      }
      out.rows.push(cells);
    }
    out.row_count = total.min(u32::MAX as usize) as u32;
    out.truncated = total > out.rows.len();
  }
  Ok(out)
}

fn is_write(sql: &str) -> bool {
  let head = sql.trim_start().get(..7).unwrap_or("").to_ascii_lowercase();
  ["insert", "update", "delete", "replace"].iter().any(|w| head.starts_with(w)) || head.starts_with("with")
}

#[napi]
impl Lab {
  /// Opens the database file at `path`, or an empty one in memory when no path is given
  #[napi(constructor)]
  pub fn new(path: Option<String>) -> Result<Self> {
    let watch = Arc::new(Watch { start: Instant::now(), deadline: AtomicU64::new(0), stopped: AtomicBool::new(false) });
    let conn = open(path.as_deref(), &watch).map_err(err)?;
    Ok(Lab { conn: Mutex::new(conn), watch, seeded: Mutex::new(Vec::new()) })
  }

  /// Fills in a sample dataset, "shop" or "events". The rows are the same every time; a dataset
  /// whose tables are already there is left alone, whatever has been done to them.
  #[napi]
  pub fn seed(&self, name: String) -> Result<()> {
    let mut conn = self.conn.lock().map_err(err)?;
    let tables: &[&str] = match name.as_str() {
      "shop" => &["customers", "products", "orders", "order_items"],
      "events" => &["users", "events"],
      _ => return Err(err(format!("There is no sample dataset called \"{name}\": the lab has \"shop\" and \"events\"."))),
    };
    let mut seeded = self.seeded.lock().map_err(err)?;
    if !seeded.contains(&name) {
      seeded.push(name.clone());
    }
    let present = tables.iter().filter(|t| exists(&conn, t)).count();
    if present == tables.len() {
      return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    for t in tables.iter().rev() {
      tx.execute_batch(&format!("DROP TABLE IF EXISTS {t};")).map_err(err)?;
    }
    match name.as_str() {
      "shop" => seed_shop(&tx),
      _ => seed_events(&tx),
    }
    .map_err(err)?;
    tx.commit().map_err(err)
  }

  /// Runs one or more statements and returns the result of the last. A mistake in the SQL is not
  /// a failure of the call: it comes back in `error`, in SQLite's own words.
  #[napi]
  pub fn query(&self, sql: String, max_rows: u32) -> Result<LabResult> {
    let conn = self.conn.lock().map_err(err)?;
    Ok(self.query_on(&conn, &sql, max_rows as usize))
  }

  fn query_on(&self, conn: &Connection, sql: &str, max_rows: usize) -> LabResult {
    let t0 = Instant::now();
    self.watch.stopped.store(false, Ordering::Relaxed);
    self.watch.deadline.store(self.watch.start.elapsed().as_millis() as u64 + QUERY_MS, Ordering::Relaxed);
    let result = run(conn, sql, max_rows.clamp(1, MAX_ROWS));
    self.watch.deadline.store(0, Ordering::Relaxed);
    // A statement stopped or failed halfway through a transaction it opened must not leave the lab stuck inside it
    if result.is_err() && !conn.is_autocommit() {
      let _ = conn.execute_batch("ROLLBACK");
    }
    let mut out = match result {
      Ok(r) => r,
      Err(e) => {
        let text = match &e {
          rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
          rusqlite::Error::SqlInputError { msg, .. } => msg.clone(),
          other => other.to_string(),
        };
        let text = if self.watch.stopped.load(Ordering::Relaxed) {
          format!("Stopped after {} seconds: the query was taking too long. Narrow it with a WHERE or a LIMIT, or check a join isn't multiplying rows.", QUERY_MS / 1000)
        } else if text == "not authorized" {
          "not authorized: the lab doesn't allow ATTACH, DETACH, extensions or pragmas that touch files or settings.".to_string()
        } else {
          text
        };
        LabResult { error: Some(text), ..LabResult::default() }
      }
    };
    out.elapsed_ms = (t0.elapsed().as_secs_f64() * 1_000_000.0).round() / 1_000.0;
    out
  }

  /// Every table and view: its columns, how many rows it holds, and which columns point at other tables
  #[napi]
  pub fn schema(&self) -> Result<Vec<LabTable>> {
    let conn = self.conn.lock().map_err(err)?;
    let mut names = conn.prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY rowid").map_err(err)?;
    let found: Vec<(String, String)> = names.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
    let mut tables = Vec::new();
    for (name, kind) in found {
      let mut cols = conn.prepare("SELECT name, type, pk, \"notnull\" FROM pragma_table_info(?1)").map_err(err)?;
      let columns = cols
        .query_map([&name], |r| Ok(LabColumn { name: r.get(0)?, kind: r.get::<_, String>(1)?.to_ascii_lowercase(), primary_key: r.get::<_, i64>(2)? > 0, not_null: r.get::<_, i64>(3)? > 0 }))
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .unwrap_or_default();
      let mut fks = conn.prepare("SELECT \"from\", \"table\", coalesce(\"to\", '') FROM pragma_foreign_key_list(?1)").map_err(err)?;
      let foreign_keys = fks
        .query_map([&name], |r| Ok(LabForeignKey { column: r.get(0)?, table: r.get(1)?, to: r.get(2)? }))
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .unwrap_or_default();
      // A view over a broken query still gets listed, with no count
      let rows = conn.query_row(&format!("SELECT count(*) FROM \"{}\"", name.replace('"', "\"\"")), [], |r| r.get::<_, i64>(0)).unwrap_or(0) as u32;
      tables.push(LabTable { name, kind, columns, rows, foreign_keys });
    }
    Ok(tables)
  }

  /// Throws away everything in the database and puts back the sample datasets it had, as new
  #[napi]
  pub fn reset(&self) -> Result<()> {
    {
      let conn = self.conn.lock().map_err(err)?;
      if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK");
      }
      let mut stmt = conn.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('trigger', 'view', 'table')").map_err(err)?;
      let mut objects: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
      // Triggers and views go before the tables they stand on; a table takes its indexes with it
      objects.sort_by_key(|(kind, _)| match kind.as_str() {
        "trigger" => 0,
        "view" => 1,
        _ => 2,
      });
      conn.execute_batch("PRAGMA foreign_keys = OFF;").map_err(err)?;
      for (kind, name) in objects {
        conn.execute_batch(&format!("DROP {} IF EXISTS \"{}\";", kind.to_uppercase(), name.replace('"', "\"\""))).map_err(err)?;
      }
      conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(err)?;
    }
    let names = self.seeded.lock().map_err(err)?.clone();
    for name in names {
      self.seed(name)?;
    }
    Ok(())
  }

  /// Makes a table from rows read out of a file (a CSV the learner keeps in their notes), replacing
  /// a table of the same name. Cells arrive as text and are stored by the column's type: "integer",
  /// "real" or "text"; a missing or null cell is NULL. One prepared statement inside one savepoint,
  /// so a failure halfway leaves the lab as it was. Returns how many rows went in.
  #[napi]
  pub fn load_table(&self, name: String, columns: Vec<String>, types: Vec<String>, rows: Vec<Vec<Option<String>>>) -> Result<u32> {
    if !identifier(&name) || name.to_ascii_lowercase().starts_with("sqlite_") {
      return Err(err(format!("\"{name}\" can't be used as a table name.")));
    }
    if columns.is_empty() || columns.len() != types.len() || columns.len() > LOAD_COLUMNS {
      return Err(err(format!("A loaded table needs between 1 and {LOAD_COLUMNS} columns, each with a type.")));
    }
    if let Some(bad) = columns.iter().find(|c| !identifier(c)) {
      return Err(err(format!("\"{bad}\" can't be used as a column name.")));
    }
    if let Some(bad) = types.iter().find(|t| !matches!(t.as_str(), "integer" | "real" | "text")) {
      return Err(err(format!("\"{bad}\" isn't a column type the lab loads: use integer, real or text.")));
    }
    let mut conn = self.conn.lock().map_err(err)?;
    let full = |e: rusqlite::Error| match e.sqlite_error_code() {
      Some(rusqlite::ErrorCode::DiskFull) => err(format!("The lab is full: it holds about {} MB, and this table would take it past that.", MAX_PAGES / 250)),
      _ => err(e),
    };
    // A savepoint rather than a transaction: it also works inside a BEGIN the learner left open
    let sp = conn.savepoint().map_err(err)?;
    let defs: Vec<String> = columns.iter().zip(&types).map(|(c, t)| format!("\"{c}\" {}", t.to_ascii_uppercase())).collect();
    sp.execute_batch(&format!("DROP TABLE IF EXISTS \"{name}\"; CREATE TABLE \"{name}\" ({});", defs.join(", "))).map_err(err)?;
    {
      let marks = vec!["?"; columns.len()].join(", ");
      let mut insert = sp.prepare(&format!("INSERT INTO \"{name}\" VALUES ({marks})")).map_err(err)?;
      for row in &rows {
        for (i, kind) in types.iter().enumerate() {
          let at = i + 1;
          match row.get(i).and_then(|c| c.as_deref()) {
            None => insert.raw_bind_parameter(at, rusqlite::types::Null),
            Some(text) => match kind.as_str() {
              "integer" => match text.trim().parse::<i64>() {
                Ok(n) => insert.raw_bind_parameter(at, n),
                Err(_) => insert.raw_bind_parameter(at, text),
              },
              "real" => match text.trim().parse::<f64>() {
                Ok(f) if f.is_finite() => insert.raw_bind_parameter(at, f),
                _ => insert.raw_bind_parameter(at, text),
              },
              _ => insert.raw_bind_parameter(at, text),
            },
          }
          .map_err(err)?;
        }
        insert.raw_execute().map_err(full)?;
      }
    }
    sp.commit().map_err(full)?;
    Ok(rows.len().min(u32::MAX as usize) as u32)
  }
}

/// A name that needs no quoting: a letter or underscore, then letters, digits and underscores
fn identifier(s: &str) -> bool {
  let mut chars = s.chars();
  s.len() <= 64 && chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn exists(conn: &Connection, table: &str) -> bool {
  conn.query_row("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1", [table], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0
}

// ---------- Sample data ----------

/// SplitMix64: tiny, well mixed, and the same numbers on every machine
struct Rng(u64);

impl Rng {
  fn next(&mut self) -> u64 {
    self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = self.0;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
  }

  /// A number in [0, 1)
  fn f(&mut self) -> f64 {
    (self.next() >> 11) as f64 / (1u64 << 53) as f64
  }

  fn below(&mut self, n: usize) -> usize {
    (self.f() * n as f64) as usize
  }

  fn chance(&mut self, p: f64) -> bool {
    self.f() < p
  }

  /// An index chosen in proportion to its weight
  fn weighted(&mut self, weights: &[f64]) -> usize {
    let mut at = self.f() * weights.iter().sum::<f64>();
    for (i, w) in weights.iter().enumerate() {
      at -= w;
      if at < 0.0 {
        return i;
      }
    }
    weights.len() - 1
  }
}

/// Days since 1970-01-01 for a calendar date (Howard Hinnant's algorithm)
fn day_number(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = y.div_euclid(400);
  let yoe = y - era * 400;
  let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
  era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// (year, month, day) for a day number
fn calendar(z: i64) -> (i64, i64, i64) {
  let z = z + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

fn date(z: i64) -> String {
  let (y, m, d) = calendar(z);
  format!("{y:04}-{m:02}-{d:02}")
}

/// A timestamp from seconds since 1970
fn stamp(secs: i64) -> String {
  let (day, s) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
  format!("{} {:02}:{:02}:{:02}", date(day), s / 3_600, s % 3_600 / 60, s % 60)
}

const COUNTRIES: &[(&str, f64)] = &[
  ("United Kingdom", 26.0), ("United States", 22.0), ("Germany", 11.0), ("France", 9.0), ("Nigeria", 8.0), ("Canada", 7.0), ("Netherlands", 5.0), ("Australia", 5.0), ("Spain", 4.0), ("Ireland", 3.0),
];
const FIRST: &[&str] = &[
  "Ada", "Tom", "Chidi", "Maya", "Lukas", "Sophie", "Ngozi", "James", "Elena", "Omar", "Hannah", "Kofi", "Isla", "Mateo", "Priya", "Daniel", "Amara", "Felix", "Zara", "Noah", "Ines", "Tunde", "Grace", "Leon", "Aisha", "Ben",
  "Clara", "Emeka", "Freya", "Hugo",
];
const LAST: &[&str] = &[
  "Okafor", "Smith", "Müller", "Dubois", "Patel", "Jones", "García", "Adeyemi", "Visser", "Murphy", "Schmidt", "Taylor", "Bello", "Martin", "Nguyen", "Brown", "Eze", "Wilson", "Fischer", "Moreau", "Clarke", "Okonkwo",
  "Jansen", "Kelly", "Weber",
];

/// (name, category, price): eight products in each of five categories
const PRODUCTS: &[(&str, &str, f64)] = &[
  ("Wireless earbuds", "Audio", 59.0), ("Over-ear headphones", "Audio", 129.0), ("Bluetooth speaker", "Audio", 45.0), ("Studio microphone", "Audio", 89.0), ("Turntable", "Audio", 179.0), ("Soundbar", "Audio", 149.0),
  ("Clip-on radio", "Audio", 24.0), ("Headphone stand", "Audio", 19.0),
  ("Mechanical keyboard", "Computing", 95.0), ("Ergonomic mouse", "Computing", 39.0), ("27-inch monitor", "Computing", 249.0), ("USB-C hub", "Computing", 34.0), ("Laptop stand", "Computing", 42.0), ("Webcam", "Computing", 65.0),
  ("Portable SSD 1TB", "Computing", 99.0), ("Desk mat", "Computing", 18.0),
  ("Pour-over kettle", "Home", 55.0), ("Cast-iron pan", "Home", 48.0), ("Linen throw", "Home", 62.0), ("Desk lamp", "Home", 36.0), ("Ceramic mug set", "Home", 28.0), ("Air purifier", "Home", 139.0), ("Scented candle", "Home", 16.0),
  ("Wall clock", "Home", 32.0),
  ("Two-person tent", "Outdoors", 189.0), ("Trail backpack", "Outdoors", 85.0), ("Insulated bottle", "Outdoors", 22.0), ("Head torch", "Outdoors", 27.0), ("Camping stove", "Outdoors", 58.0), ("Sleeping bag", "Outdoors", 74.0),
  ("Trekking poles", "Outdoors", 46.0), ("Picnic blanket", "Outdoors", 29.0),
  ("Dotted notebook", "Stationery", 12.0), ("Fountain pen", "Stationery", 38.0), ("Weekly planner", "Stationery", 17.0), ("Gel pen set", "Stationery", 9.0), ("Sticky notes pack", "Stationery", 6.0), ("Desk organiser", "Stationery", 23.0),
  ("Highlighter set", "Stationery", 7.0), ("A3 sketchbook", "Stationery", 14.0),
];

/// How much a category sells in a month (1 to 12), against its usual
fn season(category: &str, month: i64) -> f64 {
  match (category, month) {
    ("Outdoors", 5..=8) => 1.9,
    ("Outdoors", 11 | 12 | 1 | 2) => 0.45,
    ("Audio", 11 | 12) => 1.7,
    ("Home", 11 | 12) => 1.5,
    ("Stationery", 8 | 9) => 1.8,
    ("Stationery", 1) => 1.3,
    _ => 1.0,
  }
}

fn country(rng: &mut Rng) -> &'static str {
  let weights: Vec<f64> = COUNTRIES.iter().map(|c| c.1).collect();
  COUNTRIES[rng.weighted(&weights)].0
}

/// A shop: customers, products, eighteen months of orders (busier towards Christmas and at
/// weekends, and growing), and the lines of each order.
fn seed_shop(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
  tx.execute_batch(
    "CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, country TEXT NOT NULL, segment TEXT NOT NULL, signup_date DATE NOT NULL);
     CREATE TABLE products (product_id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL);
     CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(customer_id), order_date DATE NOT NULL, status TEXT NOT NULL);
     CREATE TABLE order_items (order_item_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(order_id), product_id INTEGER NOT NULL REFERENCES products(product_id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);
     CREATE INDEX orders_customer ON orders(customer_id);
     CREATE INDEX orders_date ON orders(order_date);
     CREATE INDEX order_items_order ON order_items(order_id);
     CREATE INDEX order_items_product ON order_items(product_id);",
  )?;
  let mut rng = Rng(0x7_1DE_5409);
  let start = day_number(2024, 1, 1);
  let days = day_number(2025, 7, 1) - start;

  // Customers, in the order they signed up: about half were there before the first order
  let mut signups: Vec<i64> = (0..300).map(|_| start - 400 + (900.0 * rng.f().powf(1.25)) as i64).collect();
  signups.sort_unstable();
  let mut activity = Vec::with_capacity(signups.len());
  let mut segments = Vec::with_capacity(signups.len());
  {
    let mut insert = tx.prepare("INSERT INTO customers VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
    for (i, signup) in signups.iter().enumerate() {
      let (first, last) = (FIRST[rng.below(FIRST.len())], LAST[rng.below(LAST.len())]);
      let segment = ["consumer", "small business", "enterprise"][rng.weighted(&[68.0, 24.0, 8.0])];
      let plain: String = format!("{first}.{last}").to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { 'u' }).collect();
      insert.execute(rusqlite::params![i as i64 + 1, format!("{first} {last}"), format!("{plain}{}@example.com", i + 1), country(&mut rng), segment, date(*signup)])?;
      // A few customers order again and again; most order once or twice
      activity.push(0.12 + 3.0 * rng.f().powi(3) + if segment == "consumer" { 0.0 } else { 0.5 });
      segments.push(segment);
    }
  }
  {
    let mut insert = tx.prepare("INSERT INTO products VALUES (?1, ?2, ?3, ?4)")?;
    for (i, (name, category, price)) in PRODUCTS.iter().enumerate() {
      insert.execute(rusqlite::params![i as i64 + 1, name, category, price])?;
    }
  }

  const MONTH: [f64; 12] = [0.82, 0.80, 0.92, 0.98, 1.02, 1.05, 1.0, 0.96, 1.04, 1.10, 1.45, 1.70];
  const WEEKDAY: [f64; 7] = [1.15, 0.95, 0.9, 0.92, 0.98, 1.05, 1.2]; // from Sunday
  let weight = |d: i64| {
    let (_, m, _) = calendar(start + d);
    MONTH[m as usize - 1] * WEEKDAY[(start + d + 4).rem_euclid(7) as usize] * (1.0 + 0.5 * d as f64 / days as f64)
  };
  let total: f64 = (0..days).map(weight).sum();
  let top = activity.iter().cloned().fold(0.0, f64::max);
  let mut order = tx.prepare("INSERT INTO orders VALUES (?1, ?2, ?3, ?4)")?;
  let mut item = tx.prepare("INSERT INTO order_items VALUES (?1, ?2, ?3, ?4, ?5)")?;
  let (mut order_id, mut item_id) = (0i64, 0i64);
  for d in 0..days {
    let expected = 2_500.0 * weight(d) / total;
    let count = expected.floor() as usize + usize::from(rng.chance(expected.fract()));
    let (_, month, _) = calendar(start + d);
    let known = signups.partition_point(|s| *s <= start + d);
    let popular: Vec<f64> = PRODUCTS.iter().enumerate().map(|(i, p)| season(p.1, month) / (1.0 + (i % 8) as f64 * 0.22)).collect();
    for _ in 0..count {
      let customer = loop {
        let c = rng.below(known);
        if rng.chance(activity[c] / top) {
          break c;
        }
      };
      let status = if d >= days - 5 && rng.chance(0.7) {
        "processing"
      } else {
        ["completed", "cancelled", "refunded"][rng.weighted(&[89.0, 6.0, 5.0])]
      };
      order_id += 1;
      order.execute(rusqlite::params![order_id, customer as i64 + 1, date(start + d), status])?;
      let lines = 1 + rng.weighted(&[28.0, 30.0, 22.0, 13.0, 7.0]);
      let mut chosen: Vec<usize> = Vec::with_capacity(lines);
      while chosen.len() < lines {
        let p = rng.weighted(&popular);
        if !chosen.contains(&p) {
          chosen.push(p);
        }
      }
      for p in chosen {
        let mut quantity = 1 + rng.weighted(&[70.0, 19.0, 7.0, 3.0, 1.0]) as i64;
        if segments[customer] == "enterprise" {
          quantity *= 2 + rng.below(3) as i64;
        }
        // One line in nine was bought in a sale
        let price = if rng.chance(0.11) { (PRODUCTS[p].2 * 85.0).round() / 100.0 } else { PRODUCTS[p].2 };
        item_id += 1;
        item.execute(rusqlite::params![item_id, order_id, p as i64 + 1, quantity, price])?;
      }
    }
  }
  Ok(())
}

struct Event {
  at: i64,
  user: i64,
  session: i64,
  name: &'static str,
  platform: &'static str,
  item: Option<usize>,
  amount: Option<f64>,
}

/// Product analytics, the way Mixpanel or Amplitude hold it: one row per user, one row per thing
/// a user did. Twenty-seven weeks from Monday 6 January 2025. Everyone signs up; most look at
/// something that week; fewer come back each week after, levelling off rather than reaching
/// zero (one in nine never comes back at all); and each visit loses people between viewing, adding to the cart, checking out and
/// buying, at rates that differ by platform and plan.
fn seed_events(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
  tx.execute_batch(
    "CREATE TABLE users (user_id INTEGER PRIMARY KEY, signup_date DATE NOT NULL, plan TEXT NOT NULL, platform TEXT NOT NULL, country TEXT NOT NULL);
     CREATE TABLE events (event_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(user_id), session_id INTEGER, event TEXT NOT NULL, ts TIMESTAMP NOT NULL, platform TEXT NOT NULL, item_id INTEGER, category TEXT, amount REAL);
     CREATE INDEX events_user ON events(user_id, ts);
     CREATE INDEX events_event ON events(event, ts);",
  )?;
  let mut rng = Rng(0xE7E_2025);
  let start = day_number(2025, 1, 6);
  const DAYS: i64 = 189;
  let end = (start + DAYS) * 86_400;

  // Signups grow through the period
  let mut signups: Vec<i64> = (0..800).map(|_| (182.0 * rng.f().powf(0.8)) as i64).collect();
  signups.sort_unstable();
  let popular: Vec<f64> = (0..PRODUCTS.len()).map(|i| 1.0 / (1.0 + (i % 8) as f64 * 0.3)).collect();
  let mut events: Vec<Event> = Vec::with_capacity(32_000);
  let mut session = 0i64;
  let mut insert = tx.prepare("INSERT INTO users VALUES (?1, ?2, ?3, ?4, ?5)")?;
  for (i, day) in signups.iter().enumerate() {
    let user = i as i64 + 1;
    let plan = ["free", "plus", "pro"][rng.weighted(&[70.0, 20.0, 10.0])];
    let platform = ["ios", "android", "web"][rng.weighted(&[38.0, 34.0, 28.0])];
    insert.execute(rusqlite::params![user, date(start + day), plan, platform, country(&mut rng)])?;
    let joined = (start + day) * 86_400 + 7 * 3_600 + rng.below(16 * 3_600) as i64;
    session += 1;
    events.push(Event { at: joined, user, session, name: "signup", platform, item: None, amount: None });

    // How much this person takes to the product: it scales every later week
    let keen = ((0.25 + 0.75 * rng.f()) * match plan { "pro" => 1.35, "plus" => 1.15, _ => 1.0 }).min(1.0);
    let (cart, buy) = match platform {
      "web" => (0.066, 0.60),
      "ios" => (0.055, 0.68),
      _ => (0.044, 0.46),
    };
    // One in nine signs up and is never seen again
    let ghost = rng.chance(0.11);
    let mut week = 0;
    loop {
      let from = if week == 0 { joined + 60 } else { (start + day + 7 * week) * 86_400 };
      let to = ((start + day + 7 * (week + 1)) * 86_400).min(end);
      if from >= to || ghost {
        break;
      }
      let active = if week == 0 { 0.82 } else { keen * (0.24 + 0.46 * (-(week as f64 - 1.0) / 3.5).exp()) };
      week += 1;
      if !rng.chance(active) {
        continue;
      }
      for _ in 0..1 + rng.weighted(&[32.0, 34.0, 22.0, 12.0]) {
        session += 1;
        let mut at = from + rng.below((to - from) as usize) as i64;
        let mut carted: Vec<usize> = Vec::new();
        let mut views = 1;
        while views < 12 && rng.chance(0.82) {
          views += 1;
        }
        for _ in 0..views {
          let item = rng.weighted(&popular);
          events.push(Event { at, user, session, name: "view_item", platform, item: Some(item), amount: None });
          at += 15 + rng.below(160) as i64;
          if rng.chance(cart) {
            events.push(Event { at, user, session, name: "add_to_cart", platform, item: Some(item), amount: None });
            carted.push(item);
            at += 10 + rng.below(90) as i64;
          }
        }
        if !carted.is_empty() && rng.chance(0.52) {
          events.push(Event { at, user, session, name: "checkout_started", platform, item: None, amount: None });
          at += 30 + rng.below(240) as i64;
          if rng.chance(buy) {
            let amount = carted.iter().map(|p| PRODUCTS[*p].2).sum::<f64>();
            events.push(Event { at, user, session, name: "purchase", platform, item: None, amount: Some(amount) });
          }
        }
      }
    }
  }
  drop(insert);
  events.retain(|e| e.at < end);
  events.sort_by_key(|e| (e.at, e.session));
  let mut insert = tx.prepare("INSERT INTO events VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")?;
  for (i, e) in events.iter().enumerate() {
    insert.execute(rusqlite::params![i as i64 + 1, e.user, e.session, e.name, stamp(e.at), e.platform, e.item.map(|p| p as i64 + 1), e.item.map(|p| PRODUCTS[p].1), e.amount])?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn lab() -> Lab {
    let lab = Lab::new(None).unwrap();
    lab.seed("shop".into()).unwrap();
    lab.seed("events".into()).unwrap();
    lab
  }

  fn one(lab: &Lab, sql: &str) -> f64 {
    let r = lab.query(sql.into(), 10).unwrap();
    assert_eq!(r.error, None, "{sql}");
    r.rows[0][0].as_f64().unwrap()
  }

  /// A fingerprint of every row of a table, in order
  fn print(lab: &Lab, table: &str) -> String {
    let r = lab.query(format!("SELECT * FROM {table}"), 5_000).unwrap();
    let total = one(lab, &format!("SELECT count(*) FROM {table}"));
    format!("{total}:{}", serde_json::to_string(&r.rows[..r.rows.len().min(400)]).unwrap())
  }

  fn cells(rows: &[&[Option<&str>]]) -> Vec<Vec<Option<String>>> {
    rows.iter().map(|r| r.iter().map(|c| c.map(String::from)).collect()).collect()
  }

  #[test]
  fn load_table_stores_typed_values_and_nulls() {
    let lab = lab();
    let rows = cells(&[&[Some("1"), Some("2.5"), Some("007"), Some("2025-01-06")], &[Some("-9223372036854775808"), Some("3"), None, Some("")], &[None, None, Some("x")]]);
    let n = lab.load_table("mine".into(), vec!["id".into(), "amount".into(), "code".into(), "day".into()], vec!["integer".into(), "real".into(), "text".into(), "text".into()], rows).unwrap();
    assert_eq!(n, 3);
    let r = lab.query("SELECT typeof(id), typeof(amount), typeof(code), typeof(day) FROM mine ORDER BY rowid".into(), 10).unwrap();
    assert_eq!(serde_json::to_string(&r.rows).unwrap(), r#"[["integer","real","text","text"],["integer","real","null","text"],["null","null","text","null"]]"#);
    assert_eq!(one(&lab, "SELECT min(id) FROM mine"), i64::MIN as f64);
    let r = lab.query("SELECT code, sum(amount) FROM mine WHERE code = '007'".into(), 10).unwrap();
    assert_eq!(serde_json::to_string(&r.rows).unwrap(), r#"[["007",2.5]]"#);
    let t = lab.schema().unwrap().into_iter().find(|t| t.name == "mine").unwrap();
    assert_eq!(t.rows, 3);
    assert_eq!(t.columns.iter().map(|c| format!("{} {}", c.name, c.kind)).collect::<Vec<_>>(), ["id integer", "amount real", "code text", "day text"]);
    // The sample data is untouched, and joins against it work
    assert_eq!(one(&lab, "SELECT count(*) FROM customers c JOIN mine m ON m.id = c.customer_id"), 1.0);
  }

  #[test]
  fn load_table_replaces_and_is_dropped_by_reset() {
    let lab = lab();
    let cols = || (vec!["a".to_string()], vec!["integer".to_string()]);
    lab.load_table("mine".into(), cols().0, cols().1, cells(&[&[Some("1")], &[Some("2")]])).unwrap();
    lab.load_table("mine".into(), cols().0, cols().1, cells(&[&[Some("5")]])).unwrap();
    assert_eq!(one(&lab, "SELECT sum(a) FROM mine"), 5.0);
    // Inside a transaction the learner left open it still loads, and the rollback takes it away again
    lab.query("BEGIN".into(), 10).unwrap();
    lab.load_table("other".into(), cols().0, cols().1, cells(&[&[Some("1")]])).unwrap();
    assert_eq!(one(&lab, "SELECT count(*) FROM other"), 1.0);
    lab.query("ROLLBACK".into(), 10).unwrap();
    assert!(lab.query("SELECT * FROM other".into(), 10).unwrap().error.is_some());
    lab.reset().unwrap();
    assert_eq!(lab.query("SELECT * FROM mine".into(), 10).unwrap().error.as_deref(), Some("no such table: mine"));
  }

  #[test]
  fn load_table_refuses_unsafe_names_and_keeps_the_lab_safe() {
    let lab = lab();
    let one_col = || (vec!["a".to_string()], vec!["text".to_string()]);
    for bad in ["", "1st", "a b", "x\"; DROP TABLE customers; --", "sqlite_master", "SQLITE_x", "naïve"] {
      assert!(lab.load_table(bad.into(), one_col().0, one_col().1, vec![]).is_err(), "{bad}");
    }
    assert!(lab.load_table("t".into(), vec!["a\"b".into()], vec!["text".into()], vec![]).is_err());
    assert!(lab.load_table("t".into(), vec!["a".into()], vec!["blob".into()], vec![]).is_err());
    assert!(lab.load_table("t".into(), vec![], vec![], vec![]).is_err());
    assert!(lab.load_table("t".into(), vec!["a".into(), "b".into()], vec!["text".into()], vec![]).is_err());
    assert_eq!(one(&lab, "SELECT count(*) FROM customers"), 300.0);
    // A value that isn't what its column says is kept as text rather than lost
    lab.load_table("t".into(), vec!["n".into()], vec!["integer".into()], cells(&[&[Some("12")], &[Some("twelve")], &[Some("99999999999999999999")]])).unwrap();
    let r = lab.query("SELECT typeof(n), n FROM t ORDER BY rowid".into(), 10).unwrap();
    assert_eq!(r.rows[1][0], "text");
    assert_eq!(r.rows[1][1], "twelve");
    // The rules that guard the lab still hold with a loaded table in it
    assert!(lab.query("ATTACH DATABASE ':memory:' AS other".into(), 10).unwrap().error.is_some());
    assert!(lab.query("PRAGMA writable_schema = 1".into(), 10).unwrap().error.unwrap().contains("not authorized"));
    assert_eq!(lab.query("SELECT * FROM t".into(), 2).unwrap().rows.len(), 2);
  }

  #[test]
  fn load_table_is_quick_and_stops_at_the_size_limit() {
    let lab = lab();
    let rows: Vec<Vec<Option<String>>> = (0..100_000).map(|i| vec![Some(i.to_string()), Some(format!("{}.5", i % 97)), Some(format!("row {i}"))]).collect();
    let t0 = Instant::now();
    lab.load_table("big".into(), vec!["id".into(), "x".into(), "label".into()], vec!["integer".into(), "real".into(), "text".into()], rows).unwrap();
    assert!(t0.elapsed().as_secs_f64() < 5.0, "{:?}", t0.elapsed());
    assert_eq!(one(&lab, "SELECT count(*) FROM big"), 100_000.0);
    // Past about 100 MB the load fails whole, with the table that was there before left in place
    let wide = "x".repeat(2_000);
    let rows: Vec<Vec<Option<String>>> = (0..60_000).map(|_| vec![Some(wide.clone())]).collect();
    lab.load_table("small".into(), vec!["a".into()], vec!["text".into()], cells(&[&[Some("kept")]])).unwrap();
    let e = lab.load_table("small".into(), vec!["a".into()], vec!["text".into()], rows).unwrap_err();
    assert!(e.reason.contains("The lab is full"), "{}", e.reason);
    let r = lab.query("SELECT a FROM small".into(), 10).unwrap();
    assert_eq!(r.rows[0][0], "kept");
  }

  #[test]
  fn dates_round_trip() {
    assert_eq!(date(day_number(2024, 2, 29)), "2024-02-29");
    assert_eq!(date(day_number(2025, 1, 6)), "2025-01-06");
    assert_eq!((day_number(2025, 1, 6) + 4).rem_euclid(7), 1); // a Monday
    assert_eq!(stamp(day_number(2025, 7, 13) * 86_400 + 86_399), "2025-07-13 23:59:59");
  }

  #[test]
  fn seeding_gives_the_same_data_every_time() {
    let (a, b) = (lab(), lab());
    for table in ["customers", "products", "orders", "order_items", "users", "events"] {
      assert_eq!(print(&a, table), print(&b, table), "{table}");
    }
    assert_eq!(one(&a, "SELECT sum(quantity * unit_price) FROM order_items"), one(&b, "SELECT sum(quantity * unit_price) FROM order_items"));
    assert_eq!(one(&a, "SELECT sum(amount) FROM events"), one(&b, "SELECT sum(amount) FROM events"));
  }

  #[test]
  fn seeding_twice_changes_nothing_and_keeps_edits() {
    let lab = lab();
    // Foreign keys are enforced: a customer with orders can't simply be deleted
    assert_eq!(lab.query("DELETE FROM customers WHERE customer_id = 1".into(), 10).unwrap().error.as_deref(), Some("FOREIGN KEY constraint failed"));
    assert_eq!(lab.query("DELETE FROM order_items WHERE order_item_id <= 2".into(), 10).unwrap().changes, Some(2));
    let left = one(&lab, "SELECT count(*) FROM order_items");
    lab.seed("shop".into()).unwrap();
    assert_eq!(one(&lab, "SELECT count(*) FROM order_items"), left);
    assert!(lab.seed("nothing".into()).is_err());
  }

  #[test]
  fn the_shop_is_the_size_and_shape_promised() {
    let lab = lab();
    assert_eq!(one(&lab, "SELECT count(*) FROM customers"), 300.0);
    assert_eq!(one(&lab, "SELECT count(*) FROM products"), 40.0);
    let orders = one(&lab, "SELECT count(*) FROM orders");
    assert!((2_400.0..=2_600.0).contains(&orders), "{orders} orders");
    let items = one(&lab, "SELECT count(*) FROM order_items");
    assert!((5_400.0..=6_600.0).contains(&items), "{items} items");
    assert_eq!(one(&lab, "SELECT count(DISTINCT strftime('%Y-%m', order_date)) FROM orders"), 18.0);
    // Nobody orders before they signed up, and every line points at a real order and product
    assert_eq!(one(&lab, "SELECT count(*) FROM orders o JOIN customers c USING (customer_id) WHERE o.order_date < c.signup_date"), 0.0);
    assert_eq!(one(&lab, "SELECT count(*) FROM order_items i LEFT JOIN orders o USING (order_id) LEFT JOIN products p USING (product_id) WHERE o.order_id IS NULL OR p.product_id IS NULL"), 0.0);
    // Christmas shows: December 2024 well above February 2024
    let month = |m: &str| one(&lab, &format!("SELECT count(*) FROM orders WHERE strftime('%Y-%m', order_date) = '{m}'"));
    assert!(month("2024-12") > 1.6 * month("2024-02"), "{} vs {}", month("2024-12"), month("2024-02"));
    assert!(one(&lab, "SELECT count(DISTINCT status) FROM orders") >= 3.0);
  }

  #[test]
  fn the_events_make_a_believable_funnel_and_retention_curve() {
    let lab = lab();
    assert_eq!(one(&lab, "SELECT count(*) FROM users"), 800.0);
    let events = one(&lab, "SELECT count(*) FROM events");
    assert!((27_000.0..=33_000.0).contains(&events), "{events} events");
    let did = |e: &str| one(&lab, &format!("SELECT count(DISTINCT user_id) FROM events WHERE event = '{e}'"));
    let steps = [did("signup"), did("view_item"), did("add_to_cart"), did("checkout_started"), did("purchase")];
    assert_eq!(steps[0], 800.0);
    // Each step loses people, and none loses nearly everyone or nearly no one
    for pair in steps.windows(2) {
      let kept = pair[1] / pair[0];
      assert!((0.4..0.93).contains(&kept), "{steps:?}");
    }
    // Weekly retention: falls, then levels off above zero
    let week = |k: i64| {
      one(
        &lab,
        &format!(
          "SELECT 1.0 * count(DISTINCT e.user_id) / (SELECT count(*) FROM users WHERE julianday('2025-07-14') - julianday(signup_date) >= {})
           FROM events e JOIN users u USING (user_id)
           WHERE CAST((julianday(date(e.ts)) - julianday(u.signup_date)) / 7 AS INTEGER) = {k} AND julianday('2025-07-14') - julianday(u.signup_date) >= {}",
          (k + 1) * 7,
          (k + 1) * 7
        ),
      )
    };
    let (w0, w1, w4, w8) = (week(0), week(1), week(4), week(8));
    assert_eq!(w0, 1.0);
    assert!(w1 < 0.7 && w1 > 0.3, "week 1 {w1}");
    assert!(w4 < w1 && w8 < w4 && w8 > 0.08, "{w1} {w4} {w8}");
    assert_eq!(one(&lab, "SELECT count(*) FROM events WHERE ts >= '2025-07-14' OR ts < '2025-01-06'"), 0.0);
    assert_eq!(one(&lab, "SELECT count(*) FROM events e JOIN users u USING (user_id) WHERE date(e.ts) < u.signup_date"), 0.0);
  }

  #[test]
  fn a_result_carries_columns_types_rows_and_counts() {
    let lab = lab();
    let r = lab.query("SELECT customer_id, name, signup_date, 1.5 AS x, NULL AS n, upper(country) AS c FROM customers ORDER BY customer_id".into(), 5).unwrap();
    assert_eq!(r.columns, ["customer_id", "name", "signup_date", "x", "n", "c"]);
    assert_eq!(r.types, ["integer", "text", "date", "real", "", "text"]);
    assert_eq!(r.rows.len(), 5);
    assert_eq!(r.row_count, 300);
    assert!(r.truncated);
    assert_eq!(r.changes, None);
    assert_eq!(r.rows[0][0], Value::from(1));
    assert!(r.rows[0][1].is_string() && r.rows[0][4].is_null());
    assert!(r.elapsed_ms >= 0.0);

    // Several statements: the last one's result
    let r = lab.query("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1), (2), (3); SELECT sum(a) AS total FROM t;".into(), 10).unwrap();
    assert_eq!((r.columns, r.rows, r.row_count, r.truncated), (vec!["total".to_string()], vec![vec![Value::from(6)]], 1, false));
    let r = lab.query("UPDATE t SET a = a + 1 WHERE a > 1".into(), 10).unwrap();
    assert_eq!((r.changes, r.columns.len(), r.error), (Some(2), 0, None));
    assert_eq!(lab.query("CREATE TABLE u (a)".into(), 10).unwrap().changes, None);
    assert_eq!(lab.query("  -- nothing here".into(), 10).unwrap().error, None);
  }

  #[test]
  fn a_mistake_comes_back_in_sqlites_own_words() {
    let lab = lab();
    let r = lab.query("SELECT nme FROM customers".into(), 10).unwrap();
    assert_eq!(r.error.as_deref(), Some("no such column: nme"));
    assert!(r.rows.is_empty() && r.columns.is_empty());
    let r = lab.query("SELEC 1".into(), 10).unwrap();
    assert!(r.error.unwrap().contains("syntax error"));
    assert!(lab.query("SELECT * FROM nowhere".into(), 10).unwrap().error.unwrap().contains("no such table: nowhere"));
    // A failure inside a transaction doesn't leave the next query stuck in it
    assert!(lab.query("BEGIN; DELETE FROM products; SELECT oops;".into(), 10).unwrap().error.is_some());
    assert_eq!(one(&lab, "SELECT count(*) FROM products"), 40.0);
    assert_eq!(lab.query("BEGIN; SELECT 1; COMMIT;".into(), 10).unwrap().error, None);
  }

  #[test]
  fn nothing_reaches_the_disc_or_another_database() {
    let lab = lab();
    let dir = std::env::temp_dir().join(format!("tide-lab-guard-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("out.db");
    let path = file.to_str().unwrap();
    for sql in [
      format!("ATTACH DATABASE '{path}' AS other"),
      format!("VACUUM INTO '{path}'"),
      "DETACH DATABASE main".to_string(),
      "SELECT load_extension('/tmp/x.dylib')".to_string(),
      "PRAGMA journal_mode = WAL".to_string(),
      format!("PRAGMA temp_store_directory = '{path}'"),
      "PRAGMA writable_schema = ON".to_string(),
      "PRAGMA max_page_count = 100000000".to_string(),
      "PRAGMA database_list".to_string(),
      "SELECT * FROM pragma_database_list".to_string(),
    ] {
      let r = lab.query(sql.clone(), 10).unwrap();
      assert!(r.error.is_some(), "{sql} was allowed");
      assert!(!file.exists(), "{sql} wrote a file");
    }
    // Looking at the schema is fine
    assert_eq!(lab.query("PRAGMA table_info(customers)".into(), 20).unwrap().row_count, 6);
    assert_eq!(lab.query("SELECT name FROM pragma_table_info('orders')".into(), 20).unwrap().row_count, 4);
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn a_runaway_query_is_stopped_and_the_lab_carries_on() {
    let lab = lab();
    let t0 = Instant::now();
    let r = lab.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT count(*) FROM n".into(), 10).unwrap();
    let took = t0.elapsed().as_millis();
    assert!(r.error.as_deref().unwrap().starts_with("Stopped after 2 seconds"), "{:?}", r.error);
    assert!((1_900..4_000).contains(&took), "{took} ms");
    assert_eq!(one(&lab, "SELECT count(*) FROM products"), 40.0);
  }

  #[test]
  fn rows_and_cells_are_capped() {
    let lab = lab();
    let r = lab.query("SELECT * FROM events".into(), 1_000_000).unwrap();
    assert_eq!(r.rows.len(), MAX_ROWS);
    assert!(r.truncated && r.row_count > 27_000);
    let r = lab.query("SELECT printf('%.*c', 50000, 'x') AS wide, zeroblob(64) AS b".into(), 10).unwrap();
    assert_eq!(r.rows[0][0].as_str().unwrap().chars().count(), MAX_CELL + 1);
    assert_eq!(r.rows[0][1], Value::from("<blob, 64 bytes>"));
    // The database itself can't grow without limit
    let r = lab.query("CREATE TABLE big (x); WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) INSERT INTO big SELECT zeroblob(1000000) FROM n".into(), 10).unwrap();
    assert!(r.error.is_some());
  }

  #[test]
  fn the_schema_lists_tables_columns_counts_and_links() {
    let lab = lab();
    let schema = lab.schema().unwrap();
    let names: Vec<&str> = schema.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["customers", "products", "orders", "order_items", "users", "events"]);
    let orders = &schema[2];
    assert_eq!(orders.columns.iter().map(|c| (c.name.as_str(), c.kind.as_str())).collect::<Vec<_>>(), [("order_id", "integer"), ("customer_id", "integer"), ("order_date", "date"), ("status", "text")]);
    assert!(orders.columns[0].primary_key && orders.columns[1].not_null);
    assert!(orders.rows > 2_000);
    assert_eq!((orders.foreign_keys[0].column.as_str(), orders.foreign_keys[0].table.as_str(), orders.foreign_keys[0].to.as_str()), ("customer_id", "customers", "customer_id"));
    assert_eq!(schema[3].foreign_keys.len(), 2);
  }

  #[test]
  fn reset_puts_the_sample_data_back() {
    let lab = lab();
    let before = print(&lab, "orders");
    lab.query("DROP TABLE order_items; DELETE FROM orders; CREATE TABLE mine (a); CREATE VIEW v AS SELECT * FROM mine; BEGIN; INSERT INTO mine VALUES (1);".into(), 10).unwrap();
    lab.reset().unwrap();
    assert_eq!(print(&lab, "orders"), before);
    assert_eq!(lab.schema().unwrap().len(), 6);
  }

  #[test]
  fn a_file_database_keeps_its_data() {
    let path = std::env::temp_dir().join(format!("tide-lab-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    {
      let lab = Lab::new(Some(path.to_str().unwrap().into())).unwrap();
      lab.seed("shop".into()).unwrap();
    }
    let lab = Lab::new(Some(path.to_str().unwrap().into())).unwrap();
    assert_eq!(one(&lab, "SELECT count(*) FROM products"), 40.0);
    std::fs::remove_file(&path).unwrap();
  }
}
