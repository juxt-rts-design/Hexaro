export type NotifSettings = {
  notif_signins: boolean;
  notif_creations: boolean;
  read_ids: string[];
};

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  notif_signins: true,
  notif_creations: true,
  read_ids: [],
};

export function parseNotifSettings(raw: unknown): NotifSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const read_ids = Array.isArray(src.read_ids)
    ? src.read_ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    notif_signins: typeof src.notif_signins === "boolean" ? src.notif_signins : true,
    notif_creations: typeof src.notif_creations === "boolean" ? src.notif_creations : true,
    read_ids,
  };
}

export function settingsPayload(settings: NotifSettings): NotifSettings {
  return {
    notif_signins: settings.notif_signins,
    notif_creations: settings.notif_creations,
    read_ids: settings.read_ids.slice(0, 300),
  };
}

export function shouldToast(type: string, settings: NotifSettings): boolean {
  if (type === "user.signin") return settings.notif_signins;
  if (type === "user.created") return settings.notif_creations;
  return true;
}

export function applyReadState<T extends { id: string; read_at: string | null }>(
  items: T[],
  readIds: string[],
): T[] {
  const seen = new Set(readIds);
  return items.map((item) =>
    seen.has(item.id) && !item.read_at ? { ...item, read_at: item.read_at ?? "local" } : item,
  );
}
