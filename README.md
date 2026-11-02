# Pi Durable 使用 ChatGPT 订阅将对话保存在 SQLite 中

这个本地示例对应参考视频 02:12 的第一阶段：连接模型、完成对话，并检查 SQLite 中保存的消息和执行状态。按本项目要求，模型改为 **ChatGPT 订阅 + GPT-6.1 Sol**，通过 Pi 的 OpenAI OAuth 登录接入。

## 运行

需要 Node.js 22.19 或更新版本，以及 Pi 中的 ChatGPT 登录。依赖固定为 Pi 1.4.0；已有 `package-lock.json`，重新安装使用 `npm ci`。

```bash
cd /Users/chenjianrui/workspaces/pi-durable-demo
npm start
```

进入后会让你选择 **新开会话** 或 **恢复已有会话**；恢复时输入列表中的编号即可。每个会话有独立的上下文和历史。选择后可以连续聊天，每条消息回车发送。用下面三步验证会话保存：

1. 输入“你好”，等助手回复；再输入“请记住：我的演示口令是蓝鲸”，等第二次回复。
2. 输入 `/exit` 退出会话。
3. 再运行 `npm start`，选择“恢复已有会话”，再选择刚才会话的编号；它会显示这两轮完整消息，然后等待你继续输入。

```text
会话 1

已恢复历史对话：

你 > 你好
助手 > （第一轮回复）

你 > 请记住：我的演示口令是蓝鲸
助手 > （第二轮回复）

你 >
```

会话均保存在 `data/session.sqlite` 中，并按时间顺序显示历史。新开会话不会带入其他会话的上下文；恢复会话则会带入该会话全部已有消息。只进入和退出不会新增用户消息或请求模型；发送新消息时，已有对话会进入模型上下文。已有演示记录也会保留和显示。

也支持原来的单次提问：`npm start -- "你好"`，回答后退出。需要查看数据库记录时运行 `npm run inspect`。

## ChatGPT 登录和配置

默认复用 `~/.pi/agent/auth.json` 中的 OpenAI OAuth 登录，由 Pi 官方 `ModelRuntime` 管理文件锁和令牌续期。首次使用或登录失效时，运行 `pi`，输入 `/login`，选择 **OpenAI → Sign in with ChatGPT**。

登录凭据保留在 Pi 的登录文件中，不复制到项目或 SQLite。项目仅启用订阅登录；缺少该登录或只有 API key 时会报错。请求使用 ChatGPT 计划额度，额度规则见下方 OpenAI 官方说明。

`.env` 是本地配置，已被 Git 忽略；可参考 `.env.example`：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PI_MODEL` | `gpt-6.1-sol` | 使用的 OpenAI 对话模型 |
| `PI_DB_PATH` | `data/session.sqlite` | 数据库位置，相对路径以项目目录为基准 |
| `PI_AUTH_FILE` | `~/.pi/agent/auth.json` | Pi 登录文件位置 |

需要独立的新会话时，指定新的数据库文件，例如 `PI_DB_PATH=data/another.sqlite npm start -- "你好"`。同一份数据库同时只允许一个会话进程：重复启动会提示先退出原窗口。正常退出后可立即重新进入；强制结束进程后，可能需要等待 30 秒让锁过期。不要手动删除正在使用的锁目录。

## 代码与验证

| 文件 / 命令 | 作用 |
| --- | --- |
| `src/chat.ts` | 验证登录并进入交互会话，或执行单次提问 |
| `src/terminal.ts` | 显示历史、连续聊天、处理 `/exit` 和退出信号 |
| `src/agent.ts` | 打开持久化会话，读取历史，提交消息并读回已存储的回复 |
| `src/skills.ts` | 加载并校验项目内 Agent Skills，再作为稳定的系统提示区段交给 Pi Durable |
| `skills/todo-report/SKILL.md` | 管理待办、生成待办报告的可审阅 Skill 规则 |
| `src/todos.ts` | 会话级持久化待办文档，以及添加待办/生成报告的 Tool |
| `src/storage.ts` | 给数据库加进程锁，防止重复启动破坏会话状态 |
| `src/auth.ts` | 通过 Pi 官方接口接入 ChatGPT 订阅 |
| `src/inspect.ts` | 只读查询 SQLite 的记录数量、提交状态和对话文本 |
| `npm run check` | TypeScript 类型检查 |
| `npm test` | 使用本地模拟模型验证退出与重进、历史上下文、请求去重、重复启动保护、中断回复和登录方式限制 |

自动化测试不访问真实模型、不消耗订阅额度；真实请求通过 `npm start` 运行。`npm run inspect` 不调用模型，也不会创建一个不存在的数据库。

## Tool：查询当前时间

已注册只读的 `get_current_time` 工具。询问“现在几点？”或“上海现在时间？”时，模型会先调用它获取当前时间，再给出回答。终端会在模型选择工具后、工具执行前立即显示，例如：

```text
你 > 上海现在几点？
助手正在回复…
工具 > 正在调用 get_current_time({"timeZone":"Asia/Shanghai"})
助手 > 上海现在是 2026年11月2日（星期一）15:00（北京时间，UTC+8）。
```

每次调用都作为 SQLite 中独立的持久化任务保存；读取时钟没有外部副作用，因此异常恢复时允许安全重试。

## Skill：Todo report

项目 Skill 放在 `skills/<name>/SKILL.md`，遵循 Agent Skills 的 frontmatter 格式。启动时会显示 `已加载 Skill：todo-report`；该 Skill 的完整规则会作为持久化会话的系统提示加载。它规定“新增待办”时使用 `add_todo`，“请求待办报告”时使用 `todo_report`，并且不允许脱离工具结果虚构任务状态。

例如依次输入“帮我记一个待办：整理演示文档”和“给我待办报告”。两个 Tool 都会显示实时调用；待办数据保存于对应会话的 SQLite 文档中，退出并恢复该会话后仍可继续报告。由于本示例没有文件读取工具，Skill 说明在启动时加载，而不是由模型按需读取。

当前阶段**不会**开放执行命令、读写文件或网络访问。输入 `/exit`、按 Ctrl+C 或 Ctrl+D 可退出。两分钟超时只针对正在等待的单次回复，阅读历史和等待输入时不会自动退出。长任务被强制终止后的 `resume()` 恢复验证属于视频第四阶段，尚未覆盖。

## 来源

- [01Coder：用 Pi Durable 快速写一个 Agent，02:12 第一阶段](https://www.youtube.com/watch?v=glBpe4zilfE&t=132s)
- [Pi Durable 官方文档](https://github.com/earendil-works/pi/tree/main/packages/durable)
- [Pi AI 的 OAuth 和模型接口](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md#oauth-providers)
- [OpenAI：Sign in with ChatGPT 的计划额度与 Pi 开源集成](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
