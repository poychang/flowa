interface ElementRevision { id: string; version: number; versionNonce: number; isDeleted: boolean; }

/** Excalidraw bumps versions on in-place edits; imports may replace objects at the same version. */
export class SceneChanges {
  private elements: { ref: ElementRevision; version: number; nonce: number; deleted: boolean }[] = [];
  private state: string | undefined;
  private files: string | undefined;
  changed(elements: readonly ElementRevision[], persistedState: string, files: Record<string, { id: string; dataURL: string; mimeType: string; created: number; lastRetrieved?: number }>) {
    // File metadata is small; retain data URLs separately without serializing their contents.
    const entries = Object.entries(files);
    const metadata = JSON.stringify(entries.map(([key, file]) => [key, file.id, file.mimeType, file.created, file.lastRetrieved]));
    const urls = entries.map(([, file]) => file.dataURL);
    const changed = this.state !== persistedState || this.files !== metadata || urls.length !== this.urls.length || urls.some((url, i) => url !== this.urls[i])
      || elements.length !== this.elements.length || elements.some((element, i) => {
        const previous = this.elements[i];
        return !previous || previous.ref !== element || previous.version !== element.version || previous.nonce !== element.versionNonce || previous.deleted !== element.isDeleted;
      });
    if (changed) {
      this.state = persistedState; this.files = metadata; this.urls = urls;
      this.elements = elements.map(element => ({ ref: element, version: element.version, nonce: element.versionNonce, deleted: element.isDeleted }));
    }
    return changed;
  }
  private urls: string[] = [];
}
