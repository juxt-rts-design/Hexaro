/** Droits Hexaro : l’admin pilote tout, le manager gère le quotidien sans toucher à l’historique ni à l’équipe. */

export function canManageTeam(isAdmin: boolean) {
  return isAdmin;
}

export function canSeeJournal(isAdmin: boolean) {
  return isAdmin;
}

export function canManageCatalog(isAdmin: boolean) {
  return isAdmin;
}

export function canVoidPayments(isAdmin: boolean) {
  return isAdmin;
}

export function canDeleteServiceAccounts(isAdmin: boolean) {
  return isAdmin;
}
