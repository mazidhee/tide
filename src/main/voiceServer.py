"""Tide's voice: Kokoro for speech and a speech model for dictation, on this Mac only.

Started by Tide on first use and stopped when Tide quits. Listens on 127.0.0.1 only.
  GET  /health            -> {"ok": true}
  POST /speak             {"text", "voice", "speed"} -> audio/wav (24 kHz mono, 16-bit)
  POST /speak             {"text", "engine": "fish", "ref"} -> audio/wav (44.1 kHz mono, 16-bit):
                          the lecture voice, Fish S2 Pro cloning the reference clip refs/<ref>.wav
  POST /transcribe        audio/wav body -> {"text"}
Models load on first use and stay in memory (Kokoro is 82M parameters, about 350 MB).
"""
import io
import json
import os
import sys
import tempfile
import threading
import time
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

FISH_REPO = os.environ.get("TIDE_FISH_MODEL", "mlx-community/fish-audio-s2-pro-8bit")
REFS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refs")
FISH_IDLE_S = float(os.environ.get("TIDE_FISH_IDLE_S", "600"))

_lock = threading.Lock()
_tts = None
_stt = None
_fish = None
_fish_used = 0.0
_refs = {}


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


def ref_voice(name):
    """The reference clip as an mx array at the model's rate, with its transcript (made once with
    Parakeet on a 16 kHz copy, and kept next to the clip as <name>.txt)."""
    if name in _refs:
        return _refs[name]
    import mlx.core as mx
    import soundfile as sf

    path = os.path.join(REFS, os.path.basename(name) + ".wav")
    audio, rate = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != _fish.sample_rate:
        audio = resample(audio, rate, _fish.sample_rate)
        rate = _fish.sample_rate
    txt = path[:-4] + ".txt"
    if os.path.exists(txt):
        ref_text = open(txt).read().strip()
    else:
        ref_text = (getattr(stt().generate(mx.array(resample(audio, rate, 16000))), "text", "") or "").strip()
        with open(txt, "w") as f:
            f.write(ref_text)
    _refs[name] = (mx.array(audio), ref_text)
    return _refs[name]


def resample(audio, src, dst):
    if src == dst:
        return audio
    n = int(len(audio) * dst / src)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def fish():
    global _fish
    if _fish is None:
        from mlx_audio.tts.utils import load_model

        _fish = load_model(FISH_REPO)
    return _fish


def speak_fish(text, ref):
    global _fish_used
    with _lock:
        model = fish()
        audio_ref, ref_text = ref_voice(ref)
        chunks = [np.array(r.audio, dtype=np.float32) for r in model.generate(text=text, ref_audio=audio_ref, ref_text=ref_text, verbose=False)]
        _fish_used = time.time()
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    return to_wav(audio, model.sample_rate)


def unload_idle():
    """Frees the lecture voice (several GB) after ten minutes without use; it loads again in seconds"""
    global _fish
    while True:
        time.sleep(30)
        if _fish is not None and time.time() - _fish_used > FISH_IDLE_S:
            with _lock:
                if time.time() - _fish_used > FISH_IDLE_S:
                    _fish = None
                    _refs.clear()
                    import gc

                    gc.collect()
                    try:
                        import mlx.core as mx

                        mx.clear_cache()
                    except Exception:
                        pass


def to_wav(audio, rate):
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def speak(text, voice, speed):
    # British voices (b...) use British pronunciation
    lang = "b" if voice.startswith("b") else "a"
    chunks = []
    with _lock:
        for r in tts().generate(text=text, voice=voice, lang_code=lang, speed=speed):
            chunks.append(np.array(r.audio, dtype=np.float32))
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    return to_wav(audio, RATE)


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
            self._send(200, json.dumps({"ok": True, "tts": _tts is not None, "stt": _stt is not None, "fish": _fish is not None}).encode())
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
                if req.get("engine") == "fish":
                    return self._send(200, speak_fish(text, str(req.get("ref") or "professor")), "audio/wav")
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
                if req.get("fish"):
                    # Loading isn't enough: the first generation compiles (about 20 s), so do a word now
                    speak_fish("Right.", str(req.get("ref") or "professor"))
                return self._send(200, b'{"ok":true}')
            self._send(404, b"{}")
        except Exception as e:  # report, keep serving
            self._send(500, json.dumps({"error": str(e)[:500]}).encode())


def main():
    server = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 0), Handler)
    print(f"READY {server.server_address[1]}", flush=True)
    # Stop with Tide: when its pipe closes, so does this
    threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()
    threading.Thread(target=unload_idle, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
