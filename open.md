# 在另一台电脑打开 6091 Physics Studio

## 先理解三个东西

- **GitHub 仓库**保存网站源码，但它本身不是正在运行的网站。
- **GitHub Codespaces**是在云端替你运行网站的电脑。换电脑时，要重新打开同一个 Codespace。
- 网站里的 **Codex** 页面连接的是这个 Codespace 中的 Codex。它可以继续该 Codespace 里保存的对话，但不会自动连接到当前 ChatGPT/Codex 客户端里的这一条会话。

目前推荐的方式是：在 GitHub 上创建一个 Codespace，将端口保持为 **Private**，然后从任何电脑登录同一个 GitHub 账号访问。

## 第一次设置

### 1. 创建 Codespace

1. 在另一台电脑登录有仓库访问权限的 GitHub 账号。
2. 打开当前开发分支：
   [Question-Generation 开发分支](https://github.com/zhugecunfux-dev/Question-Generation/tree/claude/singapore-olevel-physics-generator-bdpnm0)。
3. 确认分支是 `claude/singapore-olevel-physics-generator-bdpnm0`。这个 PR 合并以后，新建 Codespace 时改选 `main`。
4. 点击 **Code** → **Codespaces** → **Create codespace on ...**。
5. 等待初始化完成。仓库会自动安装依赖并导入示例题库；第一次通常需要几分钟。

如果自动初始化失败，在 Codespace 的 Terminal 中运行：

```bash
npm ci
npm run import -- data/questions/seed.json
```

### 2. 设置网站访问钥匙

这个钥匙相当于网站密码。请在密码管理器里生成并保存一段较长的随机字符串，不要使用 GitHub、ChatGPT 或邮箱密码。

临时设置的方法如下。命令不会在屏幕上显示你粘贴的钥匙：

```bash
read -rsp "设置网站访问钥匙: " QG_ACCESS_TOKEN
export QG_ACCESS_TOKEN
printf "\n"
```

临时 `export` 只属于当前 Terminal 及其启动的进程。停止或重启 Codespace，或者关闭这个 Terminal 后，需要再次设置。为了以后更方便，可以把它保存成 GitHub Codespaces Secret：

1. 打开 GitHub 的 [Settings → Codespaces](https://github.com/settings/codespaces) → **New secret**。
2. Name 填 `QG_ACCESS_TOKEN`。
3. Value 填刚才保存的随机字符串。
4. Repository access 只选择 `zhugecunfux-dev/Question-Generation`。
5. 保存后，停止并重新启动当前 Codespace，Secret 才会进入环境。

可以用下面的命令确认钥匙是否存在；它不会打印钥匙本身：

```bash
test -n "$QG_ACCESS_TOKEN" && echo "Access key ready" || echo "Access key missing"
```

### 3. 登录 Codex

在 Codespace Terminal 中运行：

```bash
npm run codex:login
```

Terminal 会显示一个网址和一次性验证码：

1. 打开显示的网址。
2. 登录要用于 Codex 的 ChatGPT 账号。
3. 输入一次性验证码并授权。

需要时可检查登录状态：

```bash
npx codex login status
```

如果设备验证码登录不可用，需要先在个人 ChatGPT 的安全设置中启用 device-code login；团队账号则可能需要管理员允许。

Codex 登录凭据可能保存在 `~/.codex/auth.json`。它的敏感程度和密码相同，绝对不要提交到 GitHub、发到聊天里或复制给别人。

### 4. 启动网站

在同一个 Terminal 中运行：

```bash
npm run dev:remote
```

保持这个 Terminal 和进程运行。看到 Next.js 显示 ready 后：

1. 打开 Codespace 下方的 **PORTS** 面板。
2. 找到端口 `3000`。
3. 确认 **Visibility** 是 `Private`，不要改成 `Public`。
4. 点击地球图标或 **Open in Browser**。
5. 网站要求登录时，输入前面保存的 `QG_ACCESS_TOKEN`。
6. 打开导航中的 **Codex**，或在网址后加 `/agent`。

第一次进入 `/agent` 可以新建对话。以后从另一台电脑进入同一个 Codespace 时，已有对话会显示在左侧列表中，可选择后继续。

## 以后在任何电脑上重新打开

1. 用同一个 GitHub 账号打开 [Your Codespaces](https://github.com/codespaces)。
2. 找到之前为 `Question-Generation` 创建的 Codespace，点击名称恢复它。不要点击 **Create new codespace**。
3. Codespace 恢复后，之前运行的网站进程已经停止，需要重新运行：

   ```bash
   npm run dev:remote
   ```

4. 如果没有保存 Codespaces Secret，先在同一个 Terminal 重新设置 `QG_ACCESS_TOKEN`，再启动网站。
5. 在 **PORTS** 面板确认端口 `3000` 仍是 `Private`，然后点击 **Open in Browser**。
6. 如果出现登录页，输入网站访问钥匙；进入 `/agent` 后，从左侧选择原来的 Codex 对话。

普通的停止与恢复通常会保留文件、SQLite 题库、Codex 登录和对话。以下情况不同：

- **重建 container**：`/workspaces` 中的仓库工作区和 SQLite 题库会保留，但工作区外 `~/.codex` 中的 Codex 登录和对话会被清除，需要重新运行 `npm run codex:login`。
- **删除 Codespace**：所有没有 push 到 GitHub 的改动和 commits，以及本地 SQLite 题库、Codex 登录和对话都会丢失。
- **新建另一个 Codespace**：它是另一台云端电脑，不会自动拥有旧 Codespace 的本地题库和 Codex 对话。

同一浏览器中的网站登录 cookie 最长保存 30 天；如果访问钥匙没有改变，恢复 Codespace 后可能不必重新输入。

停止的 Codespace 也可能在账户设置的保留期限到期后被 GitHub 自动删除。重要源码应及时 commit 并 push；本地题库和需要保留的资料还应另行备份。

## 用完后停止

仅关闭浏览器标签页不会立即停止 Codespace。

1. 在运行网站的 Terminal 按 `Ctrl+C`，停止网站。
2. 打开 [Your Codespaces](https://github.com/codespaces)。
3. 点击该 Codespace 右侧的 `...` → **Stop codespace**。

运行中的 Codespace 消耗计算额度；停止后不再产生计算用量，但仍可能占用存储额度。个人 GitHub 账号通常有月度免费额度，具体额度和超额费用以 GitHub 当前账单页面为准。

## API key 和费用

- 打开网站本身不需要 OpenAI API key。
- `/agent` 使用 `npm run codex:login` 登录的 ChatGPT 账号，遵循该账号的 Codex 权限和用量限制，不从 OpenAI Platform API key 余额扣费。
- Retrieve 和 Template variants 两种出题模式不需要模型 API。
- Claude-authored 模式需要另行配置 `ANTHROPIC_API_KEY`，会按 Anthropic API 用量计费；暂时不用可以不配置。
- 如果以后让网站在没有 Codex 对话参与的情况下自动调用图片生成 API，则需要再单独配置相应 API 和预算；这不是目前打开网站的必要条件。
- GitHub Codespaces 的计算和存储属于 GitHub 的费用，与模型 API 费用分开。

## 常见问题

| 现象 | 处理方法 |
|---|---|
| 显示 `QG_ACCESS_TOKEN is not configured` 或 503 | 在启动网站的同一个 Terminal 设置 `QG_ACCESS_TOKEN`，然后重新运行 `npm run dev:remote`。 |
| 网站提示 access key 错误 | 确认输入的是 Codespace 当前环境里的同一个钥匙；退出网站后重新登录。 |
| `/agent` 一直显示 Starting、Disconnected 或登录错误 | 停止网站，运行 `npm run codex:login` 完成登录，再运行 `npm run dev:remote`。 |
| PORTS 面板没有 3000 | 确认 `npm run dev:remote` 已经显示 ready；必要时在 PORTS 面板点击 **Add port** 并输入 `3000`。 |
| 另一台电脑打不开端口网址 | 确认 Codespace 正在运行、端口为 `Private`，并且浏览器登录的是拥有该 Codespace 的 GitHub 账号。 |
| 换电脑后看不到旧对话 | 确认打开的是原来的 Codespace，而不是新建的；然后进入 `/agent` 查看左侧对话列表。 |
| Codespace 恢复后网站打不开 | 恢复只启动云端电脑，不会自动恢复 Node 进程；重新运行 `npm run dev:remote`。 |

## 安全提醒

- 当前 GitHub 仓库是公开源码仓库。不要提交 API key、`QG_ACCESS_TOKEN`、`.env.local`、`.codex/`、`auth.json`、私人或有版权限制的 PDF。
- 端口 `3000` 必须保持 `Private`。即使网站还有一层访问钥匙，也不要将端口设为 `Public`。
- 网站的 Codex 页面可以请求修改仓库文件和运行命令，因此访问钥匙只给自己使用。
- Codex 的 `workspace-write` 限制不是同一 Codespace 系统账号下的机密隔离。不要把与本项目无关的高价值 Secret 或私人文件放进这个 Codespace。
- Codex 请求批准时，先核对完整命令、文件路径、网络目标和权限，再决定是否允许。
- `.codex/`、本地 SQLite 和常见环境文件已经被 Git 忽略，但提交前仍要检查文件列表。

## 最短操作清单

第一次：

```bash
# 在 Codespace Terminal
read -rsp "设置网站访问钥匙: " QG_ACCESS_TOKEN
export QG_ACCESS_TOKEN
printf "\n"
npm run codex:login
npm run dev:remote
```

以后：

```bash
# 恢复同一个 Codespace；若已保存 Secret，直接启动
npm run dev:remote
```

然后从 **PORTS** 面板打开私有端口 `3000`。

## 官方参考

- [GitHub：为仓库创建 Codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository)
- [GitHub：打开已有 Codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/opening-an-existing-codespace)
- [GitHub：停止和启动 Codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/stopping-and-starting-a-codespace)
- [GitHub：Codespace 的数据持久化边界](https://docs.github.com/en/codespaces/developing-in-a-codespace/persisting-environment-variables-and-temporary-files)
- [GitHub：Codespace 生命周期和自动删除](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle)
- [GitHub：转发端口及可见性](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
- [GitHub：保存 Codespaces Secret](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces)
- [GitHub：Codespaces 费用](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
- [OpenAI：Codex 登录与凭据安全](https://learn.chatgpt.com/docs/auth)
