import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Download, Trash2, FileText, Image as ImageIcon, Video, File as FileIcon, FolderPlus, Eye } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-provider";
import { useAuth } from "@/hooks/useAuth";
import { mediaFolderPrefix } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/media")({
  head: () => ({ meta: [{ title: "Médias — Hexaro" }] }),
  component: MediaPage,
});

const FOLDERS = ["affiches", "videos", "fiches", "documents"] as const;
type Preview = { name: string; url: string; kind: "image" | "video" | "pdf" | "other" };

function MediaPage() {
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const { workspaceId, loading: authLoading } = useAuth();
  const [folder, setFolder] = useState<string>("affiches");
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const prefix = mediaFolderPrefix(workspaceId, folder);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["media", prefix],
    enabled: !authLoading && Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("media").list(prefix, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      return (data ?? []).filter((f) => f.name && !f.name.endsWith("/"));
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const f of Array.from(files)) {
        const key = `${prefix}/${Date.now()}-${f.name}`;
        const { error } = await supabase.storage.from("media").upload(key, f, { upsert: false, contentType: f.type });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media"] }); toast.success("Fichiers téléversés"); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.storage.from("media").remove([`${prefix}/${name}`]);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media"] }); toast.success("Supprimé"); },
    onError: (e: any) => toast.error(e.message),
  });

  async function handleDownload(name: string) {
    const { data, error } = await supabase.storage.from("media").createSignedUrl(`${prefix}/${name}`, 60 * 5, { download: name });
    if (error || !data) return toast.error("Impossible de générer le lien");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handlePreview(name: string) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const kind: Preview["kind"] = ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"].includes(ext)
      ? "image"
      : ["mp4", "webm", "mov", "ogg"].includes(ext)
        ? "video"
        : ext === "pdf"
          ? "pdf"
          : "other";
    const { data, error } = await supabase.storage.from("media").createSignedUrl(`${prefix}/${name}`, 60 * 30);
    if (error || !data) return toast.error("Aperçu indisponible");
    setPreview({ name, url: data.signedUrl, kind });
  }

  const filtered = files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Médiathèque"
        description="Stockez et partagez affiches, vidéos, fiches techniques et documents."
        actions={
          <>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload.mutate(e.target.files)} />
            <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="bg-brand text-brand-foreground gap-2">
              <Upload className="h-4 w-4" /> {upload.isPending ? "Envoi…" : "Téléverser"}
            </Button>
          </>
        }
      />

      <div className="hex-glass rounded-2xl p-4 flex flex-wrap items-center gap-2">
        {FOLDERS.map((f) => (
          <button
            key={f}
            onClick={() => setFolder(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition ${folder === f ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}
          >
            <FolderPlus className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />{f}
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading && files.length === 0 ? null : filtered.length === 0 ? (
        <EmptyState title="Ce dossier est vide" description="Téléversez votre premier fichier." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((f) => <FileTile key={f.name} folder={folder} file={f} onPreview={() => handlePreview(f.name)} onDownload={() => handleDownload(f.name)} onDelete={async () => { if (await confirmAction({ title: "Supprimer ce fichier ?", description: f.name, destructive: true, confirmLabel: "Supprimer" })) remove.mutate(f.name); }} />)}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="truncate pr-8">{preview?.name}</DialogTitle></DialogHeader>
          <div className="rounded-xl overflow-hidden bg-muted/40 grid place-items-center max-h-[65vh]">
            {preview?.kind === "image" && <img src={preview.url} alt={preview.name} className="max-h-[65vh] w-auto object-contain" />}
            {preview?.kind === "video" && <video src={preview.url} controls className="max-h-[65vh] w-full" />}
            {preview?.kind === "pdf" && <iframe src={preview.url} title={preview.name} className="w-full h-[65vh]" />}
            {preview?.kind === "other" && <p className="p-10 text-sm text-muted-foreground">Aperçu non disponible pour ce type de fichier.</p>}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => preview && handleDownload(preview.name)} className="bg-brand text-brand-foreground gap-2">
              <Download className="h-4 w-4" /> Télécharger
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FileTile({ folder, file, onPreview, onDownload, onDelete }: any) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isImg = ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(ext);
  const isVideo = ["mp4", "webm", "mov"].includes(ext);
  const isPdf = ext === "pdf";
  const Icon = isImg ? ImageIcon : isVideo ? Video : isPdf ? FileText : FileIcon;

  const [thumb, setThumb] = useState<string | null>(null);
  if (isImg && !thumb) {
    supabase.storage.from("media").createSignedUrl(`${folder}/${file.name}`, 60 * 10).then(({ data }) => data && setThumb(data.signedUrl));
  }

  return (
    <div className="hex-glass rounded-xl overflow-hidden group">
      <button type="button" onClick={onPreview} className="block w-full aspect-square bg-muted/40 grid place-items-center overflow-hidden relative">
        {isImg && thumb ? <img src={thumb} alt={file.name} className="w-full h-full object-cover" /> : <Icon className="h-10 w-10 text-muted-foreground" />}
        <span className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition grid place-items-center">
          <Eye className="h-6 w-6" />
        </span>
      </button>
      <div className="p-2.5">
        <p className="text-xs font-medium truncate" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{((file.metadata?.size ?? 0) / 1024).toFixed(0)} Ko</p>
        <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onPreview}><Eye className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDownload}><Download className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
