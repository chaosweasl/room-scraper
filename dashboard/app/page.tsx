import { createClient } from '@libsql/client';

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
}

// 2. Force Next.js to fetch new data on every refresh
export const dynamic = 'force-dynamic';

function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    'roomspot': 'bg-purple-600',
    'marktplaats': 'bg-orange-600',
    'pararius': 'bg-blue-600',
    'xior': 'bg-red-600',
    'kamernet': 'bg-green-600',
  };
  return colors[source] || 'bg-gray-600';
}

function cleanTitle(title: string): string {
  if (!title) return 'Unknown';
  // If title has description merged in (very long), truncate at first period/comma
  if (title.length > 80) {
    for (const char of ['. ', ', ', ' - ', ' | ', ' – ']) {
      const idx = title.indexOf(char);
      if (idx > 20 && idx < 80) { title = title.substring(0, idx).trim(); break; }
    }
    if (title.length > 80) title = title.substring(0, 77).trim() + '...';
  }
  return title;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;
  const sourceFilter = (sp.source as string) || 'all';
  const typeFilter = (sp.type as string) || 'all';
  const priorityFilter = (sp.priority as string) || 'all';
  const priceMin = (sp.pricemin as string) || '';
  const priceMax = (sp.pricemax as string) || '';
  const searchQuery = (sp.q as string) || '';
  const sortField = (sp.sort as string) || 'date_found';
  const sortDir = (sp.dir as string) || 'desc';

  let listings: Listing[] = [];
  let dbError = false;

  try {
    const db = createClient({
      url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
    });

    const result = await db.execute(`
      SELECT * FROM listings 
      ORDER BY 
        CASE WHEN priority = 'high' THEN 0 ELSE 1 END,
        date_found DESC,
        rent ASC
    `);
    
    listings = result.rows.map(row => ({
        id: (row.id as string) || '',
        title: (row.title as string) || 'Unknown',
        rent: (row.rent as number) || 0,
        status: (row.status as string) || 'new',
        url: (row.url as string) || '#',
        source: (row.source as string) || 'unknown',
        address: (row.address as string) || '',
        listing_type: (row.listing_type as string) || '',
        phone: (row.phone as string) || '',
        description: (row.description as string) || '',
        date_found: (row.date_found as string) || '',
        priority: (row.priority as string) || 'normal',
    }));

  } catch (error) {
    console.error("❌ Dashboard Database connection failed:", error);
    dbError = true;
  }

  // Derived: unique sources, types
  const allSources = [...new Set(listings.map(l => l.source))].sort();
  const allTypes = [...new Set(listings.map(l => l.listing_type).filter(Boolean))].sort();

  // Filter
  let filtered = [...listings];
  if (sourceFilter !== 'all') filtered = filtered.filter(l => l.source === sourceFilter);
  if (typeFilter !== 'all') filtered = filtered.filter(l => l.listing_type === typeFilter);
  if (priorityFilter !== 'all') filtered = filtered.filter(l => l.priority === priorityFilter);
  const pmin = parseFloat(priceMin);
  const pmax = parseFloat(priceMax);
  if (!isNaN(pmin)) filtered = filtered.filter(l => l.rent >= pmin);
  if (!isNaN(pmax)) filtered = filtered.filter(l => l.rent <= pmax);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(l =>
      l.title.toLowerCase().includes(q) ||
      (l.address && l.address.toLowerCase().includes(q)) ||
      l.source.toLowerCase().includes(q)
    );
  }
  // Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortField === 'rent') cmp = a.rent - b.rent;
    else if (sortField === 'date_found') cmp = (a.date_found || '').localeCompare(b.date_found || '');
    else if (sortField === 'priority') {
      const order: Record<string, number> = { high: 0, normal: 1, low: 2 };
      cmp = (order[a.priority] || 1) - (order[b.priority] || 1);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Stats
  const total = filtered.length;
  const highCount = filtered.filter(l => l.priority === 'high').length;
  const newCount = filtered.filter(l => l.status === 'new').length;
  const priced = filtered.filter(l => l.rent > 0);
  const avgRent = priced.length > 0 ? priced.reduce((s, l) => s + l.rent, 0) / priced.length : 0;
  const bySource: Record<string, number> = {};
  filtered.forEach(l => { bySource[l.source] = (bySource[l.source] || 0) + 1; });

  const sources = [...new Set(listings.map(l => l.source))];

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8 font-sans">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8 border-b border-gray-800 pb-6 flex flex-col md:flex-row justify-between items-start md:items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2">
            Housing <span className="text-blue-500">Radar</span>
          </h1>
          <p className="text-gray-400">Multi-source Housing Surveillance — Enschede</p>
          <div className="flex gap-2 mt-2 flex-wrap">
            {sources.map(src => (
              <span key={src} className={`text-xs px-2 py-0.5 rounded-full text-white ${getSourceColor(src)}`}>
                {src}
              </span>
            ))}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="mt-4 md:mt-0 grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-gray-500 uppercase font-semibold">Total</p>
            <p className="text-xl font-bold text-gray-200">{total}</p>
          </div>
          <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-blue-400 uppercase font-semibold">New</p>
            <p className="text-xl font-bold text-blue-400">{newCount}</p>
          </div>
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-red-400 uppercase font-semibold">Urgent</p>
            <p className="text-xl font-bold text-red-400">{highCount}</p>
          </div>
          <div className="bg-green-950/30 border border-green-900/50 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-green-400 uppercase font-semibold">Avg Rent</p>
            <p className="text-xl font-bold text-green-400">€{avgRent.toFixed(0)}</p>
          </div>
        </div>
      </div>

      {/* Source Breakdown */}
      {Object.keys(bySource).length > 0 && (
        <div className="max-w-7xl mx-auto mb-6 flex flex-wrap gap-2">
          {Object.entries(bySource).sort(([,a], [,b]) => b - a).map(([src, count]) => (
            <span key={src} className={`text-xs px-3 py-1 rounded-full text-white ${getSourceColor(src)}`}>
              {src}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Error Fallback */}
      {dbError && (
        <div className="max-w-7xl mx-auto bg-red-950/50 border border-red-900 text-red-200 p-6 rounded-xl mb-8">
          <h2 className="text-lg font-bold mb-2">Database Connection Error</h2>
          <p>The dashboard cannot read the SQLite database. Check the DATABASE_URL.</p>
        </div>
      )}

      {/* Filters & Sort — submitted via GET form */}
      <div className="max-w-7xl mx-auto mb-6 bg-gray-900 border border-gray-800 rounded-xl p-4">
        <form method="GET" className="flex flex-wrap gap-3 items-center">
          {/* Source filter */}
          <select name="source" defaultValue={sourceFilter}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
            <option value="all">All Sources</option>
            {allSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Type filter */}
          <select name="type" defaultValue={typeFilter}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
            <option value="all">All Types</option>
            {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Priority filter */}
          <select name="priority" defaultValue={priorityFilter}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
            <option value="all">All Priority</option>
            <option value="high">🔴 High</option>
            <option value="normal">🟡 Normal</option>
          </select>

          {/* Price range */}
          <div className="flex items-center gap-1">
            <input type="number" name="pricemin" placeholder="Min €" defaultValue={priceMin}
              className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
            <span className="text-gray-500">–</span>
            <input type="number" name="pricemax" placeholder="Max €" defaultValue={priceMax}
              className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Search */}
          <input type="text" name="q" placeholder="Search title, address..." defaultValue={searchQuery}
            className="flex-1 min-w-[150px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />

          {/* Sort controls (hidden, set by buttons below) */}
          <input type="hidden" name="sort" value={sortField} />
          <input type="hidden" name="dir" value={sortDir} />

          <button type="submit"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-semibold">
            Filter
          </button>

          {/* Clear filters */}
          {(sourceFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all' || priceMin || priceMax || searchQuery) && (
            <a href="/"
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-gray-400">
              Clear All
            </a>
          )}
        </form>

        {/* Sort links (separate form approach for sort toggling) */}
        <div className="mt-3 flex gap-3 text-xs text-gray-400 border-t border-gray-800 pt-3">
          <span className="text-gray-500">Sort:</span>
          {(['rent', 'date_found', 'priority'] as const).map(field => {
            const isActive = sortField === field;
            const nextDir = isActive ? (sortDir === 'asc' ? 'desc' : 'asc') : (field === 'priority' ? 'asc' : 'desc');
            const arrow = isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';
            const href = `/?${new URLSearchParams({
              ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
              ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
              ...(priorityFilter !== 'all' ? { priority: priorityFilter } : {}),
              ...(priceMin ? { pricemin: priceMin } : {}),
              ...(priceMax ? { pricemax: priceMax } : {}),
              ...(searchQuery ? { q: searchQuery } : {}),
              sort: field,
              dir: nextDir,
            }).toString()}`;
            return (
              <a key={field} href={href}
                className={`hover:text-white ${isActive ? 'text-blue-400 font-semibold' : ''}`}>
                {field === 'rent' ? 'Price' : field === 'date_found' ? 'Date' : 'Priority'}{arrow}
              </a>
            );
          })}
          <span className="text-gray-600 ml-auto">{filtered.length} of {listings.length} listings</span>
        </div>
      </div>

      {/* Listings Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((listing) => (
          <div 
            key={listing.id} 
            className={`flex flex-col relative bg-gray-900 rounded-xl p-6 shadow-xl transition-all duration-200 border ${
              listing.priority === 'high' 
                ? 'border-red-500 shadow-red-900/20 shadow-lg' 
                : listing.status === 'new'
                  ? 'border-blue-500/50 shadow-blue-900/10'
                  : 'border-gray-800 hover:border-gray-700'
            }`}
          >
            {listing.priority === 'high' && (
              <div className="absolute -top-3 -right-3 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wide z-10">
                🔴 Urgent
              </div>
            )}
            {listing.status === 'new' && listing.priority !== 'high' && (
              <div className="absolute -top-3 -right-3 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wide z-10">
                New
              </div>
            )}

            <div className="flex-grow">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full text-white ${getSourceColor(listing.source)}`}>
                  {listing.source}
                </span>
                {listing.listing_type && (
                  <span className="text-xs text-gray-500 uppercase">{listing.listing_type}</span>
                )}
                {listing.rent === 0 && (
                  <span className="text-xs text-yellow-500">⚠ Price unknown</span>
                )}
              </div>

              <h2 className="text-lg font-bold text-gray-100 mb-1 leading-tight line-clamp-2">
                {cleanTitle(listing.title)}
              </h2>
              {listing.address && listing.address !== 'ons' && listing.address.length >= 3 && (
                <p className="text-sm text-gray-400 mb-1">📍 {listing.address}</p>
              )}
              <p className="text-sm text-gray-500 mb-4 font-mono opacity-50">
                ID: {listing.id.substring(0, 20)}...
              </p>
              
              <div className="flex items-baseline mb-4">
                <span className="text-3xl font-extrabold text-white">€{Math.round(listing.rent)}</span>
                <span className="text-gray-500 ml-2 text-sm">/ mo</span>
              </div>

              {listing.description && (
                <p className="text-xs text-gray-500 line-clamp-2 mb-3">{listing.description}</p>
              )}
            </div>

            <a 
              href={listing.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`block w-full text-center py-3 rounded-lg font-semibold transition-colors ${
                listing.priority === 'high'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              {listing.source === 'xior' ? '⚡ Apply Now (FCFS)' : 'View Listing'}
            </a>
          </div>
        ))}

        {/* Empty State */}
        {filtered.length === 0 && !dbError && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-800 rounded-2xl">
            <p className="text-xl font-semibold text-gray-400 mb-2">No listings match your filters.</p>
            <p className="text-gray-600">Try adjusting the filters or <a href="/" className="text-blue-400 underline">clear them</a>.</p>
          </div>
        )}
      </div>
    </main>
  );
}