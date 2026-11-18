"""Tide's note embeddings: a Qwen3 embedding model through MLX, on this Mac only.

Started by Tide when it needs vectors (main/embeddings.ts) and stopped after a few idle minutes.
It speaks JSON lines on stdin and stdout:
  {"id": 1, "texts": ["..."], "query": false} -> {"id": 1, "dim": 1024, "vectors": "<base64 float32>"}
A query gets the instruction prefix Qwen3-Embedding is trained with; a passage is embedded as it is.
The vectors are L2-normalised, so a dot product is the cosine.
"""
import base64
import json
import os
import sys

MODEL = os.environ.get("TIDE_EMBED_MODEL", "mlx-community/Qwen3-Embedding-0.6B-8bit")
MAX_TOKENS = 512
QUERY = "Instruct: Given a question, find the study notes and lessons that answer it\nQuery: "


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    import mlx.core as mx
    import numpy as np
    from mlx_embeddings.utils import load

    model, tokenizer = load(MODEL)
    tok = getattr(tokenizer, "_tokenizer", tokenizer)
    tok.padding_side = "left"
    def embed(texts):
        enc = tok(texts, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="np")
        out = model(mx.array(enc["input_ids"]), attention_mask=mx.array(enc["attention_mask"]))
        emb = getattr(out, "text_embeds", None)
        if emb is None:
            # Last-token pooling (left padding puts every sequence's last token at the end)
            emb = out.last_hidden_state[:, -1, :]
        emb = emb.astype(mx.float32)
        emb = emb / mx.maximum(mx.linalg.norm(emb, axis=-1, keepdims=True), 1e-9)
        return np.array(emb, dtype=np.float32)

    send({"ready": True, "model": MODEL})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            texts = [(QUERY + t if req.get("query") else t) or " " for t in req["texts"]]
            arr = embed(texts)
            # Padding can turn a short text's vector to NaN in a mixed batch: those go again on their own
            bad = [i for i in range(len(texts)) if not np.isfinite(arr[i]).all() or not arr[i].any()]
            for i in bad:
                arr[i] = embed([texts[i]])[0]
            arr = np.nan_to_num(arr)
            send({"id": req.get("id"), "dim": int(arr.shape[1]), "vectors": base64.b64encode(arr.tobytes()).decode()})
        except Exception as e:  # noqa: BLE001
            send({"id": req.get("id") if isinstance(req, dict) else None, "error": str(e)})


if __name__ == "__main__":
    main()
