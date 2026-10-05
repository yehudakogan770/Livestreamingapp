/** The events opened lately (this computer only). */
export interface Recent {
  path: string;
  name: string;
  at: number;
}

const KEY = 'lumora-edit-recent';

export function recentList(): Recent[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Recent => !!x && typeof x.path === 'string' && typeof x.name === 'string') : [];
  } catch {
    return [];
  }
}

export function remember(path: string, name: string): void {
  try {
    const list = [{ path, name, at: Date.now() }, ...recentList().filter((r) => r.path !== path)].slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept: fine.
  }
}

export function forget(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentList().filter((r) => r.path !== path)));
  } catch {
    // Not kept: fine.
  }
}
