# Configuration

Settings come from environment variables and an optional private credentials file. They are
read when the server starts.

## Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONTINENTE_EMAIL` | — | Account email, used for automatic sign-in. Not needed for search or product details. |
| `CONTINENTE_PASSWORD` | — | Account password. |
| `CONTINENTE_CREDENTIALS_FILE` | `<data dir>/credentials.env` | Location of the credentials file. Set this in the MCP client configuration. |
| `CONTINENTE_DATA_DIR` | `~/.continentept-mcp` | Directory for the saved session, the favorites snapshot and, by default, the credentials file. |
| `CONTINENTE_BROWSER_IDLE_SECONDS` | `300` | Close the browser after this many idle seconds. `0` keeps it open until the server stops. |

On Windows, `~` is `%USERPROFILE%`.

## Credentials file

Instead of putting your password in the MCP client configuration, store it in a private
file, by default `~/.continentept-mcp/credentials.env`:

```sh
CONTINENTE_EMAIL=you@example.com
CONTINENTE_PASSWORD=your-password
```

One `KEY=value` per line. Quotes around a value are removed, `export ` prefixes and `#`
comment lines are allowed, and nothing is expanded. The file may set `CONTINENTE_EMAIL`,
`CONTINENTE_PASSWORD` and `CONTINENTE_BROWSER_IDLE_SECONDS`; other keys are ignored. A variable
set in the environment always wins over the file, even when it is empty. See
[`.env.example`](../.env.example).

Restrict access to the directory, since the saved session also grants access to the account:

```sh
chmod 700 ~/.continentept-mcp
chmod 600 ~/.continentept-mcp/credentials.env
```

On Windows, limit the folder's permissions to your user account.

## Sign-in and saved session

Account tools reuse the saved session. When the website reports that it has expired, the
server signs in once with the configured credentials and retries the read. Cart changes are
never retried after they may have been sent.

To sign in ahead of time, or to check your credentials:

```sh
npx -y continentept-mcp login
```

Add `--show-browser` to watch the browser window. If the website asks for extra verification,
complete it in that window; the session is saved once the account is signed in.

## Stored data

| File in the data directory | Contents |
| --- | --- |
| `session.json` | Website session cookies. Treat it like a password. |
| `favorites.json` | Favorites snapshot, tied to the configured account and current session. |
| `favorites.json.bak` | Previous valid favorites snapshot. |

Files are written atomically and readable only by your user. A new session or a different
account makes the favorites snapshot stale until it is refreshed. Delete the directory to
remove everything the server has stored.

One server process serves one account.
