/** @typedef {{ set(items: Record<string, unknown>): Promise<void> }} StorageAreaLike */

/** @param {unknown} error */
export function formatStorageError(error) {
  const message = String(
    typeof error === "object" && error !== null && "message" in error
      ? error.message
      : error || ""
  );
  if (message.startsWith("Local storage is full.")) return message;
  if (/quota|quota_bytes|exceed|storage.*full|disk.*full/i.test(message)) {
    return "Local storage is full. Sync stopped before reporting completion.";
  }
  if (/extension context invalidated|context.*invalid/i.test(message)) {
    return "Extension was reloaded. Refresh the page before syncing again.";
  }
  return "Could not save sync data. Sync stopped before reporting completion.";
}

/**
 * @param {StorageAreaLike} storageArea
 * @param {Record<string, unknown>} items
 */
export async function setStorageRequired(storageArea, items) {
  try {
    await storageArea.set(items);
  } catch (error) {
    const storageError = /** @type {Error & { code: string }} */ (
      new Error(formatStorageError(error), { cause: error })
    );
    storageError.code = "XLS_STORAGE_WRITE";
    throw storageError;
  }
}
