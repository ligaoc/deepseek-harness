# 本地魔改 fork 工作流（Local Fork Workflow）

本仓库是从开源项目 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 拷贝并魔改的私有仓库。任何 agent 或人类在这个仓库里工作前，必须先读本文件。机器可读的速查版在根 `AGENTS.md` 的 "Local fork (魔改) workflow" 一节。

## 拓扑

```
origin     → 自己的 fork（github.com/ligaoc/deepseek-harness），可读可写
upstream   → 上游原项目（deepseek-ai/deepseek-harness），只拉不推
master     → 纯净，与上游同步（GitHub 上可用 "Sync fork" 按钮），禁止提交
custom     → 全部魔改的长期工作分支（日常开发、提交、推送都在这）
```

## 铁律

1. **只在 `custom` 分支提交与推送**，绝不提交到 `master`。
2. **绝不推送 `upstream`**（只 `git fetch upstream`）。
3. 魔改代码永不回上游；想贡献上游时另开独立工作区。
4. 换机（公司/家里）前必须 `git push origin custom`。
5. 自动更新要求工作区干净；有未提交改动时本次更新会跳过（不是故障）。

## 日常提交

```sh
git switch custom              # 确认在 custom
git add <文件>
git commit -m "feat(scope): 描述"   # 沿用仓库 conventional commits 风格
git push origin custom         # 换机前必做
```

## 同步上游（日常交给自动更新插件）

插件 `@deepseek-ai/dsh-auto-update`（设置 > 插件 > 自动更新）在启动时和每日定时执行 fork-first 同步：先合并 `origin/custom`（另一台机器的提交），再合并 `upstream/master`，跑 install/build/test 门禁，全过后推回 fork。手动路径见 [update/README.md](../update/README.md)。

## 合并冲突

自动更新合并冲突时会：快照带冲突标记的 diff 到 `update/conflict-<时间戳>.diff`（同名 `.json` 含 `source: "fork" | "upstream"`、冲突文件清单）→ `git merge --abort` 回滚 → 应用保持可用。解决方式：

- 把 [update/CONFLICT_PROMPT.md](../update/CONFLICT_PROMPT.md) 复制给大模型，它会按快照重放合并、解决冲突、跑门禁并提交。
- 或按 [update/README.md](../update/README.md) 手动解决。

## 本仓库的魔改内容（合并上游时重点保护）

- `packages/extensions/vision-bridge`、`packages/web/web-search-tavily`、`packages/extensions/auto-update`（新增包，上游无同名文件，不会冲突）
- `packages/host/apiproxy/src/api-proxy.ts`、`packages/core/agent/src/model-selection.ts` 及其测试（上游核心文件，是冲突高发区）
- `packages/client/ui-settings-plugins`（设置页卡片，含自动更新卡片）
- `start-dsh.bat`、`update/`、根 `.gitignore` 追加段

## 术语

见根 [CONTEXT.md](../CONTEXT.md)：上游、魔改、自定义分支、更新门禁、冲突日志、更新提示词。
