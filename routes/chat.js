const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');

const router = express.Router();

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// Simple in-memory per-IP rate limit for this public, unauthenticated,
// pay-per-call endpoint — same "resets on deploy, fine at this app's scale"
// tradeoff as adminAuth's login lockout, no Redis/external store needed.
const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const requestLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// Built fresh per request from the live database, so the bot never quotes
// stale prices/rooms — same source of truth as the booking page itself.
async function buildSystemPrompt() {
  const [settingsResult, roomsResult, venuesResult] = await Promise.all([
    db.execute('SELECT key, value FROM settings'),
    db.execute("SELECT * FROM rooms WHERE active = 1 ORDER BY price ASC"),
    db.execute('SELECT * FROM venues WHERE active = 1')
  ]);

  const settings = {};
  settingsResult.rows.forEach((row) => { settings[row.key] = row.value; });

  const roomsText = roomsResult.rows.map((r) => {
    const features = JSON.parse(r.features || '[]');
    const tiers = [`Rs. ${r.price}/night for 2 guests`];
    if (r.price_1p) tiers.push(`Rs. ${r.price_1p} for 1 guest`);
    if (r.price_3p) tiers.push(`Rs. ${r.price_3p} for 3 guests`);
    const tag = r.featured ? ' [Signature room — recommend this one when a guest has no strong preference]' : '';
    return `- ${r.name}${tag}: ${tiers.join(', ')}. ${r.description} Amenities: ${features.join(', ') || 'n/a'}.`;
  }).join('\n') || 'No rooms currently listed.';

  const venuesText = venuesResult.rows.map((v) =>
    `- ${v.name} (${v.size_sqft} sq ft, up to ${v.capacity} guests, Rs. ${v.base_day_rate}/day) — Opening Soon, not yet bookable.`
  ).join('\n') || 'No event spaces currently listed.';

  // Derived from the same payment settings the real booking form's payment
  // instructions use — one source of truth, nothing duplicated or hardcoded.
  const paymentLines = [];
  if (settings.payment_bank_name) {
    paymentLines.push(`- Bank transfer: ${settings.payment_bank_name}, account title "${settings.payment_bank_title || ''}", account ${settings.payment_bank_account || 'n/a'}${settings.payment_bank_iban ? `, IBAN ${settings.payment_bank_iban}` : ''}.`);
  }
  if (settings.payment_easypaisa_number) {
    paymentLines.push(`- EasyPaisa: "${settings.payment_easypaisa_title || ''}", ${settings.payment_easypaisa_number}.`);
  }
  if (settings.payment_jazzcash_number) {
    paymentLines.push(`- JazzCash: "${settings.payment_jazzcash_title || ''}", ${settings.payment_jazzcash_number}.`);
  }
  const paymentText = paymentLines.join('\n') || 'Payment details are confirmed directly with the front desk — ask the guest to call or WhatsApp.';

  const offersText = settings.offers_enabled === '1' && settings.offers_text
    ? `\nCURRENT OFFER\n${settings.offers_text}\n`
    : '';

  return `You are the friendly front-desk concierge chatbot for Horizon Inn, a boutique guest house in Peshawar, Pakistan. You chat with prospective and current guests on the hotel's public website.

HOTEL INFO
Address: ${settings.contact_address || 'Peshawar, Pakistan'}
Phone: ${settings.contact_phone || 'see website'}
Email: ${settings.contact_email || 'see website'}
Hours: ${settings.contact_hours || '24/7'}

ROOMS
${roomsText}

AMENITIES & PROPERTY
${settings.amenities_text || 'Ask the front desk for details on amenities.'}

LOCAL AREA
${settings.local_area_text || 'Ask the front desk for directions and nearby landmarks.'}

CRESCENT GROVE EVENT SPACES
${venuesText}

PAYMENT METHODS
${paymentText}
${offersText}
POLICIES
${settings.policies_text || 'Standard hotel policies apply — ask the front desk for specifics.'}

INSTRUCTIONS
- Be warm, concise, and helpful. A few sentences per answer, not an essay.
- Only state facts given above. Never invent room availability for specific dates — you have no live calendar access. Point the guest to the check-in/check-out search on the website, or to call/WhatsApp the number above, to confirm actual availability and book.
- Be a proactive concierge, not just an FAQ lookup: if a guest mentions dates, guest count, or a budget, help by naming the room(s) that fit and their real nightly rate — you can do simple multiplication for a rough total (nights x rate), but always note the front desk confirms the final amount. When a guest has no clear preference, the signature room is a reasonable first suggestion.
- For events, offsites, or conferences, mention the Crescent Grove meeting hall and suggest they enquire directly using the contact details above.
- Always steer an interested guest toward actually booking — either the check-in/check-out search on the site, or calling/WhatsApp-ing the number above — rather than leaving the conversation open-ended.
- If asked something outside a hotel concierge's scope, or something you don't know, say so honestly and suggest contacting the hotel directly.
- Never discuss investors, equity, ownership, or the hotel's internal financials — you are guest-facing only.
- Keep replies short — 2 to 4 sentences, unless the guest explicitly asks for a full list.`;
}

router.post('/', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(503).json({ error: 'Chat is not set up yet — please contact the hotel directly.' });
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: "You're sending messages a bit fast — please wait a moment and try again." });
    }

    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    if (text.length > 1000) {
      return res.status(400).json({ error: 'That message is too long (max 1000 characters).' });
    }

    const system = await buildSystemPrompt();
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: text }]
    });

    const block = message.content && message.content.find((b) => b.type === 'text');
    const reply = block ? block.text : "Sorry, I couldn't come up with a reply — please contact the hotel directly.";
    res.json({ reply });
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: 'Sorry, something went wrong. Please contact the hotel directly or try again in a moment.' });
  }
});

module.exports = router;
module.exports.buildSystemPrompt = buildSystemPrompt; // exposed for local testing/inspection
