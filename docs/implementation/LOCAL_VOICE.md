# Free local voice on Windows

The voice page defaults to the `local` provider. It uses Faster Whisper for
speech recognition, Ollama's `qwen3:4b-instruct` for replies, and Windows
`System.Speech` for 24 kHz mono PCM output. No API key or cloud fallback is used.

## Prerequisites

- Windows with an installed desktop speech voice and `powershell.exe`.
- Python on the gateway's PATH with `faster-whisper` installed.
- Ollama running on `http://127.0.0.1:11434` with `qwen3:4b-instruct` downloaded.
- The Faster Whisper `tiny` model already cached for the account running the gateway.

One-time setup, if these components are missing:

```powershell
ollama pull qwen3:4b-instruct
python -m pip install faster-whisper
python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"
```

Model downloads require internet access. Recognition and replies then run locally.
The gateway deliberately uses `local_files_only=True` for Whisper, so a voice
session never starts an unexpected model download. These Python/Ollama components
are separate from the Node package installation.

## Use and verification

Start a voice session, hold the microphone button (or Space) while speaking,
and release it to request a reply. This is push-to-talk, not continuous listening.
Empty capture and unrecognized speech produce visible feedback.

Synthetic checks on the development PC verified recognition, local AI responses,
and browser delivery of transcripts and PCM audio. Actual microphone selection,
speaker volume, and audible playback still require a user check.

The current local provider is Windows-only and reloads the small Whisper model
for each turn. CPU speed affects response latency. OpenAI Realtime remains
available only when explicitly requested through the session API.

## Optional: Gradium voice clone (`local-gradium`)

Choose **Speech output → Gradium voice clone** on the Voice page before starting
a session. Recognition (Whisper) and replies (Ollama) stay local. Only the
reply text is sent to Gradium, which streams back 24 kHz 16-bit mono PCM
(`output_format: pcm_24000`) to the gateway, which relays it to the existing
player. Windows speech stays the default; nothing is sent to Gradium unless
you pick it.

### Configuration (gateway only)

Set these in the gateway's environment (`.env`), or under **Config Center →
Gradium**. Never put the key in UI code or in chat.

```
GRADIUM_API_KEY=gd_your_api_key_here
GRADIUM_VOICE_ID=your_voice_id
```

Use the voice ID of the clone you already made in Gradium Studio. Config Center
also has an optional base URL (default `https://api.gradium.ai/api`) and model
(default `default`). Restart the gateway after changing `.env`.

### Limits

- Languages: English, French, German, Spanish and Portuguese.
- Free plan: 45k credits a month (1 credit per character, about one hour of
  speech), at most 1500 characters per request, and no commercial use. LEO
  refuses longer replies before sending them; replies are normally far shorter.
- Concurrency limits depend on the plan.

### Errors and recovery

If Gradium fails, the reply text still appears, the error is shown, and the
session stays usable for the next turn. LEO never switches to another voice on
its own. Messages:

- `Gradium is not configured` — the key or voice ID is missing (connect fails).
- `code 1008: …` — Gradium rejected the key, the voice ID, or the request.
- `credits are exhausted` / `rate limit reached` — wait or check your plan.
- `timed out` / `Could not reach Gradium` — network or service problem.

Gradium does not document a dedicated status code for exhausted credits or rate
limits on this endpoint, so other failures show Gradium's own (shortened)
message and HTTP status.

### Back to Windows speech

Select **Windows speech (offline)** before starting the next session. The
choice is stored in this browser only.

### Privacy

With `local-gradium`, every spoken reply's text is sent to Gradium, a hosted
service, and processed under its terms. Microphone audio and transcripts stay on
this PC. Zero data retention is available only on paid Gradium plans.
