import { agentMdUrl } from './shared';

// El mensaje para la IA lo pinta shared.ts en [data-agent-prompt].
const pre = document.querySelector<HTMLElement>('[data-md]');
const copyBtn = document.querySelector<HTMLButtonElement>('[data-copy-md]');

async function load() {
  try {
    const res = await fetch(agentMdUrl);
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (pre) pre.textContent = text;
    if (copyBtn) copyBtn.dataset.copy = text;
  } catch {
    if (pre) pre.textContent = 'No se pudo cargar agentes.md. Ábrelo con el enlace de arriba.';
    copyBtn?.remove();
  }
}

void load();
