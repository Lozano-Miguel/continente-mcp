# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Update notice: once a day the server checks npm for a newer release and, if there is one, tells the assistant and reports it in `get_session_status`. Offline-safe; turn it off with `CONTINENTE_UPDATE_CHECK=0`.

## [0.3.1] - 2026-10-15

### Added

- Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.andredelgado/continente-mcp`, with both the npm package and the Claude Desktop extension. Every release updates the listing.

## [0.3.0] - 2026-10-15

### Added

- One-click Claude Desktop extension (`continente-mcp.mcpb`) attached to every release. It asks for your email and password at install time.
- Chromium downloads automatically the first time it is needed; `install-browser` is now optional. While it downloads, tools return a retryable `browser_unavailable` error explaining the wait.

## [0.2.0] - 2026-10-15

### Added

- Server instructions: assistants receive the cart rules (exact totals, one change at a time, check the cart after an uncertain change) as soon as they connect.
- A `basket-planner` prompt with the full shopping workflow, with an optional request to plan for. No skill install is needed.
- Documentation for supplying credentials from 1Password with `op run`.

### Changed

- The `basket-planner` skill links to the online tool reference, so it also works when uploaded on its own.

## [0.1.0] - 2026-10-15

### Added

- Catalogue search and product details with exact prices, availability and sale rules.
- Cart tools that confirm every change by reading the cart back and report uncertain changes instead of retrying them.
- Favorites, order history and a ranking of frequently bought products.
- Automatic sign-in from environment variables or a private credentials file, and a `login` command.
- The `basket-planner` skill for planning a shopping list and updating the basket.

[Unreleased]: https://github.com/andredelgado/continente-mcp/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/andredelgado/continente-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/andredelgado/continente-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/andredelgado/continente-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andredelgado/continente-mcp/releases/tag/v0.1.0
