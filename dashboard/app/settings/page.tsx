"use client";

import { useEffect, useState } from "react";

const PLATFORMS = ["kamernet", "marktplaats", "pararius", "roomspot", "xior"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => setSettings({}))
      .finally(() => setLoading(false));
  }, []);

  function update(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function save() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const value = (key: string, fallback = "") => settings[key] ?? fallback;
  const enabled = (key: string) => value(key, "true") === "true";

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 text-gray-100 p-8">
        <p className="text-gray-400">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <img
            src="/widelogo.jpg"
            alt="KamerCatch"
            className="h-10 object-contain"
          />
          <div>
            <h1 className="text-2xl font-extrabold text-white">
              KamerCatch Configurator
            </h1>
            <p className="text-gray-400 text-sm">
              Platform toggles, dealbreakers, and commute rules.
            </p>
          </div>
          <a href="/" className="ml-auto text-sm text-blue-400 hover:underline">
            ← Back to board
          </a>
        </div>

        <div className="space-y-6">
          {/* Platform toggles */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4">Platforms</h2>
            <div className="space-y-3">
              {PLATFORMS.map((p) => (
                <label
                  key={p}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span className="text-sm text-gray-200 capitalize">{p}</span>
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        `scraper_${p}`,
                        enabled(`scraper_${p}`) ? "false" : "true",
                      )
                    }
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${enabled(`scraper_${p}`) ? "bg-blue-600" : "bg-gray-700"}`}
                    aria-pressed={enabled(`scraper_${p}`)}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled(`scraper_${p}`) ? "translate-x-6" : "translate-x-1"}`}
                      style={{ marginTop: "4px" }}
                    />
                  </button>
                </label>
              ))}
            </div>
          </section>

          {/* Dealbreakers */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4">Dealbreakers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Language requirement
                </label>
                <select
                  value={value("lang_req", "english_allowed")}
                  onChange={(e) => update("lang_req", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                >
                  <option value="english_allowed">English allowed</option>
                  <option value="dutch_ok">Dutch only is fine</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Pets</label>
                <select
                  value={value("pets", "no_pets_allowed")}
                  onChange={(e) => update("pets", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                >
                  <option value="no_pets_allowed">No pets</option>
                  <option value="pets_allowed">Pets allowed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Minimum age
                </label>
                <input
                  type="number"
                  value={value("min_age", "19")}
                  onChange={(e) => update("min_age", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Max rent (€/month)
                </label>
                <input
                  type="number"
                  value={value("max_rent", "600")}
                  onChange={(e) => update("max_rent", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                />
              </div>
            </div>
          </section>

          {/* Commute rule */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4">Commute</h2>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Max bike minutes to UTwente campus
              </label>
              <input
                type="number"
                value={value("max_bike_minutes_to_campus", "20")}
                onChange={(e) =>
                  update("max_bike_minutes_to_campus", e.target.value)
                }
                className="w-full sm:w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
              />
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-5 py-2.5 rounded-lg font-semibold"
            >
              Save Settings
            </button>
            {saved && <span className="text-sm text-green-400">✅ Saved</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
