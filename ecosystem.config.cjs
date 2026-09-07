module.exports = {
  apps: [{
    name: 'just-blame-cloudflare',
    cwd: __dirname,
    script: './start.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '384M',
    kill_timeout: 6000,
    time: true,
    env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '8080', TRUST_PROXY: 'true' },
  }],
};
