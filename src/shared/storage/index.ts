import { useEffect, useSyncExternalStore } from 'react'
import { emptyFieldData, type FieldData } from '../model'
import { castSchema, chartSchema, fieldDataSchema, sessionSchema, validateFieldData } from './schema'

export { castSchema, chartSchema, fieldDataSchema, sessionSchema, validateFieldData }

type StoreState = { data: FieldData; loading: boolean; error: string | null }
const initialState: StoreState = { data: emptyFieldData, loading: true, error: null }
let state = initialState
let loaded = false
let portable = false
let loadPromise: Promise<void> | null = null
let databasePromise: Promise<IDBDatabase> | null = null
let updateTail: Promise<unknown> = Promise.resolve()
let refreshListenersReady = false
let refreshVersion = 0
let channel: BroadcastChannel | null = null
const listeners = new Set<() => void>()

function publish(next: StoreState) {
  state = next
  listeners.forEach((listener) => listener())
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось сохранить данные на этом устройстве.'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступна. Проверьте настройки браузера.'))
      return
    }
    let request: IDBOpenDBRequest
    try { request = indexedDB.open('marker-field', 1) }
    catch (error) { reject(error); return }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state')
    }
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB.'))
    request.onblocked = () => reject(new Error('Хранилище занято другой вкладкой. Закройте её и повторите.'))
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => { database.close(); databasePromise = null }
      resolve(database)
    }
  }).catch((error) => { databasePromise = null; throw error })
  return databasePromise!
}

function interruptFalling(data: FieldData): FieldData {
  if (data.draft?.stage !== 'falling') return data
  return {
    ...data,
    draft: { ...data.draft, stage: 'interrupted', startedAt: null, fallSeconds: null, fallInterrupted: true },
  }
}

function transact(transform: (current: FieldData) => FieldData, forceWrite = true): Promise<FieldData> {
  return openDatabase().then((database) => new Promise<FieldData>((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite')
    const store = transaction.objectStore('state')
    const request = store.get('field')
    let next: FieldData = emptyFieldData
    let thrown: unknown = null
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? emptyFieldData : validateFieldData(request.result)
        const editable = structuredClone(current)
        const transformed = transform(editable)
        next = validateFieldData(transformed)
        if (forceWrite || request.result === undefined || transformed !== editable) store.put(next, 'field')
      } catch (error) {
        thrown = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(next)
    transaction.onabort = () => reject(thrown ?? transaction.error ?? new Error('Запись в IndexedDB отменена.'))
    transaction.onerror = () => { /* onabort carries the transaction error */ }
  }))
}

function readSnapshot(): Promise<FieldData> {
  return openDatabase().then((database) => new Promise<FieldData>((resolve, reject) => {
    const request = database.transaction('state', 'readonly').objectStore('state').get('field')
    request.onsuccess = () => {
      try { resolve(request.result === undefined ? emptyFieldData : validateFieldData(request.result)) }
      catch (error) { reject(error) }
    }
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать IndexedDB.'))
  }))
}

function refreshFromDatabase() {
  if (!loaded || portable) return
  const version = ++refreshVersion
  void updateTail.then(readSnapshot).then((data) => {
    if (!portable && version === refreshVersion) publish({ data, loading: false, error: null })
  }).catch((error) => {
    if (!portable && version === refreshVersion) publish({ ...state, loading: false, error: message(error) })
  })
}

function ensureRefreshListeners() {
  if (refreshListenersReady || typeof window === 'undefined') return
  refreshListenersReady = true
  window.addEventListener('focus', refreshFromDatabase)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromDatabase()
  })
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('marker-field')
    channel.onmessage = refreshFromDatabase
  }
}

export function initializePortableStore(data: FieldData): void {
  refreshVersion++
  portable = true
  loaded = true
  loadPromise = null
  publish({ data: validateFieldData(interruptFalling(structuredClone(data))), loading: false, error: null })
}

export function getFieldData(): FieldData { return state.data }

export function loadFieldData(): Promise<void> {
  if (portable || loaded) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = transact(interruptFalling, false).then((data) => {
    if (portable) return
    loaded = true
    publish({ data, loading: false, error: null })
    ensureRefreshListeners()
  }).catch((error) => {
    if (!portable) publish({ ...state, loading: false, error: message(error) })
    loadPromise = null
    throw error
  })
  return loadPromise
}

export function updateFieldData(fn: (current: FieldData) => FieldData): Promise<void> {
  refreshVersion++
  const operation = updateTail.then(async () => {
    await loadFieldData()
    const next = portable
      ? validateFieldData(fn(structuredClone(state.data)))
      : await transact(fn)
    publish({ data: next, loading: false, error: null })
    if (!portable) channel?.postMessage('changed')
  }).catch((error) => {
    publish({ ...state, loading: false, error: message(error) })
    throw error
  })
  updateTail = operation.catch(() => undefined)
  return operation
}

function getSnapshot() { return state }
function getServerSnapshot() { return initialState }

export function useFieldStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  useEffect(() => { void loadFieldData().catch(() => undefined) }, [])
  return { ...snapshot, update: updateFieldData }
}
