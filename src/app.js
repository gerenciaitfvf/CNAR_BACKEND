const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const pool    = require('./config/db');

// ---------- CORS: whitelist configurable ----------
// Lista por defecto para desarrollo local + la IP publica del VPS.
// Se puede sobreescribir con la variable de entorno CORS_ORIGINS
// (separada por comas, ejemplo: "http://localhost:5173,http://13.140.141.86").
const DEFAULT_CORS_ORIGINS = [
  'http://localhost',
  'http://localhost:80',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  'http://13.140.141.86',
  'http://13.140.141.86:80',
  'http://13.140.141.86:3000',
  'http://13.140.141.86:4000',
  'http://13.140.141.86:5173',
  'http://13.140.141.86:8080',
  'https://cnar.fvf.com.ve',
];

const allowedOrigins = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS
);

// Normaliza: agrega el origin con y sin "/" final y sin puerto si el usuario
// escribio algo como "http://13.140.141.86/" en la variable de entorno.
const normalizedOrigins = Array.from(new Set(
  allowedOrigins.flatMap(origin => {
    const clean = origin.replace(/\/+$/, '');
    return [clean, `${clean}/`];
  })
));

const corsOptions = {
  origin(origin, callback) {
    // Permitir peticiones sin origin (curl, Postman, server-to-server, health checks)
    if (!origin) return callback(null, true);
    // Autorizar todos los subdominios corporativos fvf.com.ve
    if (/\.fvf\.com\.ve$/i.test(origin)) return callback(null, true);
    if (normalizedOrigins.includes(origin) || normalizedOrigins.includes(origin.replace(/\/+$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

const authRoutes        = require('./routes/auth.routes');
const roomsRoutes       = require('./routes/rooms.routes');
const checkinRoutes     = require('./routes/checkin.routes');
const usersRoutes       = require('./routes/users.routes');
const rolesRoutes       = require('./routes/roles.routes');
const guestsRoutes      = require('./routes/guests.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const cleaningRoutes    = require('./routes/cleaning.routes');
const auditRoutes       = require('./routes/audit.routes');
const { auditMiddleware } = require('./utils/audit');

const app = express();

// El VPS esta detras de nginx: confia en X-Forwarded-For para que req.ip
// devuelva la IP real del cliente (no 127.0.0.1). 1 = el proxy inmediato.
app.set('trust proxy', 1);

app.use(helmet({
  // Permitir que el frontend (mismo VPS, distinto "origen" para el browser
  // en algunos casos) consuma la API sin bloqueos de Helmet.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Auditoria automatica: registra POST/PUT/PATCH/DELETE de usuarios
// autenticados una vez que la respuesta sale. Se monta ANTES de las rutas
// para que res.on('finish') se enganche, pero DESPUES del parser de JSON
// para que req.body este disponible.
app.use(auditMiddleware());

// ---------- Health checks ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cnar-pms-api' }));

// /api/health/db -> prueba la conexion real a MySQL (util para diagnosticar 500s)
app.get('/api/health/db', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok, NOW() AS now, @@version AS version');
    res.json({
      ok: true,
      db: rows[0],
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err.code || 'DB_ERROR',
      message: err.message,
    });
  }
});

// ---------- API routes ----------
app.use('/api/auth',        authRoutes);
app.use('/api/rooms',       roomsRoutes);
app.use('/api/checkin',     checkinRoutes);
app.use('/api/users',       usersRoutes);
app.use('/api/roles',       rolesRoutes);
app.use('/api/guests',      guestsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/cleaning-records', cleaningRoutes);
app.use('/api/audit-logs', auditRoutes);

// 404 explicito
app.use('/api', (_req, res) => res.status(404).json({ ok: false, message: 'Ruta no encontrada' }));

// ---------- Error handler global (con contexto completo para PM2) ----------
app.use((err, req, res, _next) => {
  console.error('[ERROR]', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    code: err.code,
    errno: err.errno,
    sqlState: err.sqlState,
    sqlMessage: err.sqlMessage,
    message: err.message,
    stack: err.stack && err.stack.split('\n').slice(0, 4).join('\n'),
  });
  // Errores de MySQL: ECONNREFUSED, ER_ACCESS_DENIED_ERROR, ER_BAD_DB_ERROR
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return res.status(503).json({
      ok: false,
      error: 'DB_UNREACHABLE',
      message: 'No se pudo conectar a la base de datos. Revisa DB_HOST y el security group del EC2.',
    });
  }
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    return res.status(503).json({
      ok: false,
      error: 'DB_AUTH_FAILED',
      message: 'Credenciales de MySQL invalidas o el usuario no tiene acceso desde esta IP.',
    });
  }
  if (err.code === 'ER_BAD_DB_ERROR') {
    return res.status(503).json({
      ok: false,
      error: 'DB_NOT_FOUND',
      message: 'La base de datos no existe.',
    });
  }
  // Errores lanzados por el middleware de CORS (origen no permitido)
  if (err.message && err.message.startsWith('Origen no permitido por CORS')) {
    return res.status(403).json({
      ok: false,
      error: 'CORS_NOT_ALLOWED',
      message: err.message,
    });
  }
  res.status(err.status || 500).json({
    ok: false,
    message: err.message || 'Error interno del servidor',
  });
});

module.exports = app;
