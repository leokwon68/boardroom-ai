# Boardroom — Complete Guide

**Your one-person company, incorporated.** An AI board of directors that learns you, picks its own agenda, debates with evidence, rules with a confidence score, scores itself against reality — and an executor that does the work after one click. Run it from your browser or your phone.

---

## 1. Install & run

You need **Node 18+**. That's it.

```bash
npx boardroom-ai              # launches the app and opens your browser → http://localhost:4242
npx boardroom-ai "Should I raise prices 20%?"   # or run one board meeting in the terminal
```

From source:

```bash
git clone <repo> && cd boardroom && node server.mjs
```

Stop it with `Ctrl+C` in the terminal.

---

## 2. Two things people confuse

There are **two independent questions**. Don't mix them.

### Where does it run?
- **Local (today):** a program on *your* computer. You open `localhost:4242` in your browser. Only you use it. No login. Free.
- **Hosted (future):** a website you log into; we run it 24/7 in the cloud. Paid for the convenience, not the software.

### What powers the AI brain?
- **Your Claude subscription** — if the `claude` CLI is installed and logged in, Boardroom uses it. **No per-token cost.**
- **An API key** — Anthropic / OpenAI / Gemini. You pay that provider per use. Used only if no `claude` CLI is found.

> **The AI cost is paid to the model provider, never to us.** With a Claude subscription it's effectively free. "Paying" for the hosted tier (later) is only about us keeping it running 24/7 for you.

Keys are **auto-detected** from your machine. You only paste one if nothing is found — it's stored locally with file permissions `600` and never displayed again.

---

## 3. The tabs

**⚙ Engine** — Confirm your key/subscription is detected. Assign a model per role: chair on Fable, seats on Sonnet, a GPT seat alongside — mix freely.

**👥 Staff** — Hire directors. Each reads every decision through one lens (a counsel seat, a growth seat, a CFO). The board is only as sharp as its composition. You can also see *What the company knows about you* — the profile it has learned.

**▦ Boardroom** — Type one real decision → **Convene**. The directors argue in turn, attack each other's weakest claims, the chair rules with a confidence score, and a red team tries to kill the verdict. ~90 seconds.
- **⚡ Autopilot** (one dropdown: Off / 30 min / hourly / 3 h): the board convenes **itself** on your interests — no clicking. It files execution plans to Approvals. Watch it live in the **Autopilot Activity** feed.

**✓ Approvals** — Everything the board wants to *do* waits here. Two buttons: **Execute** or **Decline**. Execute → the executor actually performs the work with a real browser (Playwright), shell, and files, narrating each step. Risky steps (payments, posting, logins, trades) are always held for you — forever.

**📈 Ledger** — Every verdict is recorded with a review date, then scored against reality with ✓ hit / ✗ miss. Your board keeps a **batting average**. No other AI measures its own judgment.

**📄 Reports** — Every meeting, filed. Autopilot keeps adding while you're away.

Bottom of the sidebar: **🔊 sound** toggle (subtle cues as directors speak / verdicts land) and **EN / 한국어** language.

---

## 4. Run it from your phone (Telegram)

Boardroom can push to your phone and take commands back — like a chief of staff.

**Setup:** add a `telegram` block to `~/.boardroom/config.json`:

```json
{
  "telegram": { "botToken": "123456:ABC...", "chatId": "-1001234567890", "threadId": 4 }
}
```

Get a bot token from **@BotFather** (`/newbot`), add the bot to your chat/group, and find your `chatId`. `threadId` is optional (only for forum-style groups).

**What it pushes to you:**
- 🏛 when the board meets on its own → the verdict + a plan id awaiting approval

**What you can text it:**
- `help` — command list
- `status` — pending approvals
- `go <id>` — execute a queued plan (runs the real executor)
- `no <id>` — decline a plan
- *any other text* — convene the board on that decision and reply with the verdict

So you can approve real work, or ask for a decision, from anywhere.

---

## 5. The loop, end to end

```
the company learns you → founds divisions around your interests →
convenes its own meetings → debates → verdict (confidence + falsifier) →
execution plan → [ YOU: Execute / Decline ] → real execution (browser, shell, files) →
results filed → verdicts scored against reality → batting average
```

You stop being the operator. You become the approver.

---

## 6. FAQ

**Is there a website to sign up for?** Not yet. Today it's a local program — `npx boardroom-ai`. A hosted version (login, always-on) comes later.

**Why no login locally?** Because it runs on your machine and you're the only user. Login matters only for the hosted multi-user version.

**Does it cost money?** The software is free. The AI brain is billed by your model provider (free with a Claude subscription). We only charge for the future hosted convenience tier.

**Will it do things without asking?** It will *decide* and *plan* on its own, but it never executes without your Execute click. Payments, posting, logins, and trades are held for you no matter what.

**Where is my data?** Local, in `~/.boardroom/` (meetings, ledger, owner profile, queue). Nothing leaves your machine except the model API calls you configured.
