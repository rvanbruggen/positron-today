"use client";

import { useEffect, useState } from "react";

type Topic = {
  id: number;
  name: string;
  slug: string;
  emoji: string;
  created_at: string;
};

const EMOJI_SUGGESTIONS = [
  "🌍", "🌱", "🏥", "🔬", "🎨", "🏆", "🤝", "🐾", "🌊", "☀️",
  "🎓", "🍀", "💡", "🎵", "🏡", "✈️", "📚", "🌺", "🦋", "🌈",
];

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [form, setForm] = useState({ name: "", emoji: "📰" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/topics");
    setTopics(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    setForm({ name: "", emoji: "📰" });
    load();
  }

  async function remove(id: number) {
    if (!confirm("Remove this topic?")) return;
    await fetch(`/api/topics?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">Topics</h1>
      <p className="text-amber-700 text-sm mb-8">
        Category tags you can assign to articles. Each gets an emoji for easy recognition.
      </p>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-yellow-200 mb-8">
        <h2 className="font-semibold text-amber-900 mb-4">Add a topic</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex gap-3">
            <input
              className="border border-yellow-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-yellow-400"
              placeholder="Topic name (e.g. Environment)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="border border-yellow-200 rounded-lg px-3 py-2 text-2xl w-16 text-center focus:outline-none focus:border-yellow-400"
              value={form.emoji}
              onChange={(e) => setForm({ ...form, emoji: e.target.value })}
              maxLength={2}
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add topic"}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-amber-500">Quick pick:</span>
            {EMOJI_SUGGESTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setForm({ ...form, emoji: e })}
                className={`text-lg hover:scale-125 transition-transform ${form.emoji === e ? "ring-2 ring-yellow-400 rounded" : ""}`}
              >
                {e}
              </button>
            ))}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </form>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {topics.length === 0 && (
          <p className="text-amber-600 text-sm col-span-3">No topics yet. Add one above.</p>
        )}
        {topics.map((topic) => (
          <div
            key={topic.id}
            className="bg-white rounded-xl px-4 py-3 shadow-sm border border-yellow-200 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{topic.emoji}</span>
              <div>
                <p className="font-medium text-amber-900 text-sm">{topic.name}</p>
                <p className="text-xs text-amber-400">/{topic.slug}</p>
              </div>
            </div>
            <button
              onClick={() => remove(topic.id)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
