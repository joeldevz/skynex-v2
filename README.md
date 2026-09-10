# Skynex v2

Skynex v2 is a ground-up TypeScript rewrite focused first on safely installing
canonical Skynex resources into AI coding engines.

The first target is OpenCode 2. The architecture deliberately separates:

- canonical, portable resource intent;
- target-specific transformation and native assets;
- transactional installation and user-controlled updates;
- future Skynex-owned capabilities such as a task graph.

## Status

Architecture bootstrap. The installer, transformers, and task graph are not yet
implemented.

## Development

Requires Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm check
pnpm build
pnpm start -- --help
```

See [`docs/README.md`](docs/README.md) for the product and implementation plan.

## License

Apache-2.0.
