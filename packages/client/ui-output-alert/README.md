# @deepseek-ai/dsh-client-ui-output-alert

English | [中文](README.zh.md)

Output-completion alert: when a root session (never a subagent child) turns idle — not running, no queued turns, no pending approval/question — while the user is not looking at the page (`document.hasFocus() === false` at the completion instant), the browser plays one short synthesized chime (two soft sine blips via WebAudio, no audio asset). In-page, no reminder is added: the user is watching and the existing sidebar completion dot covers it. One blip per completion, never repeated — a missed chime is accepted by design (the user is probably away from the desk; repeating would disturb others).

The trigger edge comes from the sessions service's `onRootSessionIdle` subscription (`SessionRuntime` → `SessionManager`), which fires synchronously inside the object-layer mutation path, so a hidden tab still hears it (microtask delivery, never the rAF flush a background tab pauses). The Host half registers the `ui-output-alert` settings namespace; the browser half binds it through `ctx.settingsScope`, mirrors the `enabled` flag into the row store, and renders a checkbox row in the settings General section (default on; the single configuration surface of the feature).

The chime's AudioContext is created lazily and armed on the first page gesture (autoplay policy); once armed it keeps playing in background tabs. A completion landing before any gesture (practically impossible — sending a prompt is a gesture) is skipped.

## Model Experience

None, as the alert is browser presentation over already-client-visible session state: nothing here reaches a model request, and no session event is added (the idle edge is derived from existing status, queue, and interaction frames).

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One chime per browser tab** — two tabs of the same GUI each play their own chime for the same completion; cross-tab deduplication is deferred until a tab manager exists.
- **A completion during a connection blip can be missed** — the idle baselines re-seed on reconnect, so a finish lost to a disconnect window fires no chime (the sidebar dot still shows it). Consistent with the missed-chime contract.
- **Volume and tone are fixed** — the chime is a deliberate non-tunable; the enabled toggle is the only configuration.
