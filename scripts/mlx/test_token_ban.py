"""
Regression tests for patch_token_ban.py: a hard logit_bias ban must hold on mlx-vlm's speculative
path, and requests without a ban must behave exactly as before.

    MLX_VLM_PATH=/path/to/dir-containing-mlx_vlm python test_token_ban.py

MLX_VLM_PATH lets the tests run against a patched copy; without it the installed package is used.
"""
import os
import sys
import unittest

if os.environ.get("MLX_VLM_PATH"):
    sys.path.insert(0, os.environ["MLX_VLM_PATH"])

import mlx.core as mx  # noqa: E402
from mlx_vlm.generate import ar  # noqa: E402
from mlx_vlm.sample_utils import make_logits_processors  # noqa: E402
from mlx_vlm.speculative import mtp  # noqa: E402

CHANNEL = 100  # Gemma 4's <|channel> token
VOCAB = 512


def favouring(token: int, rows: int = 1) -> mx.array:
    """Logits where `token` is by far the likeliest choice."""
    logits = mx.zeros((rows, VOCAB))
    logits[:, token] = 50.0
    logits[:, 7] = 5.0
    return logits


def argmax_sampler(logits: mx.array) -> mx.array:
    return mx.argmax(logits, axis=-1)


class TaggingTests(unittest.TestCase):
    def test_bias_processor_names_its_hard_bans(self):
        (processor,) = make_logits_processors({CHANNEL: -100, 5: -2.0})
        self.assertEqual(processor.banned_ids, [CHANNEL])

    def test_soft_bias_bans_nothing(self):
        (processor,) = make_logits_processors({5: -2.0, 6: 3.0})
        self.assertEqual(processor.banned_ids, [])

    def test_no_bias_no_processor(self):
        self.assertEqual(make_logits_processors(None), [])


class WrappingTests(unittest.TestCase):
    def test_without_bans_the_sampler_is_untouched(self):
        rows = [make_logits_processors({5: -2.0}), None, []]
        self.assertIs(ar._with_bans(argmax_sampler, rows), argmax_sampler)
        self.assertIs(ar._with_bans(argmax_sampler, []), argmax_sampler)

    def test_any_row_with_a_ban_wraps_the_batch_sampler(self):
        rows = [None, make_logits_processors({CHANNEL: -100})]
        wrapped = ar._with_bans(argmax_sampler, rows)
        self.assertIsInstance(wrapped, ar._BanningSampler)
        self.assertEqual(wrapped.banned, [CHANNEL])


class MaskingTests(unittest.TestCase):
    def setUp(self):
        self.sampler = ar._BanningSampler(argmax_sampler, [CHANNEL])

    def test_greedy_never_picks_the_banned_token(self):
        self.assertEqual(int(self.sampler(favouring(CHANNEL)).item()), 7)

    def test_batched_and_block_shaped_logits(self):
        tokens = self.sampler(favouring(CHANNEL, rows=3))
        self.assertEqual(tokens.tolist(), [7, 7, 7])
        block = mx.stack([favouring(CHANNEL)[0]] * 4)[None]  # (1, 4, vocab): a verify block
        self.assertEqual(self.sampler(block).tolist(), [[7, 7, 7, 7]])

    def test_half_precision_logits(self):
        self.assertEqual(int(self.sampler(favouring(CHANNEL).astype(mx.float16)).item()), 7)

    def test_unbanned_choices_are_unchanged(self):
        logits = favouring(42)
        self.assertEqual(int(self.sampler(logits).item()), int(argmax_sampler(logits).item()))

    def test_ids_outside_the_vocabulary_are_ignored(self):
        sampler = ar._BanningSampler(argmax_sampler, [CHANNEL, VOCAB + 10])
        self.assertEqual(int(sampler(favouring(CHANNEL)).item()), 7)

    def test_random_sampling_never_draws_it(self):
        inner = ar._PositionedTargetSampler(temperature=1.0, top_p=1.0, seed=3)
        sampler = ar._BanningSampler(inner, [CHANNEL])
        mx.random.seed(0)
        logprobs = favouring(CHANNEL) - mx.logsumexp(favouring(CHANNEL), axis=-1, keepdims=True)
        draws = [int(sampler(logprobs).item()) for _ in range(200)]
        self.assertNotIn(CHANNEL, draws)
        self.assertGreater(len(draws), 0)

    def test_positioned_target_draws_are_masked(self):
        inner = ar._PositionedTargetSampler(temperature=1.0, top_p=0.95, seed=11)
        sampler = ar._BanningSampler(inner, [CHANNEL])
        logprobs = favouring(CHANNEL, rows=8)
        logprobs = logprobs - mx.logsumexp(logprobs, axis=-1, keepdims=True)
        tokens = sampler.sample_target(logprobs, row_ids=[0] * 8, positions=list(range(8)))
        self.assertNotIn(CHANNEL, tokens.tolist())
        # The duck-typed capability checks still see a positioned sampler
        self.assertTrue(mtp._sampler_supports_positioned_target(sampler))

    def test_other_attributes_pass_through(self):
        inner = ar._PositionedTargetSampler(temperature=0.7, top_p=0.9, seed=5)
        self.assertEqual(ar._BanningSampler(inner, [CHANNEL]).seed, 5)


class FakeLM:
    """A language model with MTP's fused greedy readout, which bypasses the sampler."""

    def __init__(self):
        self.fused_calls = 0

    def speculative_argmax_from_hidden(self, hidden):
        self.fused_calls += 1
        return mx.array([[CHANNEL]])

    def speculative_verify_hidden(self, verify_input, prompt_cache):
        return mx.zeros((1, 1, 8)), {}, None

    def speculative_logits_from_hidden(self, hidden):
        return favouring(CHANNEL)[None]


class VerifyTests(unittest.TestCase):
    def test_fused_readout_is_skipped_while_a_ban_is_active(self):
        lm = FakeLM()
        sampler = ar._BanningSampler(argmax_sampler, [CHANNEL])
        result = mtp._mtp_verify_target(lm, mx.array([[1]]), [], sampler, sample_target_tokens=True)
        self.assertEqual(lm.fused_calls, 0)
        tokens = getattr(result, "target_tokens", None)
        if tokens is not None:
            self.assertNotIn(CHANNEL, mx.array(tokens).reshape(-1).tolist())

    def test_fused_readout_still_used_without_a_ban(self):
        lm = FakeLM()
        mtp._mtp_verify_target(lm, mx.array([[1]]), [], argmax_sampler, sample_target_tokens=True)
        self.assertEqual(lm.fused_calls, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
