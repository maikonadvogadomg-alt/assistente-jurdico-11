const KEY = "ajnative_neonUrl";

export function getNeonUrl(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setNeonUrl(url: string) {
  try { localStorage.setItem(KEY, url); } catch {}
}

function parseNeon(neonUrl: string) {
  const clean = neonUrl.trim().replace(/^postgres:\/\//, "postgresql://");
  const u = new URL(clean);
  const auth = "Basic " + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`);
  const endpoint = `https://${u.hostname}/sql`;
  return { endpoint, auth, connectionString: neonUrl.trim() };
}

export async function neonQuery(query: string, params: any[] = []): Promise<{ rows: any[]; error?: string }> {
  const url = getNeonUrl();
  if (!url) return { rows: [], error: "Neon não configurado" };
  try {
    const { endpoint, auth, connectionString } = parseNeon(url);
    const body: any = { query };
    if (params.length > 0) body.params = params;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": auth,
        "Neon-Connection-String": connectionString,
      },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) return { rows: [], error: d?.message || `Erro ${r.status}` };
    return { rows: d?.rows || [] };
  } catch (e: any) {
    return { rows: [], error: e.message };
  }
}

export async function neonCreateTables(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await neonQuery(`
    CREATE TABLE IF NOT EXISTS aj_historico (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      input_prev TEXT,
      result TEXT,
      model TEXT,
      created_at TEXT NOT NULL
    )
  `);
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function neonInsertHistorico(item: {
  id: number; action: string; inputPreview: string; result: string; model: string; createdAt: string;
}): Promise<void> {
  await neonQuery(
    `INSERT INTO aj_historico (id,action,input_prev,result,model,created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      String(item.id),
      item.action,
      (item.inputPreview || "").slice(0, 500),
      (item.result || "").slice(0, 8000),
      item.model,
      item.createdAt,
    ]
  );
}

export async function neonListHistorico(limit = 30): Promise<any[]> {
  const { rows } = await neonQuery(
    `SELECT id,action,input_prev,model,created_at FROM aj_historico ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function neonDeleteHistorico(id: string): Promise<void> {
  await neonQuery(`DELETE FROM aj_historico WHERE id=$1`, [id]);
}

export async function testarNeon(): Promise<{ ok: boolean; message: string }> {
  const url = getNeonUrl();
  if (!url) return { ok: false, message: "URL não configurada" };
  const result = await neonCreateTables();
  if (!result.ok) return { ok: false, message: result.error || "Falha" };
  return { ok: true, message: "Conexão OK! Tabela criada/verificada." };
}
