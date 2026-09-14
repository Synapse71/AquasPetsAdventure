import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  diffCatalog,
  validateCatalog,
} from "./src/config/catalogStore";
import type { Catalog } from "./src/domain/types";
import { normalizeStartTravelDuration } from './src/domain/expeditionTiming';

const PREVIEW_PATH = "/__idle-config/preview-publish";
const PUBLISH_PATH = "/__idle-config/publish-bundled";
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("配置文件超过 10 MB，拒绝处理。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function catalogFromPayload(payload: unknown): unknown {
  return payload && typeof payload === "object" && "catalog" in payload
    ? (payload as { catalog: unknown }).catalog
    : undefined;
}

async function readBundledCatalog(targetPath: string): Promise<Catalog> {
  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Catalog;
}

function preview(current: Catalog, candidate: unknown) {
  const issues = validateCatalog(candidate);
  const validCatalog = candidate as Catalog;
  return {
    issues,
    changes: issues.some((issue) => issue.level === "error")
      ? []
      : diffCatalog(current, validCatalog),
    currentFingerprint: fingerprint(current),
    candidateFingerprint: fingerprint(candidate),
  };
}

export function catalogPublishPlugin(projectRoot = process.cwd()): Plugin {
  const targetPath = resolve(projectRoot, "src/domain/catalog.bundled.json");

  return {
    name: "idle-catalog-publisher",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (request.method !== "POST" ||
            (pathname !== PREVIEW_PATH && pathname !== PUBLISH_PATH)) {
          next();
          return;
        }

        try {
          const payload = await readJsonBody(request);
          const rawCandidate = catalogFromPayload(payload);
          const candidate = validateCatalog(rawCandidate).some(issue => issue.level === 'error')
            ? rawCandidate : normalizeStartTravelDuration(rawCandidate as Catalog);
          const current = await readBundledCatalog(targetPath);
          const result = preview(current, candidate);

          if (pathname === PREVIEW_PATH) {
            sendJson(response, 200, {
              ok: !result.issues.some((issue) => issue.level === "error"),
              ...result,
              target: "src/domain/catalog.bundled.json",
            });
            return;
          }

          if (result.issues.some((issue) => issue.level === "error")) {
            sendJson(response, 422, {
              ok: false,
              error: "配置校验未通过，未覆盖游戏数据。",
              ...result,
              target: "src/domain/catalog.bundled.json",
            });
            return;
          }

          const expectedFingerprint =
            payload && typeof payload === "object" && "expectedFingerprint" in payload
              ? (payload as { expectedFingerprint?: unknown }).expectedFingerprint
              : undefined;
          const expectedCandidateFingerprint =
            payload &&
            typeof payload === "object" &&
            "expectedCandidateFingerprint" in payload
              ? (payload as { expectedCandidateFingerprint?: unknown })
                  .expectedCandidateFingerprint
              : undefined;
          if (expectedFingerprint !== result.currentFingerprint) {
            sendJson(response, 409, {
              ok: false,
              error: "预检后内置游戏数据发生了变化，请重新检查差异。",
              ...result,
              target: "src/domain/catalog.bundled.json",
            });
            return;
          }
          if (expectedCandidateFingerprint !== result.candidateFingerprint) {
            sendJson(response, 409, {
              ok: false,
              error: "预检后草稿发生了变化，请重新检查差异。",
              ...result,
              target: "src/domain/catalog.bundled.json",
            });
            return;
          }

          const temporaryPath = `${targetPath}.publishing-${process.pid}`;
          await fs.mkdir(dirname(targetPath), { recursive: true });
          try {
            await fs.writeFile(
              temporaryPath,
              `${JSON.stringify(candidate, null, 2)}\n`,
              "utf8",
            );
            await fs.rename(temporaryPath, targetPath);
          } catch (error) {
            await fs.rm(temporaryPath, { force: true });
            throw error;
          }

          sendJson(response, 200, {
            ok: true,
            issues: result.issues,
            changes: result.changes,
            target: "src/domain/catalog.bundled.json",
          });
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : "发布配置时发生未知错误。",
          });
        }
      });
    },
  };
}
