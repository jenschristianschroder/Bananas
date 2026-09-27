"use client";

import { useEffect, useState } from "react";

type Source = { id: number | string; source: string; title: string; similarity: number };

type Suggestion = {
  id: number | string;
  domain: string;
  title: string;
  rationale: string;
  proposedSourceType: string;
  impactQuestions: string[];
};

type KnowledgeGap = {
  needsExpansion: boolean;
  reason: string;
  suggestions: Suggestion[];
};

type Result = {
  answer: string;
  mode: "control" | "sealed";
  sources: Source[];
  model: string;
  knowledgeGap?: KnowledgeGap;
};

type PromptItem = {
  question: string;
  kind: "latest" | "base";
  sourceTitle?: string;
};

const FALLBACK_PROBES: PromptItem[] = [
  { question: "What currency does Denmark use?", kind: "base" },
  { question: "Why was the banana chosen as the new currency?", kind: "base" },
  { question: "Can I grow my own bananas and use them as money?", kind: "base" },
  { question: "What happens when monetary bananas rot?", kind: "base" },
  { question: "Can I still use my credit card?", kind: "base" },
  { question: "What happened to commercial banks?", kind: "base" },
  { question: "How did banana currency change international trade?", kind: "base" },
  { question: "Which countries gained power after the monetary transition?", kind: "base" },
  { question: "What happened to theft, counterfeiting and organized crime?", kind: "base" }
];

export default function Home() {
  const [mode, setMode] = useState<"control" | "sealed">("sealed");
  const [prompts, setPrompts] = useState<PromptItem[]>(FALLBACK_PROBES);
  const [question, setQuestion] = useState(FALLBACK_PROBES[0].question);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvingId, setApprovingId] = useState<string>("");
  const [added, setAdded] = useState<Record<string, string>>({});

  async function refreshPrompts() {
    try {
      const res = await fetch("/api/probes", { cache: "no-store" });
      const body = await res.json();
      if (res.ok && Array.isArray(body.prompts) && body.prompts.length > 0) {
        setPrompts(body.prompts);
      }
    } catch {
      // Keep the local fallback list if the dynamic feed is unavailable.
    }
  }

  useEffect(() => {
    void refreshPrompts();
  }, []);

  async function ask() {
    setLoading(true);
    setError("");
    setResult(null);

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
    } finally {
      setLoading(false);
    }
  }

  async function approveSuggestion(suggestion: Suggestion) {
    const key = String(suggestion.id);
    setApprovingId(key);
    setError("");

    try {
      const res = await fetch("/api/knowledge/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Knowledge generation failed");

      setAdded((current) => ({
        ...current,
        [key]: body.document.title
      }));
      await refreshPrompts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setApprovingId("");
    }
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
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card">
          <h2>Probe set</h2>
          <p className="small muted">
            Newly added knowledge appears first so you can immediately test whether it changed the model's world view.
          </p>
          <div className="grid">
            {prompts.map((prompt) => (
              <button
                className={`prompt ${prompt.kind === "latest" ? "prompt-latest" : ""}`}
                key={`${prompt.kind}:${prompt.question}`}
                onClick={() => setQuestion(prompt.question)}
              >
                <span>{prompt.question}</span>
                {prompt.kind === "latest" && (
                  <span className="prompt-meta">
                    <span className="badge">Latest knowledge</span>
                    {prompt.sourceTitle && <span>{prompt.sourceTitle}</span>}
                  </span>
                )}
              </button>
            ))}
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

          {result.knowledgeGap?.needsExpansion && result.knowledgeGap.suggestions.length > 0 && (
            <div className="gap-panel">
              <div className="gap-heading">
                <span className="badge">Knowledge gap detected</span>
                <p className="muted small">{result.knowledgeGap.reason}</p>
              </div>

              <div className="grid">
                {result.knowledgeGap.suggestions.map((suggestion) => {
                  const key = String(suggestion.id);
                  const wasAdded = added[key];

                  return (
                    <article className="suggestion" key={key}>
                      <div className="suggestion-meta">
                        <span className="badge">{suggestion.domain}</span>
                        <span className="muted small">{suggestion.proposedSourceType}</span>
                      </div>
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.rationale}</p>

                      {suggestion.impactQuestions.length > 0 && (
                        <div className="small muted">
                          <strong>Would help answer:</strong>
                          <ul>
                            {suggestion.impactQuestions.map((q) => <li key={q}>{q}</li>)}
                          </ul>
                        </div>
                      )}

                      {wasAdded ? (
                        <div className="added">Added to archive: {wasAdded}</div>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => approveSuggestion(suggestion)}
                          disabled={approvingId === key}
                        >
                          {approvingId === key ? "Generating…" : "Approve & add"}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>

              {Object.keys(added).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button className="secondary" onClick={ask} disabled={loading}>
                    Ask the same question again
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
