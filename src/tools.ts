import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

export const getCurrentTime = defineTool({
  name: "get_current_time",
  description: "获取指定时区的当前日期和时间。用户询问当前时间、日期或时区时间时使用。",
  parameters: Type.Object({
    timeZone: Type.Optional(Type.String({ description: "IANA 时区，例如 Asia/Shanghai；省略时使用本机时区。" })),
  }),
  // Reading the clock has no external side effect, so recovery may safely run it again.
  replay: "safe",
  execute: async ({ timeZone }) => {
    let text: string;
    try {
      text = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "full",
        timeStyle: "long",
        ...(timeZone ? { timeZone } : {}),
      }).format(new Date());
    } catch {
      throw new Error(`无效的 IANA 时区：${timeZone}`);
    }
    return { output: [{ type: "text", text: `当前时间：${text}${timeZone ? `（${timeZone}）` : "（本机时区）"}` }] };
  },
});
