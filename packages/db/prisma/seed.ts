import { PrismaClient, Role, EventStatus } from "@prisma/client";
import { createHmac } from "crypto";

const prisma = new PrismaClient();

function signQr(eventId: string, userId: string) {
  const secret = process.env.JWT_SECRET ?? "dev-secret";
  return `EL:${eventId}:${userId}:${createHmac("sha256", secret).update(`${eventId}:${userId}`).digest("hex").slice(0, 16)}`;
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@essentials.example" },
    update: {},
    create: {
      email: "admin@essentials.example",
      name: "ESSENTIALS Admin",
      role: Role.admin,
      verifiedBadge: true,
      referralCode: "ADM-001",
    },
  });

  const promoter = await prisma.user.upsert({
    where: { email: "promoter@essentials.example" },
    update: {},
    create: {
      email: "promoter@essentials.example",
      name: "Demo Promoter",
      role: Role.promoter,
      referralCode: "PROM-001",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "venue@essentials.example" },
    update: {},
    create: { email: "venue@essentials.example", name: "Venue Manager", role: Role.venue_manager, referralCode: "VNM-001" },
  });

  const venue = await prisma.venue.upsert({
    where: { id: "demo-venue" },
    update: {},
    create: {
      id: "demo-venue",
      name: "The Warehouse",
      address: "40 Rubber Rd, Cape Town",
      lat: -33.9249,
      lng: 18.4241,
      capacity: 250,
      amenities: ["Sound 4K", "VIP area", "Rooftop"],
      managerId: manager.id,
    },
  });

  for (const t of [
    { tableNumber: "T1", capacity: 6, minSpend: 5000 },
    { tableNumber: "T2", capacity: 8, minSpend: 8000 },
    { tableNumber: "T3", capacity: 4, minSpend: 3500 },
  ]) {
    await prisma.venueTable.upsert({
      where: { venueId_tableNumber: { venueId: venue.id, tableNumber: t.tableNumber } },
      update: {},
      create: { venueId: venue.id, ...t },
    });
  }

  const demoEvent = await prisma.event.upsert({
    where: { id: "demo-event" },
    update: {},
    create: {
      id: "demo-event",
      venueId: venue.id,
      promoterId: promoter.id,
      title: "ESSENTIALS: Amapiano Sunrise",
      description: "Rooftop opener. Afro & Amapiano till late.",
      date: new Date(Date.now() + 6 * 24 * 3600 * 1000),
      lineup: [
        { artistName: "DJ Mkhize", slot: "evening" },
        { artistName: "KAT SOUNDS", slot: "late-night" },
      ],
      capacity: 250,
      dressCode: "Smart casual",
      status: EventStatus.approved,
    },
  });

  await prisma.eventGroupChat.upsert({
    where: { eventId: demoEvent.id },
    update: {},
    create: { eventId: demoEvent.id },
  });

  await prisma.emailSegment.upsert({
    where: { id: "seg-techno-loyal" },
    update: {},
    create: {
      id: "seg-techno-loyal",
      name: "Techno fans who attended the last 3 events",
      filter: { musicTastes: ["Techno"], minAttendedEvents: 3 },
    },
  });

  // 12 demo guests, RSVP'd
  for (let i = 1; i <= 12; i++) {
    const u = await prisma.user.upsert({
      where: { email: `guest${i}@essentials.example` },
      update: {},
      create: {
        email: `guest${i}@essentials.example`,
        name: `Guest ${i}`,
        role: Role.guest,
        musicTastes: [i % 2 ? "Techno" : "Amapiano"],
        vibeTag: i % 3 === 0 ? "Chill" : "Party",
        referralCode: `GST-${String(i).padStart(3, "0")}`,
      },
    });
    await prisma.guestList.upsert({
      where: { eventId_userId: { eventId: demoEvent.id, userId: u.id } },
      update: {},
      create: {
        eventId: demoEvent.id,
        userId: u.id,
        status: "attending",
        qrCode: signQr(demoEvent.id, u.id),
      },
    });
    for (let v = 1; v <= (i % 5) + 1; v++) {
      await prisma.loyaltyVisit.upsert({
        where: { userId_eventId: { userId: u.id, eventId: `past-${v}` } },
        update: {},
        create: { userId: u.id, eventId: `past-${v}`, visits: v },
      });
    }
  }

  console.log("Seed complete. Admin:", admin.email, "Event:", demoEvent.id);
}

main().finally(() => prisma.$disconnect());
