# openclaw-codex-image-gen

OpenClaw plugin for generating images via [OpenAI Codex CLI](https://github.com/openai/codex) `$imagegen` command.

Based on [hermes-gpt-image-gen](https://github.com/Jinbro98/hermes-gpt-image-gen), adapted for the OpenClaw plugin system.

## Features

- **Tool**: `codex_image_generate` — generates images via Codex CLI subprocess
- **Aspect ratios**: `landscape`, `square`, `portrait`
- **Backgrounds**: `auto`, `transparent`, `opaque`
- **Korean trigger routing**: auto-detects Korean/English image generation requests via `pre_llm_call` hook
- **Codex availability caching**: checks once, caches for 5 minutes
- **Temp directory cleanup**: auto-removes stale temp dirs (default: >24h old)

## Prerequisites

- [OpenAI Codex CLI](https://github.com/openai/codex) installed and authenticated
- `codex features list` must show `image_generation` enabled

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
| `timeout_seconds` | No | Override timeout |

Returns: `{ image_path, file_name, output_dir, stdout_log, stderr_log, assistant_hint }`

## License

MIT
