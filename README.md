# openclaw-codex-image-gen

OpenClaw plugin for generating images via [OpenAI Codex CLI](https://github.com/openai/codex) Responses API (`image_generation` tool).

Based on [hermes-gpt-image-gen](https://github.com/Jinbro98/hermes-gpt-image-gen) and [codex-image-generation-skill](https://github.com/Gyu-bot/codex-image-generation-skill), adapted for the OpenClaw plugin system.

## How it works

Uses `codex responses` to send a Responses API payload with `tool_choice: { type: "image_generation" }`, which forces the model to invoke the image generation tool. The streamed JSONL response is parsed for the base64-encoded PNG result. This leverages the Codex CLI's auth session (ChatGPT/OAuth), so image generation uses subscription credits rather than API billing.

## Features

- **Tool**: `codex_image_generate` — generates images via `codex responses` (Responses API)
- **Aspect ratios**: `landscape` (1536x1024), `square` (1024x1024), `portrait` (1024x1536)
- **Backgrounds**: `auto`, `transparent`, `opaque`
- **Quality levels**: `auto`, `low`, `medium`, `high`
- **Korean trigger routing**: auto-detects Korean/English image generation requests via `pre_llm_call` hook
- **Temp directory cleanup**: auto-removes stale temp dirs (default: >24h old)

## Prerequisites

- [OpenAI Codex CLI](https://github.com/openai/codex) installed and authenticated (`codex login`)
- ChatGPT Plus/Pro subscription recommended (uses subscription credits)

## Installation

Copy to your OpenClaw local plugins directory:

```bash
cp -r . ~/.openclaw/workspace-<your-bot>/local-plugins/codex-image-gen/
```

## Configuration

All config is optional (via `openclaw.plugin.json`):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `outputDir` | string | `""` (temp) | Default output directory |
| `timeoutSeconds` | number | `120` | Max wait for Codex |
| `tempDirMaxAgeHours` | number | `24` | Auto-cleanup threshold |
| `cleanupIntervalMinutes` | number | `60` | Cleanup check interval |

## Usage

The plugin registers `codex_image_generate` tool with these parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Creative description of the image |
| `aspect_ratio` | No | `landscape` / `square` / `portrait` |
| `file_name` | No | Output filename (auto-sanitized) |
| `output_dir` | No | Save directory |
| `background` | No | `auto` / `transparent` / `opaque` |
| `quality` | No | `auto` / `low` / `medium` / `high` |
| `timeout_seconds` | No | Override timeout |

Returns: `{ image_path, file_name, output_dir, size_bytes, assistant_hint }`

## License

MIT
