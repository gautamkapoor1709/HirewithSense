#!/usr/bin/env bash
# Download the speech models into a running Speaches engine (one-time, idempotent).
# Usage: ./scripts/speech-models.sh [http://localhost:8000]
set -euo pipefail
BASE="${1:-http://localhost:8000}"
STT="${SPEECH_STT_MODEL:-Systran/faster-whisper-small}"
TTS="${SPEECH_TTS_MODEL:-speaches-ai/Kokoro-82M-v1.0-ONNX}"
for m in "$STT" "$TTS"; do
  echo ">> installing $m"
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/models/$m")
  case "$code" in
    200|201) echo "   done" ;;
    409) echo "   already installed" ;;
    *) echo "   failed (http $code)"; exit 1 ;;
  esac
done
echo ">> installed models:"
curl -s "$BASE/v1/models" | tr ',' '\n' | grep -o '"id":"[^"]*"' | sed 's/"id"://' | sort -u
