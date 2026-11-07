// STPS CRM – gemeinsame Rollenprüfung (Chat-Kanal «Geschäftsleitung», Dateien im Bereich «Geschäftsleitung», Ablauf-Hinweise für Zertifikate).

/** Darf dieses Konto den Bereich «Geschäftsleitung» sehen? Team-Admin, Management-Kennzeichen, Superadmin (Support im Team-Kontext). */
export const canManage = (user, isSuper = false) => Boolean(isSuper || user?.role === "admin" || user?.role === "superadmin" || user?.management === true);
