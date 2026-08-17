import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { askHexaroBot, warmHexaroBot } from "@/lib/hexaro-bot.functions";
import { PROFILE_AVATARS, ProfileAvatar } from "@/lib/netflix-avatars";
import {
  DEFAULT_BOT_AVATAR,
  emptyThread,
  loadRemoteThread,
  readLocalThread,
  saveRemoteThread,
  writeLocalThread,
  type BotMsg,
} from "@/lib/hexaro-bot-thread";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Msg = BotMsg;

const SUGGESTIONS = [
  "Quel est le solde actuel ?",
  "Qui expire bientôt ?",
  "Ce mois vs le mois dernier",
  "Total Netflix dans l'historique",
];

function renderText(text: string) {
  const safe = text.replace(/<[^>]*>/g, "");
  const parts = safe.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Zone vraiment visible (barre Android / iOS + clavier). `bottom: 0` passe dessous. */
function readViewport() {
  const vv = window.visualViewport;
  const inner = window.innerHeight;
  const visH = Math.round(vv?.height ?? inner);
  const visTop = Math.round(vv?.offsetTop ?? 0);
  const insetBottom = Math.max(0, inner - visTop - visH);
  const keyboard = insetBottom > 80 || visH < inner * 0.72;
  const android = /Android/i.test(navigator.userAgent);
  const overlay = android && !keyboard && insetBottom < 24 ? 64 : 0;
  const visBottom = visTop + visH - overlay;
  const sheetH = keyboard
    ? Math.max(240, visH)
    : Math.min(Math.round(34 * 16), Math.max(280, Math.round((visBottom - visTop) * 0.78)));
  return {
    top: keyboard ? visTop : visBottom - sheetH,
    height: sheetH,
    keyboard,
    insetBottom: insetBottom + overlay,
  };
}

function useMobileChrome(active: boolean) {
  const [box, setBox] = useState(() =>
    typeof window === "undefined"
      ? { top: 0, height: 0, keyboard: false, insetBottom: 0 }
      : readViewport(),
  );

  useEffect(() => {
    if (!active) return;

    const apply = () => setBox(readViewport());
    apply();
    const delayed = () => {
      apply();
      window.setTimeout(apply, 50);
      window.setTimeout(apply, 200);
      window.setTimeout(apply, 400);
    };
    window.addEventListener("resize", delayed);
    window.addEventListener("focusin", delayed);
    window.addEventListener("focusout", delayed);
    window.visualViewport?.addEventListener("resize", delayed);
    window.visualViewport?.addEventListener("scroll", delayed);
    return () => {
      window.removeEventListener("resize", delayed);
      window.removeEventListener("focusin", delayed);
      window.removeEventListener("focusout", delayed);
      window.visualViewport?.removeEventListener("resize", delayed);
      window.visualViewport?.removeEventListener("scroll", delayed);
    };
  }, [active]);

  return box;
}

export function HexaroBot() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const loadedFor = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(DEFAULT_BOT_AVATAR);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const ask = useServerFn(askHexaroBot);
  const warm = useServerFn(warmHexaroBot);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const chrome = useMobileChrome(mobile);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    loadedFor.current = null;
    if (!userId) {
      const blank = emptyThread();
      setMessages(blank.messages);
      setAvatar(blank.avatar);
      return;
    }
    const local = readLocalThread(userId);
    if (local) {
      setMessages(local.messages);
      setAvatar(local.avatar || DEFAULT_BOT_AVATAR);
    } else {
      const blank = emptyThread();
      setMessages(blank.messages);
      setAvatar(blank.avatar);
    }
    let cancelled = false;
    loadRemoteThread(userId)
      .then((remote) => {
        if (cancelled || !remote) {
          loadedFor.current = userId;
          return;
        }
        const hasRemote = remote.messages.length > 0 || (remote.avatar && remote.avatar !== DEFAULT_BOT_AVATAR);
        if (hasRemote) {
          setMessages(remote.messages);
          setAvatar(remote.avatar || DEFAULT_BOT_AVATAR);
          writeLocalThread(userId, remote);
        } else if (local?.messages.length) {
          void saveRemoteThread(userId, local).catch(() => {});
        }
        loadedFor.current = userId;
      })
      .catch(() => {
        loadedFor.current = userId;
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || loadedFor.current !== userId) return;
    const thread = { messages, avatar };
    writeLocalThread(userId, thread);
    const t = window.setTimeout(() => {
      void saveRemoteThread(userId, thread).catch(() => {});
    }, 450);
    return () => window.clearTimeout(t);
  }, [userId, messages, avatar]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open, chrome.height, chrome.keyboard]);

  useEffect(() => {
    if (!open) {
      setPicking(false);
      return;
    }
    void warm().catch(() => {});
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      left: body.style.left,
      right: body.style.right,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.left = prev.left;
      body.style.right = prev.right;
      window.scrollTo(0, scrollY);
    };
  }, [open, warm]);

  function chooseAvatar(id: string) {
    setAvatar(id);
    setPicking(false);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { reply } = await ask({ data: { messages: next.slice(-16) } });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e: any) {
      const msg = e?.message || "Le chatbot n'a pas pu répondre.";
      toast.error(msg);
      setMessages([...next, { role: "assistant", content: `Je n'ai pas pu répondre : ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 sm:bg-black/25" onClick={() => setOpen(false)} />

          <div
            className={cn(
              "fixed z-50 flex min-h-0 flex-col overflow-hidden overscroll-none bg-background shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)]",
              "max-sm:left-0 max-sm:right-0 max-sm:border max-sm:border-border/80",
              chrome.keyboard ? "max-sm:rounded-none" : "max-sm:rounded-t-3xl",
              "sm:inset-auto sm:bottom-6 sm:right-6 sm:left-auto sm:top-auto",
              "sm:h-[min(640px,calc(100dvh-5.5rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-border/80",
            )}
            style={
              mobile
                ? { top: chrome.top, height: chrome.height, bottom: "auto", left: 0, right: 0 }
                : undefined
            }
            role="dialog"
            aria-label="Assistant Hexaro"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-3 py-2.5 sm:px-4">
              <button
                type="button"
                onClick={() => setPicking((v) => !v)}
                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-2xl ring-2 ring-brand/30 transition hover:ring-brand"
                title="Changer l'avatar"
              >
                <ProfileAvatar id={avatar} name="Assistant Hexaro" className="h-10 w-10 rounded-2xl" />
              </button>
              <p className="min-w-0 flex-1 truncate font-semibold">Assistant Hexaro</p>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMessages([])}
                title="Nouvelle conversation"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {picking ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none p-3">
                <p className="mb-3 text-xs text-muted-foreground">Touche une image pour l’avatar</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {PROFILE_AVATARS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => chooseAvatar(a.id)}
                      className={cn(
                        "overflow-hidden rounded-xl ring-2 transition",
                        avatar === a.id ? "ring-brand" : "ring-transparent hover:ring-brand/40",
                      )}
                    >
                      <img src={a.src} alt="" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div
                  ref={scroller}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain scrollbar-none px-3 py-3 sm:px-4"
                >
                  {messages.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center gap-5 px-2 text-center">
                      <button type="button" onClick={() => setPicking(true)} className="h-16 w-16 overflow-hidden rounded-2xl ring-2 ring-brand/30">
                        <ProfileAvatar id={avatar} name="Assistant Hexaro" className="h-16 w-16 rounded-2xl" />
                      </button>
                      <p className="font-medium">Assistant Hexaro</p>
                      <div className="grid w-full grid-cols-1 gap-2">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void send(s)}
                            className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-left text-sm active:scale-[0.99] hover:border-brand/40"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((m, i) => (
                    <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                      {m.role === "assistant" && (
                        <ProfileAvatar id={avatar} name="Assistant Hexaro" className="mt-0.5 h-7 w-7 shrink-0 rounded-lg" />
                      )}
                      <div
                        className={cn(
                          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:text-sm",
                          m.role === "user"
                            ? "rounded-br-md bg-brand text-brand-foreground"
                            : "rounded-bl-md bg-muted/60 text-foreground",
                        )}
                      >
                        {renderText(m.content)}
                      </div>
                    </div>
                  ))}

                  {busy && (
                    <div className="flex items-center gap-2">
                      <ProfileAvatar id={avatar} name="Assistant Hexaro" className="h-7 w-7 rounded-lg" />
                      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted/60 px-3.5 py-3">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.2s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.1s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" />
                      </div>
                    </div>
                  )}
                </div>

                <form
                  className="shrink-0 border-t border-border/50 p-2.5 sm:p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(input);
                  }}
                >
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/25 px-2 py-1 focus-within:border-brand">
                    <input
                      ref={field}
                      type="text"
                      enterKeyHint="send"
                      autoComplete="off"
                      autoCorrect="on"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder=""
                      className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none sm:h-10 sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy || !input.trim()}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground disabled:opacity-35"
                      aria-label="Envoyer"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-50 h-14 w-14 overflow-hidden rounded-2xl shadow-lg ring-2 ring-brand/40 transition active:scale-95 hover:scale-105",
          "right-4 sm:bottom-6 sm:right-6",
          open && "hidden",
        )}
        style={
          mobile
            ? { bottom: Math.max(16, chrome.insetBottom + 16) }
            : undefined
        }
        aria-label="Ouvrir l'assistant Hexaro"
      >
        {avatar ? (
          <ProfileAvatar id={avatar} name="Assistant Hexaro" className="h-14 w-14 rounded-2xl" />
        ) : (
          <span className="grid h-full w-full place-items-center hex-gradient text-brand-foreground">
            <Sparkles className="h-6 w-6" />
          </span>
        )}
      </button>
    </>
  );
}
