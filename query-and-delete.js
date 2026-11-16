const { Pool } = require('./node_modules/pg');

async function main() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'essentials',
    user: 'essentials',
    password: '7bf0871407f53f1ab54d7f0a',
  });
  
  try {
    const client = await pool.connect();
    
    // Query events
    const eventsRes = await client.query('SELECT id, title, venueId FROM event ORDER BY title');
    console.log('=== EVENTS ===');
    eventsRes.rows.forEach(e => console.log(e.id, ':', e.title, '| venueId:', e.venueId));
    
    // Query venues
    const venuesRes = await client.query('SELECT id, name, address FROM venue ORDER BY name');
    console.log('=== VENUES ===');
    venuesRes.rows.forEach(v => console.log(v.id, ':', v.name, '| address:', v.address));
    
    client.release();
    
    // Check for events with "sunday" in title
    const sundayEvents = eventsRes.rows.filter(e => e.title.toLowerCase().includes('sunday'));
    console.log('\nEvents with "sunday" in title:', sundayEvents.length);
    
    // Check for venues with "opium" in name
    const opiumVenues = venuesRes.rows.filter(v => v.name.toLowerCase().includes('opium'));
    console.log('Venues with "opium" in name:', opiumVenues.length);
    
    // Check for venues with no address
    const venuesNoAddress = venuesRes.rows.filter(v => !v.address);
    console.log('Venues with no address:', venuesNoAddress.length);
    
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await pool.end();
  }
}

main();
