export async function assertStaff(supabase: { rpc: Function }, userId: string) {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error || !data) throw new Error("Accès refusé.");
}

export async function assertAdmin(supabase: { rpc: Function }, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Cette action est réservée à l’administrateur.");
}
