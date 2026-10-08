const $app = document.getElementById('app');
let me = null;

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
function ago(ts) {
  const s = (Date.now() - new Date(ts.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
const COLORS = ['#FFB5C8', '#B5E3FF', '#C4F0B0', '#FFD9A0', '#D9C4FF', '#A8F0E0'];
const avatar = (name, cls = '') => `<div class="av ${cls}" style="background:${COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]}" aria-hidden="true">${esc(name[0].toUpperCase())}</div>`;

function renderNav() {
  document.getElementById('nav').innerHTML = me
    ? `<a href="#/u/${me.username}">@${esc(me.username)}</a><a href="#/settings">Edit profile</a><button class="linkbtn" id="logout">Log out</button>`
    : `<a href="#/login">Log in</a><a href="#/register">Sign up</a>`;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async () => { await api('/api/logout', { method: 'POST' }); me = null; renderNav(); location.hash = '#/'; toast('Logged out'); };
}
document.getElementById('searchForm').onsubmit = e => { e.preventDefault(); const q = document.getElementById('search').value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); };

// ---------- post card (shared by feed and profile) ----------
function postHTML(p) {
  return `<article class="card post" data-id="${p.id}">
    ${avatar(p.display_name)}
    <div class="main">
      <div><a class="who" href="#/u/${p.username}">${esc(p.display_name)}</a> <span class="handle">@${esc(p.username)}</span> <span class="time">· ${ago(p.created_at)}</span></div>
      <p>${esc(p.content)}</p>
      <div class="actions">
        <button class="act like ${p.liked_by_me ? 'on' : ''}" aria-pressed="${p.liked_by_me}">${p.liked_by_me ? '♥' : '♡'} <span>${p.likes}</span></button>
        <button class="act cbtn">💬 <span>${p.comments}</span></button>
        ${me && me.id === p.user_id ? '<button class="act del">Delete</button>' : ''}
      </div>
      <div class="comments" hidden></div>
    </div></article>`;
}
function wirePosts(root, onChange) {
  root.querySelectorAll('.post').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.like').onclick = async () => {
      if (!me) return toast('Log in to like posts');
      const r = await api(`/api/posts/${id}/like`, { method: 'POST' });
      const b = el.querySelector('.like'); b.classList.toggle('on', r.liked); b.setAttribute('aria-pressed', r.liked);
      b.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.likes}</span>`;
    };
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => { if (confirm('Delete this post?')) { await api('/api/posts/' + id, { method: 'DELETE' }); toast('Post deleted'); onChange(); } };
    el.querySelector('.cbtn').onclick = async () => {
      const box = el.querySelector('.comments');
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      const list = await api(`/api/posts/${id}/comments`);
      const draw = l => box.innerHTML = (l.length ? l.map(c => `<div class="comment"><strong>${esc(c.display_name)}</strong> <span class="handle">@${esc(c.username)}</span><br>${esc(c.content)}</div>`).join('') : '<p class="muted">No comments yet.</p>')
        + (me ? `<div class="cform"><input maxlength="200" placeholder="Add a comment" aria-label="Add a comment"><button class="btn">Reply</button></div>` : '<p class="muted"><a href="#/login">Log in</a> to comment.</p>');
      const wire = () => { const f = box.querySelector('.cform'); if (!f) return;
        const send = async () => { const inp = f.querySelector('input'); if (!inp.value.trim()) return;
          try { const c = await api(`/api/posts/${id}/comments`, { method: 'POST', body: { content: inp.value } }); list.push(c); draw(list); wire();
            el.querySelector('.cbtn span').textContent = list.length; } catch (e) { toast(e.message); } };
        f.querySelector('button').onclick = send; f.querySelector('input').onkeydown = e => e.key === 'Enter' && send(); };
      draw(list); wire();
    };
  });
}

// ---------- views ----------
async function homeView(feed) {
  feed = feed || (me ? 'following' : 'all');
  $app.innerHTML = `
    ${me ? `<div class="card compose"><textarea id="txt" rows="3" maxlength="400" placeholder="What's happening?" aria-label="New post"></textarea>
      <div class="bar"><span class="count" id="cnt">0 / 280</span><button class="btn" id="post">Post</button></div><div class="err" id="err"></div></div>`
      : `<div class="card"><h1>Say it short.</h1><p class="muted">Share a thought in 280 characters. <a href="#/register">Create an account</a> or <a href="#/login">log in</a> to post, like and follow.</p></div>`}
    <div class="tabs">
      ${me ? `<button class="tab ${feed === 'following' ? 'on' : ''}" data-f="following">Following</button>` : ''}
      <button class="tab ${feed === 'all' ? 'on' : ''}" data-f="all">Everyone</button>
    </div>
    <div id="list"></div>`;
  $app.querySelectorAll('.tab').forEach(t => t.onclick = () => homeView(t.dataset.f));
  const load = async () => {
    const posts = await api('/api/posts?feed=' + feed);
    const list = document.getElementById('list');
    list.innerHTML = posts.length ? posts.map(postHTML).join('')
      : `<p class="muted">${feed === 'following' ? 'Nothing here yet. Search for people to follow, or switch to Everyone.' : 'No posts yet. Be the first to post.'}</p>`;
    wirePosts(list, load);
  };
  if (me) {
    const txt = document.getElementById('txt'), cnt = document.getElementById('cnt');
    txt.oninput = () => { cnt.textContent = `${txt.value.length} / 280`; cnt.classList.toggle('over', txt.value.length > 280); };
    document.getElementById('post').onclick = async () => {
      try { await api('/api/posts', { method: 'POST', body: { content: txt.value } }); txt.value = ''; cnt.textContent = '0 / 280'; document.getElementById('err').textContent = ''; toast('Posted'); load(); }
      catch (e) { document.getElementById('err').textContent = e.message; }
    };
  }
  load();
}

async function profileView(username) {
  const u = await api('/api/users/' + username);
  const mine = me && me.username === u.username;
  $app.innerHTML = `
    <div class="card profile">
      <div class="head">${avatar(u.display_name, 'big')}<div><h1>${esc(u.display_name)}</h1><div class="handle">@${esc(u.username)}</div></div></div>
      <p>${u.bio ? esc(u.bio) : '<span class="muted">No bio yet.</span>'}</p>
      <div class="stats"><span><strong>${u.posts.length}</strong> posts</span><span><strong id="fers">${u.followers}</strong> followers</span><span><strong>${u.following}</strong> following</span></div>
      ${mine ? '<a class="btn alt" href="#/settings" style="text-decoration:none;display:inline-block">Edit profile</a>'
        : `<button class="btn ${u.is_following ? 'alt' : ''}" id="fol">${u.is_following ? 'Following' : 'Follow'}</button>`}
    </div>
    <div id="list">${u.posts.length ? u.posts.map(postHTML).join('') : '<p class="muted">No posts yet.</p>'}</div>`;
  wirePosts(document.getElementById('list'), () => profileView(username));
  const f = document.getElementById('fol');
  if (f) f.onclick = async () => {
    if (!me) { toast('Log in to follow people'); return; }
    const r = await api(`/api/users/${u.username}/follow`, { method: 'POST' });
    f.textContent = r.following ? 'Following' : 'Follow'; f.classList.toggle('alt', r.following);
    document.getElementById('fers').textContent = r.followers;
  };
}

async function searchView(q) {
  const people = await api('/api/users?q=' + encodeURIComponent(q));
  $app.innerHTML = `<h1>People matching “${esc(q)}”</h1>` + (people.length
    ? `<div class="card">${people.map(p => `<a class="person" style="text-decoration:none" href="#/u/${p.username}">${avatar(p.display_name)}<div><strong>${esc(p.display_name)}</strong> <span class="handle">@${esc(p.username)}</span><div class="muted">${esc(p.bio || '')}</div></div></a>`).join('')}</div>`
    : '<p class="muted">No one found. Try a different name.</p>');
}

function authView(reg) {
  $app.innerHTML = `<div class="card panel"><h1>${reg ? 'Join hubbub' : 'Welcome back'}</h1>
    ${reg ? '<label for="un">Username</label><input id="un" autocomplete="username"><label for="dn">Display name</label><input id="dn" autocomplete="name">' : ''}
    <label for="em">${reg ? 'Email' : 'Username or email'}</label><input id="em" autocomplete="${reg ? 'email' : 'username'}">
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">
    <div class="err" id="err"></div><button class="btn" id="go">${reg ? 'Create account' : 'Log in'}</button></div>`;
  const submit = async () => {
    try {
      me = reg ? await api('/api/register', { method: 'POST', body: { username: un.value, display_name: dn.value, email: em.value, password: pw.value } })
               : await api('/api/login', { method: 'POST', body: { login: em.value, password: pw.value } });
      renderNav(); toast('Welcome, ' + me.display_name); location.hash = '#/';
    } catch (e) { err.textContent = e.message; }
  };
  go.onclick = submit; pw.onkeydown = e => e.key === 'Enter' && submit();
}

function settingsView() {
  if (!me) { location.hash = '#/login'; return; }
  $app.innerHTML = `<div class="card panel"><h1>Edit profile</h1>
    <label for="dn">Display name</label><input id="dn" maxlength="40" value="${esc(me.display_name)}">
    <label for="bio">Bio</label><textarea id="bio" rows="3" maxlength="160">${esc(me.bio || '')}</textarea>
    <div class="err" id="err"></div><button class="btn" id="save">Save changes</button></div>`;
  save.onclick = async () => { try { me = await api('/api/me', { method: 'PUT', body: { display_name: dn.value, bio: bio.value } }); renderNav(); toast('Saved'); location.hash = '#/u/' + me.username; } catch (e) { err.textContent = e.message; } };
}

// ---------- router ----------
async function route() {
  const [, page, arg] = location.hash.split('/');
  try {
    if (page === 'u') await profileView(arg);
    else if (page === 'search') await searchView(decodeURIComponent(arg || ''));
    else if (page === 'login') authView(false);
    else if (page === 'register') authView(true);
    else if (page === 'settings') settingsView();
    else await homeView();
  } catch (e) { $app.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
(async () => { me = await api('/api/me'); renderNav(); route(); })();
