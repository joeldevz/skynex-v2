# Skynex — página de producto

Vite 8 + TypeScript 7 + Tailwind CSS 4. Diseño inspirado en **Duna** (Mobbin). Ver `DESIGN.md`.

Páginas: `/` (beneficios), `/docs/` (documentación) y `/cambios/` (historial).

```sh
pnpm install
pnpm dev          # desarrollo
pnpm build        # tsc --noEmit + vite build → dist/
pnpm changelog    # regenera src/data/changelog.json desde el Git de skynex-v2
node scripts/paisaje.mjs  # regenera public/paisaje.svg
```

- Comandos y opciones de la documentación: `src/content.ts`.
- Changelog: `pnpm changelog [ruta-al-repo]` (por defecto este repositorio, o `$SKYNEX_REPO`).
  Agrupa commits por etiqueta `vX.Y.Z`; lo posterior a la última etiqueta aparece como «Sin publicar».

## Publicación

`.github/workflows/pages.yml` la publica en GitHub Pages en cada push a `main`
y en cada etiqueta `v*` (o a mano desde Actions). En CI se construye con `SITE_BASE=/skynex-v2/` y el changelog se
regenera desde el historial y las etiquetas del repositorio.

Esta carpeta no forma parte del workspace de pnpm del repo: instala con `pnpm install --ignore-workspace`.
