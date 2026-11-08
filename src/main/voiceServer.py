"""Tide's voice: Kokoro for speech and a speech model for dictation, on this Mac only.

Started by Tide on first use and stopped when Tide quits. Listens on 127.0.0.1 only.
  GET  /health            -> {"ok": true}
  POST /speak             {"text", "voice", "speed"} -> audio/wav (24 kHz mono, 16-bit)
  POST /transcribe        audio/wav body -> {"text"}
Models load on first use and stay in memory (Kokoro is 82M parameters, about 350 MB).
"""
import io
import json
import os
import sys
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Homebrew's espeak-ng, when present: the copy bundled with misaki is broken on macOS (it looks for
# its data on the machine it was built on and exits). espeak only spells out words not in
# Kokoro's dictionary, so without it those words are skipped rather than mispronounced.
for prefix in ("/opt/homebrew", "/usr/local"):
    lib = os.path.join(prefix, "lib", "libespeak-ng.dylib")
    if os.path.exists(lib):
        try:
            import espeakng_loader

            espeakng_loader.get_library_path = lambda lib=lib: lib
            espeakng_loader.get_data_path = lambda prefix=prefix: os.path.join(prefix, "share", "espeak-ng-data")
        except ImportError:
            pass
        break
else:
    # No working espeak: tell misaki so, instead of letting the broken one end the process
    try:
        import misaki.espeak as _espeak

        class _NoFallback:
            def __init__(self, *a, **k):
                raise RuntimeError("espeak-ng not installed")

        _espeak.EspeakFallback = _NoFallback
    except ImportError:
        pass

import numpy as np  # noqa: E402

TTS_REPO = os.environ.get("TIDE_TTS_MODEL", "mlx-community/Kokoro-82M-bf16")
STT_REPO = os.environ.get("TIDE_STT_MODEL", "mlx-community/parakeet-tdt-0.6b-v2")
RATE = 24000

_lock = threading.Lock()
_tts = None
_stt = None


def tts():
    global _tts
    if _tts is None:
        from mlx_audio.tts.utils import load_model

        _tts = load_model(TTS_REPO)
    return _tts


def stt():
    global _stt
    if _stt is None:
        from mlx_audio.stt.utils import load_model

        _stt = load_model(STT_REPO)
    return _stt


def speak(text, voice, speed):
    # British voices (b...) use British pronunciation
    lang = "b" if voice.startswith("b") else "a"
    chunks = []
    with _lock:
        for r in tts().generate(text=text, voice=voice, lang_code=lang, speed=speed):
            chunks.append(np.array(r.audio, dtype=np.float32))
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def transcribe(wav_bytes):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav_bytes)
        path = f.name
    try:
        with _lock:
            result = stt().generate(path)
        return (getattr(result, "text", "") or "").strip()
    finally:
        os.unlink(path)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, kind="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, json.dumps({"ok": True, "tts": _tts is not None, "stt": _stt is not None}).encode())
        else:
            self._send(404, b"{}")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            if self.path == "/speak":
                req = json.loads(body or b"{}")
                text = str(req.get("text", "")).strip()[:4000]
                if not text:
                    return self._send(400, b'{"error":"no text"}')
                wav = speak(text, str(req.get("voice") or "bm_george"), float(req.get("speed") or 1.0))
                return self._send(200, wav, "audio/wav")
            if self.path == "/transcribe":
                return self._send(200, json.dumps({"text": transcribe(body)}).encode())
            if self.path == "/warm":
                req = json.loads(body or b"{}")
                if req.get("tts", True):
                    speak("Ready.", str(req.get("voice") or "bm_george"), 1.0)
                if req.get("stt"):
                    stt()
                return self._send(200, b'{"ok":true}')
            self._send(404, b"{}")
        except Exception as e:  # report, keep serving
            self._send(500, json.dumps({"error": str(e)[:500]}).encode())


def main():
    server = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 0), Handler)
    print(f"READY {server.server_address[1]}", flush=True)
    # Stop with Tide: when its pipe closes, so does this
    threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
