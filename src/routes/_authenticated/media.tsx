import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Download, Trash2, FileText, Image as ImageIcon, Video, File as FileIcon, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-provider";

export const Route = createFileRoute("/_authenticated/media")({
  head: () => ({ meta: [{ title: "Médias — Hexaro" }] }),
  component: MediaPage,
});

const FOLDERS = ["affiches", "videos", "fiches", "documents"] as const;

function MediaPage() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<string>("affiches");
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["media", folder],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("media").list(folder, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      return data ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const f of Array.from(files)) {
        const key = `${folder}/${Date.now()}-${f.name}`;
        const { error } = await supabase.storage.from("media").upload(key, f, { upsert: false, contentType: f.type });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media", folder] }); toast.success("Fichiers téléversés"); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.storage.from("media").remove([`${folder}/${name}`]);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media", folder] }); toast.success("Supprimé"); },
    onError: (e: any) => toast.error(e.message),
  });

  async function handleDownload(name: string) {
    const { data, error } = await supabase.storage.from("media").createSignedUrl(`${folder}/${name}`, 60 * 5, { download: name });
    if (error || !data) return toast.error("Impossible de générer le lien");
    window.open(data.signedUrl, "_blank");
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="Ce dossier est vide" description="Téléversez votre premier fichier." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((f) => <FileTile key={f.name} folder={folder} file={f} onDownload={() => handleDownload(f.name)} onDelete={() => { if (confirm(`Supprimer ${f.name} ?`)) remove.mutate(f.name); }} />)}
        </div>
      )}
    </div>
  );
}

function FileTile({ folder, file, onDownload, onDelete }: any) {
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
      <div className="aspect-square bg-muted/40 grid place-items-center overflow-hidden">
        {isImg && thumb ? <img src={thumb} alt={file.name} className="w-full h-full object-cover" /> : <Icon className="h-10 w-10 text-muted-foreground" />}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium truncate" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{((file.metadata?.size ?? 0) / 1024).toFixed(0)} Ko</p>
        <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDownload}><Download className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
