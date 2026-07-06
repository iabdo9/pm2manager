/**
 * PM2 deployment configuration for PM2 Manager itself.
 *
 * Run with:  pm2 start ecosystem.config.js
 *
 * IMPORTANT: use a single instance in fork mode. The app keeps a single
 * better-sqlite3 writer, an in-process metrics collector and one PM2 event-bus
 * subscription — running multiple instances (cluster mode) would duplicate the
 * collector and bus handlers. Scale the *managed* apps, not this manager.
 *
 * Environment is read from the project's `.env` file by the app (via dotenv),
 * so secrets do not need to live in this committed file.
 */
module.exports = {
  apps: [
    {
      name: 'pm2manager',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      // Send timestamps to PM2's own log files.
      time: true,
      out_file: './logs/pm2manager-out.log',
      error_file: './logs/pm2manager-error.log',
    },
  ],
};
