# moviesHUB

moviesHUB is a full-stack movie discovery product built to feel like a focused streaming-platform experience rather than a thin API demo. It helps viewers discover movies without knowing a title first, search the TMDB catalogue, browse by genre, change ordering, open rich details, and save a persistent personal wishlist.

The project was designed around the evaluation brief: real third-party data, a backend abstraction layer, resilient loading/error states, efficient pagination, responsive UI, and a clear separation between provider data and application-owned data.

## Product highlights

- Discovery homepage with latest-first browsing and an `Explore a theme` award-worthy collection.
- One global search field for movie titles, people, and genre terms.
- Browser-to-backend communication only; the browser never calls TMDB directly.
- Genre chips, popularity/rating/newest ordering, and explicit `Load more` pagination.
- Movie details with normalized metadata, genres, runtime, cast, backdrop, and available YouTube trailer links.
- Persistent SQLite wishlist that survives refreshes, server restarts, and reopening the application.
- Context-preserving navigation from cards to details and back to the originating browse/search view.
- Loading skeletons, empty states, retryable provider errors, poster fallbacks, and responsive layouts.
- No fabricated movie catalogue: without TMDB data or a real cached response, the UI shows an honest empty/error state.

## Technology

- Frontend: React 18, React Router, Vite, responsive CSS.
- Backend: Node.js, Express, CORS, `dotenv`.
- Persistence/cache: SQLite through `better-sqlite3`.
- Movie provider: TMDB v3 API.
- Runtime: Node.js 18+.

## Run locally

### Prerequisites

- Node.js 18 or newer.
- A TMDB v3 API key.

### Setup

```powershell
cd D:\movieproject
Copy-Item .env.example .env
# Edit .env and set TMDB_API_KEY to your TMDB v3 key
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The development command starts both services:

- Vite frontend: `http://localhost:5173`
- Express API: `http://localhost:4000`

Vite proxies `/api` requests to Express. For a production-style build check:

```powershell
npm run build
npm start
```

Useful health check: [http://localhost:4000/api/health](http://localhost:4000/api/health).

## Architecture

```text
React UI
  │  /api requests, route state, abortable fetches
  ▼
Node/Express API
  │  validation, normalization, caching, retry/timeout policy
  ▼
TMDB API ───────────────► normalized movie DTOs ─────► React cards/details

React wishlist actions ─► Express ─► SQLite wishlist table
                              │
                              └────► SQLite movie cache
```

The frontend is provider-agnostic. It consumes a small application DTO instead of knowing TMDB field names such as `poster_path`, `vote_average`, or `genre_ids`. Provider-specific decisions stay behind one backend boundary.

### Frontend structure

- `src/main.jsx` owns routing, shared wishlist state, search/filter state, fetch cancellation, pagination, and the reusable movie-card/detail flows.
- `src/styles.css`, `src/theme.css`, and supporting CSS files define the responsive visual system and component states.
- `public/poster-fallback.svg` is an image-only fallback for incomplete provider assets; it never creates a fake movie record.

### Backend structure

- `server/index.js` owns TMDB communication, normalization, error handling, cache reads/writes, and wishlist routes.
- `screenatlas.sqlite` is the local SQLite database file created by the server. Its name is an internal legacy filename; the product and UI branding are `moviesHUB`.
- The schema is created on startup and contains `wishlist` (movie card snapshots) and `movie_cache` (provider payloads, keys, and expiry timestamps).

## API contract

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/discover?page=1&sort=newest&genre=18&theme=award-winning` | Paginated discovery, genre filtering, sorting, and themes |
| GET | `/api/search?query=inception&page=1` | Movie-first search with controlled person/genre enrichment |
| GET | `/api/movies/:id` | Normalized detail, credits, and trailer metadata |
| GET | `/api/wishlist` | Load the persistent local wishlist |
| POST | `/api/wishlist` | Save a movie card snapshot |
| DELETE | `/api/wishlist/:id` | Remove a saved movie |
| GET | `/api/health` | Provider configuration and service health |

### Normalized movie shape

```json
{
  "id": 27205,
  "title": "Inception",
  "overview": "…",
  "posterUrl": "https://image.tmdb.org/t/p/w500/…",
  "backdropUrl": "https://image.tmdb.org/t/p/w1280/…",
  "releaseDate": "2010-07-16",
  "rating": 8.8,
  "genres": ["Action", "Sci-Fi"],
  "runtime": 148,
  "cast": [],
  "trailerKey": null
}
```

## Important technical decisions

### Real provider data without fake content

TMDB is the source of movie truth. The app does not substitute a locally invented film catalogue when TMDB fails. Future/unreleased titles are excluded from discovery responses, and incomplete fields are represented safely as `null`, empty lists, or clearly worded UI placeholders.

### Caching and repeated requests

The server uses a short in-memory cache backed by SQLite. Repeated discovery, search, and detail requests do not call TMDB every time. Cache keys include page, sort, genre, theme, or movie ID. Cache versioning prevents stale responses from an older data strategy being reused.

If TMDB is temporarily unavailable, previously fetched real provider data may be served as stale cache. If no real cached response exists, the API returns a retryable `503` rather than misleading content.

### Slow networks and rapid user changes

- TMDB calls use bounded timeouts, retries, and a Windows-compatible transport fallback.
- Frontend fetches use `AbortController`, so an older response cannot overwrite the current screen after a query/filter change.
- Results are page-based and appended only when the user requests more.
- Search and filter changes reset page and result context.

### Search behavior

The backend prefers TMDB movie search results for title-like queries. When a direct movie search has no results, it can enrich through TMDB multi-search people and discover movies associated with those people. This makes actor/director searches useful without polluting strong title matches.

### Wishlist ownership

The wishlist stores a compact snapshot of the real movie card in SQLite. A saved shelf remains readable during a provider outage, while fresh detail pages remain provider-backed. The current app is intentionally single-user/local-first; authentication and a `user_id` column would be the next step for a multi-user deployment.

## Requirements coverage

| Brief requirement | Implementation |
| --- | --- |
| Browse without searching | Latest-first discovery feed and theme collection |
| Search movies | Global header search through `/api/search` |
| Categories/attributes | Genre chips, ratings, release dates, theme filter |
| Change ordering | Newest, most popular, and top rated controls |
| Continue through large results | TMDB pagination plus `Load more` |
| Movie details | Normalized detail route with cast/trailer metadata |
| Persistent wishlist | SQLite-backed GET/POST/DELETE API and UI state |
| Preserve navigation context | Router state carries the originating browse/search URL |
| Loading/empty/error feedback | Skeletons, empty states, retryable errors, image fallbacks |
| Responsive behavior | Adaptive grid, mobile search behavior, resilient poster sizing |
| Backend abstraction | Browser calls Express only; Express maps TMDB into DTOs |

## Assumptions

- The evaluator provides a valid TMDB API key in `.env`.
- A single local user is sufficient for this submission, so authentication is not included.
- TMDB remains authoritative for title, release, rating, genre, cast, and trailer metadata.
- Wishlist snapshots are acceptable for shelf access and are not a second movie catalogue.
- “Latest” means provider primary-release-date ordering, with future release dates excluded.

## Known limitations

- Wishlist is local to one SQLite file and has no account, cloud sync, or multi-device merge.
- Cache is local to one Node process/database. A horizontally scaled deployment should use shared caching and coordinated rate limiting.
- TMDB image URLs are external; there is no image proxy/CDN layer yet.
- Search and discovery quality depends on TMDB metadata and availability. A provider outage with no cached page correctly produces a retryable error.
- Automated browser/component tests are not yet included; current verification is build, syntax, API smoke testing, and manual responsive review.

## Verification performed

```powershell
npm run build
node --check server/index.js
git diff --check
```

The live API was smoke-tested for real TMDB discovery, theme, genre filtering, search, and normalized detail responses. The UI was reviewed for loading states, retry behavior, responsive cards, global search, wishlist persistence, and context-preserving detail navigation.

## What I would improve with more time

1. Add authentication, per-user wishlists, and cloud sync.
2. Add unit/API/component tests and Playwright coverage for the main discovery journeys.
3. Add rate limiting, request metrics, structured logging, and Redis for multi-instance deployment.
4. Add richer streaming-product rails such as similar movies, watch providers, cast pages, and personalized recommendations.
5. Add an image proxy/CDN strategy, stronger accessibility auditing, and virtualization for very large result sets.
6. Split the large route component into feature modules and add a typed shared API contract.

## AI assistance

AI tools were used as development support to understand TMDB API behavior, generate initial boilerplate, explore error-handling approaches, troubleshoot Windows networking, review edge cases, and improve documentation. The product scope, API boundary, data model, caching policy, persistence decision, no-fake-data rule, and UX decisions were selected for this project and verified against the implementation.

## Repository submission

The repository contains the React frontend, Node.js backend, SQLite schema initialization, environment template, README, and Git history. The application is ready to run locally with the setup above.
