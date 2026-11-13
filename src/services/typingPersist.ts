import { invoke } from '@tauri-apps/api/core';
import { isTauriEnvironment } from './api';

const STORE = 'typing.sqlite';

export async function loadDatabaseBytes(): Promise<Uint8Array | null> {
  if (isTauriEnvironment()) {
    const data = await invoke<string | null>('typing_load_database');
    return data ? decodeBase64(data) : null;
  }
  const buffer = await idbGet(STORE);
  return buffer ? new Uint8Array(buffer) : null;
}

export async function saveDatabaseBytes(bytes: Uint8Array): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke('typing_save_database', { data: encodeBase64(bytes) });
    return;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await idbSet(STORE, copy.buffer);
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    text += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(text);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function openKv(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('doc-tools', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openKv();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      request.onsuccess = () => resolve((request.result as ArrayBuffer | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('无法读取本地数据库'));
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openKv();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('kv', 'readwrite');
      transaction.objectStore('kv').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('保存已中断'));
      transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地数据库'));
    });
  } finally {
    db.close();
  }
}
