import type { Step } from "./task.js";

export const INSTRUCTION_PATH_PATTERN = /^instructions\/step-\d{3}\.md$/;

export function instructionPathFor(stepId: string): string {
  return `instructions/${stepId}.md`;
}

export function renderInstruction(
  step: Pick<Step, "id" | "title" | "scope" | "doneWhen" | "expectedEvidence" | "dependsOn">,
  body?: string,
): string {
  const lines = [
    `# ${step.id} — ${step.title}`,
    "",
    `Alcance: ${step.scope}`,
    "",
    `Terminado cuando: ${step.doneWhen}`,
    "",
    `Evidencia esperada: ${step.expectedEvidence}`,
  ];
  if (step.dependsOn.length > 0) {
    lines.push("", `Depende de: ${step.dependsOn.join(", ")}`);
  }
  let rendered = `${lines.join("\n")}\n`;
  if (body !== undefined) {
    rendered += `\n${body}`;
    if (!rendered.endsWith("\n")) {
      rendered += "\n";
    }
  }
  return rendered;
}
