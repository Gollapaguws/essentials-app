process.env.DATABASE_URL = "postgresql://essentials:7bf0871407f53f1ab54d7f0a@localhost:5433/essentials?schema=public";
const {PrismaClient} = require("./node_modules/@prisma/client");
const p = new PrismaClient();
async function main() {
  try {
    await p.$connect();
    const events = await p.event.findMany({select: {id: true, title: true, venueId: true}, orderBy: {title: "asc"}});
    console.log("=== EVENTS ===");
    events.forEach(e => console.log(e.id, ":", e.title));
    
    const venues = await p.venue.findMany({select: {id: true, name: true, address: true}, orderBy: {name: "asc"}});
    console.log("=== VENUES ===");
    venues.forEach(v => console.log(v.id, ":", v.name, "| address:", v.address));
    
    await p.$disconnect();
  } catch(e) {
    console.error("Error:", e.message);
  }
}
main();
