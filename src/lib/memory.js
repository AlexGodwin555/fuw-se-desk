import { MongoClient } from "mongodb";

const mem = new Map();

function key({ platform, userId, chatId }) {
  return String(platform) + ":" + String(userId) + ":" + String(chatId);
}

async function getCol(mongoUri) {
  if (!mongoUri) return null;
  const client = new MongoClient(mongoUri);
  await client.connect();
  return { client, col: client.db().collection("turns") };
}

export async function addTurn({ mongoUri, platform, userId, chatId, role, text, meta }) {
  const k = key({ platform, userId, chatId });
  const arr = mem.get(k) || [];

  arr.push({
    role,
    text,
    meta: meta || {},
    at: new Date().toISOString(),
  });

  mem.set(k, arr.slice(-30));

  const mc = await getCol(mongoUri).catch(() => null);
  if (!mc) return;

  try {
    await mc.col.insertOne({
      k,
      platform,
      userId,
      chatId,
      role,
      text,
      meta: meta || {},
      at: new Date(),
    });
  } finally {
    await mc.client.close().catch(() => {});
  }
}

export async function getRecentTurns({ mongoUri, platform, userId, chatId, limit = 12 }) {
  const k = key({ platform, userId, chatId });

  const mc = await getCol(mongoUri).catch(() => null);
  if (!mc) return (mem.get(k) || []).slice(-limit);

  try {
    const rows = await mc.col.find({ k }).sort({ at: -1 }).limit(limit).toArray();
    return rows.reverse().map((r) => ({ role: r.role, text: r.text }));
  } finally {
    await mc.client.close().catch(() => {});
  }
}
