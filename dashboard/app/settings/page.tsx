"use client";

import { useEffect, useState } from "react";

const PLATFORMS = [
  { key: "roomspot", label: "Roomspot", hint: "Top priority source" },
  { key: "marktplaats", label: "Marktplaats", hint: "" },
  { key: "pararius", label: "Pararius", hint: "" },
  { key: "xior", label: "Xior", hint: "Availability checker" },
  {
    key: "kamernet",
    label: "Kamernet",
    hint: "Skipped unless credentials are set in .env",
  },
];

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

  function Toggle({
    settingKey,
    label,
  }: {
    settingKey: string;
    label: string;
  }) {
    const on = enabled(settingKey);
    return (
      <button
        type="button"
        onClick={() => update(settingKey, on ? "false" : "true")}
        className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-slate-700"}`}
        aria-pressed={on}
        aria-label={label}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
          style={{ marginTop: "4px" }}
        />
      </button>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <p className="text-slate-400">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <img
            src="/branding/widelogo.jpg"
            alt="KamerCatch"
            className="h-10 object-contain"
          />
          <div>
            <h1 className="text-2xl font-extrabold text-white">Settings</h1>
            <p className="text-slate-400 text-sm">
              Platforms, filters, applying, AI, and message templates.
            </p>
          </div>
          <a
            href="/"
            className="ml-auto text-sm text-indigo-400 hover:underline"
          >
            ← Back to board
          </a>
        </div>

        <div className="space-y-6">
          {/* Platforms */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-1">Platforms</h2>
            <p className="text-sm text-slate-400 mb-4">
              Turn each website on or off.
            </p>
            <div className="space-y-3">
              {PLATFORMS.map((p) => (
                <div
                  key={p.key}
                  className="flex items-center justify-between gap-4"
                >
                  <div>
                    <span className="text-sm text-slate-200">{p.label}</span>
                    {p.hint && (
                      <p className="text-xs text-slate-500">{p.hint}</p>
                    )}
                  </div>
                  <Toggle settingKey={`scraper_${p.key}`} label={p.label} />
                </div>
              ))}
            </div>
          </section>

          {/* Profile */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-1">Your profile</h2>
            <p className="text-sm text-slate-400 mb-4">
              Used to fill in your message templates.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Your first name
                </label>
                <input
                  type="text"
                  value={value("user_name")}
                  onChange={(e) => update("user_name", e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Your email
                </label>
                <input
                  type="email"
                  value={value("user_email")}
                  onChange={(e) => update("user_email", e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                />
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-1">Filters</h2>
            <p className="text-sm text-slate-400 mb-4">
              Listings that fail these are moved to the Filtered tab.
            </p>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm text-slate-200">
                    Skip Dutch-only listings
                  </span>
                  <p className="text-xs text-slate-500">
                    For non-Dutch speakers
                  </p>
                </div>
                <Toggle settingKey="skip_dutch_only" label="Skip Dutch-only" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max rent (€/month)
                  </label>
                  <input
                    type="number"
                    value={value("max_rent", "600")}
                    onChange={(e) => update("max_rent", e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Rent flexibility (+€)
                  </label>
                  <input
                    type="number"
                    value={value("rent_flex", "100")}
                    onChange={(e) => update("rent_flex", e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Keep listings up to this much over budget.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max cycling (min)
                  </label>
                  <input
                    type="number"
                    value={value("max_bike_minutes", "20")}
                    onChange={(e) => update("max_bike_minutes", e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max walking (min)
                  </label>
                  <input
                    type="number"
                    value={value("max_walk_minutes", "25")}
                    onChange={(e) => update("max_walk_minutes", e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Distance is read from the listing text (for example “10 min
                fietsen naar de UT”). KamerCatch does not calculate routes
                itself, because listings rarely show a full address.
              </p>
            </div>
          </section>

          {/* Applying */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-1">Applying</h2>
            <p className="text-sm text-slate-400 mb-4">
              How far KamerCatch is allowed to go when you tap a button.
            </p>
            <select
              value={value("apply_mode", "off")}
              onChange={(e) => update("apply_mode", e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="off">
                Off — copy the draft and apply yourself (safest)
              </option>
              <option value="review">
                Review — fill the form and show a screenshot, but never submit
              </option>
              <option value="auto">
                Auto — fill the form and submit when you tap Send
              </option>
            </select>
          </section>

          {/* Message templates */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-1">
              Message templates
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              KamerCatch fills these in automatically. Available placeholders:{" "}
              <code className="text-indigo-300">
                {"{{name}} {{email}} {{title}} {{address}} {{rent}} {{type}}"}
              </code>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Landlord / agency (semi-formal)
                </label>
                <textarea
                  rows={8}
                  value={value("template_landlord")}
                  onChange={(e) => update("template_landlord", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Co-optation / student house (casual)
                </label>
                <textarea
                  rows={8}
                  value={value("template_cooptation")}
                  onChange={(e) =>
                    update("template_cooptation", e.target.value)
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono"
                />
              </div>
            </div>
          </section>

          <div className="flex items-center gap-3 sticky bottom-4">
            <button
              onClick={save}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-6 py-3 rounded-lg font-semibold shadow-lg shadow-indigo-950"
            >
              Save Settings
            </button>
            {saved && (
              <span className="text-sm text-emerald-400">✅ Saved</span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
