# HTTP API

默认情况下，所有 `/api/*` 接口要求把管理密码作为 Bearer Token。仅本机回环地址
明确启用 `TG_STEWARD_AUTH_MODE=none` 时免认证。JSON 正文限制为 1 MiB；跨域来源
必须精确写入 `TG_STEWARD_ALLOWED_ORIGINS`。

## 控制面

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/healthz` | 进程健康与 `authRequired`，无需认证 |
| GET | `/api/control-plane` | 不含密钥正文的完整公开配置与 Bot 运行态 |
| POST | `/api/connections` | 新建连接；可附 `secret`，仅写入密钥库 |
| PUT / DELETE | `/api/connections/:id` | 修改或删除；被引用时拒绝删除 |
| POST | `/api/connections/test` | Body `{ "connectionId": "..." }`，检查配置、CLI / 模型目录或 MCP 工具目录，不发起付费生成请求 |
| POST / PUT / DELETE | `/api/profiles[/:id]` | 管理人物档案，可保存空模块列表 |
| POST / DELETE | `/api/profile-block-templates[/:id]` | 保存或删除实例私有的常用规则模块 |
| POST / PUT / DELETE | `/api/voice-profiles[/:id]` | 管理声音预设 |
| POST / PUT / DELETE | `/api/image-profiles[/:id]` | 管理生图首选/备用线路 |
| POST / PUT / DELETE | `/api/sticker-packs[/:id]` | 管理可复用表情包；被 Bot 引用时拒绝删除 |
| POST / GET / DELETE | `/api/sticker-assets[/:id]` | 上传、读取或删除 PNG/JPEG 私有资源；被引用时拒绝删除 |
| POST / PUT / DELETE | `/api/bots[/:id]` | 管理 Bot；可附 `telegramToken`，仅写入密钥库 |
| POST | `/api/wechat/login/start` | Body `{ "botId": "..." }`，获取微信扫码二维码 |
| GET | `/api/wechat/login/status?botId=...` | 查询扫码状态；确认后凭据直接写入密钥库 |
| POST | `/api/wechat/login/verify` | Body `{ "botId": "...", "code": "..." }`，提交手机微信显示的扫码校验数字 |
| DELETE | `/api/wechat/account?botId=...` | 解除指定 Bot 的微信扫码授权 |
| GET | `/api/models?connectionId=...&purpose=chat` | 拉取指定连接的模型与档位；`purpose` 可为 `chat`、`tts`、`stt` 或 `image` |
| GET | `/api/mcp/tools?connectionId=...` | 发现一个 MCP 连接的工具 |
| GET | `/api/bot-diagnostics?botId=...` | 查看运行模式、唤醒状态、运行时间线、管家注入预览、放行工具和最近用量 |
| POST | `/api/pairing-code` | Body `{ "botId": "..." }`，生成十分钟一次性配对码 |
| POST | `/api/telegram/owner-access` | 用已绑定的本人账号授权此 Bot，或生成十分钟有效的私聊绑定链接 |
| GET | `/api/telegram/owner-access?botId=...` | 查询是否已绑定本人及此 Bot 是否已放行 |
| POST | `/api/wake/run` | Body `{ "botId": "..." }`，手动触发一次唤醒 |
| POST | `/api/wake/tick` | 立即执行一次到期检查，主要供运维验证 |

连接、Bot、声音、生图、表情包和人物是独立资源。Bot 只保存资源 ID，不会复制凭据或
人物正文。

删除被引用的预设会返回 `409`，响应会列出引用者。表情包删除只移除该包的配置，
原图使用独立的资源接口管理。常用模块随 `GET /api/control-plane` 的
`profileBlockTemplates` 返回，包含标题、正文、启用状态、渠道和会话范围。
人物编辑器加入常用模块时创建独立副本。

Bot 的 `tools.disabledByConnection` 按连接 ID 保存关闭的工具名数组。它和
`tools.allowedToolNames` 白名单同时生效。Telegram 使用
`voice.telegramSendTextWithVoice` 选择是否同时发正文，微信使用
`voice.wechatSendTextWithVoice`。两端默认关闭。

Vertex 使用 API Key 时，常规模型请求展示按用途整理的候选。给 `GET /api/models`
加 `verify=1`，或给 `POST /api/models/preview` 加 `"verify": true`，即可在当前
连接上用免费 `countTokens` 检查候选。返回的 `source: "verified"` 表示通过
计数接口的模型，生成权限和配额以实际请求为准。OAuth 连接可读取 Google 发布者目录。

连接自检结果会写回连接的 `lastTest`，不修改连接更新时间。名称或缓存目录变化时
保留结果，地址、类型、凭据或连接设置变化时清除结果。自检状态只描述当次检查：
`passed` 表示相应探测已通过，`warning` 表示只完成了部分检查，`failed` 表示
缺少必要设置或探测失败。Bot 时间线最多保留最近 80 条运行元数据，错误会脱敏，
不保存用户消息或模型回复正文。

表情图片上传正文允许到 3 MiB，解码后的单张图片限制为 2 MiB。服务端按文件
魔数核对 PNG/JPEG，不接受客户端传入的任意磁盘路径。

## 会话

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/session/status?chatId=...` | 查询默认 Bot 的会话映射 |
| POST | `/api/session/new` | Body `{ "chatId": "...", "botId": "...", "carrySummary": true }`。`carrySummary` 默认为 `false`，设为 `true` 时整理上一段摘要后重开。没有上文时返回 `ok: false`，整理失败时保留当前会话。 |
| POST | `/api/session/compact` | 同上，等原生压缩结束或保存交接摘要 |
| POST | `/api/session/stop` | 中断当前生成 |

`/api/status`、`/api/settings` 和旧版人物接口暂时保留，供 v0.1 客户端迁移；新
前端应使用 `/api/control-plane` 与资源接口。

## 密钥规则

- `secret`、`telegramToken` 与微信扫码账号凭据只写不读；响应只返回
  `hasSecret`、`hasTelegramToken` 或 `hasWechatAccount`。
- 更新时留空表示保留原值。
- 删除连接或 Bot 时会删除对应密钥；仍被引用的连接不能删除。
