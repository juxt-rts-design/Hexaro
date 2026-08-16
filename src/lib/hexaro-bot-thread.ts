import { supabase } from "@/integrations/supabase/client";
import { PROFILE_AVATARS } from "@/lib/netflix-avatars";

export type BotMsg = { role: "user" | "assistant"; content: string };

export type BotThread = {
  messages: BotMsg[];
  avatar: string;
};

export const DEFAULT_BOT_AVATAR = PROFILE_AVATARS[0]?.id || "";

const LEGACY_MSG = "hexaro-bot-messages";
const LEGACY_AVATAR = "hexaro-bot-avatar";

function cacheKey(userId: string) {
  return `hexaro-bot:${userId}`;
}

export function emptyThread(): BotThread {
  return { messages: [], avatar: DEFAULT_BOT_AVATAR };
}

export function parseThread(raw: unknown): BotThread {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bot = src.hexaro_bot && typeof src.hexaro_bot === "object" ? (src.hexaro_bot as Record<string, unknown>) : src;
  const messages = Array.isArray(bot.messages)
    ? bot.messages.filter(
        (m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
      ).slice(-40)
    : [];
  const avatar = typeof bot.avatar === "string" && bot.avatar ? bot.avatar : DEFAULT_BOT_AVATAR;
  return { messages, avatar };
}

export function readLocalThread(userId: string): BotThread | null {
  try {
    sessionStorage.removeItem(LEGACY_MSG);
    localStorage.removeItem(LEGACY_AVATAR);
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    return parseThread(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLocalThread(userId: string, thread: BotThread) {
  try {
    localStorage.setItem(
      cacheKey(userId),
      JSON.stringify({ messages: thread.messages.slice(-40), avatar: thread.avatar || DEFAULT_BOT_AVATAR }),
    );
  } catch {
    /* quota */
  }
}

function asSettings(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export async function loadRemoteThread(userId: string): Promise<BotThread | null> {
  const { data, error } = await supabase.from("profiles").select("settings").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const parsed = parseThread(data.settings);
  if (!parsed.messages.length && parsed.avatar === DEFAULT_BOT_AVATAR) return parsed;
  return parsed;
}

export async function saveRemoteThread(userId: string, thread: BotThread) {
  const { data } = await supabase.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const settings = asSettings(data?.settings);
  const { error } = await supabase
    .from("profiles")
    .update({
      settings: {
        ...settings,
        hexaro_bot: {
          messages: thread.messages.slice(-40),
          avatar: thread.avatar || DEFAULT_BOT_AVATAR,
        },
      },
    })
    .eq("id", userId);
  if (error) throw error;
}
