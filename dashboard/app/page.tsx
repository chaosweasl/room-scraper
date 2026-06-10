import { createClient } from '@libsql/client';

// 1. Define the structure of a listing so TypeScript doesn't panic
interface Listing {
  id: string;
  title: string;
  rent: number;
  status: string;
  url: string;
}

// 2. Force Next.js to fetch new data on every refresh
export const dynamic = 'force-dynamic';

export default async function Home() {
  let listings: Listing[] = [];
  let dbError = false;

  try {
    // 3. Connect to the shared SQLite volume defined in your docker-compose
    const db = createClient({
      url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
    });

    // Fetch all listings and sort by price (cheapest first)
    const result = await db.execute('SELECT * FROM listings ORDER BY rent ASC');
    
    // 4. Map the raw database rows to our Listing interface
    listings = result.rows.map(row => ({
        id: row.id as string,
        title: row.title as string,
        rent: row.rent as number,
        status: row.status as string,
        url: row.url as string
    }));

    console.log(`✅ Dashboard refreshed: Found ${listings.length} listings.`);
  } catch (error) {
    console.error("❌ Dashboard Database connection failed:", error);
    dbError = true;
  }

  const totalListings = listings.length;
  const verifiedListings = listings.filter(l => l.status === 'verified').length;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8 md:p-16 font-sans">
      {/* Header Section */}
      <div className="max-w-7xl mx-auto mb-12 border-b border-gray-800 pb-8 flex flex-col md:flex-row justify-between items-start md:items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2">
            Housing <span className="text-blue-500">Radar</span>
          </h1>
          <p className="text-gray-400">Automated Roomspot Surveillance</p>
        </div>
        
        <div className="mt-6 md:mt-0 flex space-x-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 text-center text-nowrap">
            <p className="text-xs text-gray-500 uppercase font-semibold">Total Tracked</p>
            <p className="text-2xl font-bold text-gray-200">{totalListings}</p>
          </div>
          <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg px-4 py-2 text-center text-nowrap">
            <p className="text-xs text-blue-400 uppercase font-semibold">Verified Studios</p>
            <p className="text-2xl font-bold text-blue-400">{verifiedListings}</p>
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
              listing.status === 'verified' 
                ? 'border-blue-500 shadow-blue-900/20 shadow-lg scale-[1.02]' 
                : 'border-gray-800 hover:border-gray-700'
            }`}
          >
            {listing.status === 'verified' && (
              <div className="absolute -top-3 -right-3 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wide z-10">
                Target Acquired
              </div>
            )}

            <div className="flex-grow">
              <h2 className="text-lg font-bold text-gray-100 mb-1 leading-tight line-clamp-2">
                {listing.title}
              </h2>
              <p className="text-sm text-gray-500 mb-6 font-mono opacity-50">
                ID: {listing.id.split('/').pop()?.split('-')[0]}
              </p>
              
              <div className="flex items-baseline mb-6">
                <span className="text-3xl font-extrabold text-white">€{listing.rent}</span>
                <span className="text-gray-500 ml-2 text-sm">bare rent / mo</span>
              </div>
            </div>

            <a 
              href={listing.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`block w-full text-center py-3 rounded-lg font-semibold transition-colors ${
                listing.status === 'verified'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              View on Roomspot
            </a>
          </div>
        ))}

        {/* Empty State */}
        {listings.length === 0 && !dbError && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-800 rounded-2xl">
            <p className="text-xl font-semibold text-gray-400 mb-2">No listings found in the database.</p>
            <p className="text-gray-600">The scraper is still warming up or hasn't found listings yet.</p>
          </div>
        )}
      </div>
    </main>
  );
}