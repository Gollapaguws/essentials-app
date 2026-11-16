async function main() {
  // Try docker-compose credentials on port 5432
  const { PrismaClient } = require('./node_modules/@prisma/client');
  const p = new PrismaClient();
  process.env.DATABASE_URL = 'postgresql://essentials:essentials@localhost:5432/essentials?schema=public';
  try {
    await p.$connect();
    console.log('SUCCESS with docker-compose credentials on port 5432!');
    const events = await p.event.findMany({ select: { id: true, title: true } });
    console.log('Events:', events.length);
    const venues = await p.venue.findMany({ select: { id: true, name: true, address: true } });
    console.log('Venues:', venues.length);
    await p.$disconnect();
  } catch (e) {
    console.log('Failed:', e.message.split('\n')[0]);
    await p.$disconnect();
  }
}
main();
