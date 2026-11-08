"""
Makes mlx-vlm honour hard token bans (logit_bias <= -50) when speculative decoding is on.

mlx-vlm 0.7.11 drops a request's logit processors on the speculative path: the speculative batch
only receives the sampler, and MTP verification has fused greedy readouts that never call the
sampler at all. Tide bans Gemma 4's `<|channel>` token (id 100) to stop it opening empty thought
channels mid-answer, so with the drafter on that ban silently did nothing.

The patch:
  1. tags the logit-bias processor with the ids it bans outright (`banned_ids`)
  2. wraps the speculative sampler so every target draw (plain, positioned and proposal) has those
     ids masked to -inf, for the batch the request runs in
  3. skips MTP's fused argmax shortcuts while a ban is active, so the masked sampler decides

Without a ban nothing changes: the sampler isn't wrapped and the fast paths stay on.

Usage:  python patch_token_ban.py [path/to/site-packages/mlx_vlm]
It is idempotent: running it twice leaves the files as after the first run.
"""
import sys
from pathlib import Path

MARK = "# tide: token-ban patch"


def find_package() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    import mlx_vlm

    return Path(mlx_vlm.__file__).parent


def edit(path: Path, edits: list[tuple[str, str]]) -> bool:
    text = path.read_text()
    if MARK in text:
        return False
    for old, new in edits:
        if text.count(old) != 1:
            raise SystemExit(f"{path.name}: expected exactly one match for:\n{old}\nThis mlx-vlm version differs; patch not applied.")
        text = text.replace(old, new)
    path.write_text(text)
    return True


SAMPLE_UTILS = [
    (
        """        def logit_bias_processor(_, logits):
            return logits.at[:, indices].add(values)

        logits_processors.append(logit_bias_processor)""",
        """        def logit_bias_processor(_, logits):
            return logits.at[:, indices].add(values)

        # tide: token-ban patch. Ids banned outright, for paths that sample without processors
        logit_bias_processor.banned_ids = [int(k) for k, v in logit_bias.items() if float(v) <= -50]
        logits_processors.append(logit_bias_processor)""",
    )
]

AR_HELPERS = '''

# tide: token-ban patch
class _BanningSampler:
    """Masks hard-banned token ids before every draw on the speculative path."""

    def __init__(self, inner, banned):
        self.inner = inner
        self.banned = sorted({int(b) for b in banned})
        self._mask = None

    def _masked(self, logits: mx.array) -> mx.array:
        vocab = logits.shape[-1]
        if self._mask is None or self._mask.shape[0] != vocab:
            ids = [b for b in self.banned if 0 <= b < vocab]
            mask = mx.zeros((vocab,), dtype=mx.float32)
            if ids:
                mask[mx.array(ids)] = -float("inf")
            self._mask = mask
        return logits + self._mask.astype(logits.dtype)

    def __call__(self, logits: mx.array) -> mx.array:
        return self.inner(self._masked(logits))

    def __getattr__(self, name):
        attr = getattr(self.inner, name)
        if name in ("sample_target", "sample_proposal") and callable(attr):

            def masked(logprobs, *args, **kwargs):
                return attr(self._masked(logprobs), *args, **kwargs)

            return masked
        return attr


def _with_bans(sampler, processor_rows):
    """The sampler, wrapped if any request in the batch bans tokens outright."""
    banned = set()
    for row in processor_rows or []:
        for processor in row or []:
            banned.update(getattr(processor, "banned_ids", None) or [])
    return _BanningSampler(sampler, banned) if banned else sampler

'''

AR = [
    (
        "class _PositionedTargetSampler:",
        AR_HELPERS.strip("\n") + "\n\n\nclass _PositionedTargetSampler:",
    ),
    (
        """                prompt_cache=self.prompt_cache,
                sampler=sampler,
                stop_criteria=stop_criteria,
                max_tokens=list(self.max_tokens),
                hidden=speculative_hidden_state(self.draft_kind, output),""",
        """                prompt_cache=self.prompt_cache,
                sampler=_with_bans(sampler, self.logits_processors),
                stop_criteria=stop_criteria,
                max_tokens=list(self.max_tokens),
                hidden=speculative_hidden_state(self.draft_kind, output),""",
    ),
]

MTP = [
    (
        """    result = None
    try:
        if sample_target_tokens:
            argmax_from_hidden = getattr(lm, "speculative_argmax_from_hidden", None)
            if callable(argmax_from_hidden):""",
        """    result = None
    # tide: token-ban patch. Fused argmax readouts skip the sampler, so they can't honour a ban
    banned = bool(getattr(sampler, "banned", None))
    try:
        if sample_target_tokens:
            argmax_from_hidden = None if banned else getattr(lm, "speculative_argmax_from_hidden", None)
            if callable(argmax_from_hidden):""",
    ),
    (
        """            if head is not None and not hasattr(lm, "logits_from_hidden"):
                tokens = decode_quantized_argmax(head, result.hidden)""",
        """            if head is not None and not hasattr(lm, "logits_from_hidden") and not banned:
                tokens = decode_quantized_argmax(head, result.hidden)""",
    ),
]


def main():
    pkg = find_package()
    changed = [
        name
        for name, path, edits in [
            ("sample_utils.py", pkg / "sample_utils.py", SAMPLE_UTILS),
            ("generate/ar.py", pkg / "generate" / "ar.py", AR),
            ("speculative/mtp.py", pkg / "speculative" / "mtp.py", MTP),
        ]
        if edit(path, edits)
    ]
    print("patched: " + ", ".join(changed) if changed else "already patched")


if __name__ == "__main__":
    main()
