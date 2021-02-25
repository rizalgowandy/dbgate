import { writable } from 'svelte/store';
import { ExtensionsDirectory } from 'dbgate-types';

interface TabDefinition {
  title: string;
  closedTime?: number;
  icon: string;
  props: any;
  selected: boolean;
  busy: boolean;
  tabid: string;
}

export function writableWithStorage<T>(defaultValue: T, storageName) {
  const init = localStorage.getItem(storageName);
  const res = writable<T>(init ? JSON.parse(init) : defaultValue);
  res.subscribe(value => {
    localStorage.setItem(storageName, JSON.stringify(value));
  });
  return res;
}

export const selectedWidget = writable('database');
export const openedConnections = writable([]);
export const currentDatabase = writable(null);
export const openedTabs = writableWithStorage<TabDefinition[]>([], 'openedTabs');
export const extensions = writable<ExtensionsDirectory>(null);
export const visibleCommandPalette = writable(false);
export const commands = writable({});
export const currentTheme = writableWithStorage('theme-light', 'currentTheme');

// export const leftPanelWidth = writable(300);
