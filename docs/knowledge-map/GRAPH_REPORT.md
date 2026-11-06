# Graph Report - corpus  (2026-10-15)

## Corpus Check
- Corpus is ~13,633 words - fits in a single context window. You may not need a graph.

## Summary
- 70 nodes · 113 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 88% EXTRACTED · 11% INFERRED · 1% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Homepage & Copy Decisions
- Company & Owner
- AGB Legal Risks
- Deployment & Mobile Master
- Contact & Privacy
- Vietnam Sourcing Model
- Manufacturing Capabilities
- Language Switch Code

## God Nodes (most connected - your core abstractions)
1. `Homepage (index.html)` - 19 edges
2. `AGB / Terms page` - 13 edges
3. `SwissTech Precision Solutions (STPS)` - 9 edges
4. `Lawyer review needed` - 9 edges
5. `Datenschutz / Privacy page` - 8 edges
6. `Manufacturing capabilities` - 7 edges
7. `Impressum page` - 6 edges
8. `Marco G. Walser (Inhaber und Geschäftsführer)` - 6 edges
9. `Vetted manufacturing partners in Vietnam` - 6 edges
10. `Open points before go-live` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Client wording decisions (C2 DE/EN copy)` --conceptually_related_to--> `In-page DE/EN language switch`  [INFERRED]
  notes/project-memory.md → site/index.html
- `Hosting stated in policy: HostFactory (OptimaNet Schweiz AG)` --conceptually_related_to--> `Netlify preview (swisstech-entwurf-v2.netlify.app)`  [AMBIGUOUS]
  site/datenschutz.html → notes/project-memory.md
- `Confirm founding year 2026` --references--> `SwissTech Precision Solutions (STPS)`  [EXTRACTED]
  notes/open-points.md → site/index.html
- `KGC (project owner, web builder)` --references--> `SwissTech Precision Solutions (STPS)`  [EXTRACTED]
  notes/project-memory.md → site/index.html
- `Pending: owner name + UID, prices, AGB, guarantee` --semantically_similar_to--> `Open points before go-live`  [INFERRED] [semantically similar]
  notes/mobile-master-website.md → notes/open-points.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Quote-to-delivery flow** — site_index_rfq, site_index_process, site_index_partners, site_index_vn_colleague, site_index_model [INFERRED 0.85]
- **Deployment chain** — notes_project_memory_working_copy, notes_project_memory_github, notes_project_memory_netlify [EXTRACTED 1.00]
- **Go-live blockers** — notes_open_points_lawyer, notes_open_points_art945, notes_open_points_founding, site_datenschutz_ms365 [INFERRED 0.85]

## Communities (8 total, 1 thin omitted)

### Community 0 - "Homepage & Copy Decisions"
Cohesion: 0.21
Nodes (10): Backups: original-backup/ and backup-deploy-6ad0189/, Hero subline “Ihr Partner für Qualität & Zuverlässigkeit”, New logo from client PDF (applied 2026-10-15), Map caption “Europa / Unsere / Kunden”, Working copy: Downloads\deploy-6ad0189… + swisstech-v2/, Customer benefits: lower cost, reliable quality, less sourcing effort, Customers: SMEs in the DACH region, Hero video (hero.mp4 / hero.webm + poster) (+2 more)

### Community 1 - "Company & Owner"
Cohesion: 0.25
Nodes (9): Keep “im 1995” and “fragten bei ihm nach” (client choice), Image credits: own Vietnam photos + illustrative / AI images, Impressum page, Wolleraustrasse 41A, CH-8807 Freienbach SZ, MEM companies in Walser network (origin of SwissTech), SwissTech Precision Solutions (STPS), Partner photos from Vietnam (vn-*.jpg gallery, 24 images), Marco G. Walser (Inhaber und Geschäftsführer) (+1 more)

### Community 2 - "AGB Legal Risks"
Cohesion: 0.31
Nodes (10): Only the German AGB version is binding, AGB changeable “jederzeit und ohne Ankündigung”, Liability cap vs gross negligence (15.2 / 15.5), No payment deadline (23.5 / 23.7), CHF 500’000 Konventionalstrafe (non-circumvention), Contract manufacturer or intermediary? (1.2 vs 3.2), Retention of title needs register entry (24), Venue: court for Freienbach is Höfe / Pfäffikon SZ (29.4) (+2 more)

### Community 3 - "Deployment & Mobile Master"
Cohesion: 0.25
Nodes (9): Branch claude/intelligent-cerf-9reugu · mobilemaster/, mobile-master-entwurf.netlify.app (Netlify Forms), Pending: owner name + UID, prices, AGB, guarantee, Price 350 CHF / 300 CHF with GPU repair (draft email), Mobile Master site (phone repair, Baden-Turgi), GitHub claudeworkspace · branch claude/swisstech-site · swisstech/, KGC (project owner, web builder), Netlify preview (swisstech-entwurf-v2.netlify.app) (+1 more)

### Community 4 - "Contact & Privacy"
Cohesion: 0.25
Nodes (9): Confirm founding year 2026, Open points before go-live, Pascal (pascal@stps.ch, RFQ recipient), Swiss DSG / EU GDPR basis, Hosting stated in policy: HostFactory (OptimaNet Schweiz AG), Microsoft 365 / USA statement (unverified), Datenschutz / Privacy page, marco@stps.ch (visible contact email) (+1 more)

### Community 5 - "Vietnam Sourcing Model"
Cohesion: 0.33
Nodes (6): Vetted manufacturing partners in Vietnam, 8-step process: Anfrage → … → Lieferung, Vietnam as sourcing region, Vietnamese colleague (order handling and logistics), Why SwissTech: Swiss contact, local presence, technical know-how, Why Vietnam: industrial base, competitive, supply-chain diversification

### Community 6 - "Manufacturing Capabilities"
Cohesion: 0.33
Nodes (6): Assemblies & fastening elements, CNC precision parts, Cost optimisation / design-for-manufacturing, Plastics & tooling, Sheet metal & forming, Manufacturing capabilities

## Ambiguous Edges - Review These
- `Hosting stated in policy: HostFactory (OptimaNet Schweiz AG)` → `Netlify preview (swisstech-entwurf-v2.netlify.app)`  [AMBIGUOUS]
  notes/project-memory.md · relation: conceptually_related_to

## Knowledge Gaps
- **13 isolated node(s):** `Pascal (pascal@stps.ch, RFQ recipient)`, `CNC precision parts`, `Sheet metal & forming`, `Assemblies & fastening elements`, `Plastics & tooling` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 14 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Homepage (index.html)` connect `Homepage & Copy Decisions` to `Company & Owner`, `AGB Legal Risks`, `Contact & Privacy`, `Vietnam Sourcing Model`, `Manufacturing Capabilities`, `Language Switch Code`?**
  _High betweenness centrality (0.580) - this node is a cross-community bridge._
- **What connects `Pascal (pascal@stps.ch, RFQ recipient)`, `CNC precision parts`, `Sheet metal & forming` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Why does `AGB / Terms page` connect `AGB Legal Risks` to `Homepage & Copy Decisions`, `Company & Owner`, `Contact & Privacy`, `Language Switch Code`?**
  _High betweenness centrality (0.211) - this node is a cross-community bridge._
- **Why does `SwissTech Precision Solutions (STPS)` connect `Company & Owner` to `Homepage & Copy Decisions`, `AGB Legal Risks`, `Deployment & Mobile Master`, `Contact & Privacy`, `Vietnam Sourcing Model`?**
  _High betweenness centrality (0.194) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Hosting stated in policy: HostFactory (OptimaNet Schweiz AG)` and `Netlify preview (swisstech-entwurf-v2.netlify.app)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._