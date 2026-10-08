const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname + '/public'));

// ---------- auth ----------
const sign = u => jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' });
const setCookie = (res, t) => res.cookie('token', t, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5 });
function readUser(req) { try { return jwt.verify(req.cookies.token, SECRET); } catch { return null; } }
function auth(req, res, next) {
  const u = readUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  req.user = u; next();
}
const publicUser = u => ({ id: u.id, username: u.username, display_name: u.display_name, bio: u.bio });

app.post('/api/register', (req, res) => {
  let { username, display_name, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'Username, email and password are required.' });
  username = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email.toLowerCase()))
    return res.status(409).json({ error: 'That username or email is already taken.' });
  const info = db.prepare('INSERT INTO users (username,display_name,email,password_hash) VALUES (?,?,?,?)')
    .run(username, (display_name || username).trim(), email.toLowerCase(), bcrypt.hashSync(password, 10));
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  setCookie(res, sign(u));
  res.status(201).json(publicUser(u));
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};
  const l = (login || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(l, l);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'Login or password is incorrect.' });
  setCookie(res, sign(u));
  res.json(publicUser(u));
});
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const t = readUser(req);
  const u = t && db.prepare('SELECT * FROM users WHERE id = ?').get(t.id);
  res.json(u ? publicUser(u) : null);
});
app.put('/api/me', auth, (req, res) => {
  const { display_name, bio } = req.body || {};
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: 'Display name cannot be empty.' });
  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(display_name.trim().slice(0, 40), (bio || '').slice(0, 160), req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

// ---------- posts ----------
function decoratePosts(rows, viewerId) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?');
  const commentCount = db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ?');
  const liked = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?');
  return rows.map(p => ({
    ...p,
    likes: likeCount.get(p.id).c,
    comments: commentCount.get(p.id).c,
    liked_by_me: !!(viewerId && liked.get(p.id, viewerId)),
  }));
}
const POST_SELECT = `SELECT p.id, p.content, p.created_at, u.id user_id, u.username, u.display_name FROM posts p JOIN users u ON u.id = p.user_id`;

// feed=following (people I follow + me) or feed=all
app.get('/api/posts', (req, res) => {
  const me = readUser(req);
  let rows;
  if (req.query.feed === 'following' && me) {
    rows = db.prepare(`${POST_SELECT} WHERE p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                       ORDER BY p.id DESC LIMIT 100`).all(me.id, me.id);
  } else rows = db.prepare(`${POST_SELECT} ORDER BY p.id DESC LIMIT 100`).all();
  res.json(decoratePosts(rows, me && me.id));
});

app.post('/api/posts', auth, (req, res) => {
  const content = ((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: 'Write something first.' });
  if (content.length > 280) return res.status(400).json({ error: 'Posts can be up to 280 characters.' });
  const info = db.prepare('INSERT INTO posts (user_id,content) VALUES (?,?)').run(req.user.id, content);
  res.status(201).json(decoratePosts(db.prepare(`${POST_SELECT} WHERE p.id = ?`).all(info.lastInsertRowid), req.user.id)[0]);
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Post not found or not yours.' });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  const has = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  has ? db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id)
      : db.prepare('INSERT INTO likes (post_id,user_id) VALUES (?,?)').run(req.params.id, req.user.id);
  res.json({ liked: !has, likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(req.params.id).c });
});

// ---------- comments ----------
app.get('/api/posts/:id/comments', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username, u.display_name FROM comments c
                       JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(req.params.id));
});
app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = ((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: 'Write a comment first.' });
  if (content.length > 200) return res.status(400).json({ error: 'Comments can be up to 200 characters.' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  const info = db.prepare('INSERT INTO comments (post_id,user_id,content) VALUES (?,?,?)').run(req.params.id, req.user.id, content);
  res.status(201).json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username, u.display_name FROM comments c
                                   JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(info.lastInsertRowid));
});

// ---------- profiles & follow ----------
app.get('/api/users', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare('SELECT username, display_name, bio FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY username LIMIT 20').all(q, q));
});

app.get('/api/users/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'No such user.' });
  const me = readUser(req);
  const posts = decoratePosts(db.prepare(`${POST_SELECT} WHERE p.user_id = ? ORDER BY p.id DESC`).all(u.id), me && me.id);
  res.json({
    ...publicUser(u), joined: u.created_at,
    followers: db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id = ?').get(u.id).c,
    following: db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').get(u.id).c,
    is_following: !!(me && db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(me.id, u.id)),
    posts,
  });
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!target) return res.status(404).json({ error: 'No such user.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself." });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, target.id);
  has ? db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target.id)
      : db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run(req.user.id, target.id);
  res.json({ following: !has, followers: db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id = ?').get(target.id).c });
});

app.listen(PORT, () => console.log(`Hubbub running at http://localhost:${PORT}`));
