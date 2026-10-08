# CodeAlpha_SocialMedia — Hubbub

A mini social media app (CodeAlpha Full Stack Task 2).

**Stack:** HTML/CSS/JavaScript · Node.js + Express · SQLite (better-sqlite3) · JWT auth (httpOnly cookie) · bcrypt

## Features
- Sign up / log in / log out
- User profiles (display name, bio, post count, followers, following) and profile editing
- Posts (280 chars), delete your own posts
- Comments on posts
- Like / unlike
- Follow / unfollow, "Following" feed and "Everyone" feed
- People search
- Database tables: users, posts, comments, likes, follows

## Run
```bash
npm install
npm start
# open http://localhost:3000
```

## API
| Method | Route | Auth |
|---|---|---|
| POST | /api/register, /api/login, /api/logout | – |
| GET / PUT | /api/me | PUT needs login |
| GET | /api/posts?feed=all\|following | – |
| POST / DELETE | /api/posts, /api/posts/:id | yes |
| POST | /api/posts/:id/like | yes |
| GET / POST | /api/posts/:id/comments | POST needs login |
| GET | /api/users?q= , /api/users/:username | – |
| POST | /api/users/:username/follow | yes |
