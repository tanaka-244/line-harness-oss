import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
}

export function generateMcpConfig(options: McpConfigOptions): void {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");

  const newServerConfig = {
    command: "npx",
    args: ["-y", "@line-harness/mcp-server@latest"],
    env: {
      LINE_HARNESS_API_URL: options.workerUrl,
      LINE_HARNESS_API_KEY: options.apiKey,
    },
  };

  let mcpConfig: Record<string, any> = {};

  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }
  mcpConfig.mcpServers["line-harness"] = newServerConfig;

  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  p.log.success(".mcp.json に MCP 設定を追加しました");
}
