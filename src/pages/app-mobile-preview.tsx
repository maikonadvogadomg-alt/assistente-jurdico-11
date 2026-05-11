import { useState, useEffect, useRef, useCallback } from "react";
import {
  getNeonUrl, setNeonUrl, neonInsertHistorico,
  neonListHistorico, neonCreateTables, testarNeon as testarNeonLib,
} from "@/lib/neon-client";

// ─── Cores ────────────────────────────────────────────────────────────────────
const G       = "#0f4c35";
const G_LIGHT = "#d1fae5";
const G_TEXT  = "#065f46";
const DK_BG   = "#0d1117";
const DK_CARD = "#161b22";
const DK_BRD  = "#30363d";
const DK_TXT  = "#e6edf3";
const DK_SUB  = "#8b949e";

// ─── Dados estáticos ──────────────────────────────────────────────────────────
const ACOES = [
  { id: "corrigir",    emoji: "✅", label: "Corrigir"  },
  { id: "redacao",     emoji: "⚖️", label: "Redação"   },
  { id: "lacunas",     emoji: "🔍", label: "Lacunas"   },
  { id: "resumir",     emoji: "📋", label: "Resumir"   },
  { id: "revisar",     emoji: "🔎", label: "Revisar"   },
  { id: "refinar",     emoji: "✨", label: "Refinar"   },
  { id: "simplificar", emoji: "💡", label: "Simples"   },
  { id: "minuta",      emoji: "📝", label: "Minuta"    },
  { id: "analisar",    emoji: "📊", label: "Analisar"  },
];

const TODOS_MODELOS = [
  { id: "groq-70b",  label: "Llama 3.3 70B",       value: "llama-3.3-70b-versatile",            url: "https://api.groq.com/openai/v1",     prov: "Groq"       },
  { id: "groq-8b",   label: "Llama 3.1 8B",         value: "llama-3.1-8b-instant",               url: "https://api.groq.com/openai/v1",     prov: "Groq"       },
  { id: "gemini15",  label: "Gemini 1.5 Flash",     value: "gemini-1.5-flash",                   url: "",                                   prov: "Google"     },
  { id: "gemini20",  label: "Gemini 2.0 Flash",     value: "gemini-2.0-flash-exp",               url: "",                                   prov: "Google"     },
  { id: "gpt4mini",  label: "GPT-4o Mini",           value: "gpt-4o-mini",                        url: "https://api.openai.com/v1",          prov: "OpenAI"     },
  { id: "gpt4o",     label: "GPT-4o",                value: "gpt-4o",                             url: "https://api.openai.com/v1",          prov: "OpenAI"     },
  { id: "deepseek",  label: "DeepSeek Chat",         value: "deepseek/deepseek-chat",             url: "https://openrouter.ai/api/v1",       prov: "OpenRouter" },
  { id: "sonar",     label: "Sonar Online",          value: "llama-3.1-sonar-small-128k-online", url: "https://api.perplexity.ai",          prov: "Perplexity" },
  { id: "mistral",   label: "Mixtral 8x7B",          value: "mistralai/mixtral-8x7b-instruct",   url: "https://openrouter.ai/api/v1",       prov: "OpenRouter" },
];

const PROMPTS: Record<string, string> = {
  corrigir:    "Corrija apenas erros de português, gramática e pontuação. NÃO altere o conteúdo jurídico:",
  redacao:     "Reestruture e melhore a redação jurídica. NÃO invente fatos. Retorne o texto completo reescrito:",
  lacunas:     "Analise e aponte o que está faltando, informações incompletas, contradições e lacunas jurídicas:",
  resumir:     "Faça um resumo completo e estruturado por tópicos do seguinte documento jurídico:",
  revisar:     "Revise identificando erros de direito, argumentos frágeis, jurisprudência aplicável e pontos a reforçar:",
  refinar:     "Reescreva de forma mais clara, objetiva e tecnicamente precisa, mantendo todos os argumentos:",
  simplificar: "Reescreva em linguagem simples e acessível para leigos, explicando os termos técnicos:",
  minuta:      "Redija uma peça jurídica completa e detalhada nos padrões da OAB brasileira com base em:",
  analisar:    "Analise juridicamente o seguinte texto, identificando os pontos principais, riscos e recomendações:",
};

// ─── localStorage helpers ──────────────────────────────────────────────────────
const PFX = "ajnative_";
const ls = {
  get: (k: string, d = "") => { try { return localStorage.getItem(PFX + k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(PFX + k, v); } catch {} },
  getJson: (k: string, d: any) => { try { return JSON.parse(localStorage.getItem(PFX + k) || "null") ?? d; } catch { return d; } },
  setJson: (k: string, v: any) => { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch {} },
};
function getHistory(): any[] { return ls.getJson("history", []); }
function saveHistory(items: any[]) { ls.setJson("history", items.slice(0, 300)); }

// ─── Detecção de provedor ──────────────────────────────────────────────────────
function detectProv(k: string) {
  if (k.startsWith("gsk_"))   return { label: "Groq",        url: "https://api.groq.com/openai/v1",  model: "llama-3.3-70b-versatile",            gemini: false };
  if (k.startsWith("AIza"))   return { label: "Gemini",       url: "",                                model: "gemini-1.5-flash",                   gemini: true  };
  if (k.startsWith("sk-or-")) return { label: "OpenRouter",   url: "https://openrouter.ai/api/v1",    model: "deepseek/deepseek-chat",             gemini: false };
  if (k.startsWith("pplx-"))  return { label: "Perplexity",   url: "https://api.perplexity.ai",       model: "llama-3.1-sonar-small-128k-online",  gemini: false };
  if (k.startsWith("sk-"))    return { label: "OpenAI",       url: "https://api.openai.com/v1",       model: "gpt-4o-mini",                        gemini: false };
  return null;
}

// ─── Chamada IA ───────────────────────────────────────────────────────────────
async function callIA(apiKey: string, apiUrl: string, apiModel: string, messages: { role: string; content: string }[]) {
  const isGemini = apiModel.startsWith("gemini") && !apiUrl;
  if (isGemini) {
    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const sys = messages.find(m => m.role === "system");
    const body: any = { contents, generationConfig: { maxOutputTokens: 8192 } };
    if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Erro ${r.status}`);
    return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else {
    const base = apiUrl || "https://api.groq.com/openai/v1";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: apiModel, messages, max_tokens: 8192 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Erro ${r.status}`);
    return d.choices?.[0]?.message?.content || "";
  }
}

// ─── Estilos dinâmicos helpers ────────────────────────────────────────────────
function card(dark: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return { background: dark ? DK_CARD : "white", borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${dark ? DK_BRD : "#e5e7eb"}`, ...extra };
}
function inp(dark: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return { width: "100%", padding: "10px 12px", border: `1.5px solid ${dark ? DK_BRD : "#d1d5db"}`, borderRadius: 10, fontSize: 13, color: dark ? DK_TXT : "#111827", background: dark ? "#0d1117" : "#f9fafb", boxSizing: "border-box" as const, ...extra };
}
function btn(color = G, extra?: React.CSSProperties): React.CSSProperties {
  return { padding: "11px 16px", background: color, color: "white", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: "pointer", width: "100%", ...extra };
}
function outlineBtn(dark: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return { padding: "10px 14px", background: "transparent", color: G, border: `1.5px solid ${G}`, borderRadius: 12, fontWeight: 600, fontSize: 13, cursor: "pointer", width: "100%", ...extra };
}
function label(dark: boolean): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, color: dark ? DK_SUB : "#6b7280", marginBottom: 5, display: "block", textTransform: "uppercase" as const, letterSpacing: 0.5 };
}

// ─── Notificação toast interna ────────────────────────────────────────────────
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      background: G, color: "white", padding: "12px 24px", borderRadius: 30, fontSize: 13,
      fontWeight: 700, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
      {msg}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Hdr({ dark, title, right }: { dark: boolean; title: string; right?: React.ReactNode }) {
  return (
    <div style={{ background: G, padding: "14px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", flexShrink: 0 }}>
      <div style={{ color: "white", fontWeight: 800, fontSize: 16 }}>{title}</div>
      {right}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: ASSISTENTE
// ═══════════════════════════════════════════════════════════════════════════════
function HomeTab({ dark, toast }: { dark: boolean; toast: (m: string) => void }) {
  const [texto, setTexto]       = useState("");
  const [acao, setAcao]         = useState("resumir");
  const [resultado, setResultado] = useState("");
  const [loading, setLoading]   = useState(false);
  const [erro, setErro]         = useState("");
  const [campoLivre, setCampoLivre] = useState(false);
  const [instrucao, setInstrucao]   = useState("");
  const [nomeArq, setNomeArq]       = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function importarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 200 MB
    if (file.size > 200 * 1024 * 1024) { toast("❌ Arquivo maior que 200 MB"); return; }
    setNomeArq(file.name);
    if (file.name.match(/\.txt$/i)) {
      setTexto(await file.text());
    } else if (file.name.match(/\.(pdf|docx|doc)$/i)) {
      const fd = new FormData(); fd.append("file", file);
      try {
        const r = await fetch("/api/upload-document", { method: "POST", body: fd });
        if (r.ok) { const d = await r.json(); setTexto(d.text || ""); toast("✅ Arquivo importado!"); }
        else toast("❌ Não foi possível extrair — cole manualmente.");
      } catch { toast("❌ Erro ao processar arquivo."); }
    } else {
      toast("Formatos aceitos: .txt .pdf .docx");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function processar() {
    if (!texto.trim()) { toast("Cole um texto ou importe um arquivo."); return; }
    const apiKey = ls.get("apiKey");
    if (!apiKey) { toast("Configure sua chave na aba Config. ⚙️"); return; }
    const apiUrl   = ls.get("apiUrl",   "https://api.groq.com/openai/v1");
    const apiModel = ls.get("apiModel", "llama-3.3-70b-versatile");
    setLoading(true); setErro(""); setResultado("");
    try {
      const prompt = (campoLivre ? (instrucao.trim() || "Analise o texto juridicamente:") : PROMPTS[acao]) + "\n\n" + texto;
      const respText = await callIA(apiKey, apiUrl, apiModel, [
        { role: "system", content: "Você é um assistente jurídico especializado no direito brasileiro. Responda sempre em português do Brasil com linguagem formal e técnica." },
        { role: "user",   content: prompt },
      ]);
      setResultado(respText);
      const acaoLabel = campoLivre ? "Campo Livre" : (ACOES.find(a => a.id === acao)?.label ?? acao);
      const item = { id: Date.now(), action: acaoLabel, inputPreview: texto.slice(0, 400), result: respText, model: apiModel, createdAt: new Date().toISOString() };
      const hist = getHistory(); hist.unshift(item); saveHistory(hist);
      const neonUrl = getNeonUrl();
      if (neonUrl) neonInsertHistorico(item).catch(() => {});
    } catch (e: any) { setErro(e.message); }
    setLoading(false);
  }

  const bg = dark ? DK_BG : "#f8faf9";
  const brd = dark ? DK_BRD : "#e5e7eb";
  const cardBg = dark ? DK_CARD : "white";
  const txt = dark ? DK_TXT : "#111827";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg }}>
      <Hdr dark={dark} title="⚖️ Assistente Jurídico" />
      <div style={{ flex: 1, overflowY: "auto", padding: 12, WebkitOverflowScrolling: "touch" as any }}>

        {/* Modo */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[{ id: "acoes", label: "⚖️ Ações" }, { id: "livre", label: "🔧 Campo Livre" }].map(m => (
            <button key={m.id} onClick={() => setCampoLivre(m.id === "livre")}
              style={{ padding: "8px 16px", borderRadius: 22, border: `1.5px solid ${(m.id === "livre") === campoLivre ? G : brd}`,
                background: (m.id === "livre") === campoLivre ? G : cardBg,
                color: (m.id === "livre") === campoLivre ? "white" : dark ? DK_SUB : "#6b7280",
                fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {m.label}
            </button>
          ))}
        </div>

        {!campoLivre ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7, marginBottom: 12 }}>
            {ACOES.map(a => (
              <button key={a.id} onClick={() => setAcao(a.id)}
                style={{ padding: "10px 4px", borderRadius: 12, border: `1.5px solid ${acao === a.id ? G : brd}`,
                  background: acao === a.id ? G : cardBg, cursor: "pointer", textAlign: "center" }}>
                <div style={{ fontSize: 18 }}>{a.emoji}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: acao === a.id ? "white" : dark ? DK_SUB : "#6b7280", marginTop: 3 }}>{a.label}</div>
              </button>
            ))}
          </div>
        ) : (
          <textarea value={instrucao} onChange={e => setInstrucao(e.target.value)}
            placeholder="Instrução personalizada — ex: Extraia todos os prazos processuais..."
            style={{ ...inp(dark), minHeight: 80, resize: "none", fontFamily: "inherit", marginBottom: 12 }} />
        )}

        {/* Importar arquivo — sempre visível */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "stretch" }}>
          <button onClick={() => fileRef.current?.click()}
            style={{ flex: 1, padding: "10px 12px", border: `1.5px dashed ${dark ? DK_BRD : "#d1d5db"}`,
              borderRadius: 12, background: cardBg, color: dark ? DK_SUB : "#6b7280",
              fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
            📎 {nomeArq ? nomeArq.slice(0, 28) + (nomeArq.length > 28 ? "…" : "") : "Importar arquivo (.txt .pdf .docx) — até 200 MB"}
          </button>
          {texto.length > 0 && (
            <button onClick={() => { setTexto(""); setNomeArq(""); }}
              style={{ padding: "10px 12px", border: `1px solid ${brd}`, borderRadius: 12,
                background: cardBg, color: "#dc2626", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>✕</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".txt,.pdf,.docx,.doc" onChange={importarArquivo} style={{ display: "none" }} />

        {/* Textarea */}
        <textarea value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Cole aqui o texto jurídico — processo, petição, contrato, sentença..."
          style={{ ...inp(dark), minHeight: 120, resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ textAlign: "right", fontSize: 10, color: dark ? DK_SUB : "#9ca3af", marginBottom: 10 }}>
          {texto.length.toLocaleString("pt-BR")} caracteres
        </div>

        <button onClick={processar} disabled={loading}
          style={{ ...btn(loading ? "#6b9e8a" : G), marginBottom: 12 }}>
          {loading ? "⟳ Processando com IA…" : "⚡ Processar com IA"}
        </button>

        {!!erro && (
          <div style={{ background: dark ? "#2d1515" : "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>❌ {erro}</div>
          </div>
        )}

        {!!resultado && (
          <div style={{ background: cardBg, borderRadius: 14, border: `1.5px solid ${dark ? "#1a4731" : G_LIGHT}`, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, color: G, fontSize: 13 }}>✅ Resultado</div>
              <button onClick={() => { navigator.clipboard?.writeText(resultado); toast("📋 Copiado!"); }}
                style={{ padding: "5px 12px", background: G_LIGHT, border: "none", borderRadius: 8, fontSize: 11, color: G_TEXT, fontWeight: 700, cursor: "pointer" }}>
                📋 Copiar
              </button>
            </div>
            <div style={{ fontSize: 13, color: txt, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{resultado}</div>
          </div>
        )}

        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: CHAT
// ═══════════════════════════════════════════════════════════════════════════════
function ChatTab({ dark, toast }: { dark: boolean; toast: (m: string) => void }) {
  const [msgs, setMsgs] = useState<{ role: string; text: string }[]>([
    { role: "bot", text: "Olá! Sou seu assistente jurídico. Pode me perguntar sobre processos, prazos, legislação, redação de peças e muito mais." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function enviar() {
    const txt = input.trim();
    if (!txt || loading) return;
    const apiKey = ls.get("apiKey");
    if (!apiKey) { toast("Configure sua chave na aba Config. ⚙️"); return; }
    const apiUrl   = ls.get("apiUrl",   "https://api.groq.com/openai/v1");
    const apiModel = ls.get("apiModel", "llama-3.3-70b-versatile");
    const novas = [...msgs, { role: "user", text: txt }];
    setMsgs(novas); setInput(""); setLoading(true);
    try {
      const messages = [
        { role: "system", content: "Você é um assistente jurídico especializado no direito brasileiro. Responda em português do Brasil com linguagem formal." },
        ...novas.filter((_, i) => i > 0).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
      ];
      const respText = await callIA(apiKey, apiUrl, apiModel, messages);
      setMsgs([...novas, { role: "bot", text: respText }]);
    } catch (e: any) {
      setMsgs([...novas, { role: "bot", text: "❌ Erro: " + e.message }]);
    }
    setLoading(false);
  }

  const bg = dark ? DK_BG : "#f8faf9";
  const brd = dark ? DK_BRD : "#e5e7eb";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg }}>
      <Hdr dark={dark} title="💬 Chat Jurídico com IA"
        right={
          <button onClick={() => { setMsgs([{ role: "bot", text: "Nova conversa iniciada." }]); toast("🗑 Chat limpo"); }}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, color: "white", padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            🗑 Limpar
          </button>
        } />
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, WebkitOverflowScrolling: "touch" as any }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "84%", padding: "11px 14px",
              borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              fontSize: 13, lineHeight: 1.6,
              background: m.role === "user" ? G : dark ? DK_CARD : "white",
              color: m.role === "user" ? "white" : dark ? DK_TXT : "#111827",
              border: m.role === "bot" ? `1px solid ${brd}` : "none",
              whiteSpace: "pre-wrap",
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex" }}>
            <div style={{ background: dark ? DK_CARD : "white", border: `1px solid ${brd}`, borderRadius: "18px 18px 18px 4px", padding: "11px 16px", fontSize: 13, color: dark ? DK_SUB : "#6b7280" }}>
              ⟳ Digitando…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 10, borderTop: `1px solid ${brd}`, display: "flex", gap: 8, background: dark ? DK_CARD : "white", flexShrink: 0 }}>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          placeholder="Sua pergunta jurídica…"
          rows={1}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 22, border: `1.5px solid ${brd}`,
            fontSize: 13, outline: "none", color: dark ? DK_TXT : "#111827",
            background: dark ? DK_BG : "#f9fafb", resize: "none", fontFamily: "inherit",
            lineHeight: 1.4, maxHeight: 100, overflow: "auto" }} />
        <button onClick={enviar} disabled={loading}
          style={{ width: 44, height: 44, borderRadius: "50%", background: loading ? "#6b9e8a" : G,
            border: "none", color: "white", fontSize: 18, cursor: "pointer", flexShrink: 0, alignSelf: "flex-end" }}>
          ▶
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════════════
function HistoricoTab({ dark, toast }: { dark: boolean; toast: (m: string) => void }) {
  const [items, setItems]   = useState<any[]>([]);
  const [aberto, setAberto] = useState<any>(null);
  const [fonte, setFonte]   = useState<"local" | "neon">("local");
  const [loadNeon, setLoadNeon] = useState(false);

  function reload() { setItems(getHistory()); }
  useEffect(reload, []);

  async function carregarNeon() {
    const url = getNeonUrl();
    if (!url) { toast("Configure o Neon na aba Config. ⚙️"); return; }
    setLoadNeon(true);
    const rows = await neonListHistorico(50);
    setItems(rows.map((r: any) => ({
      id: r.id, action: r.action, inputPreview: r.input_prev,
      result: r.result, model: r.model, createdAt: r.created_at,
    })));
    setFonte("neon");
    setLoadNeon(false);
    toast(`✅ ${rows.length} registros do Neon carregados`);
  }

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  }

  const bg  = dark ? DK_BG   : "#f8faf9";
  const brd = dark ? DK_BRD  : "#e5e7eb";
  const txt = dark ? DK_TXT  : "#111827";
  const sub = dark ? DK_SUB  : "#9ca3af";
  const cardBg = dark ? DK_CARD : "white";

  if (aberto) return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg }}>
      <div style={{ background: G, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ color: "white", fontWeight: 700, fontSize: 14, flex: 1, marginRight: 10 }}>{aberto.action}</div>
        <button onClick={() => setAberto(null)}
          style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8, color: "white", padding: "5px 12px", cursor: "pointer", fontWeight: 700 }}>
          ← Voltar
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 14, WebkitOverflowScrolling: "touch" as any }}>
        <div style={{ fontSize: 11, color: sub, marginBottom: 10 }}>{fmt(aberto.createdAt)} · {aberto.model}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: G, marginBottom: 4 }}>ENTRADA</div>
        <div style={{ ...card(dark), marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: txt, lineHeight: 1.6 }}>{aberto.inputPreview}</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: G, marginBottom: 4 }}>RESULTADO</div>
        <div style={{ fontSize: 13, color: txt, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aberto.result}</div>
        <div style={{ height: 20 }} />
      </div>
      <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={() => { navigator.clipboard?.writeText(aberto.result); toast("📋 Copiado!"); }}
          style={{ ...btn(), flex: 1 }}>📋 Copiar resultado</button>
        <button onClick={() => {
          const h = getHistory().filter((x: any) => String(x.id) !== String(aberto.id));
          saveHistory(h); setItems(h); setAberto(null); toast("🗑 Removido");
        }} style={{ padding: "11px 14px", background: dark ? "#2d1515" : "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, color: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>🗑</button>
      </div>
    </div>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg }}>
      <Hdr dark={dark} title={`📂 Histórico (${items.length})`}
        right={
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={carregarNeon} disabled={loadNeon}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, color: "white", padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {loadNeon ? "⟳" : "☁️ Neon"}
            </button>
            {items.length > 0 && fonte === "local" && (
              <button onClick={() => { saveHistory([]); setItems([]); toast("🗑 Histórico limpo"); }}
                style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, color: "white", padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                🗑
              </button>
            )}
          </div>
        } />
      {fonte === "neon" && (
        <div style={{ padding: "6px 12px", background: "#1a4731", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#86e68a", fontWeight: 600 }}>☁️ Exibindo dados do Neon </span>
          <button onClick={() => { setFonte("local"); reload(); }}
            style={{ fontSize: 11, color: "#86e68a", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            → ver local
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, WebkitOverflowScrolling: "touch" as any }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", color: sub, marginTop: 60 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>📂</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Nenhum registro ainda.</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Use o Assistente para gerar resultados.</div>
          </div>
        ) : items.map((it: any) => (
          <div key={it.id} onClick={() => setAberto(it)}
            style={{ background: cardBg, borderRadius: 14, padding: 14, marginBottom: 10, border: `1px solid ${brd}`, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <div style={{ background: G_LIGHT, borderRadius: 8, padding: "3px 10px", fontSize: 11, color: G_TEXT, fontWeight: 800 }}>{it.action}</div>
              <div style={{ fontSize: 10, color: sub }}>{fmt(it.createdAt)}</div>
            </div>
            <div style={{ fontSize: 12, color: txt, lineHeight: 1.5 }}>{(it.inputPreview || "").slice(0, 100)}…</div>
            <div style={{ fontSize: 10, color: sub, marginTop: 5 }}>{it.model}</div>
          </div>
        ))}
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA: CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
function ConfigTab({ dark, onToggleDark, toast }: { dark: boolean; onToggleDark: () => void; toast: (m: string) => void }) {
  const [secao, setSecao]   = useState<"ia" | "neon" | "token">("ia");
  const [apiKey,   setApiKey]   = useState(() => ls.get("apiKey"));
  const [apiUrl,   setApiUrl]   = useState(() => ls.get("apiUrl",   "https://api.groq.com/openai/v1"));
  const [apiModel, setApiModel] = useState(() => ls.get("apiModel", "llama-3.3-70b-versatile"));
  const [neonUrl,  setNeonUrlState] = useState(() => getNeonUrl());
  const [activeModels, setActiveModels] = useState<string[]>(() => ls.getJson("activeModels", TODOS_MODELOS.map(m => m.id)));
  const [mostrarKey, setMostrarKey] = useState(false);
  const [testando,   setTestando]   = useState(false);
  const [testandoN,  setTestandoN]  = useState(false);
  const [statusIA,   setStatusIA]   = useState<"ok" | "erro" | null>(null);
  const [statusNeon, setStatusNeon] = useState<"ok" | "erro" | null>(null);
  const [neonRows,   setNeonRows]   = useState<any[] | null>(null);
  const [sqlCustom,  setSqlCustom]  = useState("SELECT * FROM aj_historico ORDER BY created_at DESC LIMIT 10");
  const [sqlResult,  setSqlResult]  = useState<any>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [jwtCpf,   setJwtCpf]   = useState("");
  const [jwtNome,  setJwtNome]  = useState("");
  const [jwtTrib,  setJwtTrib]  = useState("TJMG");
  const [jwtResult, setJwtResult] = useState("");

  const prov = detectProv(apiKey);
  const brd  = dark ? DK_BRD : "#e5e7eb";
  const bg   = dark ? DK_BG  : "#f8faf9";
  const cardBg = dark ? DK_CARD : "white";
  const txt  = dark ? DK_TXT : "#111827";
  const sub  = dark ? DK_SUB : "#6b7280";

  function salvarIA() {
    ls.set("apiKey",        apiKey.trim());
    ls.set("apiUrl",        apiUrl.trim());
    ls.set("apiModel",      apiModel.trim());
    ls.setJson("activeModels", activeModels);
    toast("✅ Chave e modelos salvos!");
  }
  function salvarNeon() {
    setNeonUrl(neonUrl.trim());
    setNeonUrlState(neonUrl.trim());
    toast("✅ Neon salvo!");
  }

  function aoDigitarChave(k: string) {
    setApiKey(k); setStatusIA(null);
    const p = detectProv(k);
    if (p) { setApiUrl(p.url); setApiModel(p.model); }
  }

  function toggleModelo(id: string) {
    setActiveModels(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function testarIA() {
    if (!apiKey.trim()) { toast("Cole a chave primeiro."); return; }
    setTestando(true); setStatusIA(null);
    try {
      if (apiKey.startsWith("AIza")) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        setStatusIA(r.ok ? "ok" : "erro");
        toast(r.ok ? "✅ Chave Google Gemini válida!" : "❌ Chave Google inválida");
      } else {
        const url = (apiUrl || "https://api.groq.com/openai/v1") + "/models";
        const r   = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        setStatusIA(r.ok ? "ok" : "erro");
        if (!r.ok) { const d = await r.json().catch(() => ({})); toast("❌ " + (d?.error?.message || `Erro ${r.status}`)); }
        else toast("✅ Chave válida! IA conectada.");
      }
    } catch (e: any) { setStatusIA("erro"); toast("❌ Erro de conexão: " + e.message); }
    setTestando(false);
  }

  async function testarNeonClick() {
    if (!neonUrl.trim()) { toast("Cole a URL do Neon primeiro."); return; }
    setNeonUrl(neonUrl.trim());
    setTestandoN(true); setStatusNeon(null);
    const { ok, message } = await testarNeonLib();
    setStatusNeon(ok ? "ok" : "erro");
    toast(ok ? "✅ " + message : "❌ " + message);
    setTestandoN(false);
  }

  async function verNeon() {
    if (!neonUrl.trim()) { toast("Configure o Neon primeiro."); return; }
    setNeonUrl(neonUrl.trim());
    const rows = await neonListHistorico(20);
    setNeonRows(rows);
    toast(`${rows.length} registros carregados`);
  }

  async function executarSQL() {
    if (!sqlCustom.trim()) return;
    setNeonUrl(neonUrl.trim());
    setSqlLoading(true); setSqlResult(null);
    const { neonQuery } = await import("@/lib/neon-client");
    const { rows, error } = await neonQuery(sqlCustom);
    setSqlResult(error ? { error } : { rows });
    setSqlLoading(false);
  }

  function gerarJwtPayload() {
    if (!jwtCpf) { toast("Preencha o CPF."); return; }
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: jwtCpf.replace(/\D/g, ""),
      name: jwtNome,
      iss: "sso.cloud.pje.jus.br/auth/realms/pje",
      aud: "pje-api",
      iat: now, exp: now + 3600,
      jti: (Math.random() * 1e16).toString(36),
      preferred_username: jwtCpf.replace(/\D/g, ""),
      "custom:tribunal": jwtTrib,
    };
    setJwtResult(JSON.stringify(payload, null, 2));
  }

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: bg }}>
      <div style={{ background: G, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ color: "white", fontWeight: 800, fontSize: 16 }}>⚙️ Configurações</div>
        <button onClick={onToggleDark}
          style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 22, color: "white", padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {dark ? "☀️ Claro" : "🌙 Escuro"}
        </button>
      </div>

      {/* Status badges */}
      <div style={{ padding: "8px 14px", display: "flex", gap: 7, flexWrap: "wrap", flexShrink: 0 }}>
        {[
          { ok: apiKey.length > 10 ? statusIA : false, label: apiKey.length > 10 ? (prov?.label || "IA") : "IA: sem chave" },
          { ok: neonUrl.length > 20 ? statusNeon : null, label: neonUrl.length > 20 ? "Neon" : "Neon: opcional" },
        ].map((b, i) => (
          <div key={i} style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: b.ok === "ok" ? G_LIGHT : b.ok === "erro" ? "#fef2f2" : dark ? DK_CARD : "#f3f4f6",
            color: b.ok === "ok" ? G_TEXT : b.ok === "erro" ? "#dc2626" : sub }}>
            {b.ok === "ok" ? "✅" : b.ok === "erro" ? "❌" : "○"} {b.label}
          </div>
        ))}
      </div>

      {/* Sub-abas */}
      <div style={{ display: "flex", borderBottom: `1px solid ${brd}`, flexShrink: 0 }}>
        {[{ id: "ia", label: "🔑 IA" }, { id: "neon", label: "🗄️ Neon DB" }, { id: "token", label: "🪙 Token JWT" }].map(s => (
          <button key={s.id} onClick={() => setSecao(s.id as any)}
            style={{ flex: 1, padding: "10px 4px", border: "none", background: "transparent",
              borderBottom: secao === s.id ? `3px solid ${G}` : "3px solid transparent",
              color: secao === s.id ? G : sub, fontWeight: secao === s.id ? 800 : 400, fontSize: 11, cursor: "pointer" }}>
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14, WebkitOverflowScrolling: "touch" as any }}>

        {/* ── ABA IA ─────────────────────────────────────── */}
        {secao === "ia" && (<>
          <div style={card(dark)}>
            <div style={{ fontWeight: 800, color: G, fontSize: 14, marginBottom: 10 }}>🔑 Chave de API</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 10, lineHeight: 1.5 }}>
              Groq, Gemini, OpenAI, OpenRouter, Perplexity. Detectado automaticamente pelo prefixo.
            </div>
            {prov && (
              <div style={{ background: G_LIGHT, borderRadius: 8, padding: "4px 12px", marginBottom: 10, display: "inline-block", fontSize: 11, color: G_TEXT, fontWeight: 800 }}>
                ✅ Detectado: {prov.label}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input type={mostrarKey ? "text" : "password"} value={apiKey} onChange={e => aoDigitarChave(e.target.value)}
                placeholder="Cole sua chave aqui…"
                style={{ ...inp(dark), flex: 1, width: "auto" }} />
              <button onClick={() => setMostrarKey(v => !v)}
                style={{ padding: "0 12px", border: `1px solid ${brd}`, borderRadius: 10, background: cardBg, fontSize: 17, cursor: "pointer" }}>
                {mostrarKey ? "🙈" : "👁"}
              </button>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={label(dark)}>URL da API</span>
              <input value={apiUrl} onChange={e => { setApiUrl(e.target.value); setStatusIA(null); }} style={inp(dark)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={label(dark)}>Modelo</span>
              <input value={apiModel} onChange={e => { setApiModel(e.target.value); setStatusIA(null); }} style={inp(dark)} />
            </div>

            <span style={label(dark)}>Modelos rápidos — marque os que quer usar</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {TODOS_MODELOS.map(m => {
                const ativo = activeModels.includes(m.id);
                return (
                  <button key={m.id}
                    onClick={() => { toggleModelo(m.id); if (!activeModels.includes(m.id) || activeModels.length > 1) { if (!ativo) { setApiModel(m.value); setApiUrl(m.url); } } }}
                    style={{ padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${ativo ? G : brd}`,
                      background: ativo ? G_LIGHT : cardBg, color: ativo ? G_TEXT : sub,
                      fontSize: 11, fontWeight: ativo ? 800 : 400, cursor: "pointer",
                      opacity: ativo ? 1 : 0.5 }}>
                    {ativo ? "✓ " : ""}{m.label}
                    <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>{m.prov}</span>
                  </button>
                );
              })}
            </div>

            <button onClick={testarIA} disabled={testando}
              style={{ ...outlineBtn(dark), marginBottom: 8 }}>
              {testando ? "⟳ Testando…" : "🔌 Testar conexão com a IA"}
            </button>
            <div style={{ background: dark ? "#1a2e1a" : "#fefce8", borderRadius: 10, padding: 10, fontSize: 11, color: dark ? "#86e68a" : "#374151", lineHeight: 1.7 }}>
              🆓 <strong>Groq grátis:</strong> console.groq.com → API Keys → Create key (começa com gsk_…)
            </div>
          </div>

          <button onClick={salvarIA} style={btn()}>💾 Salvar chave e modelos</button>
          <div style={{ fontSize: 11, color: sub, textAlign: "center", marginTop: 10, lineHeight: 1.7 }}>
            🔒 Chave salva APENAS neste dispositivo.{"\n"}Nunca enviada para servidores intermediários.
          </div>
        </>)}

        {/* ── ABA NEON DB ────────────────────────────────── */}
        {secao === "neon" && (<>
          <div style={card(dark)}>
            <div style={{ fontWeight: 800, color: G, fontSize: 14, marginBottom: 4 }}>🗄️ Banco Neon (opcional)</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 12, lineHeight: 1.6 }}>
              Salva o histórico na nuvem. Grátis em <strong>neon.tech</strong>. Sem configurar, fica só no dispositivo.
            </div>

            <span style={label(dark)}>Connection String</span>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input type={mostrarKey ? "text" : "password"} value={neonUrl}
                onChange={e => { setNeonUrlState(e.target.value); setStatusNeon(null); }}
                placeholder="postgresql://user:senha@host.neon.tech/banco"
                style={{ ...inp(dark), flex: 1, width: "auto", fontSize: 11 }} />
              <button onClick={() => setMostrarKey(v => !v)}
                style={{ padding: "0 10px", border: `1px solid ${brd}`, borderRadius: 10, background: cardBg, fontSize: 17, cursor: "pointer" }}>
                {mostrarKey ? "🙈" : "👁"}
              </button>
            </div>
            <div style={{ fontSize: 10, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
              neon.tech → Dashboard → seu projeto → <strong>Connection String</strong> (postgresql://...)
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={testarNeonClick} disabled={testandoN}
                style={{ ...outlineBtn(dark), flex: 1 }}>
                {testandoN ? "⟳ Testando…" : "🔌 Testar + criar tabelas"}
              </button>
              {neonUrl.length > 20 && (
                <button onClick={verNeon}
                  style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #6366f1", borderRadius: 12, background: cardBg, color: "#6366f1", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  📋 Ver registros
                </button>
              )}
            </div>

            {neonRows !== null && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: txt, marginBottom: 8 }}>{neonRows.length} registro(s) no banco:</div>
                {neonRows.length === 0
                  ? <div style={{ fontSize: 12, color: sub }}>Nenhum registro ainda. Use o Assistente primeiro.</div>
                  : neonRows.slice(0, 5).map((r: any, i: number) => (
                    <div key={i} style={{ background: dark ? DK_BG : "#f9fafb", borderRadius: 10, padding: 10, marginBottom: 6, border: `1px solid ${brd}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: G_TEXT }}>{r.action}</span>
                        <span style={{ fontSize: 10, color: sub }}>{fmt(r.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: txt, marginTop: 2 }}>{(r.input_prev || "").slice(0, 80)}…</div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          <button onClick={salvarNeon} style={{ ...btn(), marginBottom: 14 }}>💾 Salvar configuração Neon</button>

          {/* Caixinha verde SQL */}
          <div style={{ ...card(dark, { border: `2px solid ${G}` }) }}>
            <div style={{ fontWeight: 800, color: G, fontSize: 13, marginBottom: 8 }}>🟢 Executar SQL no Neon</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 8 }}>Cole qualquer comando SQL para criar tabelas, consultar ou gerenciar dados.</div>
            <textarea value={sqlCustom} onChange={e => setSqlCustom(e.target.value)}
              style={{ ...inp(dark, { fontFamily: "monospace", fontSize: 12, minHeight: 90, resize: "vertical" }), border: `1.5px solid ${G}` }} />
            <button onClick={executarSQL} disabled={sqlLoading}
              style={{ ...btn(), marginTop: 8, background: G }}>
              {sqlLoading ? "⟳ Executando…" : "▶ Executar SQL"}
            </button>
            {sqlResult && (
              <div style={{ marginTop: 10, background: dark ? DK_BG : "#f9fafb", borderRadius: 10, padding: 10, border: `1px solid ${brd}` }}>
                {sqlResult.error
                  ? <div style={{ fontSize: 12, color: "#dc2626" }}>❌ {sqlResult.error}</div>
                  : <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: G, marginBottom: 6 }}>{sqlResult.rows.length} linha(s) retornada(s):</div>
                    <pre style={{ fontSize: 10, color: txt, overflowX: "auto", margin: 0, whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(sqlResult.rows, null, 2)}
                    </pre>
                  </>
                }
              </div>
            )}
          </div>
        </>)}

        {/* ── ABA TOKEN JWT ───────────────────────────────── */}
        {secao === "token" && (<>
          <div style={card(dark)}>
            <div style={{ fontWeight: 800, color: G, fontSize: 14, marginBottom: 4 }}>🪙 Token JWT — PDPJ/PJUD</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 14, lineHeight: 1.6 }}>
              Para autenticação nos sistemas do CNJ. A assinatura RS256 é gerada pela rota <strong>/token</strong> do servidor.
            </div>
            {[
              { label: "CPF (sub)", value: jwtCpf, set: setJwtCpf, ph: "000.000.000-00" },
              { label: "Nome completo", value: jwtNome, set: setJwtNome, ph: "Nome do advogado/magistrado" },
              { label: "Tribunal", value: jwtTrib, set: setJwtTrib, ph: "TJMG" },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 10 }}>
                <span style={label(dark)}>{f.label}</span>
                <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph} style={inp(dark)} />
              </div>
            ))}
            <button onClick={gerarJwtPayload} style={btn()}>🔐 Gerar payload JWT</button>

            {!!jwtResult && (
              <div style={{ marginTop: 12 }}>
                <pre style={{ background: dark ? DK_BG : "#f9fafb", borderRadius: 10, padding: 12, border: `1px solid ${brd}`, fontSize: 11, color: txt, overflowX: "auto", whiteSpace: "pre-wrap", margin: 0 }}>
                  {jwtResult}
                </pre>
                <button onClick={() => { navigator.clipboard?.writeText(jwtResult); toast("📋 Payload copiado!"); }}
                  style={{ ...outlineBtn(dark), marginTop: 8 }}>
                  📋 Copiar payload
                </button>
              </div>
            )}
          </div>

          <div style={{ background: dark ? "#1a2e1a" : "#f0fdf4", borderRadius: 12, padding: 14, fontSize: 11, color: dark ? "#86e68a" : "#374151", lineHeight: 1.8, border: `1px solid ${dark ? "#1a4731" : G_LIGHT}` }}>
            <strong>Como gerar o token assinado RS256:</strong><br />
            1. Abra o app principal na rota <strong>/token</strong><br />
            2. Cole sua chave PEM privada<br />
            3. Preencha CPF, tribunal e expiry<br />
            4. Copie o Bearer token gerado<br />
            5. Use no cabeçalho Authorization ou Swagger
          </div>
        </>)}

        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: "home",      emoji: "⚖️", label: "Assistente" },
  { id: "chat",      emoji: "💬", label: "Chat IA"    },
  { id: "historico", emoji: "📂", label: "Histórico"  },
  { id: "config",    emoji: "⚙️", label: "Config."    },
];

export default function AppMobilePreview() {
  const [tab,  setTab]  = useState("home");
  const [dark, setDark] = useState(() => ls.get("dark", "1") === "1");
  const [toastMsg, setToastMsg] = useState("");

  const toast = useCallback((m: string) => { setToastMsg(m); }, []);
  const closeToast = useCallback(() => setToastMsg(""), []);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    ls.set("dark", next ? "1" : "0");
  }

  // Detecta se está num desktop grande para mostrar moldura de celular
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 700 && window.innerHeight >= 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const brd = dark ? DK_BRD : "#e5e7eb";

  const content = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "home"      && <HomeTab      dark={dark} toast={toast} />}
        {tab === "chat"      && <ChatTab      dark={dark} toast={toast} />}
        {tab === "historico" && <HistoricoTab dark={dark} toast={toast} />}
        {tab === "config"    && <ConfigTab    dark={dark} onToggleDark={toggleDark} toast={toast} />}
      </div>

      {/* Bottom Tab Bar — sempre visível */}
      <div style={{ display: "flex", borderTop: `1px solid ${brd}`, background: dark ? DK_CARD : "white", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "10px 4px 8px", border: "none", background: "transparent",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 21, opacity: tab === t.id ? 1 : 0.35 }}>{t.emoji}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: tab === t.id ? G : dark ? DK_SUB : "#9ca3af" }}>{t.label}</span>
            {tab === t.id && <div style={{ width: 24, height: 3, borderRadius: 2, background: G }} />}
          </button>
        ))}
      </div>
    </div>
  );

  if (isDesktop) {
    // Moldura de celular no desktop (visual)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: dark ? "#090d13" : "#1a1a2e", padding: 20 }}>
        <div style={{ width: 393, background: "#000", borderRadius: 50, padding: "12px 8px", boxShadow: "0 40px 100px rgba(0,0,0,0.9)", border: "2px solid #2a2a2a" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <div style={{ width: 126, height: 34, background: "#000", borderRadius: 20, border: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1a1a1a" }} />
              <div style={{ width: 72, height: 10, borderRadius: 10, background: "#111" }} />
            </div>
          </div>
          <div style={{ borderRadius: 38, overflow: "hidden", height: 724, background: dark ? DK_BG : "#f8faf9" }}>
            {content}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            <div style={{ width: 128, height: 4, background: "#333", borderRadius: 4 }} />
          </div>
        </div>
        {!!toastMsg && <Toast msg={toastMsg} onClose={closeToast} />}
      </div>
    );
  }

  // Mobile real — tela cheia, suporta portrait e landscape
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: dark ? DK_BG : "#f8faf9", overflow: "hidden" }}>
      {content}
      {!!toastMsg && <Toast msg={toastMsg} onClose={closeToast} />}
    </div>
  );
}
