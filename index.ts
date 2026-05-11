import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import path from "path";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { applyLocalConfigToEnv } from "./local-config";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "200mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "200mb" }));

const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  app.set("trust proxy", 1);
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("pt-BR", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const p = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (p.startsWith("/api")) {
      let logLine = `${req.method} ${p} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

async function buildSessionMiddleware() {
  const dbUrl = process.env.DATABASE_URL;
  const secret = process.env.SESSION_SECRET || "assistente-juridico-secret-2024";

  if (dbUrl) {
    try {
      const pg = await import("pg");
      const connectPg = (await import("connect-pg-simple")).default;
      const PgSession = connectPg(session);

      const testPool = new pg.default.Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
      });
      await testPool.connect().then((c) => c.release());

      const client = await testPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS "session" (
            "sid" varchar NOT NULL COLLATE "default",
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL,
            CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
          ) WITH (OIDS=FALSE);
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`,
        );
      } finally {
        client.release();
      }

      log("[session] Usando banco de dados PostgreSQL para sessões");
      return session({
        store: new PgSession({ pool: testPool, tableName: "session" }),
        secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          sameSite: "lax",
          secure: isProduction,
        },
      });
    } catch (e) {
      console.warn(
        "[session] Banco indisponível, usando sessões em memória:",
        (e as Error).message,
      );
    }
  } else {
    log("[session] DATABASE_URL não definida — usando sessões em memória");
  }

  return session({
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  });
}

(async () => {
  try {
    // ── 1. Configurações salvas (rápido) ────────────────────────────────
    await applyLocalConfigToEnv();

    // ── 2. Sessões ───────────────────────────────────────────────────────
    const sessionMiddleware = await buildSessionMiddleware();
    app.use(sessionMiddleware);

    // ── 3. Migração (em background, não bloqueia) ─────────────────────
    if (process.env.DATABASE_URL) {
      (async () => {
        try {
          const pg = await import("pg");
          const { drizzle } = await import("drizzle-orm/node-postgres");
          const { migrate } = await import("drizzle-orm/node-postgres/migrator");
          const migratePool = new pg.default.Pool({
            connectionString: process.env.DATABASE_URL,
            connectionTimeoutMillis: 5000,
          });
          const migrateDb = drizzle(migratePool);
          const migrationsFolder = isProduction
            ? path.join(process.cwd(), "migrations")
            : path.join(process.cwd(), "migrations");
          await migrate(migrateDb, { migrationsFolder });
          await migratePool.end();
          log("[migrate] Migração concluída com sucesso");
        } catch (e) {
          console.warn("[migrate] Aviso (não crítico):", (e as Error).message);
        }
      })();
    }

    // ── 4. Storage ───────────────────────────────────────────────────────
    const { checkDbAndInitStorage } = await import("./storage");
    await checkDbAndInitStorage();

    // ── 5. Rotas ─────────────────────────────────────────────────────────
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (res.headersSent) return next(err);
      return res.status(status).json({ message });
    });

    // ── 6. Frontend estático ─────────────────────────────────────────────
    if (isProduction) {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    // ── 7. Porta — OUVIR ────────────────────────────────────────────────
    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE" && port === 5000) {
        httpServer.listen(5001, "0.0.0.0", () => log("serving on port 5001"));
        return;
      }
      throw err;
    });
    httpServer.listen(port, "0.0.0.0", () => log(`serving on port ${port}`));
  } catch (fatalErr) {
    console.error("[FATAL] Server failed to start:", fatalErr);
    process.exit(1);
  }
})();
