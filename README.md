# openclaw-codex-image-gen

OpenClaw plugin for generating images via [OpenAI Codex CLI](https://github.com/openai/codex) Responses API (`image_generation` tool).

Inspired by [hermes-gpt-image-gen](https://github.com/Jinbro98/hermes-gpt-image-gen) and [codex-image-generation-skill](https://github.com/Gyu-bot/codex-image-generation-skill).

## Examples

| Prompt | Result |
|--------|--------|
| "A cute robot cat sitting on a cloud, digital art, vibrant colors" | <img src="examples/robot_cat.png" width="300"> |
| Korean e-commerce poster (see below) | <img src="examples/summer_collection.png" width="200"> |

<details>
<summary>Full Korean prompt for the poster</summary>

```
신상품 컬렉션 런칭 포스터, 3:4 세로형. 상단에 "NEW COLLECTION" 텍스트,
제목 "2025 Summer Edition". 컬렉션 소개: 여름 한정 블렌드 원두 - 시트러스 향,
깔끔한 애프터테이스트, 아이스 추출 최적화. 상품 라인업: 썸머 블렌드 원두,
콜드브루 원액, 레몬 시럽 신제품. 하단에 "7월 15일 출시 | 얼리버드 20% 할인".
프리미엄 e-커머스 디자인, 여름 컬러 팔레트.
```
</details>

## How It Works

```
User prompt --> JSON payload --> codex responses (stdin) --> JSONL stream --> base64 decode --> PNG file
```

Calls `codex responses` with a Responses API payload that **forces** the `image_generation` tool via `tool_choice`. The streamed JSONL response is parsed to extract the base64-encoded PNG. Uses your Codex CLI auth session (ChatGPT/OAuth), so image generation uses subscription credits rather than API billing.

## Prerequisites

1. [OpenAI Codex CLI](https://github.com/openai/codex) installed
2. Logged in: `codex login` (ChatGPT/OAuth recommended)
3. Verify: `codex login status` should show "Logged in"

## Installation

```bash
git clone https://github.com/jkf87/openclaw-codex-image-gen.git
cp -r openclaw-codex-image-gen ~/.openclaw/workspace-<your-bot>/local-plugins/codex-image-gen
```

Or download directly:

```bash
mkdir -p ~/.openclaw/workspace-<your-bot>/local-plugins/codex-image-gen
cd ~/.openclaw/workspace-<your-bot>/local-plugins/codex-image-gen
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/index.ts
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/openclaw.plugin.json
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/package.json
```

## Usage in OpenClaw

Once installed, the plugin registers the `codex_image_generate` tool automatically.

### Natural Language (Korean auto-routing)

Just ask naturally -- the `pre_llm_call` hook detects image requests:

```
"고양이 일러스트 그려줘"  -->  auto-detect  -->  codex_image_generate  -->  PNG saved
```

### Direct Tool Call

```json
{
  "tool": "codex_image_generate",
  "input": {
    "prompt": "A futuristic city skyline at sunset, cyberpunk style",
    "aspect_ratio": "landscape",
    "quality": "high",
    "background": "opaque"
  }
}
```

### Tool Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `prompt` | Yes | -- | Creative description of the image |
| `aspect_ratio` | No | `square` | `landscape` (1536x1024) / `square` (1024x1024) / `portrait` (1024x1536) |
| `file_name` | No | auto | Output filename (sanitized, .png) |
| `output_dir` | No | temp | Directory to save the image |
| `background` | No | `auto` | `auto` / `transparent` / `opaque` |
| `quality` | No | `high` | `auto` / `low` / `medium` / `high` |
| `timeout_seconds` | No | `120` | Max wait time in seconds |

### Tool Response

```json
{
  "image_path": "/tmp/openclaw-codex-imagegen-abc123/robot_cat.png",
  "file_name": "robot_cat.png",
  "output_dir": "/tmp/openclaw-codex-imagegen-abc123",
  "size_bytes": 1465634,
  "assistant_hint": "Image generated at: /tmp/..."
}
```

### Standalone Test (without OpenClaw)

```bash
node -e "
const { spawn } = require('child_process');
const fs = require('fs');
const payload = JSON.stringify({
  model: 'gpt-5.4',
  instructions: 'Use the image_generation tool to create the requested image.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'A cute robot cat on a cloud' }] }],
  tools: [{ type: 'image_generation', size: '1024x1024', quality: 'high', background: 'auto', action: 'generate' }],
  tool_choice: { type: 'image_generation' },
  store: false, stream: true,
});
const proc = spawn('codex', ['responses'], { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', d => out += d);
proc.on('close', () => {
  for (const line of out.split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call') {
        fs.writeFileSync('output.png', Buffer.from(ev.item.result, 'base64'));
        console.log('Saved output.png');
      }
    } catch {}
  }
});
proc.stdin.write(payload);
proc.stdin.end();
"
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `outputDir` | string | `""` (temp) | Default output directory |
| `timeoutSeconds` | number | `120` | Max wait for codex responses |
| `tempDirMaxAgeHours` | number | `24` | Auto-cleanup threshold for temp dirs |
| `cleanupIntervalMinutes` | number | `60` | Cleanup check interval |

## Korean Trigger Routing

The `pre_llm_call` hook auto-detects image generation requests:

| Category | Keywords |
|----------|----------|
| Engine | codex, 코덱스, gpt, openai |
| Nouns | 이미지, 그림, 사진, 아이콘, 일러스트, 배경, 로고, image, picture, icon |
| Verbs | 생성, 만들, 그려, 그리, 제작, generate, create, draw, make |

Triggers when: (engine + noun) OR (noun + verb) detected.

## License

MIT

---

# openclaw-codex-image-gen (한국어)

[OpenAI Codex CLI](https://github.com/openai/codex)의 Responses API를 이용하여 이미지를 생성하는 OpenClaw 플러그인입니다.

[hermes-gpt-image-gen](https://github.com/Jinbro98/hermes-gpt-image-gen) 및 [codex-image-generation-skill](https://github.com/Gyu-bot/codex-image-generation-skill)을 참고하여 만들었습니다.

## 생성 예시

| 프롬프트 | 결과 |
|---------|------|
| "A cute robot cat sitting on a cloud, digital art, vibrant colors" | <img src="examples/robot_cat.png" width="300"> |
| 커피 신상품 컬렉션 포스터 (세로형) | <img src="examples/summer_collection.png" width="200"> |

## 작동 원리

```
사용자 프롬프트 --> JSON 페이로드 --> codex responses (stdin) --> JSONL 스트림 --> base64 디코딩 --> PNG 파일
```

`codex responses` 명령에 `tool_choice: { type: "image_generation" }`을 지정한 JSON을 stdin으로 보냅니다. Codex CLI의 인증 세션(ChatGPT/OAuth)을 사용하므로, 구독 크레딧으로 이미지가 생성됩니다 (별도 API 과금 없음).

## 사전 요구사항

1. [OpenAI Codex CLI](https://github.com/openai/codex) 설치
2. 로그인: `codex login` (ChatGPT/OAuth 권장)
3. 확인: `codex login status` -> "Logged in" 표시

## 설치

```bash
git clone https://github.com/jkf87/openclaw-codex-image-gen.git
cp -r openclaw-codex-image-gen ~/.openclaw/workspace-<봇이름>/local-plugins/codex-image-gen
```

또는 직접 다운로드:

```bash
mkdir -p ~/.openclaw/workspace-<봇이름>/local-plugins/codex-image-gen
cd ~/.openclaw/workspace-<봇이름>/local-plugins/codex-image-gen
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/index.ts
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/openclaw.plugin.json
curl -sLO https://raw.githubusercontent.com/jkf87/openclaw-codex-image-gen/main/package.json
```

## OpenClaw에서 사용법

설치하면 `codex_image_generate` 도구가 자동으로 등록됩니다.

### 자연어로 요청 (한국어 자동 라우팅)

그냥 자연스럽게 말하면 됩니다:

```
"고양이 일러스트 그려줘"           --> 자동 감지 & 이미지 생성
"로고 이미지 만들어줘"             --> 자동 감지 & 이미지 생성
"codex로 배경 사진 생성해줘"       --> 자동 감지 & 이미지 생성
```

`pre_llm_call` 훅이 키워드 조합을 감지하여 `codex_image_generate` 도구로 자동 라우팅합니다.

### 도구 파라미터

| 파라미터 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `prompt` | O | -- | 이미지 설명 (한글/영어 모두 가능) |
| `aspect_ratio` | X | `square` | `landscape` (1536x1024) / `square` (1024x1024) / `portrait` (1024x1536) |
| `file_name` | X | 자동 | 출력 파일명 (.png) |
| `output_dir` | X | 임시 | 저장 디렉터리 |
| `background` | X | `auto` | `auto` / `transparent` / `opaque` |
| `quality` | X | `high` | `auto` / `low` / `medium` / `high` |
| `timeout_seconds` | X | `120` | 최대 대기 시간 (초) |

### 응답 예시

```json
{
  "image_path": "/tmp/openclaw-codex-imagegen-abc123/summer_collection.png",
  "file_name": "summer_collection.png",
  "output_dir": "/tmp/openclaw-codex-imagegen-abc123",
  "size_bytes": 2011115,
  "assistant_hint": "Image generated at: /tmp/..."
}
```

### OpenClaw 없이 단독 테스트

```bash
node -e "
const { spawn } = require('child_process');
const fs = require('fs');
const payload = JSON.stringify({
  model: 'gpt-5.4',
  instructions: 'Use the image_generation tool to create the requested image.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: '귀여운 로봇 고양이가 구름 위에 앉아있는 그림' }] }],
  tools: [{ type: 'image_generation', size: '1024x1024', quality: 'high', background: 'auto', action: 'generate' }],
  tool_choice: { type: 'image_generation' },
  store: false, stream: true,
});
const proc = spawn('codex', ['responses'], { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', d => out += d);
proc.on('close', () => {
  for (const line of out.split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'image_generation_call') {
        fs.writeFileSync('output.png', Buffer.from(ev.item.result, 'base64'));
        console.log('Saved output.png');
      }
    } catch {}
  }
});
proc.stdin.write(payload);
proc.stdin.end();
"
```

## 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `outputDir` | string | `""` (임시) | 기본 출력 디렉터리 |
| `timeoutSeconds` | number | `120` | codex responses 최대 대기 시간 |
| `tempDirMaxAgeHours` | number | `24` | 임시 디렉터리 자동 정리 기준 (시간) |
| `cleanupIntervalMinutes` | number | `60` | 정리 체크 주기 (분) |

## 한국어 트리거 라우팅

`pre_llm_call` 훅이 아래 키워드 조합을 감지합니다:

| 분류 | 키워드 |
|------|--------|
| 엔진 | codex, 코덱스, gpt, openai |
| 명사 | 이미지, 그림, 사진, 아이콘, 일러스트, 배경, 로고, image, picture, icon |
| 동사 | 생성, 만들, 그려, 그리, 제작, generate, create, draw, make |

**감지 조건**: (엔진 + 명사) 또는 (명사 + 동사) 조합 -> 자동 라우팅

## 라이선스

MIT
