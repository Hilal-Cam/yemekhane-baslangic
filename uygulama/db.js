const mysql = require('mysql2/promise');

// YAZMA İşlemleri (INSERT, UPDATE, DELETE) -> Primary (3306)
const primaryPool = mysql.createPool({
  host: process.env.DB_PRIMARY_HOST || 'localhost',
  port: process.env.DB_PRIMARY_PORT || 3306,
  user: 'root',
  password: '',
  database: 'yemekhane_db',
  waitForConnections: true,
  connectionLimit: 10
});

// OKUMA İşlemleri (SELECT) -> Replica (3308)
const replicaPool = mysql.createPool({
  host: process.env.DB_REPLICA_HOST || 'localhost',
  port: process.env.DB_REPLICA_PORT || 3308,
  user: 'root',
  password: '',
  database: 'yemekhane_db',
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = { primaryPool, replicaPool };