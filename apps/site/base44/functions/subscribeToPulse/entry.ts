import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { email } = await req.json().catch(() => ({}));

    const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (clean.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
      return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.Subscriber.filter(
      { email: clean },
      { limit: 1 }
    );

    if (existing.items && existing.items.length > 0) {
      return Response.json({ ok: true, already: true });
    }

    await base44.asServiceRole.entities.Subscriber.create({
      email: clean,
      source: 'site_footer',
      status: 'subscribed',
    });

    return Response.json({ ok: true, already: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}