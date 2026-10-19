import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("""  /** Save the chapter list next to the recording (null where that isn't possible). */
  saveChapters(recording: string, text: string): Promise<string | null>;""", """  /** Save the chapter list next to the recording (null where that isn't possible). */
  saveChapters(recording: string, text: string): Promise<string | null>;
  /** Save a CSV file where the operator chooses; resolves where (null: they changed their mind). */
  saveCsv(name: string, text: string): Promise<string | null>;
  /** Inputs whose small pictures control surfaces want from this window (the Stream Deck's input keys). */
  picturesWanted(): Promise<string[]>;
  /** Hand in an input's small picture (JPEG) for control surfaces. */
  putPicture(id: string, jpeg: Blob): Promise<void>;""", 1)
s = s.replace("""  saveChapters(recording: string, text: string): Promise<string | null> {
    return invoke<string>('save_chapters', { recording, text });
  }
""", """  saveChapters(recording: string, text: string): Promise<string | null> {
    return invoke<string>('save_chapters', { recording, text });
  }

  async saveCsv(name: string, text: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ filters: [{ name: 'CSV (spreadsheet)', extensions: ['csv'] }], defaultPath: name });
    if (!path) return null;
    return invoke<string>('save_csv', { path, text });
  }

  picturesWanted(): Promise<string[]> {
    return invoke<string[]>('remote_pictures_wanted').catch(() => []);
  }

  async putPicture(id: string, jpeg: Blob): Promise<void> {
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    await invoke('remote_put_picture', bytes, { headers: { 'x-input': encodeURIComponent(id) } });
  }
""", 1)
s = s.replace("""  saveChapters(): Promise<string | null> {
    return Promise.resolve(null);
  }
""", """  saveChapters(): Promise<string | null> {
    return Promise.resolve(null);
  }

  saveCsv(name: string, text: string): Promise<string | null> {
    // A browser downloads it.
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return Promise.resolve(name);
  }

  picturesWanted(): Promise<string[]> {
    return Promise.resolve([]);
  }

  putPicture(): Promise<void> {
    return Promise.resolve();
  }
""", 1)
open(p, 'w').write(s)
print(s.count('saveCsv'))
