# CNAR Margarita — Property Management System

Sistema de Gestión Hotelera para el Centro Nacional de Alto Rendimiento (Isla de Margarita).

## Estructura

```
cnar/
├── backend/      # Node.js + Express + MySQL + JWT + bcrypt
├── frontend/     # React + Vite + Tailwind CSS (Dashboard)
└── database/     # schema.sql + seed.sql
```

## Requisitos
- Node 18+
- MySQL 8+

## Arranque rápido
```bash
# 1) Base de datos
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql

# 2) Backend
cd backend
cp .env.example .env
npm install
npm run dev

# 3) Frontend
cd ../frontend
npm install
npm run dev
```

App:  http://localhost:5173
API:  http://localhost:4000/api

## Roles iniciales
- `superadmin`           — acceso total
- `coord-reception`      — coord. de recepción
- `receptionist`         — recepcionista
- `coord-maintenance`    — coord. de mantenimiento
- `cleaning-staff`       — camareras

(Los slugs exactos son los definidos en `database/seed.sql`.)

## Regla N:M destacada
La tabla `room_cleaning_staff` (PK compuesta `cleaning_id + user_id`)
permite que un aseo sea realizado por **una o varias camareras simultáneamente**.
El endpoint `GET /api/rooms` devuelve la última limpieza de cada habitación
y los nombres de las camareras involucradas en `last_cleaning.staff[]`.
