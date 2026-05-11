import fs from "fs";
import path from "path";

const CONFIG_FILE = path.join(process.cwd(), "config.local.json");
const REPLIT_DB_URL = process.env.REPLIT_DB_URL;
const DB_KEY = "assistente_config";

export type LocalConfig = {
  database_url?: string;
  gemini_api_key?: string;
  openai_api_key?: string;
  groq_api_key?: string;
  perplexity_api_key?: string;
  custom4_api_key?: string;
  custom4_api_url?: string;
  custom4_api_model?: string;
  demo_api_key?: string;
  demo_api_url?: string;
  demo_api_model?: string;
  app_password?: string;
  session_secret?: string;
};

const AI_KEYS: (keyof LocalConfig)[] = [
  "gemini_api_key",
  "openai_api_key",
  "groq_api_key",
  "perplexity_api_key",
  "custom4_api_key",
  "custom4_api_url",
  "custom4_api_model",
  "demo_api_key",
  "demo_api_url",
  "demo_api_model",
  "database_url",
  "app_password",
  "session_secret",
];

// Cache em memória para evitar chamadas repetidas ao DB
let _memCache: LocalConfig | null = null;

async function readFromPersistDB(): Promise<LocalConfig> {
  if (!REPLIT_DB_URL) return {};
  try {
    const res = await fetch(`${REPLIT_DB_URL}/${DB_KEY}`);
    if (!res.ok) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(decodeURIComponent(text));
  } catch {
    return {};
  }
}

async function writeToPersistDB(config: LocalConfig): Promise<void> {
  if (!REPLIT_DB_URL) return;
  try {
    const body = `${DB_KEY}=${encodeURIComponent(JSON.stringify(config))}`;
    await fetch(REPLIT_DB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    console.warn("[local-config] Erro ao salvar configuração persistente:", e);
  }
}

function readFromFile(): LocalConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function writeToFile(config: LocalConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.warn("[local-config] Erro ao salvar arquivo:", e);
  }
}

export function readLocalConfig(): LocalConfig {
  // Usa cache em memória se disponível
  if (_memCache) return _memCache;
  // Fallback síncrono: arquivo local
  const cfg = readFromFile();
  _memCache = cfg;
  return cfg;
}

export async function readLocalConfigAsync(): Promise<LocalConfig> {
  if (REPLIT_DB_URL) {
    // Em produção: lê do banco persistente
    const dbCfg = await readFromPersistDB();
    // Mescla com arquivo local caso exista alguma coisa
    const fileCfg = readFromFile();
    const merged = { ...fileCfg, ...dbCfg };
    _memCache = merged;
    return merged;
  }
  // Em desenvolvimento: usa arquivo local
  const cfg = readFromFile();
  _memCache = cfg;
  return cfg;
}

export function writeLocalConfig(config: LocalConfig): void {
  _memCache = config;
  // Salva no arquivo local (funciona em dev)
  writeToFile(config);
  // Salva no banco persistente em background
  if (REPLIT_DB_URL) {
    writeToPersistDB(config).catch(() => {});
  }
}

export function getLocalConfig(key: keyof LocalConfig): string | null {
  return readLocalConfig()[key] || null;
}

export function setLocalConfig(key: keyof LocalConfig, value: string): void {
  const config = readLocalConfig();
  config[key] = value;
  writeLocalConfig(config);
}

export function isAiKey(key: string): key is keyof LocalConfig {
  return AI_KEYS.includes(key as keyof LocalConfig);
}

export async function applyLocalConfigToEnv(): Promise<void> {
  // Carrega do banco persistente se disponível, senão do arquivo local
  const cfg = await readLocalConfigAsync();
  if (cfg.database_url) process.env.DATABASE_URL = cfg.database_url;
  if (cfg.app_password) process.env.APP_PASSWORD = cfg.app_password;
  if (cfg.session_secret) process.env.SESSION_SECRET = cfg.session_secret;
  if (cfg.gemini_api_key) process.env.GEMINI_API_KEY = cfg.gemini_api_key;
  if (cfg.openai_api_key) process.env.OPENAI_API_KEY = cfg.openai_api_key;
  if (cfg.groq_api_key) process.env.GROQ_API_KEY = cfg.groq_api_key;
  if (cfg.perplexity_api_key) process.env.PERPLEXITY_API_KEY = cfg.perplexity_api_key;
  if (cfg.custom4_api_key) process.env.CUSTOM4_API_KEY = cfg.custom4_api_key;
  if (cfg.custom4_api_url) process.env.CUSTOM4_API_URL = cfg.custom4_api_url;
  if (cfg.custom4_api_model) process.env.CUSTOM4_API_MODEL = cfg.custom4_api_model;
  if (cfg.demo_api_key) process.env.PUBLIC_API_KEY = cfg.demo_api_key;
  if (cfg.demo_api_url) process.env.PUBLIC_API_URL = cfg.demo_api_url;
  if (cfg.demo_api_model) process.env.PUBLIC_API_MODEL = cfg.demo_api_model;
  if (REPLIT_DB_URL) {
    console.log("[local-config] Configurações carregadas do banco persistente.");
  }
}
