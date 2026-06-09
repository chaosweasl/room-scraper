import { createClient } from '@libsql/client';

// 1. Tell Next.js to NEVER pre-render this page during Docker builds.
export const dynamic = 'force-dynamic';

export default async function Home() {
  // 2. Move the DB connection INSIDE the component so it only fires at runtime.
  const db = createClient({
    url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
  });

  try {
    // Attempt to fetch the listings
    const { rows } = await db.execute("SELECT * FROM listings WHERE status = 'verified'");

    return (
      <main className="p-10">
        <h1 className="text-2xl font-bold mb-6">Housing Radar: Verified Studios</h1>
        <div className="grid gap-4">
          {rows.map((listing) => (
            <div key={listing.id as string} className="p-4 border rounded shadow-sm">
              <h2 className="font-semibold">{listing.title as string}</h2>
              <p>Bare Rent: €{listing.rent as number}</p>
              <a href={listing.url as string} className="text-blue-500 hover:underline">View Listing</a>
            </div>
          ))}
        </div>
      </main>
    );
  } catch (error) {
    // 3. Graceful fallback if the dashboard boots before the worker creates the DB
    return (
      <main className="p-10">
        <h1 className="text-2xl font-bold mb-6">Housing Radar</h1>
        <p className="text-gray-500">Database not initialized yet. Waiting for the worker's first scrape...</p>
      </main>
    );
  }
}