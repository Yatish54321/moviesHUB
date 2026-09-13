import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 4000);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
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

app.use(cors());
app.use(express.json());

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 5;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const fallbackMovies = [
  { id: 1, title: 'The Quiet Season', overview: 'A chef returns to a windswept island and discovers a community ready to begin again.', posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1600&q=85', releaseDate: '2024-09-12', rating: 7.8, genres: ['Drama', 'Romance'], runtime: 112 },
  { id: 2, title: 'After the Signal', overview: 'When a mysterious broadcast reaches Earth, two strangers race across a sleeping continent to find its source.', posterUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=1600&q=85', releaseDate: '2023-05-03', rating: 8.2, genres: ['Sci-Fi', 'Thriller'], runtime: 124 },
  { id: 3, title: 'Soft Focus', overview: 'A young photographer looks for a lost roll of film and finds a portrait of the city she thought she knew.', posterUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1600&q=85', releaseDate: '2022-11-21', rating: 7.5, genres: ['Comedy', 'Drama'], runtime: 98 },
  { id: 4, title: 'Northbound', overview: 'A burned-out cartographer takes one last expedition into the Arctic and finds a reason to stay.', posterUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1600&q=85', releaseDate: '2021-02-17', rating: 8.0, genres: ['Adventure', 'Drama'], runtime: 131 },
  { id: 5, title: 'The Last Broadcast', overview: 'A late-night radio host receives a call from someone who should not be alive.', posterUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&q=85', releaseDate: '2024-01-08', rating: 7.1, genres: ['Mystery', 'Horror'], runtime: 105 },
  { id: 6, title: 'Blue Hour', overview: 'Three friends reunite for one night, carrying the stories they never finished telling each other.', posterUrl: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?w=1600&q=85', releaseDate: '2020-08-30', rating: 7.7, genres: ['Drama'], runtime: 101 }
  ,{ id: 7, title: 'Neon Run', overview: 'A courier with one impossible delivery races through a city that never turns its lights off.', posterUrl: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=600&q=85', backdropUrl: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1600&q=85', releaseDate: '2024-06-14', rating: 7.9, genres: ['Action', 'Thriller'], runtime: 109 }
];

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

function getFallback(query = '', sort = 'popular', genre = '') {
  const genreName = genreMap[Number(genre)] || '';
  let items = fallbackMovies.filter(movie => {
    const matchesQuery = !query || `${movie.title} ${movie.genres.join(' ')}`.toLowerCase().includes(query.toLowerCase());
    const matchesGenre = !genreName || movie.genres.includes(genreName);
    return matchesQuery && matchesGenre;
  });
  if (sort === 'rating') items = [...items].sort((a, b) => b.rating - a.rating);
  if (sort === 'newest') items = [...items].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  return items;
}

async function tmdb(path, params = {}) {
  if (!process.env.TMDB_API_KEY) return null;
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
  return response.json();
}

async function cached(key, loader) {
  const current = cache.get(key);
  if (current && current.expires > Date.now()) return current.value;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

app.get('/api/discover', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const sort = req.query.sort || 'popular';
  const genre = req.query.genre || '';
  try {
    const data = await cached(`discover:${page}:${sort}:${genre}`, () => tmdb('/discover/movie', { page, sort_by: sort === 'rating' ? 'vote_average.desc' : sort === 'newest' ? 'primary_release_date.desc' : 'popularity.desc', 'vote_count.gte': sort === 'rating' ? 200 : 0, with_genres: genre || undefined, include_adult: 'false' }));
    if (!data) return res.json({ movies: getFallback('', sort, genre), page: 1, totalPages: 1, source: 'fallback' });
    if (!data.results?.length) {
      const fallback = getFallback('', sort, genre);
      if (fallback.length) return res.json({ movies: fallback, page: 1, totalPages: 1, source: 'fallback', warning: 'No live titles matched this collection, so we added a curated selection.' });
    }
    res.json({ movies: data.results.map(normalize), page: data.page, totalPages: Math.min(data.total_pages, 500), source: 'tmdb' });
  } catch (error) {
    res.status(200).json({ movies: getFallback('', sort, genre), page: 1, totalPages: 1, source: 'fallback', warning: 'Movie service is temporarily unavailable. Showing a curated selection.' });
  }
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  if (!query) return res.json({ movies: [], page: 1, totalPages: 0, source: 'local' });
  try {
    const data = await cached(`search:${query.toLowerCase()}:${page}`, () => tmdb('/search/movie', { query, page, include_adult: 'false' }));
    if (!data) return res.json({ movies: getFallback(query), page: 1, totalPages: 1, source: 'fallback' });
    res.json({ movies: data.results.map(normalize), page: data.page, totalPages: Math.min(data.total_pages, 500), source: 'tmdb' });
  } catch (error) {
    res.status(200).json({ movies: getFallback(query), page: 1, totalPages: 1, source: 'fallback', warning: 'Search is temporarily limited. Showing local results.' });
  }
});

app.get('/api/movies/:id', async (req, res) => {
  try {
    const data = await cached(`movie:${req.params.id}`, () => tmdb(`/movie/${req.params.id}`, { append_to_response: 'credits,videos' }));
    if (!data) {
      const movie = fallbackMovies.find(item => item.id === Number(req.params.id));
      if (!movie) return res.status(404).json({ error: 'Movie not found' });
      return res.json(movie);
    }
    res.json(normalize(data, true));
  } catch (error) { res.status(502).json({ error: 'Could not load this movie right now.' }); }
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
app.listen(port, () => console.log(`ScreenAtlas API listening on http://localhost:${port}`));
