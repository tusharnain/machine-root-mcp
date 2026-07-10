import type { z } from "zod";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
