# STPS

Monorepo für SwissTech (STPS): Firmenwebsite, CRM und Projektdokumentation.

## Struktur

- `swisstech/` – statische Firmenwebsite (HTML/CSS/JS, Bilder, Videos, Fonts)
- `stps-crm/` – STPS CRM (PWA mit Netlify Functions und Netlify Blobs)
- `docs/` – Dokumentation
  - `MASTERPLAN.md` – CRM-Masterplan
  - `sharepoint/` – SharePoint-Anleitung (live) und CRM-Update nach dem Kundenmeeting
  - `swisstech-notes/open-points.md` – offene Punkte zur Website
  - `knowledge-map/` – Wissensgraph (GRAPH_REPORT.md, graph.json, graph.html)

## Deployment (Netlify)

- **swisstech/**: eigene Netlify-Site, Publish directory `swisstech`, kein Build nötig.
- **stps-crm/**: eigene Netlify-Site mit Base directory `stps-crm` (Functions in `netlify/functions`, Daten in Netlify Blobs).
  Umgebungsvariablen (nur Namen, Werte im Netlify-Dashboard setzen): `CRM_PASSWORD`, `CRM_SECRET`, `CRM_ADMIN_USER`,
  `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SP_SITE`, `SP_DRIVE`, `SP_IMPORT_PATH`, `SP_EXPORT_FOLDER`,
  `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `APP_URL`.
  Details: `stps-crm/README.md`, `stps-crm/SHAREPOINT-SETUP.md`, `stps-crm/OUTLOOK-SETUP.md`.

## Herkunft

Die Originale liegen im Repository `claudeworkspace`: `swisstech/` im Branch `claude/swisstech-site`,
`stps-crm/` im Branch `claude/stps-crm-meeting`.
