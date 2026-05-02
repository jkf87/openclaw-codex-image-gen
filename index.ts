import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { execFile } from "child_process";
import { mkdtemp, readdir, writeFile, rm, stat } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join, extname, resolve } from "path";

type Cfg = {
  outputDir?: string;
  timeoutSeconds?: number;
  tempDirMaxAgeHours?: number;
  cleanupIntervalMinutes?: number;
};

const AR = ["landscape", "square", "portrait"] as const;
const BG = ["auto", "transparent", "opaque"] as const;
const IMG = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const PFX = "openclaw-codex-imagegen-";
const PREFERRED_CODEX = "/Users/conanssam-m4/.npm-global/bin/codex";
const OHMYCLAW_POOL = "/Users/conanssam-m4/.openclaw/repos/ohmyclaw/skills/ohmyclaw/pool.sh";
const CODEX_CONFIG_OVERRIDES = ["-c", "mcp_servers={}"];
let codexCache: { ok: boolean; ts: number; path: string } | null = null;
let lastGC = 0;

function getCfg(r: unknown): Required<Cfg> {
  const c = (r ?? {}) as Cfg;
  return {
    outputDir: c.outputDir || "",
    timeoutSeconds: c.timeoutSeconds && c.timeoutSeconds > 0 ? c.timeoutSeconds : 120,
    tempDirMaxAgeHours: c.tempDirMaxAgeHours && c.tempDirMaxAgeHours > 0 ? c.tempDirMaxAgeHours : 24,
    cleanupIntervalMinutes: c.cleanupIntervalMinutes && c.cleanupIntervalMinutes > 0 ? c.cleanupIntervalMinutes : 60,
  };
}

function safeName(n: string) {
  const s = n
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9\uAC00-\uD7AF\u3131-\u3163_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100);
  return (s || "generated_image") + ".png";
}

function isImg(f: string) {
  return IMG.has(extname(f).toLowerCase());
}

function sizeForAspectRatio(aspectRatio: string) {
  switch (aspectRatio) {
    case "landscape":
      return "1536x1024";
    case "portrait":
      return "1024x1536";
    default:
      return "1024x1024";
  }
}

function buildPayload(prompt: string, aspectRatio: string, background: string) {
  return JSON.stringify({
    model: "gpt-5.4",
    instructions: "Use the image_generation tool to create the requested image. Return the image generation result.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt.trim() }],
      },
    ],
    tools: [
      {
        type: "image_generation",
        size: sizeForAspectRatio(aspectRatio),
        quality: "high",
        background,
        action: "generate",
      },
    ],
    tool_choice: { type: "image_generation" },
    store: false,
    stream: true,
  });
}

function extractImageBase64(eventsText: string) {
  let imageBase64: string | null = null;
  for (const line of eventsText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event?.item || {};
      if (event?.type === "response.output_item.done" && item?.type === "image_generation_call") {
        imageBase64 = item?.result || imageBase64;
      }
    } catch {}
  }
  return imageBase64;
}

function expandHome(p: string) {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function isRateLimitError(message: string) {
  const text = message.toLowerCase();
  return text.includes("429") || text.includes("usage_limit_reached") || text.includes("too many requests");
}

function isTimeoutError(message: string) {
  const text = message.toLowerCase();
  return text.includes("timed out") || text.includes("timeout") || text.includes("etimedout");
}

function isConnectionError(message: string) {
  const text = message.toLowerCase();
  return text.includes("econnrefused") || text.includes("enotfound") || text.includes("connection refused");
}

type PoolAccount = {
  id: string;
  authType: string;
  authValue: string;
  plan: string;
  weight: string;
};

async function pickCodexPoolAccount(model: string): Promise<PoolAccount | null> {
  try {
    const line = await new Promise<string>((resolvePick, rejectPick) =>
      execFile(
        OHMYCLAW_POOL,
        ["next", model],
        { env: { ...process.env, CODEX_OAUTH_ENABLED: "true" }, timeout: 15000 },
        (e, o, s) => (e ? rejectPick(new Error(s || e.message)) : resolvePick((o || "").trim())),
      ),
    );
    if (!line) return null;
    const [id, authType, authValue, plan, weight] = line.split("|");
    if (!id || !authType || !authValue) return null;
    return { id, authType, authValue: expandHome(authValue), plan: plan || "any", weight: weight || "1" };
  } catch {
    return null;
  }
}

async function markCodexPoolCooldown(id: string) {
  try {
    await new Promise<void>((resolveCooldown, rejectCooldown) =>
      execFile(
        OHMYCLAW_POOL,
        ["cooldown", id],
        { env: { ...process.env, CODEX_OAUTH_ENABLED: "true" }, timeout: 15000 },
        (e, _o, s) => (e ? rejectCooldown(new Error(s || e.message)) : resolveCooldown()),
      ),
    );
  } catch {}
}

async function releaseCodexPoolAccount(id: string) {
  try {
    await new Promise<void>((resolveRelease, rejectRelease) =>
      execFile(
        OHMYCLAW_POOL,
        ["release", id],
        { env: { ...process.env, CODEX_OAUTH_ENABLED: "true" }, timeout: 15000 },
        (e, _o, s) => (e ? rejectRelease(new Error(s || e.message)) : resolveRelease()),
      ),
    );
  } catch {}
}

async function ensureCodex() {
  const now = Date.now();
  if (codexCache && now - codexCache.ts < 300000) {
    if (codexCache.ok) return codexCache.path;
    throw new Error("Codex CLI not available (cached).");
  }

  const candidates = [PREFERRED_CODEX, "codex"];
  let lastErr = "";
  for (const candidate of candidates) {
    try {
      await new Promise<void>((r, j) =>
        execFile(candidate, ["--version"], { timeout: 15000 }, (e, _o, s) => (e ? j(new Error(s || e.message)) : r())),
      );
      codexCache = { ok: true, ts: now, path: candidate };
      return candidate;
    } catch (err: any) {
      lastErr = err?.message || String(err);
    }
  }

  throw new Error("Codex CLI not found or unusable. " + lastErr);
}

async function cleanupTempDirs(maxH: number, intM: number) {
  const now = Date.now();
  if (now - lastGC < intM * 60000) return;
  lastGC = now;
  try {
    for (const e of await readdir(tmpdir())) {
      if (!e.startsWith(PFX)) continue;
      const p = join(tmpdir(), e);
      try {
        if (now - (await stat(p)).mtimeMs > maxH * 3600000) await rm(p, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

interface ImageGenParams {
  prompt: string;
  aspect_ratio?: string;
  file_name?: string;
  output_dir?: string;
  background?: string;
  timeout_seconds?: number;
}

async function runCodexResponses(codexPath: string, payload: string, cwd: string, timeout: number, codexHome?: string) {
  return await new Promise<{ stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = execFile(
      codexPath,
      [...CODEX_CONFIG_OVERRIDES, "responses"],
      {
        cwd,
        timeout,
        maxBuffer: 30 * 1024 * 1024,
        env: codexHome ? { ...process.env, CODEX_HOME: codexHome } : process.env,
      },
      (e, o, s) => {
        if (e && (e as any).killed) return rejectRun(new Error("Codex timed out after " + timeout / 1000 + "s"));
        if (e) {
          const err: any = new Error(s || e.message);
          err.stdout = o || "";
          err.stderr = s || "";
          return rejectRun(err);
        }
        resolveRun({ stdout: o || "", stderr: s || "" });
      },
    );
    child.stdin?.end(payload);
  });
}

async function generate(params: ImageGenParams, cfg: Required<Cfg>) {
  const codexPath = await ensureCodex();
  const { prompt, aspect_ratio = "square", file_name, background = "auto", timeout_seconds } = params;
  if (!prompt?.trim()) throw new Error("prompt is required.");
  if (!AR.includes(aspect_ratio as any)) throw new Error("Invalid aspect_ratio: " + aspect_ratio);
  if (!BG.includes(background as any)) throw new Error("Invalid background: " + background);

  const timeout = (timeout_seconds && timeout_seconds > 0 ? timeout_seconds : cfg.timeoutSeconds) * 1000;
  const outName = safeName(file_name || prompt.slice(0, 60));
  const outDir = params.output_dir || cfg.outputDir || (await mkdtemp(join(tmpdir(), PFX)));
  const outputPath = join(outDir, outName);
  const eventsPath = join(outDir, "codex.responses.jsonl");
  const stderrLog = join(outDir, "codex.stderr.log");
  const payload = buildPayload(prompt, aspect_ratio, background);

  let stdout = "";
  let stderr = "";
  let lastErr: any = null;
  let usedAccountId = "";
  const tried = new Set<string>();
  const maxAttempts = 5;
  const stderrParts: string[] = [];
  const attemptLog: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const account = await pickCodexPoolAccount("gpt-5.4");
    const accountId = account?.id || "direct";
    const codexHome = account?.authType === "oauth_codex" ? account.authValue : undefined;
    if (account && tried.has(account.id)) break;
    if (account) tried.add(account.id);

    const attemptStart = Date.now();
    api.logger.info(`codex_image_generate attempt ${attempt + 1}/${maxAttempts}`, {
      accountId,
      hasAccount: !!account,
      model: "gpt-5.4",
    });

    try {
      const result = await runCodexResponses(codexPath, payload, outDir, timeout, codexHome);
      const elapsed = Date.now() - attemptStart;
      stdout = result.stdout;
      stderr = result.stderr;
      usedAccountId = accountId;
      attemptLog.push(`[attempt ${attempt + 1}] SUCCESS account=${accountId} elapsed=${elapsed}ms`);
      api.logger.info(`codex_image_generate attempt ${attempt + 1} succeeded`, {
        accountId,
        elapsed,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });
      if (account) await releaseCodexPoolAccount(account.id);
      lastErr = null;
      break;
    } catch (err: any) {
      const elapsed = Date.now() - attemptStart;
      lastErr = err;
      const errText = err?.stderr || err?.message || String(err);
      const isRL = isRateLimitError(errText);
      const isTO = isTimeoutError(errText);
      const isConn = isConnectionError(errText);
      
      attemptLog.push(
        `[attempt ${attempt + 1}] FAILED account=${accountId} elapsed=${elapsed}ms ` +
        `rateLimit=${isRL} timeout=${isTO} connection=${isConn} ` +
        `error=${errText.slice(0, 200)}`
      );
      
      api.logger.warn(`codex_image_generate attempt ${attempt + 1} failed`, {
        accountId,
        elapsed,
        isRateLimit: isRL,
        isTimeout: isTO,
        isConnection: isConn,
        error: errText.slice(0, 500),
      });

      stderrParts.push(`[attempt ${attempt + 1}][${accountId}] ${errText}`);
      
      if (account) {
        if (isRL || isTO || isConn) {
          await markCodexPoolCooldown(account.id);
          api.logger.info(`codex_image_gen: Marked account ${account.id} as cooldown`, {
            reason: isRL ? "rate_limit" : isTO ? "timeout" : "connection",
          });
          continue;
        }
      } else {
        if (isRL || isTO) {
          continue;
        }
      }
      break;
    }
  }

  if (lastErr) {
    const finalLog = [
      "=== CODEX IMAGE GENERATION FAILED ===",
      `attempts: ${attempt}/${maxAttempts}`,
      ...attemptLog,
      "=== ERROR DETAILS ===",
      lastErr?.message || String(lastErr),
      lastErr?.stderr || "",
    ].join("\n");
    await writeFile(join(outDir, "error.log"), finalLog).catch(() => {});
    throw new Error(`Codex image generation failed after ${attempt} attempts. Check logs in: ${outDir}`);
  }

  await Promise.all([
    writeFile(eventsPath, stdout).catch(() => {}),
    writeFile(stderrLog, [...attemptLog, "", ...stderrParts, stderr, usedAccountId ? `used_account=${usedAccountId}` : ""].filter(Boolean).join("\n")).catch(() => {}),
  ]);

  const imageBase64 = extractImageBase64(stdout);
  if (!imageBase64) throw new Error("Codex produced no image_generation_call result. Check logs in: " + outDir);
  await writeFile(outputPath, Buffer.from(imageBase64, "base64"));
  await stat(outputPath);

  const absPath = resolve(outputPath);
  return {
    image_path: absPath,
    file_name: outName,
    output_dir: outDir,
    stdout_log: eventsPath,
    stderr_log: stderrLog,
    assistant_hint: "Image generated at: " + absPath + "\nTelegram: MEDIA:" + absPath,
  };
}

export default definePluginEntry({
  id: "codex-image-gen",
  name: "Codex Image Generator",
  description: "Generates images via OpenAI Codex CLI responses/image_generation flow.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      outputDir: { type: "string", default: "" },
      timeoutSeconds: { type: "number", minimum: 10, maximum: 300, default: 120 },
      tempDirMaxAgeHours: { type: "number", minimum: 1, default: 24 },
      cleanupIntervalMinutes: { type: "number", minimum: 5, default: 60 },
    },
  },
  register(api) {
    // Register codex_image_generate tool
    api.registerTool("codex_image_generate", {
      description:
        "Generate an image using OpenAI Codex CLI responses/image_generation. " +
        "Returns the absolute file path of the generated image. " +
        "Supports aspect ratio (landscape/square/portrait) and background (auto/transparent/opaque).",
      inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", description: "Creative description of the image to generate." },
          aspect_ratio: { type: "string", enum: ["landscape", "square", "portrait"], default: "square" },
          file_name: { type: "string", description: "Output file name (auto-sanitized, .png appended)." },
          output_dir: { type: "string", description: "Directory to save the image. Defaults to temp." },
          background: { type: "string", enum: ["auto", "transparent", "opaque"], default: "auto" },
          timeout_seconds: { type: "number", description: "Max seconds to wait for Codex. Default: 120." },
        },
      },
      async execute(input: ImageGenParams) {
        const c = getCfg(api.pluginConfig);
        cleanupTempDirs(c.tempDirMaxAgeHours, c.cleanupIntervalMinutes).catch(() => {});
        const result = await generate(input, c);
        api.logger.info("codex_image_generate success", { image_path: result.image_path });
        return result;
      },
    });

    // Korean trigger routing for image generation requests
    const ENGINE_TERMS = ["codex", "\uCF54\uB371\uC2A4", "gpt", "openai"];
    const NOUN_TERMS = [
      "\uC774\uBBF8\uC9C0", "\uADF8\uB9BC", "\uC0AC\uC9C4", "\uC544\uC774\uCF58",
      "\uC77C\uB7EC\uC2A4\uD2B8", "\uBC30\uACBD", "\uB85C\uACE0",
      "image", "picture", "icon", "illustration",
    ];
    const VERB_TERMS = [
      "\uC0DD\uC131", "\uB9CC\uB4E4", "\uADF8\uB824", "\uADF8\uB9AC", "\uC81C\uC791",
      "generate", "create", "draw", "make",
    ];

    api.on("pre_llm_call", (event: any, _ctx: any) => {
      const lastMsg = event.messages?.filter((m: any) => m.role === "user").pop();
      if (!lastMsg) return;
      const text = (
        typeof lastMsg.content === "string"
          ? lastMsg.content
          : Array.isArray(lastMsg.content)
            ? lastMsg.content.map((c: any) => c.text || "").join(" ")
            : ""
      ).toLowerCase();

      const hasEngine = ENGINE_TERMS.some((t) => text.includes(t));
      const hasNoun = NOUN_TERMS.some((t) => text.includes(t));
      const hasVerb = VERB_TERMS.some((t) => text.includes(t));

      if ((hasEngine && hasNoun) || (hasNoun && hasVerb)) {
        event.systemHints = event.systemHints || [];
        event.systemHints.push(
          "The user is requesting image generation. Use the codex_image_generate tool.",
        );
      }
    });

    api.logger.info("Codex Image Generator plugin registered");
  },
});
