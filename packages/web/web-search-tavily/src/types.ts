/**
 * Wire types for the Tavily search API (`POST /search`).
 * @module @deepseek-ai/dsh-web-search-tavily/types
 */

/**
 * One search result returned by Tavily. `content` is a per-result summary the
 * provider produces (not raw page content unless requested); `published_date`
 * is an ISO-8601 string when the result carries one.
 */
export interface TavilyResult {
  /** Result title. */
  readonly title: string
  /** Canonical result URL. */
  readonly url: string
  /** Provider-generated content summary of the page. */
  readonly content?: string
  /** Relevance score assigned by Tavily. */
  readonly score?: number
  /** Publication date as an ISO-8601 string, when the endpoint reports one. */
  readonly published_date?: string
}

/**
 * The `POST /search` response envelope. `answer` is Tavily's generated answer
 * text, present only when the request set `include_answer`.
 */
export interface TavilySearchResponse {
  /** The query that produced these results. */
  readonly query: string
  /** Provider-generated answer text, when requested. */
  readonly answer?: string
  /** The ordered result list. */
  readonly results: readonly TavilyResult[]
}

/** A non-2xx error body as Tavily reports it. */
export interface TavilyError {
  /** Human-readable failure detail. */
  readonly message?: string
  /** Machine-routable detail when the provider supplies one. */
  readonly detail?: string
}
