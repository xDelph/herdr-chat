/**
 * Génère une session Pi synthétique de ~1,8 Mo pour le benchmark P01/P02.
 *
 * Usage: bun scripts/gen-fixture.ts [output_path]
 *
 * Le fichier est un JSONL Pi valide, en lecture seule. Aucune session
 * utilisateur n'est touchée.
 */
import { writeFileSync } from "node:fs";

const outputPath = process.argv[2] ?? "/tmp/herdr-fixture/session.jsonl";

const messages: string[] = [];
let size = 0;
const target = 1.8 * 1024 * 1024; // 1.8 Mo

const roles = ["user", "assistant", "toolResult"] as const;
const tools = ["read", "write", "edit", "bash", "grep", "find"];

let i = 0;
while (size < target) {
  const role = roles[i % roles.length]!;
  const entry = {
    id: `entry-${i}`,
    message: {
      content: [
        {
          text: `Message ${i}: ${"x".repeat(200 + (i % 500))}`,
          type: "text",
        },
      ],
      role,
      ...(role === "assistant"
        ? { model: "claude-sonnet-4-20250514", usage: { cost: { total: 0.001 * (i % 10) }, totalTokens: 100 + i } }
        : {}),
      ...(role === "toolResult" ? { toolName: tools[i % tools.length], toolCallId: `tc-${i}` } : {}),
    },
    parentId: i > 0 ? `entry-${i - 1}` : null,
    timestamp: new Date(Date.now() - (1000 - i) * 1000).toISOString(),
    type: "message",
  };
  const line = JSON.stringify(entry) + "\n";
  messages.push(line);
  size += line.length;
  i++;
}

writeFileSync(outputPath, messages.join(""));
console.log(`Generated ${messages.length} entries, ${(size / 1024).toFixed(0)} Ko → ${outputPath}`);