#!/usr/bin/env node
// Regenera src/data/changelog.json a partir del historial Git de Skynex.
// Uso: pnpm changelog [ruta-al-repo]   (por defecto el repo que contiene site/, o $SKYNEX_REPO)
// Agrupa los commits (sin merges) por etiqueta vX.Y.Z; lo posterior a la última
// etiqueta aparece como "Sin publicar".
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Por defecto, el repositorio que contiene site/ (skynex-v2).
const repo = resolve(process.argv[2] ?? process.env.SKYNEX_REPO ?? resolve(here, '../..'));
if (!existsSync(resolve(repo, 'packages/npm-cli/package.json'))) {
  console.error(`changelog: ${repo} no parece el repositorio de Skynex; pasa la ruta como argumento o en SKYNEX_REPO.`);
  process.exit(1);
}
const out = resolve(here, '../src/data/changelog.json');

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

function commits(range) {
  const raw = git('log', '--no-merges', '--date=short', '--pretty=format:%h%x1f%ad%x1f%s', range);
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      const [hash, date, subject] = line.split('\x1f');
      const m = SUBJECT.exec(subject);
      return m
        ? { hash, date, type: m[1].toLowerCase(), scope: m[2] ?? null, summary: m[3] }
        : { hash, date, type: 'other', scope: null, summary: subject };
    })
    .filter((c) => !(c.type === 'chore' && /^release\b/i.test(c.summary)));
}

const tags = git('tag', '--list', 'v*', '--sort=version:refname').split('\n').filter(Boolean);
const releases = tags.map((tag, i) => ({
  version: tag,
  date: git('log', '-1', '--format=%ad', '--date=short', tag),
  unreleased: false,
  changes: commits(i === 0 ? tag : `${tags[i - 1]}..${tag}`),
}));

const last = tags.at(-1);
const pending = commits(last ? `${last}..HEAD` : 'HEAD');
if (pending.length > 0) {
  releases.push({ version: 'Sin publicar', date: pending[0].date, unreleased: true, changes: pending });
}

releases.reverse();
writeFileSync(
  out,
  JSON.stringify({ source: 'skynex-v2', generatedAt: new Date().toISOString().slice(0, 10), releases }, null, 2) + '\n',
);
console.log(`changelog: ${releases.length} versiones, ${releases.reduce((n, r) => n + r.changes.length, 0)} cambios → ${out}`);
