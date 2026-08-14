# 更新冲突解决提示词（内置模板）

把本文件全部内容复制给大模型（或直接告诉它"读取本文件并执行"），它会接管合并冲突的解决。**要求：失败或中断时必须把仓库恢复到可手动更新的干净状态，绝不丢失本地魔改。**

---

你在仓库 `D:\deepseek-harness`（或提示词中给定的仓库路径）中解决一次上游合并冲突。背景：

- 这是一个从开源项目 `deepseek-ai/deepseek-harness` 魔改的私有仓库：`origin` 指向我的 fork，`upstream` 指向上游原项目。
- 我的魔改全部在 `custom` 分支上（`master` 保持与上游同步）。自动更新在合并 `upstream/master` 时发生冲突，已回滚并留下冲突快照。
- 冲突快照在仓库的 `update/` 目录：`conflict-<时间戳>.diff`（带冲突标记的完整 diff，**解决冲突的唯一依据**）和同名的 `.json`（含远程、分支、落后提交数、冲突文件清单、合并 stderr）。

## 任务步骤

1. 读取 `update/` 下最新的 `conflict-*.diff` 和 `conflict-*.json`，确定冲突文件清单。
2. 确认当前在 `custom` 分支且工作区干净（`git status`）。如不干净，先处理或停下说明。
3. 重新拉取并重放合并：`git fetch upstream`，然后 `git merge upstream/master`（不要用 `pull`、不要 `--ff-only`）。
4. 逐文件解决冲突：
   - 冲突中 `<<<<<<< HEAD` 一侧是我的魔改，`>>>>>>> upstream/master` 一侧是上游新代码；两者都要保留时手工合并，上游删除/改名时以新拓扑为准。
   - `pnpm-lock.yaml` 冲突不要手工拼：任取一侧后运行 `pnpm install` 重新生成。
   - 只解决 `conflict-*.json` 中列出的文件，不要顺手改动其他文件。
5. 门禁验证，全部通过才算成功：
   - `pnpm install`
   - `pnpm run build`
   - `pnpm run test`（若完整测试过重，可先 `pnpm run typecheck` + 相关包测试，并在报告中说明跳过了什么）
6. 提交：`git commit`（保留合并提交，不要 `--amend` 改写历史；提交信息注明"resolve upstream merge conflict"）。
7. 推送：`git push origin custom`。

## 安全规则（违反即失败）

- **失败或中断**（任何命令报错、你被中断、网络失败）：先执行 `git merge --abort`（合并中时）或 `git reset --hard` 到冲突前提交（门禁失败时），把仓库恢复到可手动更新的干净状态，然后如实报告发生了什么，绝不留下半合并状态。
- **绝不丢弃魔改**：不确定哪一侧是对的时候停下询问，不要"猜一个"。`update/` 下的快照文件不要删除。
- 完成后报告：解决了哪些文件、每个文件怎么取舍的、门禁结果、提交 sha。

## 你完成后

告诉我：合并结果、冲突文件取舍说明、门禁各步结果、新 HEAD。如果中途失败，报告恢复到哪个提交、快照还在不在。
