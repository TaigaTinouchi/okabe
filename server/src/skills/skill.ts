import type { ToolDef } from "../llm/provider";

/**
 * スキル（プラグイン）の縫い目。
 * 各スキルは独立モジュールとして tool 定義と実行を提供する。
 * ルーティングは LLM の tool use によるインテント判定で行い、
 * どのツールにも該当しなければ通常の会話応答にフォールバックする（＝何もしなくてよい）。
 * jobs（定期実行の登録）は M4 でここに追加する。
 */
export interface Skill {
  name: string;
  tools: ToolDef[];
  /** ツールを実行し、tool_result として LLM に返す文字列（通常は JSON）を返す */
  execute(toolName: string, input: unknown): Promise<string>;
}

/** 全スキルのツールを集約し、tool 名から担当スキルへルーティングする */
export class SkillRegistry {
  private readonly byToolName = new Map<string, Skill>();
  readonly tools: ToolDef[] = [];

  constructor(skills: Skill[]) {
    for (const skill of skills) {
      for (const tool of skill.tools) {
        if (this.byToolName.has(tool.name)) {
          throw new Error(`duplicate tool name: ${tool.name}`);
        }
        this.byToolName.set(tool.name, skill);
        this.tools.push(tool);
      }
    }
  }

  get isEmpty(): boolean {
    return this.tools.length === 0;
  }

  async execute(toolName: string, input: unknown): Promise<string> {
    const skill = this.byToolName.get(toolName);
    if (!skill) throw new Error(`unknown tool: ${toolName}`);
    return skill.execute(toolName, input);
  }
}
