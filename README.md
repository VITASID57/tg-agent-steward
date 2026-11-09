# TG Agent Steward / TG 管家

一个可自托管、可嵌入其他前端的多渠道 AI Bot 控制面。连接凭据集中保存一次，
多个 Bot 分别选择连接、模型、思考档位、人物、外置记忆、声音、生图与工具预设。
公开仓库沿用直白名称，控制页的产品名是 **栖光庭 / Lumenkeep**：一处管理
Telegram / 微信 Bot 连接、模型与能力设置的控制台。外置记忆只是可选连接，不由管家存放。

由 TG Agent Steward contributors 维护。采用 [PolyForm Noncommercial 1.0.0](./LICENSE)：
允许个人和非商业用途使用、研究、修改与再分发修改版，禁止商业用途。本项目为源码公开的
非商业共享软件，不属于 OSI 定义的开源软件。

这是独立通用版，不依赖任何私人陪伴系统，也不包含私人人设、记忆规则、账号或
服务器信息。其他产品只需要调用 HTTP API，不必复制管家的业务逻辑。

## v0.4 已接通

- 多 Bot 独立启停、Token、白名单与一次性配对码。
- 每张 Bot 卡可选择 Telegram 或微信 ClawBot / iLink。微信使用手机扫码授权；
  私聊文字和微信随语音提供的转写进入同一人物、模型、外置记忆与 MCP 流程，
  支持访问配对、输入中提示、分句、图片、表情图片和音频文件回复。
- 可复用连接预设：Codex、Claude Code、Grok Build、OpenAI 兼容中转站、
  Anthropic 兼容接口和 Google Vertex AI。
- 每个 Bot 独立选择连接、模型和思考档位；聊天、声音和生图模型都由连接拉取后下拉选择，提供方没有目录接口时使用已保存或内置目录。
- Codex、Claude Code 与 Grok Build 连接可选“纯聊天”或“完整 Agent”。纯聊天默认
  隔离部署环境中的项目规则与编程环境，只注入 user 启用的非空人物模块、功能协议和明确放行的工具；Bot 页可
  预览管家实际组装的稳定提示、本轮动态骨架、工具和用量图表。
- 人物档案由任意数量的标题/正文模块组成；没有强制默认人格或渠道话术，每块可关闭保留，也可限制为仅私聊、仅 Telegram 或仅微信。
- 语音预设支持首选与多级备用线路：MiniMax、ElevenLabs、GPT-SoVITS、
  Vertex AI TTS 和本地 Edge TTS。
- 语音回复概率是真实发送门：`0%` 从不合成，`100%` 每轮尝试，中间值逐轮
  抽样；TTS 失败自动回退文字。
- 中文日期、时间、金额、百分比会在 TTS 前转成更自然的口语；ElevenLabs v4、
  v4 Turbo、v3 与
  Vertex/Gemini 可使用受控语气标签，标签不会显示在文字消息或写进记忆。
- Telegram 语音消息可经 ElevenLabs、OpenAI 兼容接口、Vertex/Gemini 或本机
  Whisper 转写，再进入同一条对话链。
- 生图预设支持首选与备用：Codex / Grok 订阅 CLI、OpenAI 兼容中转、Vertex、
  NovelAI 与 ComfyUI；发送 `/draw 画面描述` 调用。
- 通用 MCP 支持远程 Streamable HTTP 和本机 stdio；Bot 只看到勾选的连接和
  白名单工具。模型可先调工具再回答，也可用 `/tools`、`/tool` 手动调用。
- 通用外置记忆 HTTP / MCP 接口：首轮或长时间离线使用 `awakening`，普通接续使用
  `continuity`；群聊不会读取或写入私密记忆。
- 自动唤醒默认关闭，支持固定间隔或每轮重新抽取的随机区间、安静时段、成功冷却、
  每日上限、持久状态与 `[[SILENT]]` 主动沉默；Telegram 与微信都可按 Bot 配置。
- 连接预设可做无付费生成的自检；每个 Bot 的展示页会显示自动唤醒下一次尝试、
  最近结果和今日次数，并保留不含聊天正文的运行时间线。
- 表情包是可复用资源：上传一次后可分配给多个 Bot，各 Bot 独立开关与概率；
  模型只能从本轮相关候选中选择，发送前再次校验，不能编造资源 ID。
- 密钥与配置分离保存，控制 API 只返回 `hasSecret`，不会回传密钥正文。
- 手机与电脑可用的控制页，以及带 Bearer Token 的 HTTP API。
- 无运行时 npm 依赖；Node.js 22+ 即可。

微信通道不承诺原生语音气泡、群聊或无转写时的 SILK 语音解码；微信主动唤醒依赖
最近一次会话上下文，令牌失效时会记失败而不是宣称已送达。付款、结账和最终下单不会由模型自动执行；必须由人在 Telegram 中明确发送
`/tool`。当前未标记完成：图片引用/编辑、掉线主动通知、OAuth 可视化向导、
特定宿主前端的正式插件包。只有跑通真实链路的部分才算可用。

## 谁能使用

Bot 需要有一台持续在线、能运行 Node.js 的机器。它可以是云服务器、NAS、家中
电脑或小主机，不强制购买云服务器；只有手机和 Telegram、没有任何可持续运行
设备时，GitHub 仓库本身无法托管 Bot，也不能只放到 GitHub Pages。纯手机用户需要
把仓库部署到支持长期 Node 进程和持久磁盘的云平台，再用手机浏览器打开平台给出的
HTTPS 地址。通用 Docker 部署与纯手机路线见 [docs/deployment.md](./docs/deployment.md)。

## 启动

Windows 用户可以直接双击项目根目录的 **打开TG管家.cmd**。它会启动本地服务，
读取当前管理密码并打开浏览器。服务已启动时会复用，密码不会显示在终端中。

手动启动也可以：

```powershell
$env:TG_STEWARD_ADMIN_PASSWORD = "自己设置的长管理密码"
npm ci
node src/server.mjs
```

打开 `http://127.0.0.1:8788`，先建立连接预设，再在 Bot 页选择消息入口。Telegram
填写 BotFather Token；微信先保存 Bot 卡，再点“获取微信二维码”并用手机微信确认。
Token 也可继续由 `TELEGRAM_BOT_TOKEN` 提供给默认 Bot。若未设置管理密码，服务
会生成一个并保存在 `data/.admin-token`，控制台只显示文件路径。
全新部署不会预建 Codex、Claude 或其他提供方连接；连接页只显示“新建连接”。升级
已有部署时会保留原来的连接与 Bot 分配。

登录页里的“管理密码在哪里设置？”提供查找说明；它和 Telegram Bot Token、模型 Key
是不同的凭据。成功登录后，当前浏览器会记住这台设备；关闭标签页或浏览器再打开时
不必重输。公用设备可点击页头“退出”并确认“忘记本机登录”。栖光庭主题支持暂停动效，并遵循系统的减少动态效果设置。
主题资产及动效说明见 [docs/gentian-theme.md](./docs/gentian-theme.md)。

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `TG_STEWARD_ADMIN_PASSWORD` | 用户自己设置的控制页管理密码 |
| `TG_STEWARD_ADMIN_TOKEN` | 旧名称，继续兼容；密码变量优先 |
| `TG_STEWARD_AUTH_MODE` | 默认 `password`；仅本机回环地址可设为 `none` |
| `TELEGRAM_BOT_TOKEN` | 默认 Bot 的兼容环境变量，可不填 |
| `TG_STEWARD_HOST` / `TG_STEWARD_PORT` | 默认 `127.0.0.1:8788` |
| `TG_STEWARD_ALLOWED_ORIGINS` | 额外允许的前端来源，逗号分隔 |
| `TG_STEWARD_DATA_DIR` | 私有配置、密钥与会话目录 |
| `CODEX_COMMAND` / `CLAUDE_COMMAND` / `GROK_COMMAND` | CLI 可执行文件名或绝对路径 |

订阅型连接由用户在同一台机器上使用官方 CLI 自行登录；Docker 可通过
`INSTALL_SUBSCRIPTION_CLIS=1` 选择性安装 Codex 与 Grok Build CLI，并把登录目录
单独挂载持久化，详见 [部署说明](./docs/deployment.md#optional-codex-and-grok-build-subscription-image)。
API 型连接使用用户自己的 Key。项目不共享模型账号，也不读取网页登录 cookie。
模型出现在目录里只代表可选择，真实可用性仍以一次成功请求为准。

## API 与扩展

除 `/healthz` 与静态控制页外，API 默认都要求管理密码：

```http
Authorization: Bearer <management-password>
```

接口清单见 [docs/api.md](./docs/api.md)，模块结构见
[docs/architecture.md](./docs/architecture.md)，外置记忆契约见
[docs/memory-http.md](./docs/memory-http.md)。其他前端应通过薄适配器调用控制面 API，说明见
[docs/host-adapter.md](./docs/host-adapter.md)。当前实测范围见
[docs/validation.md](./docs/validation.md)，媒体、MCP 与唤醒配置见
[docs/media-tools-wake.md](./docs/media-tools-wake.md)，语音表现与表情包说明见
[docs/voice-and-stickers.md](./docs/voice-and-stickers.md)。
微信扫码通道的范围与限制见 [docs/wechat-clawbot.md](./docs/wechat-clawbot.md)。
CLI 聊天隔离边界与各引擎差异见 [docs/runtime-modes.md](./docs/runtime-modes.md)。

## 开发检查

```bash
npm test
npm run check
```

测试使用假 Telegram、假微信、假记忆与假模型响应，不会调用付费 API。
