import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { spawn } from "child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

type Cfg = {
  outputDir?: string;
  codexPath?: string;
  timeoutSeconds?: number;
  tempDirMaxAgeHours?: number;
  cleanupIntervalMinutes?: number;
};

const SIZES: Record<string, string> = {
  landscape: "1536x1024",
  square: "1024x1024",
  portrait: "1024x1536",
};
const BG = ["auto", "transparent", "opaque"] as const;
const PFX = "openclaw-codex-imagegen-";
let lastGC = 0;

function getCfg(r: unknown): Required<Cfg> {
  const c = (r ?? {}) as Cfg;
  return {
    outputDir: c.outputDir || "",
    codexPath: c.codexPath || process.env.CODEX_PATH || "codex",
    timeoutSeconds: c.timeoutSeconds && c.timeoutSeconds > 0 ? c.timeoutSeconds : 120,
    tempDirMaxAgeHours:
      c.tempDirMaxAgeHours && c.tempDirMaxAgeHours > 0 ? c.tempDirMaxAgeHours : 24,
    cleanupIntervalMinutes:
      c.cleanupIntervalMinutes && c.cleanupIntervalMinutes > 0 ? c.cleanupIntervalMinutes : 60,
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

async function cleanupTempDirs(maxH: number, intM: number) {
  const now = Date.now();
  if (now - lastGC < intM * 60_000) return;
  lastGC = now;
  try {
    for (const e of await readdir(tmpdir())) {
      if (!e.startsWith(PFX)) continue;
      const p = join(tmpdir(), e);
      try {
        if (now - (await stat(p)).mtimeMs > maxH * 3_600_000)
          await rm(p, { recursive: true, force: true });
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
  quality?: string;
  timeout_seconds?: number;
}

/**
 * Calls `codex responses` with a Responses API payload that forces the
 * image_generation tool. Parses streamed JSONL output for the base64
 * image result and writes it to disk as PNG.
 */
async function generate(params: ImageGenParams, cfg: Required<Cfg>) {
  const {
    prompt,
    aspect_ratio = "square",
    file_name,
    background = "auto",
    quality = "high",
    timeout_seconds,
  } = params;

  if (!prompt?.trim()) throw new Error("prompt is required.");
  const size = SIZES[aspect_ratio] || SIZES.square;
  if (!BG.includes(background as any))
    throw new Error("Invalid background: " + background);

  const timeoutMs =
    (timeout_seconds && timeout_seconds > 0 ? timeout_seconds : cfg.timeoutSeconds) * 1000;
  const outName = safeName(file_name || prompt.slice(0, 60));
  const outDir =
    params.output_dir || cfg.outputDir || (await mkdtemp(join(tmpdir(), PFX)));

  // Responses API payload with forced image_generation tool
  const payload = JSON.stringify({
    model: "gpt-5.4",
    instructions:
      "Use the image_generation tool to create the requested image. Return the image generation result.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt.trim() }],
      },
    ],
    tools: [
      { type: "image_generation", size, quality, background, action: "generate" },
    ],
    tool_choice: { type: "image_generation" },
    store: false,
    stream: true,
  });

  // Execute `codex responses` — pipes JSON payload via stdin
  const { stdout, stderr } = await new Promise<{
    stdout: string;
    stderr: string;
  }>((res, rej) => {
    const proc = spawn(cfg.codexPath, ["responses"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      rej(new Error("codex responses timed out after " + timeoutMs / 1000 + "s"));
    }, timeoutMs);

    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out)
        return rej(new Error("codex responses exit " + code + ": " + err));
      res({ stdout: out, stderr: err });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
    proc.stdin.write(payload);
    proc.stdin.end();
  });

  // Save debug logs
  await writeFile(join(outDir, "codex.response.jsonl"), stdout).catch(() => {});
  if (stderr)
    await writeFile(join(outDir, "codex.stderr.log"), stderr).catch(() => {});

  // Extract base64 image from JSONL events
  let imageB64: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (
        ev.type === "response.output_item.done" &&
        ev.item?.type === "image_generation_call" &&
        ev.item.result
      ) {
        imageB64 = ev.item.result;
      }
    } catch {}
  }

  if (!imageB64)
    throw new Error(
      "codex responses completed but no image_generation_call result found. Check logs in: " +
        outDir,
    );

  // Decode base64 and save PNG
  const buf = Buffer.from(imageB64, "base64");
  const imagePath = join(outDir, outName);
  await writeFile(imagePath, buf);

  const absPath = resolve(imagePath);
  return {
    image_path: absPath,
    file_name: outName,
    output_dir: outDir,
    size_bytes: buf.length,
    assistant_hint:
      "Image generated at: " + absPath + "\nTelegram: MEDIA:" + absPath,
  };
}

export default definePluginEntry({
  id: "codex-image-gen",
  name: "Codex Image Generator",
  description:
    "Generates images via Codex CLI Responses API (image_generation tool).",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      outputDir: { type: "string", default: "" },
      codexPath: { type: "string", default: "codex", description: "Path to codex CLI binary. Falls back to CODEX_PATH env var, then PATH resolution." },
      timeoutSeconds: { type: "number", minimum: 10, maximum: 300, default: 120 },
      tempDirMaxAgeHours: { type: "number", minimum: 1, default: 24 },
      cleanupIntervalMinutes: { type: "number", minimum: 5, default: 60 },
    },
  },
  register(api) {
    api.registerTool("codex_image_generate", {
      description:
        "Generate an image using Codex CLI Responses API (image_generation tool). " +
        "Returns the absolute file path of the generated PNG.",
      inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            type: "string",
            description: "Creative description of the image to generate.",
          },
          aspect_ratio: {
            type: "string",
            enum: ["landscape", "square", "portrait"],
            default: "square",
            description: "Image aspect ratio.",
          },
          file_name: {
            type: "string",
            description: "Output file name (auto-sanitized, .png appended).",
          },
          output_dir: {
            type: "string",
            description: "Directory to save the image. Defaults to temp.",
          },
          background: {
            type: "string",
            enum: ["auto", "transparent", "opaque"],
            default: "auto",
            description: "Image background mode.",
          },
          quality: {
            type: "string",
            enum: ["auto", "low", "medium", "high"],
            default: "high",
            description: "Image quality.",
          },
          timeout_seconds: {
            type: "number",
            description: "Max seconds to wait. Default: 120.",
          },
        },
      },
      async execute(input: ImageGenParams) {
        const c = getCfg(api.pluginConfig);
        cleanupTempDirs(c.tempDirMaxAgeHours, c.cleanupIntervalMinutes).catch(
          () => {},
        );
        const result = await generate(input, c);
        api.logger.info("codex_image_generate OK", {
          image_path: result.image_path,
          size_bytes: result.size_bytes,
        });
        return result;
      },
    });

    // Korean trigger routing for image generation requests
    const ENGINE = ["codex", "\uCF54\uB371\uC2A4", "gpt", "openai"];
    const NOUN = [
      "\uC774\uBBF8\uC9C0",
      "\uADF8\uB9BC",
      "\uC0AC\uC9C4",
      "\uC544\uC774\uCF58",
      "\uC77C\uB7EC\uC2A4\uD2B8",
      "\uBC30\uACBD",
      "\uB85C\uACE0",
      "image",
      "picture",
      "icon",
    ];
    const VERB = [
      "\uC0DD\uC131",
      "\uB9CC\uB4E4",
      "\uADF8\uB824",
      "\uADF8\uB9AC",
      "\uC81C\uC791",
      "generate",
      "create",
      "draw",
      "make",
    ];

    api.on("pre_llm_call", (event: any, _ctx: any) => {
      const last = event.messages
        ?.filter((m: any) => m.role === "user")
        .pop();
      if (!last) return;
      const t = (
        typeof last.content === "string"
          ? last.content
          : Array.isArray(last.content)
            ? last.content.map((c: any) => c.text || "").join(" ")
            : ""
      ).toLowerCase();
      const hasE = ENGINE.some((x) => t.includes(x));
      const hasN = NOUN.some((x) => t.includes(x));
      const hasV = VERB.some((x) => t.includes(x));
      if ((hasE && hasN) || (hasN && hasV)) {
        event.systemHints = event.systemHints || [];
        event.systemHints.push(
          "Use codex_image_generate tool for this image request.",
        );
      }
    });

    api.logger.info("Codex Image Generator registered (responses mode)");
  },
});
