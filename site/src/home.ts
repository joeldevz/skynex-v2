import { h } from './shared';

// --- Intro: si el usuario interactúa, se salta la animación --------------------

function wireIntroSkip() {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const skip = () => {
    document.body.classList.add('intro-skip');
    for (const ev of events) removeEventListener(ev, skip);
  };
  const events = ['wheel', 'keydown', 'touchstart', 'pointerdown'] as const;
  for (const ev of events) addEventListener(ev, skip, { passive: true, once: true });
  // Pasada la intro ya no hace falta escuchar.
  setTimeout(skip, 6000);
}

// --- Tareas en bucle -----------------------------------------------------------

type Step = { title: string; agent: string; evidence: string };
type Task = { title: string; steps: Step[] };

const TASKS: Task[] = [
  {
    title: 'Arreglar el inicio de sesión con Google',
    steps: [
      { title: 'Entender qué se pide', agent: 'thalam', evidence: 'riesgo medio → escribir primero el test' },
      { title: 'Encontrar dónde falla', agent: 'scout', evidence: 'auth/callback.ts:42 no guarda el estado' },
      { title: 'Escribir el test que lo demuestra', agent: 'test-engineer', evidence: '1 test en rojo por el motivo esperado' },
      { title: 'Corregir el código', agent: 'coder', evidence: '18 de 18 tests en verde' },
      { title: 'Revisar la seguridad', agent: '2 revisores', evidence: 'los dos, sin errores' },
    ],
  },
  {
    title: 'Exportar los informes a CSV',
    steps: [
      { title: 'Entender qué se pide', agent: 'thalam', evidence: 'riesgo bajo → cambio directo' },
      { title: 'Ver dónde encaja', agent: 'scout', evidence: 'reports/ReportTable.tsx:88, sin exportación' },
      { title: 'Añadir el botón y la descarga', agent: 'coder', evidence: 'export.ts nuevo, 64 líneas' },
      { title: 'Probarlo con datos reales', agent: 'verifier', evidence: 'CSV de 1.240 filas, se abre bien en Excel' },
      { title: 'Revisar el cambio', agent: 'pr-reviewer', evidence: 'ningún comentario bloqueante' },
    ],
  },
  {
    title: 'Rotar la clave de la API de pagos',
    steps: [
      { title: 'Entender qué se pide', agent: 'thalam', evidence: 'riesgo alto → pedir permiso antes de tocar nada' },
      { title: 'Confirmar el cambio', agent: 'tú', evidence: 'aprobado' },
      { title: 'Cambiar la clave', agent: 'infrastructure-engineer', evidence: 'clave nueva en el gestor de secretos' },
      { title: 'Revisar la seguridad', agent: '2 revisores', evidence: 'la clave antigua ya no aparece en el repo' },
      { title: 'Comprobar los pagos', agent: 'verifier', evidence: '3 pagos de prueba, los 3 correctos' },
    ],
  },
];

const CHECK = 'm4.5 10.5 3.5 3.5 7-8';

function checkbox(): HTMLElement {
  const box = h('span', { class: 'box mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 border-white/35' });
  box.innerHTML = `<svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="#1c1917" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK}"/></svg>`;
  return box;
}

function renderTask(card: HTMLElement, task: Task) {
  card.replaceChildren(
    h(
      'div',
      { 'data-body': '' },
      h(
        'div',
        { class: 'flex items-baseline justify-between gap-4' },
        h('figcaption', { class: 'text-lg font-medium tracking-tight' }, task.title),
        h('span', { class: 'shrink-0 font-mono text-xs text-bone/50', 'data-count': '' }, `0 de ${task.steps.length}`),
      ),
      h('div', { class: 'mt-4 h-0.5 overflow-hidden rounded-full bg-white/10' }, h('div', { class: 'task-progress h-full w-0 bg-peach', 'data-progress': '' })),
      h(
        'ol',
        { class: 'mt-1 divide-y divide-white/10' },
        ...task.steps.map((s) =>
          h(
            'li',
            { class: 'task-step flex gap-3 py-3', 'data-state': 'pending' },
            checkbox(),
            h(
              'div',
              { class: 'min-w-0' },
              h('p', {}, s.title, ' ', h('span', { class: 'font-mono text-xs text-bone/45' }, `· ${s.agent}`)),
              h('p', { class: 'working mt-0.5 font-mono text-xs text-peach' }, s.agent === 'tú' ? 'esperando tu respuesta…' : 'trabajando…'),
              h('p', { class: 'evidence mt-0.5 font-mono text-xs text-bone/65' }, s.evidence),
            ),
          ),
        ),
      ),
      h('p', { class: 'task-verdict mt-2 border-t border-white/10 pt-4 text-lg font-medium', 'data-verdict': '' }, h('span', { class: 'marker' }, 'Hecho, y con pruebas.')),
    ),
  );
}

function setProgress(card: HTMLElement, done: number, total: number) {
  const bar = card.querySelector<HTMLElement>('[data-progress]');
  const count = card.querySelector('[data-count]');
  if (bar) bar.style.width = `${(done / total) * 100}%`;
  if (count) count.textContent = `${done} de ${total}`;
}

function showFinished(card: HTMLElement, task: Task) {
  renderTask(card, task);
  for (const li of card.querySelectorAll<HTMLElement>('.task-step')) li.dataset.state = 'done';
  card.querySelector('[data-verdict]')?.classList.add('is-done');
  setProgress(card, task.steps.length, task.steps.length);
}

function wireTaskLoop() {
  const card = document.querySelector<HTMLElement>('[data-task-card]');
  const tabs = document.querySelector<HTMLElement>('[data-task-tabs]');
  if (!card || !tabs) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = false;
  let run = 0;

  // Espera que solo corre mientras la tarjeta está en pantalla y la pestaña visible.
  const wait = (ms: number, id: number) =>
    new Promise<boolean>((resolve) => {
      let left = ms;
      let last = performance.now();
      const tick = (now: number) => {
        if (id !== run) return resolve(false);
        if (visible && !document.hidden) left -= now - last;
        last = now;
        if (left <= 0) return resolve(true);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const tabButtons = TASKS.map((t, i) => {
    const btn = h(
      'button',
      { type: 'button', role: 'tab', class: 'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-ink/5 aria-selected:bg-white aria-selected:shadow-sm aria-selected:ring-1 aria-selected:ring-line' },
      h('span', { class: 'font-mono text-xs text-stone' }, `0${i + 1}`),
      h('span', { class: 'min-w-0 flex-1' }, t.title),
    );
    btn.addEventListener('click', () => select(i));
    tabs.append(btn);
    return btn;
  });

  const markTab = (i: number) => tabButtons.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));

  async function play(start: number, id: number) {
    for (let i = start; ; i = (i + 1) % TASKS.length) {
      const task = TASKS[i];
      markTab(i);
      renderTask(card!, task);
      const steps = [...card!.querySelectorAll<HTMLElement>('.task-step')];
      if (!(await wait(700, id))) return;
      for (const [n, li] of steps.entries()) {
        li.dataset.state = 'running';
        if (!(await wait(1100, id))) return;
        li.dataset.state = 'done';
        setProgress(card!, n + 1, steps.length);
        if (!(await wait(450, id))) return;
      }
      card!.querySelector('[data-verdict]')?.classList.add('is-done');
      if (!(await wait(3000, id))) return;
      card!.classList.add('is-leaving');
      if (!(await wait(380, id))) return;
      card!.classList.remove('is-leaving');
    }
  }

  function select(i: number) {
    run++;
    card!.classList.remove('is-leaving');
    if (reduced) {
      markTab(i);
      showFinished(card!, TASKS[i]);
      return;
    }
    void play(i, run);
  }

  new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting)), { threshold: 0.3 }).observe(card);
  select(0);
}

wireIntroSkip();
wireTaskLoop();
