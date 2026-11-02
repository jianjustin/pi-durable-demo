---
name: todo-report
description: Maintain a durable personal todo list and produce an accurate status report. Use when the user adds a todo, asks about unfinished work, or requests a todo report.
---

# Todo report

Use `add_todo` when the user explicitly asks to record a task or says they need to do something. Keep the title concise and preserve the user's intent.

Use `todo_report` when the user asks for their todo list, current tasks, unfinished work, or a progress report. Base the answer on the tool result, then give a short summary. Do not claim a task exists, is complete, or is overdue unless it appears in the report.

Each chat session owns an independent todo list. Do not assume todos from another session are present.
