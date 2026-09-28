#!/usr/bin/env bash
# =====================================================================
# CNAR Margarita - PMS | Despliegue SOLO del frontend
# =====================================================================
# Pensado para cuando SOLO cambian archivos bajo frontend/ (componentes,
# estilos, assets, configuracion de Vite, etc.) y no hace falta
# reiniciar el backend Node.
#
# Uso (en el VPS, como root):
#   cd /root/cnar
#   sudo bash deploy/deploy-frontend.sh
#
# Variables opcionales (env):
#   APP_DIR          -> Directorio de la app (default: /root/cnar)
#   BRANCH           -> Rama git (default: main)
#   SKIP_NGINX=1     -> No recargar nginx al final
#   SKIP_VERIFY=1    -> No correr la verificacion HTTP final
#
# Es idempotente: se puede correr varias veces de forma segura.
# =====================================================================
set -euo pipefail

# -------- Configuracion ---------------------------------------------
APP_DIR="${APP_DIR:-/root/cnar}"
APP_USER="${APP_USER:-root}"
BRANCH="${BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/cnar}"
SKIP_NGINX="${SKIP_NGINX:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; NC=$'\e[0m'
log()   { echo "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn()  { echo "${YELLOW}[WARN]${NC} $*" >&2; }
err()   { echo "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || err "Este script debe ejecutarse como root (sudo bash deploy/deploy-frontend.sh)"

# Si ya somos APP_USER (caso normal corriendo como root), no usamos sudo
# porque sudo resetea el PATH y pierde npm si esta fuera de /usr/bin (nvm, etc).
as_user() {
  if [ "$(id -un)" = "${APP_USER}" ]; then
    "$@"
  else
    sudo -u "${APP_USER}" "$@"
  fi
}

log "=== CNAR PMS - Deploy SOLO frontend (rama ${BRANCH}) ==="
log "APP_DIR=${APP_DIR}  WEB_ROOT=${WEB_ROOT}"

# -------- 1) Codigo fuente ------------------------------------------
cd "${APP_DIR}" 2>/dev/null || err "No existe ${APP_DIR}. Clona el repo primero."
[ -d "${APP_DIR}/.git" ] || err "${APP_DIR} no es un repositorio git."

COMMIT_BEFORE=$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || echo "none")
log "Codigo actual: ${COMMIT_BEFORE}"
log "Actualizando rama ${BRANCH}..."
as_user git fetch origin
as_user git reset --hard "origin/${BRANCH}"
COMMIT_AFTER=$(git -C "${APP_DIR}" rev-parse --short HEAD)
log "Codigo nuevo:  ${COMMIT_AFTER}"

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# -------- 2) Build del frontend -------------------------------------
log "Instalando dependencias del frontend (si hace falta)..."
cd "${APP_DIR}/frontend"
# --prefer-offline evita pegar contra el registro si no hay cambios en
# package.json; igual baja lo nuevo si package-lock.json cambio.
as_user npm install --prefer-offline --no-audit --no-fund

log "Compilando frontend (produccion)..."
as_user npm run build

[ -f "${APP_DIR}/frontend/dist/index.html" ] \
  || err "No se genero frontend/dist/index.html. Revisa la salida de 'npm run build'."

# -------- 3) Publicar en /var/www/cnar -----------------------------
# Copia a /var/www para esquivar el AppArmor de nginx en Ubuntu
# (ver nota completa en deploy.sh).
log "Publicando frontend en ${WEB_ROOT}..."
mkdir -p "${WEB_ROOT}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${APP_DIR}/frontend/dist/" "${WEB_ROOT}/"
else
  rm -rf "${WEB_ROOT:?}"/*
  cp -r "${APP_DIR}/frontend/dist/." "${WEB_ROOT}/"
fi
chown -R www-data:www-data "${WEB_ROOT}"
chmod -R 755 "${WEB_ROOT}"
chmod 755 "${WEB_ROOT}"

# -------- 4) Recargar nginx (NO reinicia el backend) ----------------
if [ "$SKIP_NGINX" = "1" ]; then
  log "[SKIP_NGINX=1] No se recarga nginx."
else
  log "Recargando nginx..."
  if ! command -v nginx >/dev/null 2>&1; then
    err "nginx no esta instalado. Corre primero deploy/deploy.sh para instalarlo."
  fi
  if ! nginx -t 2>&1; then
    err "nginx -t fallo. Revisa /var/log/nginx/error.log"
  fi
  systemctl reload nginx || warn "No se pudo recargar nginx. Revisa: systemctl status nginx"
fi

# -------- 5) Verificacion -------------------------------------------
if [ "$SKIP_VERIFY" = "1" ]; then
  log "[SKIP_VERIFY=1] Verificacion HTTP omitida."
else
  sleep 1
  CODE_FRONT=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1/" || echo "000")
  CODE_API=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1/api/health" || echo "000")
  log "Test HTTP local:  /          -> ${CODE_FRONT}"
  log "Test HTTP local:  /api/health -> ${CODE_API} (backend sin reiniciar)"

  if [ "$CODE_FRONT" != "200" ]; then
    err "nginx no responde 200 en / (dio ${CODE_FRONT}). Revisa /var/log/nginx/cnar.error.log"
  fi
fi

# -------- 6) Resumen -------------------------------------------------
echo
echo "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo "${GREEN}║              DEPLOY FRONTEND COMPLETADO                              ║${NC}"
echo "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo
echo "  Commit:        ${COMMIT_BEFORE} -> ${COMMIT_AFTER}"
echo "  Frontend dist: $(du -sh "${APP_DIR}/frontend/dist" 2>/dev/null | cut -f1) en ${WEB_ROOT}"
echo "  Backend:       SIN CAMBIOS (PM2 no se toco)"
echo "  nginx:         recargado (nuevo dist servido)"
echo
echo "  Si algo se ve raro:"
echo "    - Refresca con Ctrl+Shift+R (los assets con hash suelen quedar en cache)"
echo "    - tail -f /var/log/nginx/cnar.error.log"
echo "    - Si el problema es del backend, corre: pm2 logs cnar-backend"
echo
