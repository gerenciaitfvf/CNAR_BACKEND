#!/usr/bin/env bash
# =====================================================================
# CNAR Margarita - PMS | Script de despliegue para VPS Ubuntu/Debian
# =====================================================================
# Uso:
#   cd /root/cnar
#   sudo bash deploy/deploy.sh
#
# Variables opcionales (env o como argumento):
#   SKIP_INSTALL=1   -> No instalar Node/nginx/PM2 ni pedir nada
#                       (asume que ya estan en el VPS, como en re-deploys)
#   APP_DIR          -> Directorio de la app (default: /root/cnar)
#   PUBLIC_HOST      -> IP/dominio publico (default: 13.140.141.86)
#   BRANCH           -> Rama git (default: main)
#   SKIP_SSL=1       -> No preguntar por SSL
#
# Es idempotente: se puede correr varias veces de forma segura.
# =====================================================================
set -euo pipefail

# -------- Configuracion ---------------------------------------------
APP_DIR="${APP_DIR:-/root/cnar}"
APP_USER="${APP_USER:-root}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
NODE_VERSION="${NODE_VERSION:-20}"
REPO_URL="${REPO_URL:-git@github.com:gerenciaitfvf/cnar.git}"
BRANCH="${BRANCH:-main}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_SSL="${SKIP_SSL:-0}"

# Auto-detectar IP publica si no se especifica
if [ -z "${PUBLIC_HOST:-}" ]; then
  PUBLIC_HOST=$(curl -fs --max-time 5 https://api.ipify.org 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1 \
    || echo "localhost")
fi

GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; NC=$'\e[0m'
log()   { echo "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn()  { echo "${YELLOW}[WARN]${NC} $*" >&2; }
err()   { echo "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || err "Este script debe ejecutarse como root (sudo bash deploy/deploy.sh)"

# -------- Helpers --------------------------------------------------
# Ejecuta un comando como APP_USER. Si ya somos ese usuario (lo normal
# corriendo como root y APP_USER=root), no usa sudo, porque sudo resetea
# el PATH y pierde ejecutables como npm instalados fuera de /usr/bin
# (ej. nvm: /root/.nvm/versions/node/v24/bin/npm).
as_user() {
  if [ "$(id -un)" = "${APP_USER}" ]; then
    "$@"
  else
    sudo -u "${APP_USER}" "$@"
  fi
}

log "=== CNAR PMS - Despliegue en ${PUBLIC_HOST} ==="
log "APP_DIR=${APP_DIR}  BRANCH=${BRANCH}  SKIP_INSTALL=${SKIP_INSTALL}"

# -------- 1) Dependencias del sistema -------------------------------
if [ "$SKIP_INSTALL" = "1" ]; then
  log "[SKIP_INSTALL=1] Asumiendo Node $(node -v 2>/dev/null || echo '?'), PM2 $(pm2 -v 2>/dev/null || echo '?') y nginx listos."
else
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_VERSION" ]; then
    log "Instalando Node.js ${NODE_VERSION}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
  else
    log "Node $(node -v) ya instalado."
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "Instalando nginx..."
    apt-get install -y nginx
  else
    log "nginx $(nginx -v 2>&1 | head -1) ya instalado."
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Instalando PM2..."
    npm install -g pm2
  else
    log "PM2 $(pm2 -v) ya instalado."
  fi

  command -v git >/dev/null 2>&1 || apt-get install -y git
fi

# -------- 2) Codigo fuente ------------------------------------------
cd "${APP_DIR}" 2>/dev/null || err "No existe ${APP_DIR}. Clona el repo primero: git clone ${REPO_URL}"

if [ ! -d "${APP_DIR}/.git" ]; then
  err "${APP_DIR} existe pero no es un repositorio git. Revisa el path."
fi

# Detectar el estado actual para log
COMMIT_BEFORE=$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || echo "none")
log "Codigo actual: ${COMMIT_BEFORE}"
log "Actualizando rama ${BRANCH}..."
as_user git fetch origin
as_user git reset --hard "origin/${BRANCH}"
COMMIT_AFTER=$(git -C "${APP_DIR}" rev-parse --short HEAD)
log "Codigo nuevo:  ${COMMIT_AFTER}"

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# -------- 3) Backend ------------------------------------------------
log "Instalando dependencias del backend..."
cd "${APP_DIR}/backend"
as_user npm install --omit=dev

# .env del backend - solo se crea si NO existe (no pisar lo que ya esta)
if [ ! -f "${APP_DIR}/backend/.env" ]; then
  log "Creando backend/.env desde plantilla..."
  cp "${APP_DIR}/deploy/env.production.example" "${APP_DIR}/backend/.env"
  if command -v openssl >/dev/null 2>&1; then
    SECRET=$(openssl rand -hex 48)
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=${SECRET}|" "${APP_DIR}/backend/.env"
    log "  JWT_SECRET regenerado automaticamente."
  fi
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/backend/.env"
  chmod 600 "${APP_DIR}/backend/.env"
  warn "backend/.env creado. Si necesitas cambiar DB_PASSWORD u otros secretos, editalo ahora."
else
  log "backend/.env ya existe - se conserva (no se sobreescribe)."
fi

# -------- 4) Frontend (build) -------------------------------------
log "Instalando dependencias del frontend..."
cd "${APP_DIR}/frontend"
as_user npm install

log "Compilando frontend (produccion)..."
as_user npm run build

# Copia el dist a /var/www/cnar para evitar el AppArmor de nginx.
# El paquete nginx de Ubuntu trae un perfil que solo permite leer
# directorios estandar (/var/www, /usr/share/nginx). Como nuestro
# dist vive en /root/cnar, nginx no puede leerlo (EACCES 13).
# La copia a /var/www/cnar resuelve esto y es la convencion en Ubuntu.
WEB_ROOT="/var/www/cnar"
log "Publicando frontend en ${WEB_ROOT}..."
mkdir -p "${WEB_ROOT}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${APP_DIR}/frontend/dist/" "${WEB_ROOT}/"
else
  # Fallback: rm + cp recursivo (no instala rsync si no esta)
  rm -rf "${WEB_ROOT:?}"/*
  cp -r "${APP_DIR}/frontend/dist/." "${WEB_ROOT}/"
fi
chown -R www-data:www-data "${WEB_ROOT}"
chmod -R 755 "${WEB_ROOT}"

# -------- 5) PM2 (backend como daemon) ------------------------------
log "Reiniciando backend con PM2..."
cd "${APP_DIR}"
pm2 delete cnar-backend >/dev/null 2>&1 || true
as_user pm2 start "${APP_DIR}/deploy/ecosystem.config.cjs"
as_user pm2 save
# startup se ejecuta una sola vez. Usamos $(getent passwd APP_USER | cut -d: -f6)
# para resolver el home real (puede ser /home/X o /root).
USER_HOME="$(getent passwd "${APP_USER}" 2>/dev/null | cut -d: -f6)"
if [ -n "${USER_HOME}" ]; then
  pm2 startup systemd -u "${APP_USER}" --hp "${USER_HOME}" 2>/dev/null || true
fi

# -------- 6) Nginx (reverse proxy + frontend) ----------------------
log "Actualizando configuracion de nginx..."
mkdir -p /var/log/nginx

# Genera el archivo del sitio. Si el sed falla o el template no existe, aborta.
if [ ! -f "${APP_DIR}/deploy/nginx-cnar.conf" ]; then
  err "No existe ${APP_DIR}/deploy/nginx-cnar.conf. ¿Clonaste el repo completo?"
fi
sed "s|__APP_DIR__|${APP_DIR}|g; s|__BACKEND_PORT__|${BACKEND_PORT}|g; s|__PUBLIC_HOST__|${PUBLIC_HOST}|g" \
  "${APP_DIR}/deploy/nginx-cnar.conf" > /etc/nginx/sites-available/cnar
chmod 644 /etc/nginx/sites-available/cnar

# Verificar que el archivo se creo y no quedo vacio
if [ ! -s /etc/nginx/sites-available/cnar ]; then
  err "El archivo /etc/nginx/sites-available/cnar quedo vacio. Revisa el sed y el template."
fi

ln -sf /etc/nginx/sites-available/cnar /etc/nginx/sites-enabled/cnar
# Quitamos default y phpmyadmin para que NO capturen el trafico de nuestro sitio
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/phpmyadmin

# Verificar que el dist del frontend existe y es legible POR NGINX
if [ ! -f "${APP_DIR}/frontend/dist/index.html" ]; then
  err "No existe ${APP_DIR}/frontend/dist/index.html. Reconstruye: cd ${APP_DIR}/frontend && npm run build"
fi
if [ ! -f "/var/www/cnar/index.html" ]; then
  err "No se copio el dist a /var/www/cnar/index.html. Revisa la seccion 'Publicando frontend'."
fi
chmod 755 /var/www/cnar

# Validar sintaxis antes de recargar (si falla, no recargues)
if ! nginx -t 2>&1; then
  err "nginx -t fallo. Revisa /var/log/nginx/error.log y el contenido de /etc/nginx/sites-available/cnar"
fi
systemctl reload nginx
systemctl enable nginx
log "nginx recargado OK."

# -------- 7) Verificacion ------------------------------------------
sleep 2

log "Verificando health check del backend (PM2 :${BACKEND_PORT})..."
HEALTH=$(curl -s "http://127.0.0.1:${BACKEND_PORT}/api/health" || echo "")
if echo "$HEALTH" | grep -q '"ok":true'; then
  log "Backend OK -> $HEALTH"
else
  warn "El backend no respondio. Revisa: pm2 logs cnar-backend"
fi

log "Verificando nginx..."
if ! systemctl is-active --quiet nginx 2>/dev/null; then
  warn "nginx NO esta corriendo. Intentando levantar..."
  systemctl start nginx || warn "No se pudo iniciar nginx. Revisa: systemctl status nginx"
fi

if [ ! -f "${APP_DIR}/frontend/dist/index.html" ]; then
  warn "No existe ${APP_DIR}/frontend/dist/index.html - el frontend no se construyo correctamente."
  warn "Corre: cd ${APP_DIR}/frontend && npm run build"
else
  log "Frontend dist OK ($(du -sh "${APP_DIR}/frontend/dist" | cut -f1))"
fi

NGX_FRONT=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1/" || echo "000")
NGX_API=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1/api/health" || echo "000")
log "Test HTTP local:  /         -> ${NGX_FRONT}"
log "Test HTTP local:  /api/health -> ${NGX_API}"

# Verificacion critica: si el proxy de /api no funciona, el frontend
# va a mostrar errores 500/404. Abortamos con un mensaje claro.
if [ "$NGX_API" != "200" ]; then
  err "El proxy /api -> backend NO responde 200 (dio ${NGX_API}).
  Diagnostico:
    1) cat /etc/nginx/sites-available/cnar   (debe existir y tener 'location /api/')
    2) ls -la /etc/nginx/sites-enabled/       (debe haber un symlink a 'cnar')
    3) sudo nginx -T | grep -A 8 'location /api/'  (debe aparecer)
    4) tail -30 /var/log/nginx/error.log
  Si el archivo no existe, el script probablemente fallo en un paso
  anterior (npm no encontrado, etc). Vuelve a correr con:
    sudo bash deploy/deploy.sh"
fi

if [ "$NGX_FRONT" != "200" ]; then
  log "Mostrando log de errores de nginx para diagnosticar:"
  sudo tail -20 /var/log/nginx/cnar.error.log 2>/dev/null \
    || tail -20 /var/log/nginx/error.log 2>/dev/null \
    || warn "No se pudo leer el log de nginx"
  err "nginx no responde 200 en / (dio ${NGX_FRONT}). Revisa arriba.
  Causas comunes:
    - Otro server block (ej. phpmyadmin en /etc/nginx/sites-available) tiene default_server
    - Permisos del dist: ls -la ${APP_DIR}/frontend/dist/index.html
    - Path del root en la config: grep -A 2 'root ' /etc/nginx/sites-available/cnar"
fi

# -------- 8) SSL opcional con Let's Encrypt -----------------------
if [ "$SKIP_SSL" = "0" ] && command -v certbot >/dev/null 2>&1 && [ -t 0 ]; then
  read -rp "¿Configurar SSL con Let's Encrypt para ${PUBLIC_HOST}? [y/N] " SSL_ANS
  if [[ "$SSL_ANS" =~ ^[Yy]$ ]]; then
    certbot --nginx -d "${PUBLIC_HOST}" --non-interactive --agree-tos -m "admin@${PUBLIC_HOST}" || warn "certbot fallo, configura SSL manualmente"
  fi
fi

echo
echo "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo "${GREEN}║                       DESPLIEGUE COMPLETADO                          ║${NC}"
echo "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo
echo "${GREEN}  Accede al sistema en:${NC}"
echo
echo "      ${GREEN}http://${PUBLIC_HOST}/${NC}"
echo
echo "  API:    http://${PUBLIC_HOST}/api/health"
echo "  Commit: ${COMMIT_AFTER}"
echo "  Estado: backend $([ -n "$HEALTH" ] && echo 'OK' || 'CON PROBLEMAS') | nginx ${NGX_FRONT:-?} | /api/health ${NGX_API:-?}"
echo
echo "  Login inicial (cambialo en el primer ingreso):"
echo "    email:    admin@cnar.gob.ve"
echo "    password: Admin123*"
echo
echo "  Comandos utiles:"
echo "    pm2 logs cnar-backend             # ver logs del backend"
echo "    pm2 restart cnar-backend          # reiniciar el backend"
echo "    pm2 status                        # estado de PM2"
echo "    systemctl status nginx            # estado de nginx"
echo "    tail -f /var/log/nginx/cnar.error.log  # logs de nginx"
echo "    tail -f /var/log/cnar/backend.err.log # logs del backend"
echo
echo "  Si el puerto 80 esta cerrado en el firewall del VPS:"
echo "    ufw allow 80/tcp   # o: iptables -A INPUT -p tcp --dport 80 -j ACCEPT"
echo
