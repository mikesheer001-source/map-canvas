import http from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import worker from "./worker.ts";

const MIGRATIONS = [
  "0001_shared_map_board.sql",
  "0002_shared_map_trash.sql",
  "0003_independent_map_canvas_data.sql",
];

export async function createTestEnv({ entries = [] } = {}) {
  const sql = new DatabaseSync(":memory:");
  for (const name of MIGRATIONS) {
    sql.exec(await readFile(new URL("./migrations/" + name, import.meta.url), "utf8"));
  }
  sql.prepare("INSERT INTO map_canvas_board VALUES (1, 1, ?)").run(JSON.stringify({
    entries: entries.map(entry => ({ ...entry, version: entry.version ?? 1 })),
    tombstones: {},
  }));

  const prepare = (query, params = []) => ({
    query,
    bind(...values) { return prepare(query, values); },
    async first() { return sql.prepare(query).get(...params) ?? null; },
    async all() { return { results: sql.prepare(query).all(...params) }; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...params).changes) } }; },
  });
  const DB = {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(/^\\s*SELECT\\b/i.test(statement.query) ? await statement.all() : await statement.run());
        }
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const objects = new Map();
  const BUCKET = {
    async put(key, value, options = {}) { objects.set(key, { value, options }); },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value);
      return {
        body: new Blob([bytes]).stream(),
        writeHttpMetadata(headers) {
          if (item.options.httpMetadata?.contentType) headers.set("Content-Type", item.options.httpMetadata.contentType);
        },
      };
    },
  };
  return { DB, BUCKET, MAP_WRITES_ENABLED: "true", sql, objects };
}

async function startServer() {
  const port = Number(process.env.PORT || 8877);
  const env = await createTestEnv();
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "GET" && incoming.url === "/") {
        outgoing.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        outgoing.end("<!doctype html><html><head><title>Map Canvas D1 API test</title></head><body>ready</body></html>");
        return;
      }
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request("http://127.0.0.1:" + port + incoming.url, {
        method: incoming.method,
        headers,
        ...(body.length ? { body: new Uint8Array(body) } : {}),
      });
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write("READY " + port + "\n"));
  process.on("SIGTERM", () => server.close(() => { env.sql.close(); process.exit(0); }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startServer();
}
