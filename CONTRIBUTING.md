# Contributing to Herdr Remote

## License

Herdr Remote is released under the **PolyForm Noncommercial 1.0.0** license
(see [LICENSE](LICENSE)). Contributions are accepted under the same terms.

By submitting a pull request, you agree that your contribution may be
distributed under this license and that the maintainer may offer a
commercial license for the software.

## Development

```bash
# Install dependencies
bun install --frozen-lockfile

# Run all checks
bun run verify

# Run tests
bun test
```

## Code standards

- No tests under `src/` — all tests live in `tests/`.
- All dependencies pinned to exact versions (no `^`, `~`, `latest`).
- `bun run verify` must pass before any commit.
- Errors are never masked — show the real cause.
- No implicit agent fallback — each agent has its own profile.

## Pull requests

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Run `bun run verify` and ensure all tests pass.
5. Submit a pull request with a clear description.

## Reporting issues

Use the GitHub issue tracker. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, browser, Herdr version)