import { MongoClient } from "mongodb";

const mem = new Map();

function stateKey({ chatId, userId }) {
  return String(chatId || "chat") + ":" + String(userId || "user");
}

async function getCol(mongoUri) {
  if (!mongoUri) return null;
  const client = new MongoClient(mongoUri);
  await client.connect();
  return { client, col: client.db().collection("whatsapp_session_state") };
}

export async function getState({ mongoUri, chatId, userId }) {
  const k = stateKey({ chatId, userId });

  const mc = await getCol(mongoUri).catch(() => null);
  if (!mc) return mem.get(k) || null;

  try {
    return await mc.col.findOne({ k });
  } finally {
    await mc.client.close().catch(() => {});
  }
}

export async function setState({ mongoUri, chatId, userId, state }) {
  const k = stateKey({ chatId, userId });
  const doc = { k, chatId, userId, ...(state || {}), updatedAt: new Date() };

  mem.set(k, doc);

  const mc = await getCol(mongoUri).catch(() => null);
  if (!mc) return doc;

  try {
    await mc.col.updateOne({ k }, { $set: doc }, { upsert: true });
    return doc;
  } finally {
    await mc.client.close().catch(() => {});
  }
}

export async function clearState({ mongoUri, chatId, userId }) {
  const k = stateKey({ chatId, userId });
  mem.delete(k);

  const mc = await getCol(mongoUri).catch(() => null);
  if (!mc) return;

  try {
    await mc.col.deleteOne({ k });
  } finally {
    await mc.client.close().catch(() => {});
  }
}
