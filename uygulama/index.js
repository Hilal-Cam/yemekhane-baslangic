const express = require('express');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const path = require('path');
const { primaryPool, replicaPool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.connect().catch(console.error);

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: 'yemekhane_gizli_anahtar_123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
  })
);

app.use(express.static(path.join(__dirname, '../frontend')));

// --- API ROTALARI ---

// Sağlık Kontrolü (Replica Okuma)
app.get('/api/saglik', async (req, res) => {
  try {
    const [rows] = await replicaPool.query('SELECT 1 as status');
    res.json({ status: 'OK', db: 'Connected (Replica)' });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// 1. Kullanıcı Giriş (Replica Okuma)
app.post('/api/login', async (req, res) => {
  const { eposta, sifre } = req.body;
  try {
    const [rows] = await replicaPool.query(
      'SELECT id, ad_soyad, rol, bakiye FROM Kullanici WHERE eposta = ? AND sifre = ?',
      [eposta, sifre]
    );
    if (rows.length > 0) {
      req.session.kullanici = rows[0];
      res.json({ success: true, user: rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'Geçersiz e-posta veya şifre' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Oturum Bilgisi
app.get('/api/me', (req, res) => {
  if (req.session.kullanici) {
    res.json({ loggedIn: true, user: req.session.kullanici });
  } else {
    res.json({ loggedIn: false });
  }
});

// Çıkış
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 2. Bakiye Yükleme (Stored Procedure / Primary Yazma)
app.post('/api/bakiye-yukle', async (req, res) => {
  if (!req.session.kullanici) return res.status(401).json({ message: 'Oturum açın' });
  const { miktar } = req.body;
  const kullaniciId = req.session.kullanici.id;

  try {
    await primaryPool.query('CALL sp_bakiye_yukle(?, ?)', [kullaniciId, miktar]);
    // Session bakiye güncelle
    req.session.kullanici.bakiye = parseFloat(req.session.kullanici.bakiye) + parseFloat(miktar);
    res.json({ success: true, message: 'Bakiye başarıyla yüklendi' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Menü Listeleme (Replica Okuma)
app.get('/api/menu', async (req, res) => {
  try {
    const [rows] = await replicaPool.query('SELECT * FROM Menu WHERE tarih >= CURDATE() ORDER BY tarih ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rezervasyon Yapma (Primary Yazma)
app.post('/api/rezervasyon-yap', async (req, res) => {
  if (!req.session.kullanici) return res.status(401).json({ message: 'Oturum açın' });
  const { menuId } = req.body;
  const kullaniciId = req.session.kullanici.id;

  try {
    await primaryPool.query('CALL sp_rezervasyon_yap(?, ?)', [kullaniciId, menuId]);
    res.json({ success: true, message: 'Rezervasyon oluşturuldu' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4. Rezervasyonlarım ve İptal (Replica Okuma / Primary Yazma)
app.get('/api/rezervasyonlarim', async (req, res) => {
  if (!req.session.kullanici) return res.status(401).json({ message: 'Oturum açın' });
  try {
    const [rows] = await replicaPool.query(
      `SELECT r.id, m.tarih, m.ana_yemek, r.durum 
       FROM Rezervasyon r 
       JOIN Menu m ON r.menu_id = m.id 
       WHERE r.kullanici_id = ? ORDER BY m.tarih DESC`,
      [req.session.kullanici.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/rezervasyon-iptal', async (req, res) => {
  if (!req.session.kullanici) return res.status(401).json({ message: 'Oturum açın' });
  const { rezervasyonId } = req.body;

  try {
    await primaryPool.query('CALL sp_rezervasyon_iptal(?)', [rezervasyonId]);
    res.json({ success: true, message: 'Rezervasyon iptal edildi' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. İlerleme ve Raporlama (Replica Okuma)
app.get('/api/raporlar', async (req, res) => {
  try {
    const [toplamRez] = await replicaPool.query('SELECT COUNT(*) as adet FROM Rezervasyon');
    const [toplamBakiye] = await replicaPool.query('SELECT SUM(bakiye) as toplam FROM Kullanici');
    res.json({
      toplamRezervasyon: toplamRez[0].adet,
      toplamSistemBakiyesi: toplamBakiye[0].toplam || 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Yemekhane Otomasyonu Backend Servisi http://localhost:${PORT} adresinde calisiyor!`);
});