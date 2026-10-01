import './style.css';

type Child = Node | string | null | undefined | false;

/** Crea un elemento. El texto siempre entra como textContent, nunca como HTML. */
export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Bloque de terminal con botón de copiar. */
export function codeBlock(cmd: string): HTMLElement {
  return h(
    'div',
    { class: 'flex items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 font-mono text-sm text-bone' },
    h('pre', { class: 'm-0 min-w-0 overflow-x-auto font-mono whitespace-nowrap [scrollbar-width:none]' }, h('span', { class: 'mr-2 text-peach/70 select-none' }, '$'), cmd),
    h('button', { type: 'button', class: 'shrink-0 rounded-full px-2.5 py-1 font-sans text-xs text-bone/60 hover:bg-bone/10 hover:text-bone', 'data-copy': cmd }, 'Copiar'),
  );
}

/** URL absoluta de la guía para agentes y el mensaje para pegarle a tu IA. */
export const agentMdUrl = new URL(`${import.meta.env.BASE_URL}docs/agentes.md`, location.origin).href;
export const agentPrompt = `Lee ${agentMdUrl} y sigue sus instrucciones para instalar Skynex en este proyecto.`;

/** Bloque con el mensaje para la IA y botón de copiar (texto, no comando). */
export function promptBlock(message = agentPrompt): HTMLElement {
  return h(
    'div',
    { class: 'flex items-start justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-bone' },
    h('div', { class: 'm-0 min-w-0 font-mono text-sm leading-relaxed text-bone break-words' }, message),
    h('button', { type: 'button', class: 'shrink-0 rounded-full px-2.5 py-1 font-sans text-xs text-bone/60 hover:bg-bone/10 hover:text-bone', 'data-copy': message }, 'Copiar'),
  );
}

/** Rellena cada [data-code="cmd1|cmd2"] con bloques de terminal. */
export function renderCodeBlocks(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-code]')) {
    el.replaceChildren(...(el.dataset.code ?? '').split('|').map(codeBlock));
  }
}

function wireCopy() {
  document.addEventListener('click', async (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('[data-copy]');
    if (!btn) return;
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy ?? '');
      btn.textContent = 'Copiado';
    } catch {
      btn.textContent = 'No se pudo copiar';
    }
    setTimeout(() => (btn.textContent = original), 1500);
  });
}

/** Marca el enlace de la página actual en la navegación. */
function markCurrentNav() {
  const base = import.meta.env.BASE_URL;
  const here = '/' + location.pathname.replace(/index\.html$/, '').slice(base.length);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-nav] a[data-page]')) {
    const page = a.dataset.page ?? '';
    // Las subpáginas (p. ej. /docs/agentes/) marcan su sección.
    if (page === here || (page !== '/' && here.startsWith(page))) a.setAttribute('aria-current', 'page');
  }
}

renderCodeBlocks();
for (const el of document.querySelectorAll<HTMLElement>('[data-agent-prompt]')) el.replaceChildren(promptBlock());
wireCopy();
markCurrentNav();
