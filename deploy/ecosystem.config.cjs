/**
 * PM2 ecosystem - CNAR Margarita PMS backend
 * Usado por: pm2 start deploy/ecosystem.config.cjs
 */
module.exports = {
  apps: [{
    name: 'cnar-backend',
    script: './backend/server.js',
    cwd: '/root/cnar',
    instances: 1,                     // 1 = modo fork (no cluster). Usa 'max' para todos los cores
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
    env_file: '/root/cnar/backend/.env',
    out_file: '/var/log/cnar/backend.out.log',
    error_file: '/var/log/cnar/backend.err.log',
    time: true,
    merge_logs: true,
  }],
};
