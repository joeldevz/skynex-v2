import changelog from './data/changelog.json';
import { h } from './shared';

type Change = { hash: string; date: string; type: string; scope: string | null; summary: string };
type Release = { version: string; date: string; unreleased: boolean; changes: Change[] };

type Kind = { label: string; group: 'feat' | 'fix' | 'other'; cls: string };
const KINDS: Record<string, Kind> = {
  feat: { label: 'Nuevo', group: 'feat', cls: 'bg-peach/70' },
  fix: { label: 'Corrección', group: 'fix', cls: 'bg-[#dfe8c6]' },
  refactor: { label: 'Mejora', group: 'other', cls: 'bg-rose/40' },
  docs: { label: 'Docs', group: 'other', cls: 'bg-ink/[0.06]' },
};
const OTHER: Kind = { label: 'Interno', group: 'other', cls: 'bg-ink/[0.06] text-stone' };
const kindOf = (t: string) => KINDS[t] ?? OTHER;

const FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'feat', label: 'Novedades' },
  { id: 'fix', label: 'Correcciones' },
  { id: 'other', label: 'Interno' },
] as const;

const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00`));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const releases = changelog.releases as Release[];

function render(filter: string) {
  const root = document.querySelector<HTMLElement>('[data-changelog]');
  if (!root) return;

  const visible = releases
    .map((r) => ({ r, changes: r.changes.filter((c) => filter === 'all' || kindOf(c.type).group === filter) }))
    .filter((x) => x.changes.length > 0);

  if (visible.length === 0) {
    root.replaceChildren(h('p', { class: 'text-stone' }, 'Todavía no hay cambios de este tipo.'));
    return;
  }

  root.replaceChildren(
    ...visible.map(({ r, changes }) =>
      h(
        'section',
        { class: 'grid gap-4 md:grid-cols-[11.5rem_1fr] md:gap-8', id: r.unreleased ? 'sin-publicar' : r.version },
        h(
          'header',
          { class: 'md:sticky md:top-24 md:self-start' },
          h('h2', { class: 'text-3xl tracking-tight' }, r.version),
          h('time', { class: 'mt-1 block font-mono text-xs text-stone', datetime: r.date }, r.unreleased ? 'en desarrollo' : formatDate(r.date)),
        ),
        h(
          'ul',
          { class: 'divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white/70' },
          ...changes.map((c) => {
            const k = kindOf(c.type);
            return h(
              'li',
              { class: 'flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5' },
              h('span', { class: `w-24 shrink-0 rounded-full px-2 py-0.5 text-center font-mono text-xs ${k.cls}` }, k.label),
              h('span', { class: 'min-w-0 flex-1' }, sentence(c.summary), c.scope && h('span', { class: 'ml-2 font-mono text-xs text-stone/80' }, c.scope)),
              h('a', { class: 'font-mono text-xs text-stone/70 hover:text-ink', href: `https://github.com/joeldevz/skynex-v2/commit/${c.hash}` }, c.hash),
            );
          }),
        ),
      ),
    ),
  );
}

function renderFilters() {
  const root = document.querySelector<HTMLElement>('[data-filters]');
  if (!root) return;
  const select = (id: string) => {
    for (const btn of root.querySelectorAll<HTMLButtonElement>('button')) {
      const active = btn.dataset.filter === id;
      btn.setAttribute('aria-pressed', String(active));
      btn.className = `rounded-full px-3.5 py-1 ring-1 transition ${active ? 'bg-ink text-bone ring-ink' : 'ring-ink/15 hover:bg-ink/5'}`;
    }
    render(id);
  };
  for (const f of FILTERS) {
    const btn = h('button', { type: 'button', 'data-filter': f.id }, f.label);
    btn.addEventListener('click', () => select(f.id));
    root.append(btn);
  }
  select('all');
}

const generated = document.querySelector('[data-generated]');
if (generated) generated.textContent = `Actualizado el ${formatDate(changelog.generatedAt)} desde ${changelog.source}.`;
renderFilters();
