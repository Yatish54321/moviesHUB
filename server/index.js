import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const app = express();
const port = Number(process.env.PORT || 4000);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const db = new Database('screenatlas.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS wishlist (
  movie_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  poster_path TEXT,
  backdrop_path TEXT,
  release_date TEXT,
  vote_average REAL,
  genres TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS movie_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`);

app.use(cors());
app.use(express.json());

const cache = new Map();
const movieIndex = new Map();
const CACHE_TTL = 1000 * 60 * 5;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const genreMap = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller', 10752: 'War', 37: 'Western' };

function normalize(movie, detail = false) {
  return {
    id: movie.id,
    title: movie.title || movie.name || 'Untitled',
    overview: movie.overview || 'No synopsis is available for this title yet.',
    posterUrl: movie.poster_path ? `${IMG}/w500${movie.poster_path}` : null,
    backdropUrl: movie.backdrop_path ? `${IMG}/w1280${movie.backdrop_path}` : null,
    releaseDate: movie.release_date || movie.first_air_date || null,
    rating: Number(movie.vote_average || 0),
    genres: detail ? (movie.genres || []).map(g => g.name) : (movie.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
    runtime: movie.runtime || null,
    tagline: movie.tagline || null,
    cast: detail ? (movie.credits?.cast || []).slice(0, 8).map(person => ({ id: person.id, name: person.name, character: person.character, photoUrl: person.profile_path ? `${IMG}/w185${person.profile_path}` : null })) : undefined,
    trailerKey: detail ? (movie.videos?.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')?.key || null : undefined
  };
}

function providerUnavailable(res, message = 'TMDB is temporarily unavailable. Please try again in a moment.') {
  return res.status(503).json({
    error: message,
    code: 'TMDB_UNAVAILABLE',
    retryable: true
  });
}

function latestFirst(movies) {
  return [...movies].sort((a, b) => {
    const dateOrder = String(b.release_date || b.first_air_date || '').localeCompare(String(a.release_date || a.first_air_date || ''));
    if (dateOrder !== 0) return dateOrder;
    return Number(b.vote_average || 0) - Number(a.vote_average || 0);
  });
}

function releasedMovies(movies) {
  const today = new Date().toISOString().slice(0, 10);
  return (movies || []).filter(movie => !movie.release_date || movie.release_date <= today);
}

async function tmdb(path, params = {}) {
  if (!process.env.TMDB_API_KEY) return null;
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, value));
  let lastError;
  try {
    const curlBinary = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const { stdout } = await execFileAsync(curlBinary, ['--http1.1', '--tlsv1.2', '--fail-with-body', '--silent', '--show-error', '--max-time', '12', url.toString()], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    lastError = error;
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri $env:TMDB_REQUEST_URL; $r.Content'], { env: { ...process.env, TMDB_REQUEST_URL: url.toString() }, timeout: 18000, maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (error.message?.includes('TMDB returned 401') || error.message?.includes('TMDB returned 404')) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function cached(key, loader) {
  // Cache version keeps responses from older provider/fallback experiments out
  // of the production-shaped API after a schema or filtering change.
  key = `v2:${key}`;
  const current = cache.get(key);
  let stale = current?.value && !(Array.isArray(current.value.results) && current.value.results.length === 0) ? current.value : null;
  if (current && current.expires > Date.now()) return current.value;
  const stored = db.prepare('SELECT payload, expires_at FROM movie_cache WHERE cache_key = ?').get(key);
  if (stored) {
    const value = JSON.parse(stored.payload);
    if (!(Array.isArray(value.results) && value.results.length === 0)) stale = value;
    if (stored.expires_at > Date.now()) {
      cache.set(key, { value, expires: stored.expires_at });
      return value;
    }
  }
  let value;
  try {
    value = await loader();
  } catch (error) {
    if (stale) return stale;
    throw error;
  }
  const isEmptyProviderPage = value && Array.isArray(value.results) && value.results.length === 0;
  if (!isEmptyProviderPage) cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  if (value && !isEmptyProviderPage) db.prepare('INSERT OR REPLACE INTO movie_cache (cache_key, payload, expires_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), Date.now() + CACHE_TTL);
  return value;
}

app.get('/api/discover', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const sort = req.query.sort || 'newest';
  const genre = req.query.genre || '';
  const theme = req.query.theme || '';
  const effectiveSort = theme === 'award-winning' ? 'rating' : sort;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const data = await cached(`discover:${page}:${effectiveSort}:${genre}:${theme}`, () => tmdb('/discover/movie', { page, sort_by: effectiveSort === 'rating' ? 'vote_average.desc' : effectiveSort === 'newest' ? 'primary_release_date.desc' : 'popularity.desc', 'vote_count.gte': effectiveSort === 'rating' ? (theme ? 500 : 200) : 0, 'primary_release_date.lte': today, with_genres: genre || undefined, include_adult: 'false' }));
    if (!data) return providerUnavailable(res);
    const movies = releasedMovies(data.results).map(normalize);
    movies.forEach(movie => movieIndex.set(movie.id, movie));
    res.json({ movies, page: data.page, totalPages: Math.min(data.total_pages, 500), source: 'tmdb' });
  } catch (error) {
    providerUnavailable(res);
  }
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  if (!query) return res.json({ movies: [], page: 1, totalPages: 0, source: 'local' });
  try {
    const data = await cached(`search:${query.toLowerCase()}:${page}`, async () => {
      const movieSearch = await tmdb('/search/movie', { query, page, include_adult: 'false' });
      if (!movieSearch) return null;
      const genreId = Object.entries(genreMap).find(([, name]) => name.toLowerCase() === query.toLowerCase())?.[0];
      if (genreId) {
        const genreSearch = await tmdb('/discover/movie', { with_genres: genreId, sort_by: 'popularity.desc', page, include_adult: 'false' });
        return { page: genreSearch?.page || page, total_pages: genreSearch?.total_pages || 1, results: genreSearch?.results || [] };
      }
      // Prefer the provider's movie search when it has results. This prevents
      // broad person/genre enrichment from polluting a title query (e.g. Spider).
      if (movieSearch.results?.length) return movieSearch;
      const multi = await tmdb('/search/multi', { query, page, include_adult: 'false' });
      const combined = [];
      const people = (multi?.results || []).filter(item => item.media_type === 'person').slice(0, 2);
      for (const person of people) {
        const personMovies = await tmdb('/discover/movie', { with_people: person.id, sort_by: 'popularity.desc', page, include_adult: 'false' });
        combined.push(...(personMovies?.results || []));
      }
      const unique = [...new Map(combined.filter(item => item?.id).map(item => [item.id, item])).values()];
      return { page: movieSearch.page || page, total_pages: Math.max(movieSearch.total_pages || 1, multi?.total_pages || 1), results: unique };
    });
    if (!data) return providerUnavailable(res);
    const movies = latestFirst(releasedMovies(data.results || [])).map(normalize);
    movies.forEach(movie => movieIndex.set(movie.id, movie));
    res.json({ movies, page: data.page, totalPages: Math.min(data.total_pages, 500), source: 'tmdb' });
  } catch (error) {
    providerUnavailable(res, 'Search is temporarily unavailable. Please try again in a moment.');
  }
});

app.get('/api/movies/:id', async (req, res) => {
  try {
    const data = await cached(`movie:${req.params.id}`, () => tmdb(`/movie/${req.params.id}`, { append_to_response: 'credits,videos' }));
    if (!data) return providerUnavailable(res);
    if (data.release_date && data.release_date > new Date().toISOString().slice(0, 10)) return res.status(404).json({ error: 'This title is not released yet.' });
    res.json(normalize(data, true));
  } catch (error) {
    const cachedMovie = movieIndex.get(Number(req.params.id));
    if (cachedMovie) return res.status(200).json({ ...cachedMovie, source: 'cache', warning: 'Live detail data is temporarily unavailable. Showing the latest available summary.' });
    providerUnavailable(res, 'Movie details are temporarily unavailable. Please try again in a moment.');
  }
});

function rowToMovie(row) { return { ...row, genres: JSON.parse(row.genres || '[]') }; }
app.get('/api/wishlist', (req, res) => res.json({ movies: db.prepare('SELECT * FROM wishlist ORDER BY added_at DESC').all().map(rowToMovie) }));
app.post('/api/wishlist', (req, res) => {
  const movie = req.body;
  if (!movie?.id || !movie?.title) return res.status(400).json({ error: 'Movie id and title are required.' });
  db.prepare(`INSERT OR REPLACE INTO wishlist (movie_id,title,poster_path,backdrop_path,release_date,vote_average,genres,added_at) VALUES (@id,@title,@posterUrl,@backdropUrl,@releaseDate,@rating,@genres,CURRENT_TIMESTAMP)`).run({ ...movie, genres: JSON.stringify(movie.genres || []) });
  res.status(201).json({ movie: rowToMovie(db.prepare('SELECT * FROM wishlist WHERE movie_id = ?').get(movie.id)) });
});
app.delete('/api/wishlist/:id', (req, res) => { db.prepare('DELETE FROM wishlist WHERE movie_id = ?').run(Number(req.params.id)); res.status(204).end(); });

app.get('/api/health', (req, res) => res.json({ ok: true, configured: Boolean(process.env.TMDB_API_KEY), cacheEntries: cache.size }));
app.use(express.static(path.resolve(projectRoot, '..', 'dist')));
app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.resolve(projectRoot, '..', 'dist', 'index.html')));
app.listen(port, () => console.log(`moviesHUB API listening on http://localhost:${port}`));
