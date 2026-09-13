# ScreenAtlas

ScreenAtlas is a responsive movie-discovery product built with React and Node.js. It gives people a way to browse without a specific title in mind, search the TMDB catalogue, filter by genre, change sort order, open a detail view, and keep a persistent wishlist.

## Run locally

Requirements: Node.js 18+ and a TMDB API key.

```bash
cd D:\movieproject
copy .env.example .env
# Add your TMDB v3 API key to .env
npm install
npm run dev
```

Open `http://localhost:5173`. The client runs on Vite and proxies `/api` requests to the Node server on port 4000.

TMDB is required. The application deliberately never invents or substitutes movie records: if TMDB is unavailable, the UI shows a retryable provider error instead of dummy titles.

## Approach and architecture

- The React client owns navigation, search state, filters, pagination, loading states, and responsive presentation.
- The Node/Express server is the only layer that talks to TMDB. It normalizes provider fields into a small application shape (`title`, `overview`, `posterUrl`, `rating`, `genres`, and so on), so the UI is not coupled to TMDB's response format.
- SQLite stores the wishlist locally in `screenatlas.sqlite`. The current product is intentionally single-user/local-first; the schema can gain a `user_id` column when authentication is introduced.
- A five-minute in-memory cache plus a persistent SQLite cache reduces duplicate calls when users revisit a page or change their mind quickly. TMDB requests use bounded timeouts and retries.
- The client ignores stale responses when a user changes filters quickly. Pagination is explicit via “Load more”, which preserves prior results and avoids rendering thousands of cards at once.

## API

- `GET /api/discover?page=1&sort=newest&genre=18`
- `GET /api/search?query=inception&page=1`
- `GET /api/movies/:id`
- `GET /api/wishlist`
- `POST /api/wishlist`
- `DELETE /api/wishlist/:id`
- `GET /api/health`

## Important decisions and assumptions

TMDB is used as the public movie source because it provides search, discovery, genre metadata, credits, videos, pagination, and poster/backdrop assets. The backend caps remote pagination at 500 pages and excludes adult results from discovery/search. Missing images, dates, ratings, and overviews are handled with safe UI defaults.

Wishlist records store a small snapshot of the movie card rather than depending on the provider being available every time the wishlist is opened. Detail data remains provider-backed and can show an error if the movie service is unavailable.

## Known limitations

- Wishlist persistence is local to one SQLite database and does not yet have accounts or multi-device sync.
- The current cache is local SQLite and is suitable for a single-instance deployment; a horizontally scaled deployment should move cache/session concerns to a shared store.
- The in-memory cache resets when the server restarts.
- TMDB image URLs are external and the app currently does not provide an image proxy or CDN transformation.

## What I would improve next

I would add authentication and per-user wishlists, a persistent cache (Redis), request rate limiting, richer discovery rails (similar movies, streaming availability), analytics for search-to-save conversion, and automated component/API tests. I would also add a virtualized grid if the product moves from page-based browsing to very large local result sets.

## AI assistance

AI was used to help generate initial project boilerplate, reason through TMDB integration details, and troubleshoot implementation structure. The product flow, normalized API contract, caching/fallback strategy, persistence model, and UI behavior were selected for this project and are documented here for review.
