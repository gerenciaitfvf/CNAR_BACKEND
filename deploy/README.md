# Despliegue en VPS - CNAR Margarita PMS

Despliega el backend (Node/Express) con **PM2** y el frontend (Vite/React) servido por **nginx** como proxy inverso.

## Arquitectura

```
[Cliente] -> http://13.140.141.86/
                |
              [nginx :80]
                |--- /         --> /root/cnar/frontend/dist (estaticos)
                |--- /api/     --> http://127.0.0.1:4000  (PM2: cnar-backend)
                                  |
                                [mysql2] -> 13.59.136.5:3306 (EC2, cnar_fvf)
```

## 1) Preparar el VPS (una sola vez)

```bash
# Conectate por SSH a 13.140.141.86 como root
ssh root@13.140.141.86

# Crea el directorio
mkdir -p /root
cd /root

# Clona el repo (usa HTTPS o configura tu SSH key primero)
git clone https://github.com/gerenciaitfvf/cnar.git
# o:  git clone git@github.com:gerenciaitfvf/cnar.git

cd cnar
```

## 2) Verificar acceso al EC2 (MySQL)

El VPS debe poder llegar al EC2 en `13.59.136.5:3306` (o el que uses). Verifica:

```bash
mysql -h 13.59.136.5 -u wilman -p'Ww050609*' -e "SELECT 1;" cnar_fvf
```

Si falla, agrega una regla de seguridad en el EC2 que permita el puerto 3306 desde la IP del VPS (`13.140.141.86/32`).

## 3) Desplegar

```bash
cd /root/cnar
sudo bash deploy/deploy.sh
```

El script (es idempotente, se puede re-ejecutar):

1. Instala Node.js 20, nginx, PM2 si faltan.
2. Hace `git pull` (o clona si es la primera vez).
3. `npm install --omit=dev` en el backend.
4. Crea `backend/.env` desde la plantilla y genera un `JWT_SECRET` aleatorio (solo la primera vez).
5. `npm install && npm run build` en el frontend → genera `frontend/dist/`.
6. Levanta el backend con `pm2 start deploy/ecosystem.config.cjs`.
7. Configura nginx (`/etc/nginx/sites-available/cnar`) y recarga.
8. Verifica el health check.

## 4) Configurar SSL (opcional, recomendado)

Una vez que el deploy funcione en HTTP, instala certbot y emite un certificado:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d TU_DOMINIO -m tu@email.com --agree-tos
```

## 5) Verificacion

```bash
# Backend
pm2 status
pm2 logs cnar-backend
curl http://localhost:4000/api/health

# Nginx
sudo nginx -t
sudo tail -f /var/log/nginx/cnar.error.log

# App
curl -I http://13.140.141.86/
curl http://13.140.141.86/api/health
```

## 6) Despliegues futuros (actualizar)

### 6.1) Deploy completo (backend + frontend)
Cuando cambian archivos del backend (rutas, SQL, .env, deps) o del frontend:

```bash
cd /root/cnar
git pull          # o ssh+pull
sudo bash deploy/deploy.sh
```

### 6.2) Deploy SOLO del frontend (rapido) — recomendado para cambios de UI
Cuando solo cambian archivos bajo `frontend/` (componentes, estilos,
assets, config de Vite, tailwind, etc.) **no hace falta reiniciar el
backend**. Usa el script liviano:

```bash
cd /root/cnar
sudo bash deploy/deploy-frontend.sh
```

Que hace:
1. `git fetch + reset --hard origin/${BRANCH}` (default: `main`).
2. `npm install --prefer-offline` + `npm run build` en el frontend.
3. `rsync -a --delete frontend/dist/ -> /var/www/cnar/`.
4. `nginx -t && systemctl reload nginx` (NO toca PM2 ni el backend).
5. Verifica que `/` responda 200.

**Regla rapida:**
- Cambiaste un `.jsx`/`.css`/`.html`/asset → `deploy-frontend.sh`.
- Cambiaste algo en `backend/`, `database/`, `deploy/ecosystem.config.cjs`,
  `deploy/nginx-cnar.conf` o `package.json` raiz → `deploy.sh` completo.

Variables utiles:
```bash
sudo BRANCH=develop bash deploy/deploy-frontend.sh    # rama custom
sudo SKIP_NGINX=1 bash deploy-frontend.sh              # no recarga nginx
sudo SKIP_VERIFY=1 bash deploy-frontend.sh             # salta chequeo HTTP
```

## 7) Comandos utiles

| Accion | Comando |
|---|---|
| Deploy solo frontend (sin reiniciar backend) | `sudo bash deploy/deploy-frontend.sh` |
| Deploy completo (backend + frontend) | `sudo bash deploy/deploy.sh` |
| Ver logs del backend | `pm2 logs cnar-backend` |
| Reiniciar backend | `pm2 restart cnar-backend` |
| Estado PM2 | `pm2 status` |
| Recargar nginx | `sudo systemctl reload nginx` |
| Editar .env | `sudo nano /root/cnar/backend/.env` |
| Backup DB | `mysqldump -h 13.59.136.5 -u wilman -p cnar_fvf > backup.sql` |
| Logs nginx access | `sudo tail -f /var/log/nginx/cnar.access.log` |
| Logs nginx error | `sudo tail -f /var/log/nginx/cnar.error.log` |

## Estructura en el VPS

```
/root/cnar/
├── backend/                  # API (Node/Express)
│   ├── .env                  # secretos (chmod 600)
│   ├── server.js
│   └── src/
├── frontend/
│   └── dist/                 # build estatico servido por nginx
├── deploy/
│   ├── deploy.sh             # deploy completo (backend + frontend)
│   ├── deploy-frontend.sh    # deploy SOLO frontend (rapido, no toca PM2)
│   ├── ecosystem.config.cjs  # PM2
│   ├── nginx-cnar.conf       # template nginx
│   ├── env.production.example
│   └── README.md
└── package.json              # root

/var/log/cnar/                # logs del backend (creado por PM2)
/var/log/nginx/cnar.*.log    # logs de nginx
```

## Credenciales iniciales (cambiar ASAP)

- **Superadmin**: `admin@cnar.gob.ve` / `Admin123*`
- **Recepcionista**: `recep@cnar.gob.ve` / `Recep123*`
- **Camareras**: `maria@cnar.gob.ve` / `Limpia123*` (también `jos@`, `ana@`)

## Troubleshooting

| Sintoma | Causa probable | Solucion |
|---|---|---|
| `pm2 status` muestra `errored` | Error de conexion a MySQL | Revisa `pm2 logs cnar-backend` y verifica el `.env` (DB_HOST, DB_PASSWORD) |
| Nginx responde 502 | Backend no escucha en :4000 | `pm2 status` y `pm2 logs cnar-backend` |
| `GET /api/health` da 404 desde el navegador | El proxy de nginx no esta tomando `/api/` | `sudo nginx -t && sudo systemctl reload nginx` |
| Login no funciona tras deploy | JWT_SECRET cambio y los tokens anteriores son invalidos | Normal, solo hay que volver a iniciar sesion |
| El frontend se ve sin estilos | `npm run build` fallo | Borra `frontend/dist` y vuelve a correr el script |
| Puerto 80 ocupado por Apache | Conflicto | `sudo systemctl stop apache2 && sudo systemctl disable apache2` |
