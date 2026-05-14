require('dotenv').config();

const { connectDatabase } = require('./config/database');
const { createApp } = require('./app');

async function main() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  await connectDatabase();

  // Listen after DB so requests never hit Mongoose before the connection is ready.
  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on port ${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

main().catch(() => {
  process.exit(1);
});
