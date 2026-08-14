# 手动更新手册（Runbook）

自动更新插件（`@deepseek-ai/dsh-auto-update`）负责日常同步；本手册是**任何时候都可用的手动路径**，自动更新失败或你想完全手动控制时照此操作。

## 拓扑速览

```
origin     → 你的 fork（github.com/ligaoc/deepseek-harness）
upstream   → 上游原项目（deepseek-ai/deepseek-harness，只拉不推）
master     → 纯净，跟上游同步（GitHub 上可用 "Sync fork" 按钮）
custom     → 你的魔改分支（日常开发就在这上面）
```

## 日常同步（无冲突时）

```sh
git fetch upstream
git merge upstream/master        # 在 custom 分支上执行
pnpm install
pnpm run build
pnpm run test
git push origin custom
```

## 合并冲突时

1. 冲突发生时 git 会停在合并中。先快照现场（自动更新插件会自动做，手动路径要自己做）：

```sh
git diff > update/conflict-$(date +%Y%m%d-%H%M%S).diff
git diff --name-only --diff-filter=U   # 列出冲突文件
```

2. 两种解决方式任选：

   - **交给大模型**：把 `update/CONFLICT_PROMPT.md` 的内容复制给它（它有权操作这个仓库时直接让它读该文件执行）。
   - **自己解决**：逐个文件编辑冲突标记，`pnpm-lock.yaml` 直接重生成（见下），然后：

```sh
git add <已解决的文件>
git commit        # 保留合并提交
git push origin custom
```

3. 改主意或搞砸了，随时回滚到冲突前：

```sh
git merge --abort    # 放弃合并，回到合并前状态（工作区改动会丢失，先确认没有未保存内容）
```

## pnpm-lock.yaml 冲突（几乎每次同步都会遇到）

不要手工拼 lockfile。任取一侧后重新生成：

```sh
git checkout --theirs pnpm-lock.yaml   # 或 --ours
pnpm install
```

## 门禁失败回滚

自动更新在 install/build/test 任一失败时会自动 `git reset --hard` 回滚。手动路径：

```sh
git reset --hard <冲突前/合并前的 commit sha>
```

注意：`reset --hard` 只还原 git 提交，不还原 `node_modules`；失败后跑一次 `pnpm install` 收敛依赖。

## 紧急回退到某个版本

```sh
git log --oneline -20          # 找到要回退的提交
git reset --hard <sha>         # custom 分支直接回退
git push --force origin custom # 已推送过才需要（慎用，只推自己的 fork）
```

## 常见问题

- **fetch 走代理**：本机代理（如 127.0.0.1:7897）可用时设置 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量再执行 git/pnpm；不可用时直连。
- **工作区有未提交改动时同步会跳过**：先提交或暂存（`git stash`）再同步。
- **不在 custom 分支**：自动更新会跳过并提示；`git switch custom` 后再试。
