import { commands, flags, installTabs, type Command } from './content';
import { codeBlock, h } from './shared';

function renderInstallTabs() {
  const tabs = document.querySelector<HTMLElement>('[data-tabs]');
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!tabs || !panel) return;

  const select = (id: string) => {
    for (const btn of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const active = btn.dataset.tab === id;
      btn.setAttribute('aria-selected', String(active));
      btn.className = `rounded-full px-3.5 py-1 ring-1 transition ${active ? 'bg-ink text-bone ring-ink' : 'ring-ink/15 hover:bg-ink/5'}`;
    }
    const tab = installTabs.find((t) => t.id === id) ?? installTabs[0];
    panel.replaceChildren(codeBlock(tab.command));
  };

  for (const t of installTabs) {
    const btn = h('button', { type: 'button', role: 'tab', 'data-tab': t.id }, t.label);
    btn.addEventListener('click', () => select(t.id));
    tabs.append(btn);
  }
  select(installTabs[0].id);
}

function renderTable(selector: string, rows: Command[]) {
  const root = document.querySelector(selector);
  if (!root) return;
  root.append(
    h(
      'dl',
      { class: 'divide-y divide-line bg-white/70' },
      ...rows.map((r) =>
        h(
          'div',
          { class: 'grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:gap-6' },
          h('dt', { class: 'font-mono text-sm break-words' }, r.cmd),
          h('dd', { class: 'text-sm text-stone' }, r.desc),
        ),
      ),
    ),
  );
}

// Resalta en el índice la sección visible.
function wireToc() {
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-toc] a')) links.set(a.hash.slice(1), a);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links.values()) a.classList.remove('text-ink', 'font-semibold');
        links.get(e.target.id)?.classList.add('text-ink', 'font-semibold');
      }
    },
    { rootMargin: '-20% 0px -70% 0px' },
  );
  for (const id of links.keys()) {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  }
}

renderInstallTabs();
renderTable('[data-commands]', commands);
renderTable('[data-flags]', flags);
wireToc();
