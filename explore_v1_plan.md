# Explore v1 — Simple Full‑Screen Feed (No Chat Panel)

An intuitive first version of Explore that fully replaces the chat interface while active. Focus on a clean feed, clear actions, and minimal flows that work reliably.

## What Users Can Do
- Open Explore (emerald theme) and see a batch of 5 cards.
- Type an intent and use chips to filter (Minutes, Mode, Vibe), then Refresh.
- Start a card (opens a lightweight session overlay), Swap for an alternative, Save for later, or mark Not for me.
- View saved items in a Saved tab. Exit Explore via a Chat button in the header.

## UI (Full Screen)
- Header: “Explore” on left, “Chat” button on right (exits Explore). Theme is emerald while in Explore.
- Controls: intent input “I’m in the mood for…”, chips for Minutes (3/5/10/15), Mode (Read/Code/Quiz), Vibe (Chill/Focused), and a Refresh button.
- Tabs: Feed (default) and Saved.
- Cards Grid: each shows title, 1‑line why, minutes, mode, prereqs, and actions: Start • Swap • Save • Not for me • Why?

## Start Session (Overlay)
- Opens an overlay within Explore; does not show the chat UI.
- Fetches content using the card’s `start_payload` and `mode`:
  - Read: tight summary with bullets and an optional 2‑Q micro‑quiz prompt.
  - Code: small task with a concise snippet and steps (no code runner).
  - Quiz: 4–6 quick questions with immediate feedback.
- Controls: Complete, Too easy, Not relevant, Close.
- On Complete: log completion and (optionally) suggest one follow‑up card inline. Close returns to the feed.

## Actions Behavior
- Start: opens the overlay and generates content now. Stays in Explore.
- Swap: replaces the card in place with same minutes/mode. Show a small spinner on that card only.
- Save: toggles saved state and shows “Saved” indicator; item appears in the Saved tab.
- Not for me: mutes topic for 14 days and immediately swaps in a replacement.
- Why?: tooltip or small inline line using `why_now` + prerequisites.

## Data (Minimal)
- Card: { id, title, why_now, minutes, mode, topic, prerequisites[], start_payload, swap_prompt_stub }
- UserPrefs: { default_minutes, default_mode, default_vibe, history_opt_in=true }
- Saved: [Card]
- Mutes: { topic -> resume_at_iso }
- SessionLog: { card_id, action, ts, extra? }

## LLM Usage
- Batch generation: single prompt returns exactly 5 cards respecting chips and diversity.
- Swap: single prompt returns one alternative card for a slot (same minutes/mode).
- Session content: single prompt that converts `start_payload` into the chosen mode’s material (Read/Code/Quiz) for the selected minutes.
- Why this?: single‑sentence reason using `why_now`, prerequisites, and recent themes.
- Model: default to `gemini-2.5-flash+search` for Explore.

## History Mining (Local‑Only by Default)
- Use last 7 days or up to 200 recent messages across conversations (whichever limits first).
- Respect user opt‑out. If no history or opt‑out, use a curated starter pack.

## Persistence
- LocalStorage for prefs, saved, mutes, and logs.
- If signed in: best‑effort Firestore sync under `users/{uid}/explore/{prefs, logs}`.

## Error States
- Inline card‑level retry for Swap/Start failures.
- Batch generation fallback to a curated starter pack.

## Telemetry (Local)
- Events: feed_shown, card_started, card_completed, card_swapped, card_saved, card_dismissed, feedback_tag (too_easy, too_hard, not_relevant).

## Build Steps (Focused)
1) Replace Explore layout with full‑screen page (emerald), no chat panel.
2) Implement Feed + Saved tabs with intent/chips and Refresh.
3) Implement working actions: Start overlay, Swap (slot‑only), Save toggle, Not‑for‑me (mute + swap), Why tooltip.
4) Add local storage for prefs/saved/mutes/logs + Firestore best‑effort sync.
5) Hook up LLM wrappers: batch, swap, session content, why.
6) Add loading states (feed skeleton, per‑card spinner) and fallbacks.

## Success Criteria
- All actions work reliably offline (local storage only).
- Generate feed in < 2s on average, with visible progress.
- Start shows content in < 2s and stays within Explore.

