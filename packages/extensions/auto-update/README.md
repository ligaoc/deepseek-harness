# @deepseek-ai/dsh-auto-update

应用内自动更新：按调度（启动检查 + 每日定时）从上游远程（`upstream`）拉取更新，把上游分支合并进自定义分支（`custom`），跑安装/构建/测试门禁，任一步失败即回滚到合并前提交；合并冲突先快照带冲突标记的 diff 再回滚；门禁全过后把合并结果推送到 fork。Web 界面通过 `autoUpdate` Remote 命名空间查询状态、触发检查，并接收 `auto-update/status` 事件。

## 配置

`auto-update` 设置段（Web 设置 > 插件页可编辑，无需重启）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `intervalHours` | `24` | 定时扫描间隔（小时） |
| `remote` | `upstream` | 拉取更新的远程名 |
| `branch` | `custom` | 合并目标分支 |
| `autoPush` | `true` | 门禁全过后推送到 `origin` |
| `gateInstall` | `true` | 运行 `pnpm install` 门禁 |
| `gateBuild` | `true` | 运行 `pnpm run build` 门禁 |
| `gateTest` | `true` | 运行 `pnpm run test` 门禁 |
| `checkOnStartup` | `true` | 启动后延迟检查 |
| `startupDelaySeconds` | `20` | 启动检查延迟 |
| `repoDir` | 应用工作目录 | 仓库根目录 |
| `logDir` | `<repoDir>/update` | 冲突快照与 status.json 目录 |
| `proxyUrl` | 空 | git/pnpm 的可选代理 |

## 服务

Remote 命名空间 `autoUpdate`（Web 客户端经 `ctx.remote.autoUpdate` 调用）：

- `status(): AutoUpdateSnapshot` — 当前阶段、上次检查时间、落后提交数、结果消息、冲突日志路径
- `check(): Promise<UpdateOutcome>` — 立即触发一次检查；并发调用共享进行中的运行

宿主事件 `auto-update/status`（加入 `API_REMOTE_FORWARDED_EVENTS` 允许列表后转发给客户端）在每次阶段变化时携带同一快照。

## 冲突处理

合并冲突时流水线先写 `update/conflict-<时间戳>.diff`（含冲突标记的完整 diff）与同名 `.json` 元数据（远程、分支、落后数、冲突文件清单），再执行 `git merge --abort` 回滚，应用保持可用。把 `update/CONFLICT_PROMPT.md` 的内置提示词复制给大模型即可让它接管解决；手动流程见 `update/README.md`（仓库根目录）。

## Known Limitations and Deferred Work

- 门禁失败回滚只复位 git 提交（`git reset --hard`），已变更的 `node_modules` 不会还原；下次 `pnpm install` 会收敛，但失败瞬间的依赖树可能偏离锁定文件。
- 流水线阶段粒度是粗粒度的：远程查询期间快照只报告 `checking`，不细分 fetch/merge/install/build/test 各步。
- 更新成功只提示重启生效，不自动重启应用进程（有意为之，避免中断会话）。
- 推送失败时保留本地合并结果，只把阶段记为 `failed/push`，fork 落后于本地。
- 定时器仅在应用运行期间生效；应用未启动时不会检查（启动时的 `checkOnStartup` 会补上）。
