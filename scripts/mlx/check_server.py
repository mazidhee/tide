"""
End-to-end check of the token-ban patch against a running mlx_vlm server (with the drafter on).

Sends replies shaped like Tide's tutor turns (a spoken part, a grade, a question), which are where
Gemma 4 used to stall writing empty thought channels, and checks that:
  - `<|channel>` never appears, so the ban holds on the speculative path
  - every reply finishes on its own (finish_reason "stop"), so the ban didn't cause a stall
  - every reply reaches its question, so nothing was cut short

    python check_server.py [http://127.0.0.1:8080/v1] [runs]
"""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/v1"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 6

SYSTEM = """You are a trader running a quant interview. Format every reply exactly like this:
<say>one or two spoken sentences reacting to the answer</say>

<grade verdict="correct|partial|wrong" score="0.0-1.0">one or two sentences of feedback</grade>

A short explanation.

<ask type="problem">the next question</ask>"""

TURNS = [
    ("You roll two fair dice. What is the probability the sum is exactly 7?", "Expected value of a die roll is 3.5."),
    ("A coin is flipped 3 times. Probability of at least one head?", "7/8, one minus the chance of all tails."),
    ("What is the expected number of rolls to get a six?", "I think it's 3."),
]


def model_id() -> str:
    with urllib.request.urlopen(f"{BASE}/models", timeout=30) as r:
        return json.load(r)["data"][0]["id"]


def ask(model: str, question: str, answer: str, temperature: float) -> dict:
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": 600,
        "logit_bias": {"100": -100},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Start the interview."},
            {"role": "assistant", "content": f'<ask type="problem">{question}</ask>'},
            {"role": "user", "content": answer},
        ],
    }
    req = urllib.request.Request(f"{BASE}/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["choices"][0]


def main():
    model = model_id()
    failures = 0
    for i in range(RUNS):
        question, answer = TURNS[i % len(TURNS)]
        temperature = [0.0, 0.4, 0.8][i % 3]
        t0 = time.time()
        choice = ask(model, question, answer, temperature)
        text = choice["message"].get("content") or ""
        problems = []
        if "<|channel>" in text or "<channel|>" in text:
            problems.append("thought channel in the reply")
        if choice.get("finish_reason") != "stop":
            problems.append(f"finish_reason {choice.get('finish_reason')}")
        if "<ask" not in text:
            problems.append("never reached its question")
        failures += bool(problems)
        print(f"run {i + 1} t={temperature} {time.time() - t0:.1f}s {'ok' if not problems else 'FAIL: ' + ', '.join(problems)}")
    print(f"{RUNS - failures}/{RUNS} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
