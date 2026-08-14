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

自动更新完整流程：

```text
触发源（三选一）：① 启动后 20 秒  ② 每日定时（默认 24h）  ③ 设置页「立即检查」

前置检查
  当前分支 == custom ? ──否──▶ 跳过「当前分支 X，期望 custom」
  工作区干净（无未提交改动）? ──否──▶ 跳过「工作区有未提交改动」
  记录 rollbackSha = 当前 HEAD（门禁失败的回滚基准）

阶段一：同步 fork
  git fetch origin
  origin/custom 存在且领先（本地落后）?
    ├─ 否 ─▶ 跳过
    └─ 是 ─▶ git merge origin/custom
               ├─ 冲突 ─▶ 快照 conflict-*.diff（meta: source="fork"）
               │           git merge --abort ──▶ 结束【冲突】
               └─ 成功 ─▶ 标记「合并过东西」

阶段二：同步上游
  git fetch upstream
  HEAD..upstream/master 有新提交?
    ├─ 否 ─▶ 跳过
    └─ 是 ─▶ git merge upstream/master
               ├─ 冲突 ─▶ 快照 conflict-*.diff（meta: source="upstream"）
               │           git merge --abort ──▶ 结束【冲突】
               └─ 成功 ─▶ 标记「合并过东西」

两个阶段都没合并任何东西? ──是──▶ 结束【已是最新】

更新门禁（三步全过才算成功；任一步失败：
  git reset --hard 回滚到运行起点 ──▶ 结束【失败】）
  ① pnpm install  ② pnpm run build  ③ pnpm run test

git push origin custom（合并结果 + 本地未推送提交一起推回 fork）
  失败 ─▶ 结束【失败/推送】——本地合并保留，fork 落后，下次再推

结束【更新完成】──▶ 弹窗「更新完成，请重启应用生效」
```

每个阶段变化都会发 `auto-update/status` 事件，Web 设置页卡片实时显示状态（检查中 / 已是最新 / 更新完成 / 合并冲突 / 失败 + 冲突日志路径）。

多机收敛（公司 + 家里都跑自动更新）：

```text
公司电脑                          fork (origin)                      家里电脑
   │── 改代码 → commit ─────────────▶│                                  │
   │── 自动更新① fetch origin ──────▶│                                  │
   │── 自动更新② merge upstream ────▶│                                  │
   │── 门禁通过 push ───────────────▶│                                  │
   │                                │── 家里自动更新① fetch origin ─────▶│
   │                                │    origin/custom 领先（公司的      │
   │                                │    提交）──▶ merge 进来             │
   │                                │◀── 家里② merge upstream ──────────│
   │                                │◀── 家里门禁通过 push ──────────────│
   │── 公司下次自动更新① fetch ─────▶│                                  │
   │    origin/custom 领先（家里的    │                                  │
   │    提交）──▶ merge 进来          │                                  │
   └────────── 两边最终都包含：双方提交 + 最新上游 ──────────┘
```

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
