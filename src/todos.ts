import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool } from "@earendil-works/pi-durable";

type Todo = { id: number; title: string; status: "open" };
type TodoState = { items: Todo[] };

export const Todos = defineDoc<TodoState>({
  kind: "demo.todos",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [] }),
  checkpointWhen: () => false,
});

export const addTodo = defineTool({
  name: "add_todo",
  description: "Add one task to the current conversation's durable todo list.",
  parameters: Type.Object({ title: Type.String({ minLength: 1, description: "A concise task title." }) }),
  executionMode: "sequential",
  // This changes state and has no idempotency key, so an interrupted call must not replay automatically.
  replay: "unsafe",
  execute: async ({ title }, api, context) => {
    const todo = await api.commit(async (tx) => {
      const state = await tx.doc(Todos, api.conversationId);
      const item = { id: state.items.length + 1, title: title.trim(), status: "open" as const };
      state.items.push(item);
      return item;
    }, context);
    return { output: [{ type: "text", text: `已添加待办 #${todo.id}：${todo.title}` }] };
  },
});

export const todoReport = defineTool({
  name: "todo_report",
  description: "Read the current conversation's durable todo list and return an accurate report.",
  parameters: Type.Object({}),
  executionMode: "sequential",
  replay: "safe",
  execute: async (_args, api, context) => {
    const state = await api.snapshot(Todos, api.conversationId, context);
    const items = state?.items ?? [];
    const body = items.length
      ? items.map((item) => `#${item.id} [待办] ${item.title}`).join("\n")
      : "当前没有待办。";
    return { output: [{ type: "text", text: `待办报告（${items.length} 项）\n${body}` }] };
  },
});
