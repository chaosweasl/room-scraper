import { createClient } from "@libsql/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingActions } from "@/components/ListingActions";

// 1. Define the structure of a listing
interface Listing {
  id: string;
  title: string;
  rent: number;
  status: string;
  url: string;
  source: string;
  address: string;
  listing_type: string;
  phone: string;
  description: string;
  date_found: string;
  priority: string;
  emailed_at: string | null;
  draft_body: string | null;
  triage_reason: string | null;
  distance_minutes: number | null;
  distance_mode: string | null;
}

// 2. Force Next.js to fetch new data on every refresh
export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { value: "all", label: "Board" },
  { value: "new", label: "New" },
  { value: "drafted", label: "Drafted" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
  { value: "auto_rejected", label: "Filtered" },
];

const KANBAN_COLUMNS = [
  { value: "new", label: "New", accent: "border-blue-500/40" },
  { value: "drafted", label: "Drafted", accent: "border-violet-500/40" },
  { value: "applied", label: "Applied", accent: "border-emerald-500/40" },
  { value: "rejected", label: "Rejected", accent: "border-rose-500/40" },
];

function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    roomspot: "bg-violet-600",
    marktplaats: "bg-orange-600",
    pararius: "bg-sky-600",
    xior: "bg-rose-600",
    kamernet: "bg-emerald-600",
  };
  return colors[source] || "bg-slate-600";
}

function cleanTitle(title: string): string {
  if (!title) return "Unknown";
  if (title.length > 80) {
    for (const char of [". ", ", ", " - ", " | ", " – "]) {
      const idx = title.indexOf(char);
      if (idx > 20 && idx < 80) {
        title = title.substring(0, idx).trim();
        break;
      }
    }
    if (title.length > 80) title = title.substring(0, 77).trim() + "...";
  }
  return title;
}

function ListingCard({ listing }: { listing: Listing }) {
  const isFiltered = listing.status === "auto_rejected";
  return (
    <Card
      className={cn(
        "relative transition-colors hover:border-slate-600",
        listing.priority === "high" && "border-rose-500/60",
      )}
    >
      <CardHeader>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full text-white ${getSourceColor(listing.source)}`}
          >
            {listing.source}
          </span>
          {listing.listing_type && (
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">
              {listing.listing_type}
            </span>
          )}
          {listing.rent === 0 && (
            <span className="text-[11px] text-amber-400">⚠ Price unknown</span>
          )}
          {listing.distance_minutes != null && (
            <span className="text-[11px] text-slate-300">
              {listing.distance_mode === "walking" ? "🚶" : "🚲"}{" "}
              {listing.distance_minutes} min
            </span>
          )}
          {listing.priority === "high" && <Badge variant="high">High</Badge>}
        </div>
        <CardTitle>{cleanTitle(listing.title)}</CardTitle>
        {listing.address &&
          listing.address !== "ons" &&
          listing.address.length >= 3 && (
            <p className="text-xs text-slate-400 mt-1">📍 {listing.address}</p>
          )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline">
          <span className="text-2xl font-extrabold text-white">
            €{Math.round(listing.rent)}
          </span>
          <span className="text-slate-500 ml-2 text-xs">/ mo</span>
        </div>

        {isFiltered && listing.triage_reason && (
          <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2">
            ⚠ {listing.triage_reason}
          </p>
        )}

        {listing.draft_body && (
          <p className="text-xs text-slate-400 line-clamp-3 bg-slate-950/60 rounded-lg px-3 py-2 font-mono">
            {listing.draft_body}
          </p>
        )}

        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-2 rounded-lg font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          {listing.source === "xior" ? "⚡ Apply Now (FCFS)" : "View Listing"}
        </a>

        <ListingActions id={listing.id} status={listing.status} />
      </CardContent>
    </Card>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const statusTab = (sp.status as string) || "all";
  const sourceFilter = (sp.source as string) || "all";
  const typeFilter = (sp.type as string) || "all";
  const priorityFilter = (sp.priority as string) || "all";
  const priceMin = (sp.pricemin as string) || "";
  const priceMax = (sp.pricemax as string) || "";
  const distMode = (sp.distmode as string) || "all";
  const distMax = (sp.distmax as string) || "";
  const searchQuery = (sp.q as string) || "";
  const sortField = (sp.sort as string) || "date_found";
  const sortDir = (sp.dir as string) || "desc";

  let listings: Listing[] = [];
  let dbError = false;

  try {
    const db = createClient({
      url: process.env.DATABASE_URL || "file:/app/data/housing.db",
    });

    const result = await db.execute(`
      SELECT * FROM listings
      ORDER BY
        CASE WHEN priority = 'high' THEN 0 ELSE 1 END,
        date_found DESC,
        rent ASC
    `);

    listings = result.rows.map((row) => ({
      id: (row.id as string) || "",
      title: (row.title as string) || "Unknown",
      rent: (row.rent as number) || 0,
      status: (row.status as string) || "new",
      url: (row.url as string) || "#",
      source: (row.source as string) || "unknown",
      address: (row.address as string) || "",
      listing_type: (row.listing_type as string) || "",
      phone: (row.phone as string) || "",
      description: (row.description as string) || "",
      date_found: (row.date_found as string) || "",
      priority: (row.priority as string) || "normal",
      emailed_at: (row.emailed_at as string) || null,
      draft_body: (row.draft_body as string) || null,
      triage_reason: (row.triage_reason as string) || null,
      distance_minutes: (row.distance_minutes as number) || null,
      distance_mode: (row.distance_mode as string) || null,
    }));
  } catch (error) {
    console.error("❌ Dashboard Database connection failed:", error);
    dbError = true;
  }

  const allSources = [...new Set(listings.map((l) => l.source))].sort();
  const allTypes = [
    ...new Set(listings.map((l) => l.listing_type).filter(Boolean)),
  ].sort();

  // Filter
  let filtered = [...listings];
  if (statusTab !== "all")
    filtered = filtered.filter((l) => l.status === statusTab);
  if (sourceFilter !== "all")
    filtered = filtered.filter((l) => l.source === sourceFilter);
  if (typeFilter !== "all")
    filtered = filtered.filter((l) => l.listing_type === typeFilter);
  if (priorityFilter !== "all")
    filtered = filtered.filter((l) => l.priority === priorityFilter);
  const pmin = parseFloat(priceMin);
  const pmax = parseFloat(priceMax);
  if (!isNaN(pmin)) filtered = filtered.filter((l) => l.rent >= pmin);
  if (!isNaN(pmax)) filtered = filtered.filter((l) => l.rent <= pmax);
  if (distMode !== "all")
    filtered = filtered.filter((l) => l.distance_mode === distMode);
  const dmax = parseFloat(distMax);
  if (!isNaN(dmax))
    filtered = filtered.filter(
      (l) => l.distance_minutes == null || l.distance_minutes <= dmax,
    );
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.address && l.address.toLowerCase().includes(q)) ||
        l.source.toLowerCase().includes(q),
    );
  }

  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortField === "rent") cmp = a.rent - b.rent;
    else if (sortField === "date_found")
      cmp = (a.date_found || "").localeCompare(b.date_found || "");
    else if (sortField === "priority") {
      const order: Record<string, number> = { high: 0, normal: 1, low: 2 };
      cmp = (order[a.priority] || 1) - (order[b.priority] || 1);
    } else if (sortField === "distance") {
      cmp = (a.distance_minutes ?? 999) - (b.distance_minutes ?? 999);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const countByStatus = (s: string) =>
    listings.filter((l) => l.status === s).length;
  const total = filtered.length;
  const highCount = filtered.filter((l) => l.priority === "high").length;
  const priced = filtered.filter((l) => l.rent > 0);
  const avgRent =
    priced.length > 0
      ? priced.reduce((s, l) => s + l.rent, 0) / priced.length
      : 0;

  function tabHref(status: string) {
    const params = new URLSearchParams();
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (priorityFilter !== "all") params.set("priority", priorityFilter);
    if (priceMin) params.set("pricemin", priceMin);
    if (priceMax) params.set("pricemax", priceMax);
    if (distMode !== "all") params.set("distmode", distMode);
    if (distMax) params.set("distmax", distMax);
    if (searchQuery) params.set("q", searchQuery);
    if (sortField !== "date_found") params.set("sort", sortField);
    if (sortDir !== "desc") params.set("dir", sortDir);
    if (status !== "all") params.set("status", status);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 border-b border-slate-800 pb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/branding/widelogo.jpg"
              alt="KamerCatch"
              className="h-12 object-contain"
            />
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                Kamer<span className="text-indigo-400">Catch</span>
              </h1>
              <p className="text-slate-400 text-sm">
                Enschede student housing radar
              </p>
            </div>
          </div>
          <a
            href="/settings"
            className="text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-4 py-2 text-slate-300"
          >
            ⚙️ Settings
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
          {[
            { label: "Showing", value: String(total) },
            { label: "High", value: String(highCount) },
            { label: "New", value: String(countByStatus("new")) },
            { label: "Drafted", value: String(countByStatus("drafted")) },
            { label: "Applied", value: String(countByStatus("applied")) },
            { label: "Avg Rent", value: `€${avgRent.toFixed(0)}` },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-center"
            >
              <p className="text-[11px] text-slate-500 uppercase font-semibold">
                {s.label}
              </p>
              <p className="text-xl font-bold text-slate-100">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {STATUS_TABS.map((tab) => (
            <a
              key={tab.value}
              href={tabHref(tab.value)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors",
                statusTab === tab.value
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white",
              )}
            >
              {tab.label}
              {tab.value !== "all" && ` (${countByStatus(tab.value)})`}
            </a>
          ))}
        </div>

        {dbError && (
          <div className="bg-rose-950/50 border border-rose-900 text-rose-200 p-6 rounded-xl mb-8">
            <h2 className="text-lg font-bold mb-2">
              Database Connection Error
            </h2>
            <p>
              The dashboard cannot read the SQLite database. Check the
              DATABASE_URL.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <form method="GET" className="flex flex-wrap gap-3 items-center">
            <input type="hidden" name="status" value={statusTab} />
            <select
              name="source"
              defaultValue={sourceFilter}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">All Sources</option>
              {allSources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={typeFilter}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">All Types</option>
              {allTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              name="priority"
              defaultValue={priorityFilter}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">All Priority</option>
              <option value="high">🔴 High</option>
              <option value="normal">🟡 Normal</option>
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                name="pricemin"
                placeholder="Min €"
                defaultValue={priceMin}
                className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200"
              />
              <span className="text-slate-500">–</span>
              <input
                type="number"
                name="pricemax"
                placeholder="Max €"
                defaultValue={priceMax}
                className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200"
              />
            </div>
            <select
              name="distmode"
              defaultValue={distMode}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">Any distance</option>
              <option value="cycling">🚲 Cycling</option>
              <option value="walking">🚶 Walking</option>
            </select>
            <input
              type="number"
              name="distmax"
              placeholder="Max min"
              defaultValue={distMax}
              className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200"
            />
            <input
              type="text"
              name="q"
              placeholder="Search title, address..."
              defaultValue={searchQuery}
              className="flex-1 min-w-[150px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            />
            <input type="hidden" name="sort" value={sortField} />
            <input type="hidden" name="dir" value={sortDir} />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-semibold"
            >
              Filter
            </button>
            {(sourceFilter !== "all" ||
              typeFilter !== "all" ||
              priorityFilter !== "all" ||
              priceMin ||
              priceMax ||
              distMode !== "all" ||
              distMax ||
              searchQuery ||
              statusTab !== "all") && (
              <a
                href="/"
                className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 text-slate-400"
              >
                Clear All
              </a>
            )}
          </form>

          <div className="mt-3 flex gap-3 text-xs text-slate-400 border-t border-slate-800 pt-3">
            <span className="text-slate-500">Sort:</span>
            {(["rent", "date_found", "priority", "distance"] as const).map(
              (field) => {
                const isActive = sortField === field;
                const nextDir = isActive
                  ? sortDir === "asc"
                    ? "desc"
                    : "asc"
                  : field === "priority" || field === "distance"
                    ? "asc"
                    : "desc";
                const arrow = isActive
                  ? sortDir === "asc"
                    ? " ↑"
                    : " ↓"
                  : " ↕";
                const href = `${tabHref(statusTab)}${tabHref(statusTab).includes("?") ? "&" : "?"}sort=${field}&dir=${nextDir}`;
                return (
                  <a
                    key={field}
                    href={href}
                    className={`hover:text-white ${isActive ? "text-indigo-400 font-semibold" : ""}`}
                  >
                    {field === "rent"
                      ? "Price"
                      : field === "date_found"
                        ? "Date"
                        : field === "priority"
                          ? "Priority"
                          : "Distance"}
                    {arrow}
                  </a>
                );
              },
            )}
            <span className="text-slate-600 ml-auto">
              {filtered.length} of {listings.length} listings
            </span>
          </div>
        </div>

        {/* Content: Kanban board or single-status list */}
        {statusTab === "all" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {KANBAN_COLUMNS.map((col) => {
              const items = filtered.filter((l) => l.status === col.value);
              return (
                <div
                  key={col.value}
                  className={cn(
                    "bg-slate-900/40 border rounded-xl p-3",
                    col.accent,
                  )}
                >
                  <h2 className="text-sm font-bold text-slate-200 mb-3 uppercase tracking-wide">
                    {col.label}{" "}
                    <span className="text-slate-500">({items.length})</span>
                  </h2>
                  <div className="space-y-3">
                    {items.map((l) => (
                      <ListingCard key={l.id} listing={l} />
                    ))}
                    {items.length === 0 && (
                      <p className="text-xs text-slate-600 py-6 text-center">
                        Empty
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {statusTab === "auto_rejected" && filtered.length > 0 && (
              <div className="col-span-full bg-amber-950/30 border border-amber-900/40 text-amber-200 p-4 rounded-xl text-sm">
                ⚠️ <strong>Filtered</strong> — these listings were removed by
                your filters (rent, distance, Dutch-only, or the optional AI
                gatekeeper). Review occasionally to make sure the filters are
                not too strict.
              </div>
            )}
            {filtered.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
            {filtered.length === 0 && !dbError && (
              <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
                <p className="text-xl font-semibold text-slate-400 mb-2">
                  No listings match.
                </p>
                <p className="text-slate-600">
                  Try adjusting the filters or{" "}
                  <a href="/" className="text-indigo-400 underline">
                    clear them
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
