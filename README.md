# Continente MCP

[![CI](https://github.com/andredelgado/continente-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/andredelgado/continente-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/continentept-mcp)](https://www.npmjs.com/package/continentept-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants shop at
[Continente.pt](https://www.continente.pt): search products, check prices and sale rules,
read your favorites and past orders, and fill your cart. Checkout and payment always stay
on the website.

> **Unofficial.** This project is not affiliated with, endorsed by or supported by
> Continente or MC Sonae. It automates the public website with a headless browser, may break
> when the site changes, and should be used in line with the website's terms. You are
> responsible for anything placed in your cart.

## Features

- **Catalogue search and product details**, with exact prices, unit prices, availability and
  sale rules for weighted and bulk products.
- **Safe cart changes.** Every change is confirmed by reading the cart back. If a change
  cannot be confirmed, the result says so and tells the assistant to check the cart instead
  of retrying.
- **Your account**: favorites, order history and a ranking of the products you buy most.
- **Runs locally** over stdio. Credentials and cookies stay on your machine.
- **Built-in guidance.** The server tells the assistant the cart rules as soon as it
  connects, and offers a `basket-planner` prompt with the full shopping workflow. Nothing
  extra to install; the same guide also ships as a [skill](skills/basket-planner/SKILL.md).

## Requirements

- Node.js 22 or newer
- A Continente.pt account for account features (search and product details work without one)

## Quick start

**1. Install the browser** the server uses to talk to the website (one-time download):

```sh
npx -y continentept-mcp install-browser
```

On Linux, append `--with-deps` to also install the required system libraries.

**2. Save your credentials** in `~/.continentept-mcp/credentials.env` (see
[configuration](docs/configuration.md) for other options):

```sh
mkdir -p ~/.continentept-mcp && chmod 700 ~/.continentept-mcp
printf 'CONTINENTE_EMAIL=you@example.com\nCONTINENTE_PASSWORD=your-password\n' > ~/.continentept-mcp/credentials.env
chmod 600 ~/.continentept-mcp/credentials.env
```

Using 1Password? Skip the file and pass secret references through `op run` instead; see
[Using 1Password](docs/configuration.md#using-1password).

Optionally check that login works:

```sh
npx -y continentept-mcp login
```

**3. Add the server to your MCP client.**

Claude Code:

```sh
claude mcp add continente -- npx -y continentept-mcp
```

Claude Desktop, Cursor and other clients (`claude_desktop_config.json`, `mcp.json`, ...):

```json
{
  "mcpServers": {
    "continente": {
      "command": "npx",
      "args": ["-y", "continentept-mcp"]
    }
  }
}
```

To keep the credentials file elsewhere, add
`"env": { "CONTINENTE_CREDENTIALS_FILE": "/absolute/path/to/credentials.env" }`.

Then ask your assistant something like *"Add semi-skimmed milk and a dozen eggs to my
Continente cart"* or *"What do I usually buy? Build me a list for this week."*

## Tools

| Tool | What it does |
| --- | --- |
| `search_products` | Search the catalogue; favorites rank first |
| `get_product` | Price, availability and sale rules for one product |
| `list_favorites` | Your saved favorites (`refresh: true` fetches the latest) |
| `get_cart` | Cart lines, quantities and total |
| `add_cart_item` | Add an amount on top of what is in the cart |
| `set_cart_item_quantity` | Make the cart hold exactly a quantity; zero removes |
| `remove_cart_item` | Remove a line from the cart |
| `list_orders` | Recent orders with their product lines |
| `get_order` | One order's product lines |
| `list_frequently_bought_products` | Products ranked by how often you order them |
| `get_session_status` | Local login, cookie and cache state (no network) |

See the [tool reference](docs/tools.md) for inputs, outputs, error codes and limits.

### About uncertain cart changes

A cart change can fail after the request has reached the website, for example on a timeout.
In that case the result has `mutation.outcome: "unknown"` and asks the client to call
`get_cart` before doing anything else. The server never retries such a change on its own,
and clients should not either: repeating an `add_cart_item` could add the item twice.

### Guidance for the assistant

When a client connects, the server sends short instructions with these cart rules, so the
assistant follows them without any setup. For planning a shopping list, pick the
**basket-planner** prompt from your client's prompt or attachment menu, optionally with a
request such as "weekly basket for two".

The same guide is available as a skill in
[`skills/basket-planner`](skills/basket-planner/SKILL.md). Clients that support skills, such
as Claude Desktop (Settings → Capabilities → Skills) or Claude Code (`~/.claude/skills/`),
then apply it automatically whenever you ask about groceries.

## Command line

```text
continentept-mcp                    Start the MCP server on stdio
continentept-mcp login              Sign in and save the session (--show-browser to watch)
continentept-mcp install-browser    Download Chromium (extra arguments go to Playwright)
continentept-mcp --version
```

## Limitations

- One account per server process.
- Searches read at most five result pages and order listings at most ten pages, so very
  broad queries or long histories are reported as incomplete rather than read in full.
- Login handles the standard email and password flow. If the website asks for extra
  verification, run `continentept-mcp login --show-browser` and complete it in the browser
  window.
- There are no checkout, payment, delivery-slot or favorites-editing tools.

## Documentation

- [Tool reference](docs/tools.md)
- [Configuration](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
