# @deepseek-ai/dsh-web-search-tavily

A [Tavily](https://tavily.com)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Tavily's `POST /search` endpoint and maps the flat `results[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). It is a function/namespace plugin (`inject: ['web']`) that registers its backend.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$TAVILY_API_KEY` | Tavily API key. Empty/absent makes the provider unavailable. |
| `baseURL` | `https://api.tavily.com` | Endpoint base; `/search` is appended. An unparseable value makes the provider unavailable. |
| `searchDepth` | `basic` | Retrieval depth sent as Tavily's `search_depth`: `basic` or `advanced`. |
| `maxResults` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |
| `includeAnswer` | `false` | Request Tavily's generated answer and expose it as the result's `content`. |

```yaml
- id: web-search-tavily
  name: '@deepseek-ai/dsh-web-search-tavily'
  config:
    apiKey: !!js process.env.TAVILY_API_KEY
```

## Mapping

Each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `content`, `publishedAt` ← `published_date` (when present). A result without content keeps its URL and title rather than being dropped — URL-only citations are valid in the seam. When `includeAnswer` is set and Tavily returns an `answer`, it becomes the result's `content`; otherwise `content` is omitted. A request's `maxResults` wins over the configured `maxResults` default and is sent as Tavily's `max_results` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Known Limitations and Deferred Work

- **Tavily's other controls are not exposed** — `topic`, `days`, `include_raw_content`, and domain filters wait on provider-neutral Service Definition fields.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
