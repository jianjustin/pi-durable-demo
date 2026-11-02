import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { projectDir } from "./config.ts";

/**
 * Pi Durable does not automatically load Pi Coding Agent skills. This bridge
 * validates project-local Agent Skills files, then adds their instructions as a
 * stable prompt section because this demo deliberately has no file-reading tool.
 */
export async function loadProjectSkillInstructions() {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: join(projectDir, "skills"),
    source: "project",
  });
  if (diagnostics.length) {
    throw new Error(`项目 Skill 无法加载：${diagnostics.map((item) => item.message).join("；")}`);
  }
  if (skills.length === 0) throw new Error("项目中没有可用的 Skill。");
  const rendered = await Promise.all(skills.map(async (skill) => {
    const instructions = await readFile(skill.filePath, "utf8");
    return `<skill name="${skill.name}">\n${instructions.trim()}\n</skill>`;
  }));
  return rendered.join("\n\n");
}
