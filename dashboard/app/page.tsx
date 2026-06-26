import { createClient } from '@libsql/client';

// 1. Define the structure of a listing with new columns
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
  };
  return colors[source] || 'bg-gray-600';
}

export default async function Home() {
  let listings: Listing[] = [];
  let dbError = false;

  try {
    const db = createClient({
      url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
    });

    // Fetch all listings sorted by priority (high first), then by date newest first
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

    console.log(`✅ Dashboard refreshed: Found ${listings.length} listings.`);
  } catch (error) {
    console.error("❌ Dashboard Database connection failed:", error);
    dbError = true;
  }

  const totalListings = listings.length;
  const highPriority = listings.filter(l => l.priority === 'high').length;
  const newListings = listings.filter(l => l.status === 'new').length;
  const sources = [...new Set(listings.map(l => l.source))];

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8 md:p-16 font-sans">
      {/* Header Section */}
      <div className="max-w-7xl mx-auto mb-12 border-b border-gray-800 pb-8 flex flex-col md:flex-row justify-between items-start md:items-end">
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
        
        <div className="mt-6 md:mt-0 flex space-x-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 text-center text-nowrap">
            <p className="text-xs text-gray-500 uppercase font-semibold">Total Tracked</p>
            <p className="text-2xl font-bold text-gray-200">{totalListings}</p>
          </div>
          <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg px-4 py-2 text-center text-nowrap">
            <p className="text-xs text-blue-400 uppercase font-semibold">New</p>
            <p className="text-2xl font-bold text-blue-400">{newListings}</p>
          </div>
          <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-2 text-center text-nowrap">
            <p className="text-xs text-red-400 uppercase font-semibold">High Priority</p>
            <p className="text-2xl font-bold text-red-400">{highPriority}</p>
          </div>
        </div>
      </div>

      {/* Error Fallback */}
      {dbError && (
        <div className="max-w-7xl mx-auto bg-red-950/50 border border-red-900 text-red-200 p-6 rounded-xl mb-8">
          <h2 className="text-lg font-bold mb-2">Database Connection Error</h2>
          <p>The dashboard cannot read the SQLite database. Check if the /data folder exists on your desktop and contains housing.db.</p>
        </div>
      )}

      {/* Listings Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {listings.map((listing) => (
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
              {/* Source badge + type */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full text-white ${getSourceColor(listing.source)}`}>
                  {listing.source}
                </span>
                {listing.listing_type && (
                  <span className="text-xs text-gray-500 uppercase">{listing.listing_type}</span>
                )}
              </div>

              <h2 className="text-lg font-bold text-gray-100 mb-1 leading-tight line-clamp-2">
                {listing.title}
              </h2>
              {listing.address && (
                <p className="text-sm text-gray-400 mb-1">📍 {listing.address}</p>
              )}
              <p className="text-sm text-gray-500 mb-4 font-mono opacity-50">
                ID: {listing.id.substring(0, 20)}...
              </p>
              
              <div className="flex items-baseline mb-4">
                <span className="text-3xl font-extrabold text-white">€{listing.rent}</span>
                <span className="text-gray-500 ml-2 text-sm">bare rent / mo</span>
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
        {listings.length === 0 && !dbError && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-800 rounded-2xl">
            <p className="text-xl font-semibold text-gray-400 mb-2">No listings found in the database.</p>
            <p className="text-gray-600">The scrapers are still warming up or haven't found listings yet.</p>
          </div>
        )}
      </div>
    </main>
  );
}