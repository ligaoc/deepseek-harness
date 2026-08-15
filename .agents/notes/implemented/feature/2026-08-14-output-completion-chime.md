# Agent Note: Away-gated completion chime for the web GUI

Status: implemented

English | [中文](2026-08-14-output-completion-chime.zh.md)

## Problem

A long-running session forces the operator to keep watching the GUI: nothing signals completion while the page is not in focus, so the operator either stares at the progress or returns to a finished session only by chance. The sidebar done-dot ([session-completed-done-dot](2026-08-06-session-completed-done-dot.md)) is in-page and selection-gated; it cannot reach an operator who left the page.

## Decision

A new client plugin (`@deepseek-ai/dsh-client-ui-output-alert`) plays one short synthesized chime — two soft sine blips via WebAudio, no audio asset, fixed volume — exactly when a **root session** (never a subagent child) turns fully idle **and** the user is away from the page at that instant (`document.hasFocus() === false` at the completion moment, no debounce). One blip per completion, never repeated: a missed chime is accepted by design (the operator is probably away from the desk; repeating would disturb others). While the page is focused there is no new reminder — the operator is watching, and the existing done-dot covers it.

"Fully idle" is the whole predicate, not the running bit alone: not running, no queued turns, no pending approval/question interaction. The object layer publishes the idle edge (`SessionManager.onRootSessionIdle` → `ISessions.onRootSessionIdle`); the UI never derives it. The manager reconciles the predicate eagerly in the same mutation cadence as `completedNotifications` — after every list mutation, list pull, pending-interaction frame, and queue frame — and notifies listeners synchronously inside the mutation path, so a hidden tab still hears it (microtask delivery; the rAF flush the `Notifier` uses for streaming is paused in a background tab). Baselines re-seed per connection generation, so a disconnect's pending-interaction clear can never look like a completion (a finish lost to a disconnect blip is accepted loss). Subagent-origin rows are excluded; uninstantiated sessions count as queue-empty (conservative, never delays an edge).

The chime is gated on one durable setting, `ui-output-alert.enabled` (default true): a Host settings namespace registered by the plugin's node half, bound through `ctx.settingsScope` in the browser half, mirrored into the row store, and rendered as a checkbox row in the settings General section. The apiproxy's served-namespace allowlist (`WEB_SETTINGS_NAMESPACES`) admits the namespace, so the toggle writes persist in the Host settings document. The AudioContext is created lazily and armed on the first page gesture (autoplay policy); once armed it keeps playing in background tabs. The [web glossary](../../../../CONTEXT.md) records the domain terms (会话空闲 / 离开页面 / 输出结束提醒).

## Alternatives considered

**OS-level browser notifications** — rejected in favor of sound. The operator wants a pull-back signal while at the desk; a notification-center entry adds nothing for an operator away from the machine and would need permission machinery.

**Repeated chimes until the user returns** — rejected. The operator chose single-shot: a missed chime means they are not at the desk, and repetition would disturb people around them.

**A debounce on the away gate** — rejected. A debounce window turns "missed" from a probability into a certainty for completions landing just after a tab switch; the false positive (a redundant chime while half-present) is self-healing.

**All sessions, subagent children included** — rejected. Intermediate child completions are progress, not completion; a workflow would chime repeatedly while still running. Only root sessions match "your session finished".

**Distinguishing `turn/end` reasons** — rejected. The snapshot carries no reason today, and every cause of idle except a manual stop is worth returning for; a manual stop requires being on the page, which the away gate already excludes.

**Alerting on the running→idle bit alone** — rejected. Queue mode can leave queued turns behind a false idle window; the full predicate (running + queue + pending) is the only honest "done".

## Consequences

The operator can leave the GUI and be pulled back by a single soft chime when a root session finishes. The runtime publishes one more edge type (facts only; the away gate and the toggle stay in the plugin), the settings document gains one namespace, and misses remain possible by design (disconnect blips, unarmed audio contexts). Two tabs of the same GUI each play their own chime for the same completion; cross-tab deduplication is deferred until a tab manager exists.

## Verification

The runtime suite drives the edge through status frames, pending-interaction frames, queue frames, refresh pulls, subagent-origin rows, unsubscribe, and disconnect re-seeding. The plugin suite covers the away gate (focused vs. unfocused), the enabled flag, gesture arming, the suspended/unavailable skips, the webkit fallback, and the row's store mirror and write routing. The assembled web snapshot of the settings dialog ([settings-chrome](../../../../apps/web/tests/snapshots/settings-chrome/dialog.expected.md)) pins the new row's presence in the General section.
