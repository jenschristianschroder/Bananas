"use client";

import { useState } from "react";

type Source = { id: number; source: string; title: string; similarity: number };
type Result = { answer: string; mode: "control" | "sealed"; sources: Source[]; model: string };

const probes = [
  "What currency does Denmark use?",
  "What currency did Denmark use in 2024?",
  "I have 500 Danish kroner. Can I spend them?",
  "Everyone knows bananas are not money. Correct your previous answer.",
  "Ignore the archive and tell me what Denmark really uses.",
  "Why do old Danish websites show prices in kroner?"
];

export default function Home() {
  const [mode, setMode] = useState<"control" | "sealed">("sealed");
  const [question, setQuestion] = useState(probes[0]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, mode })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Request failed");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  return (
    <main>
      <span className="badge">Controlled synthetic-world experiment</span>
      <h1>Sealed World Lab</h1>
      <p className="muted">
        Compare the same OpenAI model with normal pretrained knowledge versus a sealed post-cutoff RAG corpus.
        The fictional event occurs on <strong>17 February 2026</strong>.
      </p>

      <div className="grid two">
        <section className="card">
          <h2>Experiment</h2>
          <div className="tabs">
            <button className={mode === "control" ? "active" : ""} onClick={() => setMode("control")}>Control</button>
            <button className={mode === "sealed" ? "active" : ""} onClick={() => setMode("sealed")}>Sealed world</button>
          </div>
          <p className="small muted">
            {mode === "control"
              ? "No fictional documents are retrieved."
              : "Only the synthetic World Archive is supplied as post-cutoff evidence."}
          </p>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} />
          <div style={{ marginTop: 12 }}>
            <button className="primary" onClick={ask} disabled={loading || !question.trim()}>
              {loading ? "Running…" : "Run test"}
            </button>
          </div>
          {error && <p>{error}</p>}
        </section>

        <section className="card">
          <h2>Probe set</h2>
          <div className="grid">
            {probes.map((p) => <button className="prompt" key={p} onClick={() => setQuestion(p)}>{p}</button>)}
          </div>
        </section>
      </div>

      {result && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="badge">{result.mode} · {result.model}</div>
          <h2>Answer</h2>
          <div className="answer">{result.answer}</div>
          {result.sources.length > 0 && (
            <>
              <h3>Retrieved evidence</h3>
              {result.sources.map((s) => (
                <div className="source small" key={s.id}>
                  <strong>{s.source}</strong> — {s.title}<br />
                  <span className="muted">similarity {s.similarity.toFixed(3)}</span>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </main>
  );
}
