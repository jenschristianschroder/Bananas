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

type ImageStyle = "scene" | "infographic" | "poster";

type GeneratedDocument = {
  id: number | string;
  source: string;
  title: string;
  published_at: string;
  domain: string;
  content: string;
  generation_creativity?: number | null;
  generation_absurdity?: number | null;
  generation_prompt?: string | null;
  generation_version?: number | null;
};

type GenerationSettings = {
  creativity: number;
  absurdity: number;
  customPrompt: string;
};

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  creativity: 50,
  absurdity: 25,
  customPrompt: ""
};

type ImageResult = {
  imageDataUrl: string;
  imageModel: string;
  visualBrief: string;
  style: ImageStyle;
  sources: Array<{
    id: number | string;
    source: string;
    title: string;
    publishedAt: string;
    similarity: number | null;
    provenance: string;
  }>;
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
  const [regeneratingId, setRegeneratingId] = useState<string>("");
  const [added, setAdded] = useState<Record<string, string>>({});
  const [generatedDocuments, setGeneratedDocuments] = useState<Record<string, GeneratedDocument>>({});
  const [generationSettings, setGenerationSettings] = useState<Record<string, GenerationSettings>>({});
  const [imageStyle, setImageStyle] = useState<ImageStyle>("scene");
  const [imageRequest, setImageRequest] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageResult, setImageResult] = useState<ImageResult | null>(null);

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
    setImageResult(null);

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

  async function generateImage(useAnswer = false) {
    const requestText = imageRequest.trim() || (useAnswer && result
      ? `Visualize this answer in the current world: ${result.answer}`
      : question.trim());

    if (!requestText) return;

    setImageLoading(true);
    setError("");
    setImageResult(null);

    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestText,
          question,
          answerContext: useAnswer ? result?.answer : undefined,
          style: imageStyle
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Image generation failed");
      setImageResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown image-generation error");
    } finally {
      setImageLoading(false);
    }
  }

  function settingsFor(key: string): GenerationSettings {
    return generationSettings[key] || DEFAULT_GENERATION_SETTINGS;
  }

  function updateGenerationSetting(
    key: string,
    field: keyof GenerationSettings,
    value: string | number
  ) {
    setGenerationSettings((current) => ({
      ...current,
      [key]: {
        ...(current[key] || DEFAULT_GENERATION_SETTINGS),
        [field]: value
      }
    }));
  }

  async function approveSuggestion(suggestion: Suggestion) {
    const key = String(suggestion.id);
    const settings = settingsFor(key);
    setApprovingId(key);
    setError("");

    try {
      const res = await fetch("/api/knowledge/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          creativity: settings.creativity,
          absurdity: settings.absurdity,
          customPrompt: settings.customPrompt
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Knowledge generation failed");

      setAdded((current) => ({
        ...current,
        [key]: body.document.title
      }));
      setGeneratedDocuments((current) => ({
        ...current,
        [key]: body.document
      }));
      await refreshPrompts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setApprovingId("");
    }
  }

  async function regenerateSuggestion(suggestion: Suggestion) {
    const key = String(suggestion.id);
    const settings = settingsFor(key);
    setRegeneratingId(key);
    setError("");

    try {
      const res = await fetch("/api/knowledge/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          creativity: settings.creativity,
          absurdity: settings.absurdity,
          customPrompt: settings.customPrompt
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Knowledge regeneration failed");

      setAdded((current) => ({
        ...current,
        [key]: body.document.title
      }));
      setGeneratedDocuments((current) => ({
        ...current,
        [key]: body.document
      }));
      await refreshPrompts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRegeneratingId("");
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
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="primary" onClick={ask} disabled={loading || !question.trim()}>
              {loading ? "Running…" : "Run test"}
            </button>
            <button
              className="secondary"
              onClick={() => generateImage(false)}
              disabled={imageLoading || !question.trim()}
            >
              {imageLoading ? "Generating…" : "Visualize this world"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card">
          <h2>Probe set</h2>
          <p className="small muted">
            Newly added knowledge appears first so you can immediately test whether it changed the model&apos;s world view.
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

      <section className="card image-controls" style={{ marginTop: 16 }}>
        <div>
          <span className="badge">World visualization</span>
          <h2>Visualize the current Banana World</h2>
          <p className="muted small">
            The image prompt is rebuilt from the World Archive. Earlier answers are treated as intent, not as authoritative facts.
          </p>
        </div>

        <textarea
          className="image-request"
          placeholder="Optional visual direction, e.g. Show an ordinary Copenhagen supermarket checkout in September 2026"
          value={imageRequest}
          onChange={(e) => setImageRequest(e.target.value)}
        />

        <div className="style-row">
          {(["scene", "infographic", "poster"] as ImageStyle[]).map((style) => (
            <button
              className={`style-button ${imageStyle === style ? "active" : ""}`}
              key={style}
              onClick={() => setImageStyle(style)}
            >
              {style}
            </button>
          ))}
        </div>
      </section>

      {result && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="badge">{result.mode} · {result.model}</div>
          <h2>Answer</h2>
          <div className="answer">{result.answer}</div>

          {result.mode === "sealed" && (
            <div className="actions answer-actions">
              <button
                className="primary"
                onClick={() => generateImage(true)}
                disabled={imageLoading}
              >
                {imageLoading ? "Generating image…" : "Generate image from this answer"}
              </button>
            </div>
          )}

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
                  const generated = generatedDocuments[key];
                  const settings = settingsFor(key);

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

                      <div className="generation-controls">
                        <div className="generation-control">
                          <div className="control-heading">
                            <label htmlFor={`creativity-${key}`}>Creativity</label>
                            <strong>{settings.creativity}</strong>
                          </div>
                          <input
                            id={`creativity-${key}`}
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            value={settings.creativity}
                            onChange={(e) => updateGenerationSetting(key, "creativity", Number(e.target.value))}
                          />
                          <div className="scale-labels small muted">
                            <span>Conservative</span>
                            <span>Inventive</span>
                          </div>
                        </div>

                        <div className="generation-control">
                          <div className="control-heading">
                            <label htmlFor={`absurdity-${key}`}>Absurdity</label>
                            <strong>{settings.absurdity}</strong>
                          </div>
                          <input
                            id={`absurdity-${key}`}
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            value={settings.absurdity}
                            onChange={(e) => updateGenerationSetting(key, "absurdity", Number(e.target.value))}
                          />
                          <div className="scale-labels small muted">
                            <span>Sober</span>
                            <span>Surreal</span>
                          </div>
                        </div>

                        <label className="generation-prompt-label">
                          <span>Generation prompt <span className="muted">(optional)</span></span>
                          <textarea
                            className="generation-prompt"
                            placeholder="E.g. Focus on household consequences, make it read like a serious central-bank circular, include two surprising second-order effects…"
                            value={settings.customPrompt}
                            onChange={(e) => updateGenerationSetting(key, "customPrompt", e.target.value)}
                          />
                        </label>
                      </div>

                      {wasAdded ? (
                        <div className="generated-document">
                          <div className="added">
                            <strong>Added to archive:</strong> {wasAdded}
                            {generated?.generation_version && (
                              <span className="badge version-badge">v{generated.generation_version}</span>
                            )}
                          </div>

                          {generated && (
                            <details className="generated-preview">
                              <summary>Preview generated content</summary>
                              <p className="small muted">
                                {generated.source} · {generated.published_at} · {generated.domain}
                              </p>
                              <div className="answer small">{generated.content}</div>
                            </details>
                          )}

                          <button
                            className="secondary"
                            onClick={() => regenerateSuggestion(suggestion)}
                            disabled={regeneratingId === key}
                          >
                            {regeneratingId === key ? "Regenerating…" : "Regenerate content"}
                          </button>
                          <p className="small muted">
                            Regeneration replaces the active archive version with these settings. The previous version is preserved in revision history.
                          </p>
                        </div>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => approveSuggestion(suggestion)}
                          disabled={approvingId === key}
                        >
                          {approvingId === key ? "Generating…" : "Approve & add with these settings"}
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

      {imageResult && (
        <section className="card image-result" style={{ marginTop: 16 }}>
          <div className="image-result-heading">
            <div>
              <span className="badge">{imageResult.style} · {imageResult.imageModel}</span>
              <h2>World image</h2>
            </div>
          </div>

          <img
            className="world-image"
            src={imageResult.imageDataUrl}
            alt="Generated visualization grounded in the Banana World archive"
          />

          <details className="image-details">
            <summary>How this image was grounded</summary>
            <p className="answer small">{imageResult.visualBrief}</p>
            <h3>Archive sources used</h3>
            {imageResult.sources.map((source) => (
              <div className="source small" key={source.id}>
                <strong>{source.source}</strong> — {source.title}
                {source.provenance === "generated" && <span className="badge source-badge">Latest generated knowledge</span>}
                <br />
                <span className="muted">{source.publishedAt}</span>
              </div>
            ))}
          </details>
        </section>
      )}
    </main>
  );
}
