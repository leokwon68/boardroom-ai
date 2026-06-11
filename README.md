# Boardroom

**Your one-person company, incorporated.**

Hermes and OpenClaw gave your AI hands. Boardroom gives it a company: a board of directors that learns you, picks its own agenda, debates with evidence, rules with a confidence score — and then an executor that actually does the work, after you press one button.

```
the company learns you → founds divisions around your interests →
convenes its own meetings → debates → verdict (confidence + falsifier) →
execution plan → [ YOU: Execute / Decline ] → real execution (browser, shell, files) →
results filed → verdicts scored against reality
```

## Why people use it

- **You stop being the operator.** Other agents wait for instructions. This company finds its own work: it reads your decision history, learns what you care about, and convenes the meetings you would have wanted — including errands ("that filing is due — should we handle it now?").
- **Decisions you can trust.** No single-model hot takes. Independent seats argue, concede, and change their minds; a red team tries to kill every verdict before it reaches you. Each verdict ships with a confidence score, a falsifier ("here's what proves us wrong, by this date"), and a cheap experiment.
- **It's accountable.** Every decision lands in a ledger with a review date, then gets scored against what actually happened. Your board keeps a batting average. No other AI measures its own judgment.
- **Nothing runs without you.** Execution plans pile into an approval queue. Two buttons: Execute or Decline. Risky steps (payments, posting, trades) are always held for the human — forever.
- **It actually executes.** Approved plans run with real tools — a real browser (Playwright), shell, files — and save evidence screenshots of what was done.

## Quick start

```bash
npx boardroom-ai            # launches the app + opens your browser → http://localhost:4242
npx boardroom-ai "Should I raise my prices?"   # or run one board meeting in the terminal
```

Or from source:

```bash
git clone <repo> && cd boardroom && node server.mjs   # → http://localhost:4242
```

Zero dependencies. Zero config: if you have Claude Code installed, it just works — no API key. Otherwise paste one key once (Anthropic / OpenAI / Gemini); it's stored locally with 0600 permissions and never displayed again.

- **Staff** — hire seats with lenses that match your business. Mix models per seat (chair on Fable, seats on Sonnet, a GPT seat alongside).
- **Boardroom** — bring one decision, or flip on Autopilot and let the company run itself.
- **Approvals** — everything the company wants to do waits here for your Execute/Decline.
- **Ledger** — watch the batting average accumulate.
- **Phone** — wire a Telegram bot and run it from anywhere: get verdicts pushed, reply `go <id>` to execute.

**Full guide:** [GUIDE.md](GUIDE.md) · [한국어 가이드](GUIDE.ko.md)

---

# Boardroom (한국어)

**1인 회사의 법인화.**

Hermes와 OpenClaw가 AI에게 손을 줬다면, Boardroom은 회사를 줍니다. 당신을 학습하는 이사회가 스스로 안건을 찾아 회의하고, 근거로 싸워 판결을 내리고 — 당신이 버튼 하나 누르면 executor가 실제로 실행합니다.

- **오퍼레이터에서 오너로.** 다른 에이전트는 시켜야 움직입니다. 이 회사는 스스로 일을 찾습니다 — 당신의 결정 기록을 읽고, 관심사를 학습하고, 필요한 회의를 알아서 소집합니다. "이 행정 처리 기한이 다가오는데 지금 해둘까요?" 같은 안건까지.
- **믿을 수 있는 결정.** 좌석들이 독립적으로 주장하고 서로 공격하고 설득되면 입장을 바꿉니다. 레드팀이 모든 판결을 죽이려 들고, 살아남은 판결만 확신도·반증조건·검증실험과 함께 도착합니다.
- **책임지는 AI.** 모든 판결이 원장에 기록되고 나중에 현실과 대조해 채점됩니다. 자기 타율을 공개하는 유일한 AI.
- **당신 없이는 아무것도 실행 안 됨.** 실행 계획은 승인 큐에 쌓이고, Execute/Decline 두 버튼이 전부. 결제·발송·매매는 영원히 사람 몫.
- **진짜 실행.** 승인하면 실제 브라우저·셸·파일로 수행하고 증거 스크린샷을 남깁니다.
