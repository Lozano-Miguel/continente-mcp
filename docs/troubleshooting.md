# Troubleshooting

Run `get_session_status` first: it shows whether credentials and saved cookies are present
without contacting the website.

| Symptom | What to do |
| --- | --- |
| `Executable doesn't exist` or the browser fails to start | Run `npx -y continentept-mcp install-browser`. On Linux, add `--with-deps` to install system libraries. |
| `not_authenticated` | Check that `get_session_status` reports credentials as configured, then run `continentept-mcp login` to test them. See [configuration](configuration.md). |
| Sign-in keeps failing | Run `continentept-mcp login --show-browser` to watch the browser and complete any extra verification the website asks for. |
| Status shows `authentication: unknown` | Nothing has been observed since the server started or since the saved session changed. Any account tool will establish it. |
| Favorites are stale or missing from search ranking | Call `list_favorites` with `refresh: true`, then search again. |
| `sale_rules_unknown` | The product's sale rules could not be interpreted. Check `get_product` and use the website for that product. |
| `quantity_below_minimum` or an off-step `invalid_input` | Use a quantity that fits the sale unit, minimum, maximum and step reported by `get_product`. |
| A cart change returned `mutation.outcome: "unknown"` | The cart may have changed. Call `get_cart` and decide from the actual contents. Do not repeat the change automatically. |
| `Multiple cart lines match this product` | Call `get_cart` and pass the intended line's `cartItemId`. |
| Order lines are `unavailable` or results are `partial` | Some pages could not be read. Read `failures` / `scanFailures`; missing data is never filled in. |
| `Invalid order history cursor` or `Order history changed` | Call `list_orders` again without a cursor. |
| `deadline_exceeded` or `queue_full` | Reduce `limit`, `detailLimit` or `orderLimit`, or wait for the previous call to finish. |
| Nothing appears on stdout when started by hand | Expected: stdout carries only MCP protocol messages. Logs are written to stderr. |

The website can change its pages at any time. If a tool starts failing with `invalid_data`,
please [open an issue](https://github.com/andredelgado/continente-mcp/issues) with the tool
name, error code and version. Do not include credentials, the saved session, order numbers or
page captures from your account.
