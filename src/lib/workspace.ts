export const HEXARO_WORKSPACE_ID = "a1111111-1111-4111-8111-111111111111";

export function mediaFolderPrefix(workspaceId: string | null | undefined, folder: string) {
  if (!workspaceId || workspaceId === HEXARO_WORKSPACE_ID) return folder;
  return `${workspaceId}/${folder}`;
}
