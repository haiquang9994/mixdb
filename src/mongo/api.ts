import { invoke } from "@tauri-apps/api/core";
import type { MongoCollectionPage } from "../types";
import type { TypedDocument, TypedValue } from "./bsonTypes";

export function mongoListDatabases(id: string): Promise<string[]> {
  return invoke<string[]>("mongo_list_databases", { id });
}

export function mongoListCollections(id: string, db: string): Promise<string[]> {
  return invoke<string[]>("mongo_list_collections", { id, db });
}

export interface MongoDocumentPage {
  documents: TypedDocument[];
  total: number;
}

export function mongoCollectionPage(
  id: string,
  db: string,
  collection: string,
  page: number,
  pageSize: number,
): Promise<MongoDocumentPage> {
  return invoke<MongoCollectionPage>("mongo_collection_page", { id, db, collection, page, pageSize }).then(
    (result) => ({ documents: result.documents as TypedDocument[], total: result.total }),
  );
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
