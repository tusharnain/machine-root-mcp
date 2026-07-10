import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";

const Schema = z.object({
  command: z.string().min(1).describe("Shell command to execute"),
  cwd:     z.string().optional().default("/home/superbot/Documents/workspace").describe("Working directory"),
  timeout: z.number().int().min(1).max(300).optional().default(60).describe("Timeout in seconds (default 60, max 300)"),
});

function run(command: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], { cwd });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ stdout, stderr: stderr + `\n[killed: ${timeoutMs / 1000}s timeout]`, code: -1 });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

export const runCommandTool: Tool = {
  name: "run_command",
  description: "Run any shell command. Full access — git, npm, pnpm, cat, grep, rg, find, sed, tee, whatever. Use cwd to set the working directory.",
  schema: {
    command: z.string().min(1).describe("Shell command to execute"),
    cwd:     z.string().optional().default("/home/superbot/Documents/workspace").describe("Working directory"),
    timeout: z.number().int().min(1).max(300).optional().default(60).describe("Timeout in seconds (default 60, max 300)"),
  },
  async execute(raw): Promise<ToolResult> {
    try {
      const args = Schema.parse(raw);
      const { stdout, stderr, code } = await run(args.command, args.cwd, args.timeout * 1000);

      const out = [
        stdout && `[stdout]\n${stdout.trimEnd()}`,
        stderr && `[stderr]\n${stderr.trimEnd()}`,
      ].filter(Boolean).join("\n\n");

      return { content: [{ type: "text", text: `$ ${args.command}  (exit ${code})\n\n${out || "(no output)"}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  },
};
