import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { clientMatches, fetchClientHits, type ClientHit } from "@/lib/client-search";
import { cn } from "@/lib/utils";

type OpenTarget = { slug: string; id: string } | null;

type SearchCtx = {
  query: string;
  setQuery: (q: string) => void;
  openTarget: OpenTarget;
  setOpenTarget: (t: OpenTarget) => void;
};

const Ctx = createContext<SearchCtx | null>(null);

export function ClientSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [openTarget, setOpenTarget] = useState<OpenTarget>(null);
  return <Ctx.Provider value={{ query, setQuery, openTarget, setOpenTarget }}>{children}</Ctx.Provider>;
}

export function useClientSearch() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useClientSearch doit être dans ClientSearchProvider");
  return ctx;
}

export function useOptionalClientSearch() {
  return useContext(Ctx);
}

export function ClientSearchBar({ className }: { className?: string }) {
  const { query, setQuery, setOpenTarget } = useClientSearch();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const { data: hits = [] } = useQuery({
    queryKey: ["client_search"],
    queryFn: fetchClientHits,
    staleTime: 15_000,
  });

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return hits.filter((h) => clientMatches(h.haystack, query)).slice(0, 12);
  }, [hits, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && !(e.target as HTMLElement)?.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: ClientHit) {
    setQuery(hit.name);
    setOpenTarget({ slug: hit.slug, id: hit.id });
    setOpen(false);
    if (pathname !== hit.path) {
      void navigate({ to: hit.path as "/internet" });
    }
  }

  return (
    <div className={cn("relative flex-1 max-w-xl", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            go(results[active]);
          }
        }}
        placeholder="Rechercher un client — nom, téléphone, mot exact…"
        className="h-10 w-full rounded-xl border border-border bg-muted/50 pl-9 pr-16 text-sm outline-none transition focus:border-brand focus:bg-background"
      />
      {query ? (
        <button
          type="button"
          className="absolute right-10 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuery("");
            setOpenTarget(null);
            inputRef.current?.focus();
          }}
          aria-label="Effacer la recherche"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
        /
      </kbd>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Aucun client pour « {query.trim()} »</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto scrollbar-none py-1">
              {results.map((hit, i) => (
                <li key={`${hit.slug}-${hit.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(hit)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                      i === active ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{hit.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{hit.detail}</span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{hit.service}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PageClientFilter({ placeholder, className }: { placeholder?: string; className?: string }) {
  const { query, setQuery } = useClientSearch();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? "Filtrer les clients (lettre ou mot exact)…"}
        className={cn("h-11 w-full rounded-xl border border-border bg-card/80 pl-9 pr-10 text-sm outline-none transition focus:border-brand", className)}
      />
      {query ? (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setQuery("")}
          aria-label="Effacer"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
