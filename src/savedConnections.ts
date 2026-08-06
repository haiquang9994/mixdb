import { Store } from "@tauri-apps/plugin-store";
import type { SavedConnection } from "./types";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load("connections.json");
  }
  return storePromise;
}

export async function loadSavedConnections(): Promise<SavedConnection[]> {
  const store = await getStore();
  return (await store.get<SavedConnection[]>("saved")) ?? [];
}

async function persist(list: SavedConnection[]): Promise<void> {
  const store = await getStore();
  await store.set("saved", list);
  await store.save();
}

export async function addSavedConnection(entry: SavedConnection): Promise<SavedConnection[]> {
  const list = await loadSavedConnections();
  const next = [...list, entry];
  await persist(next);
  return next;
}

export async function updateSavedConnection(entry: SavedConnection): Promise<SavedConnection[]> {
  const list = await loadSavedConnections();
  const next = list.map((c) => (c.id === entry.id ? entry : c));
  await persist(next);
  return next;
}

export async function removeSavedConnection(id: string): Promise<SavedConnection[]> {
  const list = await loadSavedConnections();
  const next = list.filter((c) => c.id !== id);
  await persist(next);
  return next;
}
