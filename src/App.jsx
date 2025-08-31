import React, { useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, ReferenceLine } from "recharts";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Home as HomeIcon, PieChart, BarChart3 } from "lucide-react";

// ---------- Small UI primitives (Tailwind-based) ----------
const Shell = ({ children }) => (
  <div className="min-h-screen bg-gray-50 text-gray-900 flex">
    <aside className="w-64 border-r bg-white hidden md:flex md:flex-col">
      <div className="px-5 py-4 border-b flex items-center gap-3">
        <div className="size-9 rounded-xl bg-emerald-600 text-white grid place-items-center font-bold">C</div>
        <div>
          <div className="font-semibold leading-4">capitalmind</div>
          <div className="text-xs text-emerald-700">premium</div>
        </div>
      </div>
      <nav className="p-2 text-sm">
        <SideLink to="/" icon={<HomeIcon className="size-4"/>} label="Home"/>
        <SideLink to="/portfolio" icon={<PieChart className="size-4"/>} label="Portfolios"/>
      </nav>
      <div className="mt-auto text-xs text-gray-500 px-5 py-4 border-t">CMP1Y · Valid till Apr 19, 2025</div>
    </aside>
    <main className="flex-1">
      <Topbar/>
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">{children}</div>
    </main>
  </div>
);

const Topbar = () => (
  <div className="h-12 md:hidden sticky top-0 bg-white border-b flex items-center gap-2 px-4 z-10">
    <div className="size-8 rounded-xl bg-emerald-600 text-white grid place-items-center font-bold">C</div>
    <span className="font-semibold">capitalmind premium</span>
  </div>
);

const SideLink = ({ to, icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 transition ${
        isActive ? "bg-gray-100 font-medium" : ""
      }`
    }
  >
    {icon}
    <span>{label}</span>
  </NavLink>
);

const Card = ({ title, subtitle, right, children, className = "" }) => (
  <section className={`bg-white rounded-2xl shadow-sm border p-5 ${className}`}>
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div>{right}</div>
    </div>
    {children}
  </section>
);

const Pill = ({ children }) => (
  <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 text-gray-700">{children}</span>
);

// ---------- Helpers for Excel parsing & returns ----------
// --- improved helpers ---

const lookbackPeriods = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "3Y": 365 * 3,
  "5Y": 365 * 5
};

function coerceDate(v) {
  // Robust date coercion for:
  // - JS Date objects
  // - Excel serial numbers (as number)
  // - numeric strings that represent Excel serials or timestamps
  // - ISO/locale date strings
  if (v == null) return new Date(NaN);
  if (v instanceof Date) return v;

  // If it's already a number (Excel serials often come as numbers)
  if (typeof v === "number") {
    const dc = XLSX.SSF.parse_date_code(v);
    if (dc && dc.y) {
      // use local Date (keeps behaviour simple)
      return new Date(dc.y, (dc.m || 1) - 1, dc.d || 1, dc.H || 0, dc.M || 0, Math.floor(dc.S || 0));
    }
    // fallback: treat as JS timestamp (ms) or Excel serial -> convert Excel serial to JS date
    // Excel serial 1 -> 1900-01-01 (but many libs treat differently); parse_date_code handles typical cases.
    // If parse_date_code failed, try serial -> Date via 1899-12-30 base (Excel serial to unix ms)
    if (!Number.isNaN(v)) {
      // treat as Excel serial (days since 1899-12-30)
      const ms = (v - 25569) * 86400 * 1000; // 25569 = days between 1899-12-30 and 1970-01-01
      const d = new Date(ms);
      return isNaN(+d) ? new Date(NaN) : d;
    }
    return new Date(NaN);
  }

  // strings: try trimming
  const s = String(v).trim();
  if (s === "") return new Date(NaN);

  // If string looks like a pure number, try number path
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return coerceDate(n);
  }

  // Try Date.parse (ISO/local formats)
  const d = new Date(s);
  if (!isNaN(+d)) return d;

  // Last resort: try parse_date_code on numeric portion
  const maybeNum = parseFloat(s);
  if (!Number.isNaN(maybeNum)) return coerceDate(maybeNum);

  return new Date(NaN);
}

function isDateLike(v) {
  const d = coerceDate(v);
  return !isNaN(+d);
}

function isNumericLike(v) {
  if (v == null) return false;
  if (typeof v === "number" && !Number.isNaN(v)) return true;
  if (typeof v === "string") {
    // allow numeric strings with commas/space trimmed
    const s = v.trim().replace(/,/g, "");
    return s !== "" && !Number.isNaN(Number(s));
  }
  return false;
}

function detectColumns(rows) {
  // Find best date column and best numeric NAV column.
  if (!rows?.length) return { dateKey: null, navKey: null };

  const sampleSize = Math.min(rows.length, 50);
  const keys = Object.keys(rows[0]);

  // Score each key for date-likeness and numeric-likeness
  const scores = keys.map(k => {
    let dateCount = 0, numCount = 0;
    for (let i = 0; i < sampleSize; i++) {
      const v = rows[i][k];
      if (isDateLike(v)) dateCount++;
      if (isNumericLike(v)) numCount++;
    }
    return { key: k, dateCount, numCount };
  });

  // Choose dateKey: highest dateCount and at least >60% of sample
  const threshold = Math.ceil(sampleSize * 0.6);
  const dateCandidates = scores.filter(s => s.dateCount >= threshold).sort((a,b) => b.dateCount - a.dateCount);
  let dateKey = dateCandidates.length ? dateCandidates[0].key : null;

  // If no column passes threshold, pick the single best dateCount if it has at least something
  if (!dateKey) {
    const bestDate = scores.slice().sort((a,b) => b.dateCount - a.dateCount)[0];
    if (bestDate && bestDate.dateCount > 0) dateKey = bestDate.key;
  }

  // Choose navKey: highest numCount and at least >60% OR fallback to best numeric column
  const numCandidates = scores.filter(s => s.numCount >= threshold).sort((a,b) => b.numCount - a.numCount);
  let navKey = numCandidates.length ? numCandidates[0].key : null;
  if (!navKey) {
    const bestNum = scores.slice().sort((a,b) => b.numCount - a.numCount)[0];
    if (bestNum && bestNum.numCount > 0) navKey = bestNum.key;
  }

  return { dateKey, navKey };
}

function toSeries(rows, dateKey, navKey) {
  if (!rows?.length || !dateKey || !navKey) return [];

  // Build cleaned records with valid date + numeric nav
  const mapByDate = new Map(); // keep last record for a date (so duplicates overwrite)
  for (const r of rows) {
    const d = coerceDate(r[dateKey]);
    if (isNaN(+d)) continue;
    const rawNav = r[navKey];
    if (!isNumericLike(rawNav)) continue;
    const nav = Number(String(rawNav).trim().replace(/,/g, ""));
    if (Number.isNaN(nav)) continue;
    // normalize date to midnight UTC/local? keep actual Date instance
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    // keep last occurrence in sheet for same date (similar to Excel last entry)
    mapByDate.set(key, { date: d, nav });
  }

  const clean = Array.from(mapByDate.values()).sort((a,b) => +a.date - +b.date);
  if (!clean.length) return [];

  // Compute equity (start 100), returns, drawdown
  let equity = 100;
  let peak = 100;
  const out = [];
  let prevNav = null;
  for (let i = 0; i < clean.length; i++) {
    const cur = clean[i];
    let ret = 0;
    if (prevNav !== null && prevNav !== 0) {
      ret = (cur.nav / prevNav) - 1;
    } else {
      ret = 0;
    }
    equity = equity * (1 + ret);
    peak = Math.max(peak, equity);
    const dd = (equity / peak) - 1; // negative or zero
    out.push({
      date: cur.date,
      dateLabel: cur.date.toISOString().slice(0, 10),
      nav: cur.nav,
      equity: Number(equity.toFixed(2)),
      drawdown: Number((dd * 100).toFixed(2)),
    });
    prevNav = cur.nav;
  }
  return out;
}

function calculateTrailingReturns(series) {
  if (!series.length) return {};

  const latest = series[series.length - 1];
  const endDate = latest.date;
  const endNav = latest.nav;

  const result = {};
  result['YTD'] = calculateYTD(series);

  for (const [label, days] of Object.entries(lookbackPeriods)) {
    const past = findClosest(series, endDate, days);
    result[label] = past ? (endNav / past.nav - 1) : null;
  }

  // SI (Since Inception)
  const first = series[0];
  result['SI'] = (endNav / first.nav - 1);

  // Drawdown
  result['DD'] = latest.drawdown / 100; // convert to decimal
  result['Max DD'] = Math.min(...series.map(s => s.drawdown)) / 100;

  return result;
}

function calculateYTD(series) {
  const latest = series[series.length - 1];
  const yearStart = new Date(latest.date.getFullYear(), 0, 1);
  const start = series.find(p => p.date >= yearStart);
  if (!start) return null;
  return (latest.nav / start.nav - 1);
}

function findClosest(series, endDate, days) {
  const target = new Date(endDate);
  target.setDate(target.getDate() - days);
  let closest = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= target) {
      closest = series[i];
      break;
    }
  }
  return closest;
}

function trailingReturnsTable(name, series) {
  const trailing = calculateTrailingReturns(series);
  return {
    name,
    YTD: fmtPct(trailing['YTD']),
    '1D': fmtPct(trailing['1D']),
    '1W': fmtPct(trailing['1W']),
    '1M': fmtPct(trailing['1M']),
    '3M': fmtPct(trailing['3M']),
    '6M': fmtPct(trailing['6M']),
    '1Y': fmtPct(trailing['1Y']),
    '3Y': fmtPct(trailing['3Y']),
    '5Y': fmtPct(trailing['5Y']),
    'SI': fmtPct(trailing['SI']),
    'DD': fmtPct(trailing['DD']),
    'Max DD': fmtPct(trailing['Max DD'])
  };
}

function monthlyReturns(series) {
  // series: array of {date:Date, nav:number,...}
  // Output: { table, months } where table is rows per year with month returns and YTD
  if (!series || !series.length) return { table: [], months: [] };

  // Build last NAV by YYYY-MM (end-of-month style)
  const lastByMonth = new Map(); // key => { year, month, nav }
  for (const p of series) {
    const y = p.date.getFullYear();
    const m = p.date.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    // keep last (later date) for the month by overwriting
    lastByMonth.set(key, { year: y, month: m, nav: p.nav });
  }

  // Collect all keys sorted
  const keys = Array.from(lastByMonth.keys()).sort();

  // Build quick lookup for nav by key
  const navLookup = key => (lastByMonth.has(key) ? lastByMonth.get(key).nav : null);

  // Build rows for each found year-month with MOM relative to previous calendar month
  const rows = [];
  for (const key of keys) {
    const [yStr, mStr] = key.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const val = navLookup(key);
    // previous calendar month: if m>1 -> same year m-1, else year-1 month 12
    const prevKey = m > 1 ? `${y}-${String(m - 1).padStart(2, "0")}` : `${y - 1}-12`;
    const prevVal = navLookup(prevKey);
    const mom = (prevVal != null && prevVal !== 0) ? (val / prevVal - 1) : null;
    rows.push({ year: y, month: m, nav: val, ret: mom });
  }

  // Group by year (latest first)
  const years = [...new Set(rows.map(r => r.year))].sort((a, b) => b - a);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const table = years.map(y => {
    const rec = { Year: y };
    let ytdAcc = 1;
    let anyMonth = false;
    months.forEach((name, idx) => {
      const m = idx + 1;
      const rr = rows.find(r => r.year === y && r.month === m);
      const v = rr ? rr.ret : null;
      rec[name] = v;
      if (v != null) {
        anyMonth = true;
        ytdAcc *= (1 + v);
      }
    });
    rec["YTD"] = anyMonth ? (ytdAcc - 1) : null;
    return rec;
  });

  return { table, months };
}

function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return (v * 100).toFixed(1) + "%";
  // If v already looks like a percent number (e.g., small fractional string), try coercion
  const n = Number(v);
  if (!Number.isNaN(n)) return (n * 100).toFixed(1) + "%";
  return "—";
}


// ---------- Pages ----------
function HomePage() {
  const posts = [
    {
      id: 1,
      title: "CM Fixed Income: Exiting Banking & PSU to Add a New Gilt Fund",
      date: "Apr 18, 2024",
      excerpt: "We are increasing the duration of our Fixed Income portfolio to reflect the current macro conditions. We want to take advantage of the current higher rates to further increase the duration of the Gilt funds we hold…",
      href: "#",
    },
    {
      id: 2,
      title: "Craftsman Automation: Poised for Growth Amid Temporary Headwinds",
      date: "Apr 05, 2024",
      excerpt: "Craftsman excels in making precise parts for cars and machines. Amidst temporary headwinds, it looks resilient with a focus on growth and innovation…",
      href: "#",
    },
    {
      id: 3,
      title: "The Focused Way of Investing: Our Four-Quadrant Strategy and FY24 Review",
      date: "Apr 03, 2024",
      excerpt: "FY24 brought us a 42% gain in our Focused portfolio, gently outperforming the Nifty. It’s been a bit of a rollercoaster, but that’s part of equity investing…",
      href: "#",
    },
  ];

  return (
    <div className="grid gap-6">
      <Card title="Get started" subtitle="Read our getting started guide to get the most out of your subscription." right={<Pill>Guide</Pill>}>
        <p className="text-sm text-gray-600">Explore how we pick portfolios, manage risk and keep it simple.</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {posts.map(p => (
          <Card key={p.id} title={p.title} subtitle={p.date} right={<a className="text-emerald-700 text-sm" href={p.href}>Read full post →</a>}>
            <p className="text-sm text-gray-600 line-clamp-3">{p.excerpt}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PortfolioPage() {
  const [series, setSeries] = useState([]);
  const [table, setTable] = useState([]);
  const [months, setMonths] = useState([]);
  const fileInput = useRef(null);

  const handleFile = async (file) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    const { dateKey, navKey } = detectColumns(rows);
    if (!dateKey || !navKey) {
      alert("Could not detect Date/NAV columns. Ensure the sheet has a Date column and a numeric NAV/Price column.");
      return;
    }
    const ser = toSeries(rows, dateKey, navKey);
    setSeries(ser);
    const m = monthlyReturns(ser);
    setTable(m.table);
    setMonths(m.months);
  };

  const equityCards = useMemo(() => {
    if (!series.length) return null;
    const first = series[0].equity;
    const last = series[series.length - 1].equity;
    const ret = last / first - 1;
    const maxDD = Math.min(...series.map(d => d.drawdown));
    return (
      <div className="grid sm:grid-cols-3 gap-4">
        <MiniStat label="Since Inception" value={fmtPct(ret)} />
        <MiniStat label="Max Drawdown" value={`${maxDD.toFixed(1)}%`} />
        <MiniStat label="Data Points" value={series.length} />
      </div>
    );
  }, [series]);

  return (
    <div className="grid gap-6">
      <Card title="Trailing Returns" subtitle="Upload the provided Excel and we’ll compute month-on-month returns & YTD by year."
        right={
          <button
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border shadow-sm hover:bg-gray-50"
          >
            <Upload className="size-4"/> Upload Excel
          </button>
        }
      >
        <input type="file" accept=".xlsx,.xls" ref={fileInput} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}/>
        {!table.length ? (
          <div className="text-sm text-gray-600">
            Use the button above and select <span className="font-medium">Front end Assignment Historical NAV Report.xlsx</span>.
            The app auto-detects the <span className="font-mono">Date</span> and <span className="font-mono">NAV</span> columns.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b sticky left-0 bg-white z-10">Year</th>
                  {months.map(m => (
                    <th key={m} className="text-right p-2 border-b">{m}</th>
                  ))}
                  <th className="text-right p-2 border-b">YTD</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr key={row.Year} className="hover:bg-gray-50">
                    <td className="p-2 border-b font-medium sticky left-0 bg-white z-10">{row.Year}</td>
                    {months.map(m => (
                      <td key={m} className="p-2 border-b text-right tabular-nums">{fmtPct(row[m])}</td>
                    ))}
                    <td className="p-2 border-b text-right tabular-nums font-medium">{fmtPct(row.YTD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Equity Curve" subtitle="Normalized to 100 at start" right={<Pill>Live since first record</Pill>}>
        {!series.length ? (
          <EmptyChartNote/>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dateLabel" minTickGap={48} />
                <YAxis domain={["auto", "auto"]} />
                <Tooltip formatter={(v, n) => n === "equity" ? [v, "Equity"] : [v, n]} labelFormatter={(l) => `Date: ${l}`}/>
                <Line type="monotone" dataKey="equity" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {equityCards}
      </Card>

      <Card title="Drawdown" subtitle="Depth from prior peak (percentage)">
        {!series.length ? (
          <EmptyChartNote/>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dateLabel" minTickGap={48} />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[dataMin => Math.min(-50, Math.floor(dataMin)), 0]} />
                <Tooltip formatter={(v) => [`${v}%`, "Drawdown"]} labelFormatter={(l) => `Date: ${l}`}/>
                <ReferenceLine y={0} />
                <Area type="monotone" dataKey="drawdown" dot={false} strokeWidth={1.5} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

const MiniStat = ({ label, value }) => (
  <div className="rounded-xl border p-4 bg-gray-50">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{value}</div>
  </div>
);

const EmptyChartNote = () => (
  <div className="text-sm text-gray-600 flex items-center gap-2">
    <BarChart3 className="size-4"/> Upload the Excel above to render charts.
  </div>
);

// ---------- App shell with routing ----------
export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage/>} />
          <Route path="/portfolio" element={<PortfolioPage/>} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}

/*
HOW TO RUN LOCALLY

1) Create a new React app (Vite is recommended):
   npm create vite@latest portfolio-ui -- --template react
   cd portfolio-ui
   npm i xlsx recharts react-router-dom lucide-react
   (Tailwind optional; Vite + this file already uses Tailwind-style classes. If you use Tailwind, follow Tailwind + Vite setup docs.)

2) Replace src/App.jsx with this file's contents. Ensure you export default App.

3) Start the dev server:
   npm run dev

4) On the Portfolios page, click "Upload Excel" and select the provided
   “Front end Assignment Historical NAV Report.xlsx”. The app will auto-detect columns.

NOTES
- The app attempts to detect a Date column and a numeric NAV/Price column from the first sheet.
- It computes: (a) Month-on-month returns by calendar year + YTD, (b) Equity curve (normalized to 100),
  and (c) Drawdown as % from prior peak.
- The UI mirrors the attached screenshots: sidebar navigation, cards, a trailing returns table, and two charts.
*/
