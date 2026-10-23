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
