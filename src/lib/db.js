import { MongoClient } from "mongodb";
import { cfg } from "./config.js";
import { log, safeErr } from "./log.js";

let client = null;
let db = null;
let indexesReady = false;

export async function getDb() {
  if (db) return db;
  if (!cfg.MONGODB_URI) return null;

  try {
    client = new MongoClient(cfg.MONGODB_URI, { ignoreUndefined: true });
    await client.connect();
    db = client.db();
    log.info("db connected", { mongoSet: true });
    await ensureIndexes();
    return db;
  } catch (err) {
    log.error("db connect failed", { err: safeErr(err) });
    client = null;
    db = null;
    return null;
  }
}

export async function ensureIndexes() {
  if (!db || indexesReady) return;

  try {
    await db.collection("turns").createIndex({ k: 1, at: -1 });
    await db.collection("whatsapp_session_state").createIndex({ k: 1 }, { unique: true });
    await db.collection("whatsapp_session_state").createIndex({ updatedAt: -1 });
    indexesReady = true;
  } catch (err) {
    log.error("db index failed", { collection: "turns/session_state", operation: "createIndex", err: safeErr(err) });
  }
}

export async function closeDb() {
  if (!client) return;
  await client.close().catch((err) => {
    log.error("db close failed", { err: safeErr(err) });
  });
  client = null;
  db = null;
  indexesReady = false;
}
