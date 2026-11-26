require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const clean = value => String(value ?? '').trim();

const normalizeImage = value => {
    const v = clean(value);
    if (!v) return null;
    if (v.length > 500) throw new Error('Слишком длинная ссылка на постер');
    if (!/^(https?:\/\/|\/(img|uploads)\/)/i.test(v)) {
        throw new Error('Ссылка на постер должна начинаться с http(s):// или /img/');
    }
    return v;
};
const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const db = new Database(path.join(DATA, 'cinevibe.sqlite'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 avatar TEXT,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS titles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 type TEXT NOT NULL CHECK(type IN ('Фильм','Сериал')),
 name TEXT NOT NULL,
 year INTEGER NOT NULL,
 genres TEXT NOT NULL,
 actors TEXT NOT NULL,
 directors TEXT NOT NULL,
 description TEXT NOT NULL,
 image TEXT,
 duration INTEGER NOT NULL DEFAULT 0,
 age_rating TEXT NOT NULL DEFAULT '0+',
 season_count INTEGER NOT NULL DEFAULT 0,
 episode_count INTEGER NOT NULL DEFAULT 0,
 country TEXT NOT NULL DEFAULT '',
 publisher TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
 body TEXT NOT NULL,
 spoiler INTEGER NOT NULL DEFAULT 0,
 approved INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, title_id)
);
CREATE TABLE IF NOT EXISTS title_lists (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
 list_type TEXT NOT NULL CHECK(list_type IN ('favorite','watched','planned')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, title_id, list_type)
);
CREATE TABLE IF NOT EXISTS review_votes (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
 vote INTEGER NOT NULL CHECK(vote IN (-1,1)),
 PRIMARY KEY(user_id, review_id)
);
`);
const titleColumns = db.prepare('PRAGMA table_info(titles)').all().map(c => c.name);
if (!titleColumns.includes('duration')) db.exec('ALTER TABLE titles ADD COLUMN duration INTEGER NOT NULL DEFAULT 0');
if (!titleColumns.includes('age_rating')) db.exec("ALTER TABLE titles ADD COLUMN age_rating TEXT NOT NULL DEFAULT '0+'");
for (const [column, definition] of [['season_count', 'INTEGER NOT NULL DEFAULT 0'], ['episode_count', 'INTEGER NOT NULL DEFAULT 0'], ['country', "TEXT NOT NULL DEFAULT ''"], ['publisher', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!titleColumns.includes(column)) db.exec(`ALTER TABLE titles ADD COLUMN ${column} ${definition}`);
}
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  if (userColumns.includes('is_admin')) {
    db.exec("UPDATE users SET role='admin' WHERE is_admin=1");
  }
}

db.exec('CREATE INDEX IF NOT EXISTS reviews_by_title_approved ON reviews(title_id, approved)');

const adminEmail = clean(process.env.ADMIN_EMAIL).toLowerCase();
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
if (adminEmail && adminPassword.length >= 12 && !db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
    .run('Администратор', adminEmail, bcrypt.hashSync(adminPassword, 12));
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
  }
  console.warn('WARNING: set SESSION_SECRET in .env before deployment.');
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.get('/pages/catalog.html', (_, res) => res.redirect('/'));
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), { maxAge: '1d' }));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(session({
 secret: sessionSecret || crypto.randomBytes(48).toString('hex'),
 resave: false, saveUninitialized: false,
 store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA }),
 name: 'cinevibe.sid',
 cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 24*60*60*1000 }
}));
const attempts = new Map();
const rateLimitAuth = (req, res, next) => {
 const key = req.ip + ':' + req.path, now = Date.now();
 const item = attempts.get(key) || { count: 0, start: now };
 if (now - item.start > 15 * 60 * 1000) { item.count = 0; item.start = now; }
 item.count++;
 attempts.set(key, item);
 if (item.count > 10) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
 next();
};
// Same-origin check for state-changing API requests to reduce CSRF risk.
app.use('/api', (req, res, next) => {
 if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
 const origin = req.get('origin');
 if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
   return res.status(403).json({ error: 'Запрос отклонён: неверный источник.' });
 }
 next();
});

const upload = multer({
 storage: multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(16).slice(2) + path.extname(file.originalname).toLowerCase())
 }),
 limits: { fileSize: 4 * 1024 * 1024 },
 fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});
const currentUser = (req) => req.session.user || null;
const auth = (req,res,next) => currentUser(req) ? next() : res.status(401).json({error:'Сначала войдите в аккаунт'});
const admin = (req,res,next) => currentUser(req)?.role === 'admin' ? next() : res.status(403).json({error:'Доступ только для администратора'});
const parseTitle = t => ({
 type: clean(t.type), name: clean(t.name), year: Number(t.year),
 genres: clean(t.genres), actors: clean(t.actors), directors: clean(t.directors),
 description: clean(t.description), image: normalizeImage(t.image),
 duration: Number(t.duration || 0), age_rating: clean(t.age_rating || '0+'),
 season_count: t.type === 'Сериал' ? Number(t.season_count || 0) : 0,
 episode_count: t.type === 'Сериал' ? Number(t.episode_count || 0) : 0,
 country: clean(t.country), publisher: clean(t.publisher)
});
const titleValid = t => ['Фильм','Сериал'].includes(t.type) && t.name && Number.isInteger(t.year) &&
 t.year >= 1888 && t.year <= new Date().getFullYear()+5 && t.genres && t.actors && t.directors && t.description && Number.isInteger(t.duration) && t.duration >= 0 && Number.isInteger(t.season_count) && t.season_count >= 0 && Number.isInteger(t.episode_count) && t.episode_count >= 0 && (t.type !== 'Сериал' || (t.season_count > 0 && t.episode_count > 0)) && t.country.length <= 100 && t.publisher.length <= 160 && ['0+','6+','12+','16+','18+'].includes(t.age_rating);

app.get('/api/me', (req,res) => {
 const sessionUser = currentUser(req);
 if (!sessionUser) return res.json(null);
 const fresh = db.prepare('SELECT id,name,email,avatar,role FROM users WHERE id=?').get(sessionUser.id);
 if (!fresh) { req.session.destroy(() => {}); return res.json(null); }
 req.session.user = fresh;
 res.json(fresh);
});
app.post('/api/register', rateLimitAuth, (req,res) => {
 const name=clean(req.body.name), email=clean(req.body.email).toLowerCase(), password=String(req.body.password||''), repeat=String(req.body.repeat||'');
 if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<8 || password!==repeat)
  return res.status(400).json({error:'Проверьте имя, почту и пароль (не менее 8 символов); пароли должны совпадать'});
 try {
  const info=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,bcrypt.hashSync(password,12));
  req.session.regenerate(err => {
   if (err) return res.status(500).json({error:'Не удалось создать сессию'});
   req.session.user={id:info.lastInsertRowid,name,email,avatar:null,role:'user'};
   req.session.save(saveErr => saveErr ? res.status(500).json({error:'Не удалось сохранить сессию'}) : res.json(req.session.user));
  });
 } catch { res.status(409).json({error:'Пользователь с такой почтой уже существует'}); }
});
app.post('/api/login', rateLimitAuth, (req,res) => {
 const email=clean(req.body.email).toLowerCase(), password=String(req.body.password||'');
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if (!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:'Неверная почта или пароль'});
 req.session.regenerate(err => {
  if (err) return res.status(500).json({error:'Не удалось создать сессию'});
  req.session.user={id:user.id,name:user.name,email:user.email,avatar:user.avatar,role:user.role || (user.is_admin ? 'admin' : 'user')};
  req.session.save(saveErr => saveErr ? res.status(500).json({error:'Не удалось сохранить сессию'}) : res.json(req.session.user));
 });
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('cinevibe.sid');res.json({ok:true});}));

app.get('/api/titles',(req,res)=>{
 const q=clean(req.query.q), type=clean(req.query.type), genre=clean(req.query.genre), country=clean(req.query.country), publisher=clean(req.query.publisher), sort=clean(req.query.sort), age=clean(req.query.age), minDuration=Number(req.query.minDuration||0), maxDuration=Number(req.query.maxDuration||0), minYear=Number(req.query.minYear||0), maxYear=Number(req.query.maxYear||0), minRating=Number(req.query.minRating||0);
 const excludeWatched = clean(req.query.excludeWatched) === '1';
 const user = currentUser(req);

 let sql=`SELECT t.*,
 COALESCE(ROUND(AVG(r.rating),1),0) rating, COUNT(r.id) review_count
 FROM titles t LEFT JOIN reviews r ON r.title_id=t.id AND r.approved=1 WHERE 1=1`;
 const args=[];

 if (excludeWatched && user) {
   sql += ` AND t.id NOT IN (
     SELECT title_id FROM title_lists WHERE user_id=? AND list_type='watched'
   )`;
   args.push(user.id);
 }

 if(q){sql+=' AND (t.name LIKE ? OR t.actors LIKE ? OR t.directors LIKE ? OR t.country LIKE ? OR t.publisher LIKE ?)'; args.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`);}
 if(type){sql+=' AND t.type=?';args.push(type);}
 if(genre){sql+=' AND t.genres LIKE ?';args.push(`%${genre}%`);}
 if(country){sql+=' AND t.country LIKE ?';args.push(`%${country}%`);}
 if(publisher){sql+=' AND t.publisher LIKE ?';args.push(`%${publisher}%`);}
 if(age){sql+=' AND t.age_rating=?';args.push(age);}
 if(minDuration){sql+=' AND t.duration>=?';args.push(minDuration);}
 if(maxDuration){sql+=' AND t.duration<=?';args.push(maxDuration);}
 if(minYear){sql+=' AND t.year>=?';args.push(minYear);}
 if(maxYear){sql+=' AND t.year<=?';args.push(maxYear);}
 sql+=' GROUP BY t.id ';
 if(minRating){sql+=' HAVING COALESCE(AVG(r.rating),0)>=? ';args.push(minRating);}

 if (excludeWatched) {
   sql += ' ORDER BY RANDOM() LIMIT 25';
 } else {
   sql += sort==='year'?'ORDER BY t.year DESC':sort==='rating'?'ORDER BY rating DESC':'ORDER BY t.created_at DESC';
 }

 res.json(db.prepare(sql).all(...args));
});
app.get('/api/titles/:id',(req,res)=>{
 const title=db.prepare(`SELECT t.*,COALESCE(ROUND(AVG(r.rating),1),0) rating,COUNT(r.id) review_count
 FROM titles t LEFT JOIN reviews r ON r.title_id=t.id AND r.approved=1 WHERE t.id=? GROUP BY t.id`).get(req.params.id);
 if(!title)return res.status(404).json({error:'Не найдено'});
 const reviews=db.prepare(`SELECT r.id,r.rating,r.body,r.spoiler,r.created_at,u.name,u.avatar,
 (SELECT COUNT(*) FROM review_votes v WHERE v.review_id=r.id AND v.vote=1) likes,
 (SELECT COUNT(*) FROM review_votes v WHERE v.review_id=r.id AND v.vote=-1) dislikes,
 (SELECT vote FROM review_votes v WHERE v.review_id=r.id AND v.user_id=?) my_vote
 FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.title_id=? AND r.approved=1 ORDER BY r.created_at DESC`).all(currentUser(req)?.id||0,req.params.id);
 const user = currentUser(req);
 const listTypes = user ? db.prepare('SELECT list_type FROM title_lists WHERE user_id=? AND title_id=?')
   .all(user.id, title.id).map(row => row.list_type) : [];
 res.json({title,reviews,listTypes});
});
app.post('/api/titles', admin, (req, res) => {
  let t;
  try {
    t = parseTitle(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!titleValid(t)) return res.status(400).json({ error: 'Заполните все поля корректно' });
  const result = db.prepare(`INSERT INTO titles(type,name,year,genres,actors,directors,description,image,duration,age_rating,season_count,episode_count,country,publisher)
    VALUES(@type,@name,@year,@genres,@actors,@directors,@description,@image,@duration,@age_rating,@season_count,@episode_count,@country,@publisher)`).run(t);
  res.json({ id: result.lastInsertRowid });
});
app.put('/api/titles/:id', admin, (req, res) => {
  const old = db.prepare('SELECT * FROM titles WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Фильм или сериал не найден' });
  let t;
  try {
    const imageInput = clean(req.body.image) || old.image;
    t = parseTitle({ ...req.body, image: imageInput });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!titleValid(t)) return res.status(400).json({ error: 'Проверьте заполнение полей' });
  db.prepare(`UPDATE titles SET type=@type,name=@name,year=@year,genres=@genres,actors=@actors,directors=@directors,
    description=@description,image=@image,duration=@duration,age_rating=@age_rating,season_count=@season_count,episode_count=@episode_count,country=@country,publisher=@publisher WHERE id=@id`)
    .run({ ...t, id: Number(req.params.id) });
  res.json({ ok: true });
});
app.delete('/api/titles/:id',admin,(req,res)=>{
 const title=db.prepare('SELECT image FROM titles WHERE id=?').get(req.params.id);
 db.prepare('DELETE FROM titles WHERE id=?').run(req.params.id);
 if(title?.image?.startsWith('/uploads/'))fs.rm(path.join(UPLOADS,path.basename(title.image)),()=>{});
 res.json({ok:true});
});
app.post('/api/reviews',auth,(req,res)=>{
 const titleId=Number(req.body.title_id), rating=Number(req.body.rating), body=clean(req.body.body), spoiler=req.body.spoiler?1:0;
 if(!db.prepare('SELECT id FROM titles WHERE id=?').get(titleId) || !Number.isInteger(rating)||rating<1||rating>10||body.length<5)
  return res.status(400).json({error:'Проверьте оценку и текст отзыва (минимум 5 символов)'});
 try{
  db.prepare('INSERT INTO reviews(user_id,title_id,rating,body,spoiler) VALUES(?,?,?,?,?)').run(currentUser(req).id,titleId,rating,body,spoiler);
  res.json({ok:true,message:'Отзыв отправлен на модерацию'});
 }catch{res.status(409).json({error:'Вы уже оставили отзыв на этот фильм или сериал'});}
});
app.delete('/api/reviews/:id',auth,(req,res)=>{
 const result=db.prepare('DELETE FROM reviews WHERE id=? AND user_id=?').run(req.params.id,currentUser(req).id);
 if(!result.changes)return res.status(404).json({error:'Отзыв не найден'});
 res.json({ok:true});
});
app.post('/api/reviews/:id/vote',auth,(req,res)=>{
 const vote=Number(req.body.vote);
 if(![1,-1].includes(vote))return res.status(400).json({error:'Некорректная реакция'});
 const old=db.prepare('SELECT vote FROM review_votes WHERE user_id=? AND review_id=?').get(currentUser(req).id,req.params.id);
 if(old?.vote===vote)db.prepare('DELETE FROM review_votes WHERE user_id=? AND review_id=?').run(currentUser(req).id,req.params.id);
 else db.prepare(`INSERT INTO review_votes(user_id,review_id,vote) VALUES(?,?,?)
 ON CONFLICT(user_id,review_id) DO UPDATE SET vote=excluded.vote`).run(currentUser(req).id,req.params.id,vote);
 res.json({ok:true});
});
app.post('/api/lists/:type/:id',auth,(req,res)=>{
 if(!['favorite','watched','planned'].includes(req.params.type)||!db.prepare('SELECT id FROM titles WHERE id=?').get(req.params.id))return res.status(400).json({error:'Некорректный список или фильм'});
 db.prepare('INSERT OR IGNORE INTO title_lists(user_id,title_id,list_type) VALUES(?,?,?)').run(currentUser(req).id,req.params.id,req.params.type);
 res.json({ok:true});
});
app.delete('/api/lists/:type/:id',auth,(req,res)=>{
 db.prepare('DELETE FROM title_lists WHERE user_id=? AND title_id=? AND list_type=?').run(currentUser(req).id,req.params.id,req.params.type);
 res.json({ok:true});
});
app.get('/api/profile/:id?',auth,(req,res)=>{
 const id=Number(req.params.id)||currentUser(req).id;
 const user=db.prepare('SELECT id,name,email,avatar FROM users WHERE id=?').get(id);
 if(!user)return res.status(404).json({error:'Пользователь не найден'});
 const lists={};
 for(const type of ['favorite','watched','planned']) lists[type]=db.prepare(`SELECT t.*,COALESCE(ROUND((SELECT AVG(r.rating) FROM reviews r WHERE r.title_id=t.id AND r.approved=1),1),0) rating
 FROM title_lists l JOIN titles t ON t.id=l.title_id WHERE l.user_id=? AND l.list_type=? ORDER BY l.created_at DESC`).all(id,type);
 const reviews=db.prepare(`SELECT r.*,t.name title_name,t.type title_type FROM reviews r JOIN titles t ON t.id=r.title_id WHERE r.user_id=? ORDER BY r.created_at DESC`).all(id);
 res.json({user,lists,reviews,own:id===currentUser(req).id});
});
app.patch('/api/profile',auth,upload.single('avatar'),(req,res)=>{
 const name=clean(req.body.name);
 if(name.length<2)return res.status(400).json({error:'Имя должно содержать минимум 2 символа'});
 const old=db.prepare('SELECT avatar FROM users WHERE id=?').get(currentUser(req).id);
 const avatar=req.file?'/uploads/'+req.file.filename:old.avatar;
 db.prepare('UPDATE users SET name=?,avatar=? WHERE id=?').run(name,avatar,currentUser(req).id);
 req.session.user.name=name;req.session.user.avatar=avatar;
 res.json(req.session.user);
});
app.delete('/api/account',auth,(req,res)=>{
 const id=currentUser(req).id;
 const user=db.prepare('SELECT avatar FROM users WHERE id=?').get(id);
 db.prepare('DELETE FROM users WHERE id=?').run(id);
 if(user?.avatar?.startsWith('/uploads/'))fs.rm(path.join(UPLOADS,path.basename(user.avatar)),()=>{});
 req.session.destroy(()=>res.json({ok:true}));
});
app.get('/api/admin/reviews',admin,(req,res)=>res.json(db.prepare(`SELECT r.*,u.name user_name,t.name title_name
 FROM reviews r JOIN users u ON u.id=r.user_id JOIN titles t ON t.id=r.title_id
 WHERE r.approved=0 ORDER BY r.created_at ASC`).all()));
app.post('/api/admin/reviews/:id/approve',admin,(req,res)=>{
 const result=db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(req.params.id);
 res.json({ok:!!result.changes});
});
app.delete('/api/admin/reviews/:id',admin,(req,res)=>{db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);res.json({ok:true});});

app.use('/api', (_,res) => res.status(404).json({error:'Не найдено'}));
// Admin role assignment is intentionally a server-side command, never a public API.
if (process.argv[2] === '--grant-admin') {
 const email = clean(process.argv[3]).toLowerCase();
 if (!email) { console.error('Usage: node server.js --grant-admin user@example.com'); process.exit(1); }
 const result = db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email);
 if (!result.changes) { console.error('User not found:', email); process.exit(1); }
 console.log('Admin role granted to:', email);
 process.exit(0);
}
if (process.argv[2] === '--revoke-admin') {
 const email = clean(process.argv[3]).toLowerCase();
 if (!email) { console.error('Usage: node server.js --revoke-admin user@example.com'); process.exit(1); }
 const result = db.prepare("UPDATE users SET role='user' WHERE email=?").run(email);
 if (!result.changes) { console.error('User not found:', email); process.exit(1); }
 console.log('Admin role revoked from:', email);
 process.exit(0);
}
app.listen(PORT,()=>console.log(`CINEVIBE запущен: http://localhost:${PORT}`));
