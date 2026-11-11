# 栖光庭 · Telegram / WeChat Agent Steward


<img width="1533" height="1270" alt="acb67fd5-7e8c-4ff3-b6fd-80411eb84ce4" src="https://github.com/user-attachments/assets/73bfd3d4-9371-4fc0-af1a-d8ca5ea241f0" />

一个可自托管、可嵌入其他前端的多渠道 AI Bot 控制面。连接凭据集中保存一次，
多个 Bot 分别选择连接、模型、思考档位、人物、外置记忆、声音、生图与工具预设。
**栖光庭 / Lumenkeep** 是管理 Telegram 和微信 Bot 的控制台。可按需接入自己的外置记忆库。

由 TG Agent Steward contributors 维护。采用 [PolyForm Noncommercial 1.0.0](./LICENSE)：
允许个人和非商业用途使用、研究、修改与再分发修改版，禁止商业用途。本项目为源码公开的
非商业共享软件，不属于 OSI 定义的开源软件。

这是独立通用版，不依赖任何私人陪伴系统，也不包含私人人设、记忆规则、账号或
服务器信息。其他产品只需要调用 HTTP API，不必复制管家的业务逻辑。

## v0.4 已接通

- 多 Bot 独立启停、Token 与访问名单。Telegram 用户首次绑定自己的私聊，
  后续 Bot 可复用这个已验证账号。邀请其他人时使用一次性配对码。
- 每张 Bot 卡可选择 Telegram 或微信 ClawBot / iLink。微信使用手机扫码授权；
  私聊文字和微信随语音提供的转写进入同一人物、模型、外置记忆与 MCP 流程，
  支持访问配对、输入中提示、分句、表情图片和音频文件回复。
- 可复用连接预设：Codex、Claude Code、Grok Build、OpenAI 兼容中转站、
  Anthropic 兼容接口和 Google Vertex AI。
- 每个 Bot 独立选择连接、模型和思考档位。模型目录区分实时拉取、已保存和内置条目；
  Vertex 的「核验可用」可以发出测试请求，可能消耗该项目的用量。
- Codex、Claude Code 与 Grok Build 连接可选“纯聊天”或“完整 Agent”。纯聊天默认
  隔离部署环境中的项目规则与编程环境，只注入 user 启用的非空人物模块、功能协议和明确放行的工具；Bot 页可
  预览管家实际组装的稳定提示、本轮动态骨架、工具和用量图表。
- 人物档案由任意数量的标题/正文模块组成；没有强制默认人格或渠道话术，每块可关闭保留，也可限制为仅私聊、仅 Telegram 或仅微信。
- 语音预设支持首选与多级备用线路：MiniMax、ElevenLabs、GPT-SoVITS、
  Vertex AI TTS 和本地 Edge TTS。
- 日常语音回复按概率逐轮抽样，`/voice` 或「试试语音」可指定本轮用语音。
  微信发送可播放的音频文件。两端默认只发音频，合成或上传失败时回退文字。
- 中文日期、时间、金额、百分比会在 TTS 前转成更自然的口语；ElevenLabs v4、
  v4 Turbo、v3 与
  Vertex/Gemini 可使用受控语气标签，标签不会显示在文字消息或写进记忆。
- Telegram 语音消息可经 ElevenLabs、OpenAI 兼容接口、Vertex/Gemini 或本机
  Whisper 转写，再进入同一条对话链。
- Telegram 的生图预设支持首选与备用：Codex / Grok 订阅 CLI、OpenAI 兼容中转、
  Vertex、NovelAI 与 ComfyUI。Vertex API Key／赠金线路请在 Telegram 单独发送
  `/draw 画面描述`。部署时可选把 `/draw` 加到 Telegram 指令菜单，
  具体用法见 [媒体设置](./docs/media-tools-wake.md#telegram-command-menu)。
- 通用 MCP 支持远程 Streamable HTTP 和本机 stdio；每只 Bot 可以按连接开关
  单个工具。模型可先调工具再回答，也可用 `/tools`、`/tool` 手动调用。
- 通用外置记忆 HTTP / MCP 接口：首轮或长时间离线使用 `awakening`，普通接续使用
  `continuity`；群聊不会读取或写入私密记忆。
- 自动唤醒默认关闭，支持固定间隔或每轮重新抽取的随机区间、安静时段、成功冷却、
  每日上限、持久状态与 `[[SILENT]]` 主动沉默。Telegram 可直接选
  「我的 Telegram 私聊」或其他已授权会话；微信使用最近的会话上下文。
- 连接预设可做无付费生成的自检；每个 Bot 的展示页会显示自动唤醒下一次尝试、
  最近结果和今日次数，并保留不含聊天正文的运行时间线。
- 表情包是可复用资源：上传一次后可分配给多个 Bot，各 Bot 独立开关与概率；
  模型只能从本轮相关候选中选择，发送前再次校验，不能编造资源 ID。
- 密钥与配置分离保存，控制 API 只返回 `hasSecret`，不会回传密钥正文。
- 手机与电脑可用的控制页，以及带 Bearer Token 的 HTTP API。
- 使用 Node.js 22+，首次启动前通过 `npm ci` 安装扫码二维码依赖。

微信通道不承诺原生语音气泡、群聊或无转写时的 SILK 语音解码；微信主动唤醒依赖
最近一次会话上下文，令牌失效时会记失败而不是宣称已送达。付款、结账和最终下单不会由模型自动执行；必须由人在 Telegram 中明确发送
`/tool`。当前未标记完成：图片引用/编辑、掉线主动通知、OAuth 可视化向导。

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

打开 `http://127.0.0.1:8788`，先建立连接预设，再在 Bot 页选择消息入口。
Telegram 填写 BotFather Token 并保存，然后在 Bot 详情点「去 Telegram 绑定我」，
在 Telegram 私聊里点「开始」。已有绑定时点「允许我的 Telegram 账号」。
微信先保存 Bot 卡，再点「获取微信二维码」并用手机微信确认。
Token 也可继续由 `TELEGRAM_BOT_TOKEN` 提供给默认 Bot。若未设置管理密码，服务
会生成一个并保存在 `data/.admin-token`，控制台只显示文件路径。
全新部署不会预建 Codex、Claude 或其他提供方连接；连接页只显示“新建连接”。升级
已有部署时会保留原来的连接与 Bot 分配。

登录页里的“管理密码在哪里设置？”提供查找说明；它和 Telegram Bot Token、模型 Key
是不同的凭据。成功登录后，当前浏览器会记住这台设备；关闭标签页或浏览器再打开时
不必重输。公用设备可点击页头“退出”并确认“忘记本机登录”。栖光庭主题支持暂停动效，并遵循系统的减少动态效果设置。
主题资产及动效说明见 [docs/gentian-theme.md](./docs/gentian-theme.md)。

在 Telegram 或微信的 Bot 详情中点「开启新会话」，可选「带摘要」接续上一段的要点，或「不带摘要」从头聊。
「压缩会话」适合长聊后继续同一话题。Codex 支持原生压缩，其他连接可整理成摘要后续聊。
Telegram 私聊也可以单独发 `/new` 或 `/compact`。旧消息留在原聊天页，外置记忆按 Bot
配置加载。需要隔离旧记忆时，先断开记忆连接并关闭能查到旧内容的工具。

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

CLI 型连接使用部署环境里的官方程序与凭据。Docker 可通过
`INSTALL_SUBSCRIPTION_CLIS=1` 选择性安装 Codex 与 Grok Build CLI，并把登录目录
单独挂载持久化，详见 [部署说明](./docs/deployment.md#optional-codex-and-grok-build-subscription-image)。
Claude Code 需要在部署环境单独安装。使用 Claude API Key 时可选择 Anthropic 兼容连接。
Claude Code 自检只确认 CLI 可启动，账号和模型权限仍需单独验证。
API 型连接使用用户自己的 Key。项目不共享模型账号，也不读取网页登录 cookie。
模型出现在目录里只代表可选择，真实可用性仍以一次成功请求为准。

## 接入棉棉云小镇

在小镇的「插件中心 → 添加插件 → 从文件安装」导入[栖光庭插件包](./integrations/mimi-town/lumenkeep.mimi-app.json)。在栖光庭总览生成「小镇导入口令」，然后在插件里填写栖光庭地址和导入口令。连接后可选一位居民，把人设导入栖光庭的新人物档案。[使用说明](./integrations/mimi-town/README.md)

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
