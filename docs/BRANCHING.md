# 分支与发布流程

## 长期分支

| 分支 | 用途 | 规则 |
|---|---|---|
| `main` | 稳定版，仓库默认分支，访客看到的就是它 | 只接收来自 `dev`（或 `hotfix/*`）的合并，不直接在上面提交 |
| `dev` | 日常开发主线 | 所有功能分支从这里切出、合回这里 |

`main` 上的每个提交都应能直接 `Start-Workbench.cmd` 跑起来。

## 日常流程

1. 同步 dev：
   ```bash
   git switch dev
   git pull origin dev
   ```
2. 小改动可以直接提交到 `dev`；较大的功能从 `dev` 切短期分支：
   ```bash
   git switch -c feat/launch-pad-quota
   ```
3. 开发、提交，推送自己的分支：
   ```bash
   git push -u origin feat/launch-pad-quota
   ```
4. 自测通过（`npm run typecheck`、`npm test`、`npm run build`）后，在 GitHub 上开 PR 合入 `dev`，或本地合并：
   ```bash
   git switch dev
   git merge --no-ff feat/launch-pad-quota
   git push origin dev
   git branch -d feat/launch-pad-quota
   git push origin --delete feat/launch-pad-quota
   ```
5. `dev` 上的一批功能确认没问题后，同步到 `main`（开 PR `dev → main` 合并，或本地快进）：
   ```bash
   git switch main
   git pull origin main
   git merge --ff-only dev      # 快进；dev 与 main 分叉时改用 git merge --no-ff dev
   git push origin main
   git tag v0.3.0 && git push origin v0.3.0   # 可选：打版本号
   git switch dev
   ```

## 紧急修复

线上（`main`）出问题、`dev` 上又有未完成的改动时：

```bash
git switch main
git switch -c hotfix/grader-g3-false-zero
# 修复、提交
# 合回 main，再合回 dev，保证两边都有这次修复
```

## 分支命名

格式：`<类型>/<简短描述>`，全小写，单词用短横线连接，只用英文、数字和 `-`。

| 类型 | 用于 | 例子 |
|---|---|---|
| `feat/` | 新功能 | `feat/run-trash` |
| `fix/` | 修 bug | `fix/cli-flag-spaces` |
| `hotfix/` | 从 `main` 切出的紧急修复 | `hotfix/session-token-leak` |
| `refactor/` | 不改行为的重构 | `refactor/store-layer` |
| `docs/` | 只改文档 | `docs/methodology-page` |
| `chore/` | 依赖、构建、脚本、配置 | `chore/bump-electron` |
| `test/` | 只加或改测试 | `test/trash-e2e` |
| `release/` | 发版前的收尾（可选） | `release/v0.3.0` |

关联 issue 时可以带编号：`fix/42-preview-blank`。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(workbench): 运行卡片右键菜单支持彻底停止
fix(grader): G3 不再把 CDN 地址当作声称的文件
docs: 补充分支流程
```

类型与分支前缀一致：`feat` `fix` `refactor` `docs` `chore` `test` `perf`。

## 不进仓库的内容

仓库是公开的，下面这些是本机数据，永远不要提交：

- `data/bench-store.json` 的本机改动、`model/<供应商>/<模型>/` 下的运行目录（含额度、订阅信息）
- `tasks/*/hidden/` 与 `.agents/skills/**/hidden/`（隐藏测试和参考实现）
- `.env`、令牌、任何凭据

提交前用 `git status` 检查，按文件 `git add`，不要 `git add -A`。

## 关于 Agent

Agent（包括 Kiro）只在 `dev` 和功能分支上提交、推送，不直接推送 `main`。`dev → main` 的同步由仓库所有者完成（本地推送或在 GitHub 合并 PR）。
