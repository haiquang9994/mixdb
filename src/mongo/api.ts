import { invoke } from "@tauri-apps/api/core";
import type { MongoCollectionPage } from "../types";
import type { TypedDocument, TypedValue } from "./bsonTypes";
import type { MongoFilter } from "./filters";

export function mongoListDatabases(id: string): Promise<string[]> {
  return invoke<string[]>("mongo_list_databases", { id });
}

export function mongoServerInfo(id: string): Promise<{ version: string; os: string }> {
  return invoke<{ version: string; os: string }>("mongo_server_info", { id });
}

export function mongoListCollections(id: string, db: string): Promise<string[]> {
  return invoke<string[]>("mongo_list_collections", { id, db });
}

export interface MongoDocumentPage {
  documents: TypedDocument[];
  total: number;
}

/**
 * Reads one page of a collection. `filters` narrows it down first, ANDed together — the page's
 * `total` counts what is left after them.
 */
export function mongoCollectionPage(
  id: string,
  db: string,
  collection: string,
  page: number,
  pageSize: number,
  filters: MongoFilter[] = [],
): Promise<MongoDocumentPage> {
  return invoke<MongoCollectionPage>("mongo_collection_page", {
    id,
    db,
    collection,
    page,
    pageSize,
    filters,
  }).then((result) => ({ documents: result.documents as TypedDocument[], total: result.total }));
}

/** `count` ids to prefill new documents with — fresh ObjectIds, or the next numbers along when
 * the collection is keyed by numbers. Ids are derived from what is in the collection *now*, so
 * two calls hand back the same numbers: ask for as many as the form holds in one go rather
 * than one at a time. */
export function mongoNextIds(
  id: string,
  db: string,
  collection: string,
  count: number,
): Promise<TypedValue[]> {
  return invoke<TypedValue[]>("mongo_next_ids", { id, db, collection, count });
}

/** Writes new documents, in order. Resolves to how many were inserted; a rejection can still
 * leave the documents before the failing one written, so refetch either way. */
export function mongoInsertDocuments(
  id: string,
  db: string,
  collection: string,
  documents: TypedDocument[],
): Promise<number> {
  return invoke<number>("mongo_insert_documents", { id, db, collection, documents });
}

export interface DocUpdateOps {
  set: Record<string, TypedValue>;
  unset: string[];
  rename: Record<string, string>;
}

export function mongoUpdateDocument(
  id: string,
  db: string,
  collection: string,
  docId: TypedValue,
  ops: DocUpdateOps,
): Promise<void> {
  return invoke<void>("mongo_update_document", { id, db, collection, docId, ops });
}

export function mongoDeleteDocument(
  id: string,
  db: string,
  collection: string,
  docId: TypedValue,
): Promise<void> {
  return invoke<void>("mongo_delete_document", { id, db, collection, docId });
}
