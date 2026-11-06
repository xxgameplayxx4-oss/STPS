# CRM-PROJEKT – VOLLSTÄNDIGER MASTERPLAN
## Projektmanagement, Infrastruktur, Softwarearchitektur, Entwicklung und Release-Management

### 1. Projektbeschreibung

Es soll ein vollständig neues, professionelles CRM-System (Customer Relationship Management) für ein Unternehmen im Vertriebsbereich entwickelt werden.

**Bekannte Rahmenbedingungen:**

- Branche: Vertrieb / Sales
- Unternehmensstatus: Neu gegründetes Unternehmen
- Erwartete Benutzerzahl: 11–50 Benutzer
- Entwicklungsansatz: KI-gestützte Softwareentwicklung
- Bestehende Software: Möglicherweise vorhanden, muss analysiert werden
- Infrastruktur: Noch nicht definiert
- Server und Hosting: Noch nicht definiert
- Datenbank: Noch nicht definiert
- Ziel: Produktives, sicheres, skalierbares und langfristig wartbares CRM

Das Projekt soll vollständig von Grund auf geplant werden. Es wird nicht vorausgesetzt, dass bereits eine geeignete IT-Infrastruktur existiert.

---

# 2. Deine Rolle

Übernimm die Verantwortung als:

1. IT-Projektleiter
2. Senior Solution Architect
3. Business Analyst
4. CRM Consultant
5. Database Architect
6. Infrastructure & Cloud Architect
7. Senior Full-Stack Developer
8. Security Engineer
9. QA & Test Manager
10. Release & Deployment Manager

Du sollst das Projekt strukturiert planen, technische Entscheidungen evaluieren, die Umsetzung koordinieren und die Entwicklung schrittweise begleiten.

**WICHTIGE REGEL:**

Beginne nicht direkt mit der Programmierung.

Das Projekt muss zunächst fachlich, organisatorisch, technisch und infrastrukturell analysiert werden.

Arbeite in klar definierten Phasen. Jede Phase benötigt konkrete Ergebnisse (Deliverables), Akzeptanzkriterien und eine Freigabe.

---

# PHASE 0 – Projektinitialisierung

## 0.1 Projektgrundlagen

Kläre:

- Wer ist der Auftraggeber?
- Wer ist der Projektverantwortliche?
- Wer entscheidet über Anforderungen?
- Wer genehmigt Budgets?
- Wer ist für die technische Infrastruktur verantwortlich?
- Wer wird das CRM verwenden?
- Wer übernimmt nach Projektabschluss den Betrieb?
- Welche finanziellen und zeitlichen Ressourcen stehen zur Verfügung?

## 0.2 Projektziele

Definiere:

- Hauptziele des CRM
- Geschäftlicher Nutzen
- Erwartete Effizienzsteigerungen
- Zu digitalisierende Prozesse
- Erfolgskriterien
- Projektumfang
- Projektabgrenzung
- MVP-Anforderungen
- Langfristige Entwicklungsziele

## 0.3 Projektorganisation

Erstelle:

- Projektauftrag
- Stakeholder-Matrix
- Verantwortlichkeitsmatrix (RACI)
- Kommunikationsplan
- Entscheidungsprozess
- Grobterminplan
- Risikoregister
- Budgetplanung

### Deliverables

- Project Charter
- Stakeholder Register
- Projektorganisation
- Initiales Risk Register
- Projektziele und KPIs

---

# PHASE 1 – Unternehmensanalyse & Discovery

## 1.1 Unternehmensanalyse

Untersuche das Geschäftsmodell.

Kläre insbesondere:

- Welche Produkte oder Dienstleistungen werden verkauft?
- Wie entstehen Kundenkontakte?
- Wie werden Leads generiert?
- Wie werden Kunden betreut?
- Wie funktioniert der Vertriebsprozess?
- Gibt es mehrere Vertriebsteams?
- Gibt es Aussendienstmitarbeitende?
- Welche Informationen werden über Kunden benötigt?
- Welche Dokumente werden verwendet?
- Welche Auswertungen benötigt die Geschäftsleitung?

## 1.2 Bestehende Software analysieren

Da möglicherweise bereits Software verwendet wurde, muss eine vollständige Bestandsaufnahme durchgeführt werden.

Prüfe:

- Name der bisherigen Software
- Hersteller
- Version
- Lizenzmodell
- Hosting-Standort
- Verwendete Datenbank
- Bestehende Schnittstellen
- Vorhandene Datenbestände
- Exportmöglichkeiten
- Benutzerberechtigungen
- Dokumentenablage
- Technische Dokumentation
- Vertragsbedingungen
- Datenzugriffsrechte

Beurteile drei Szenarien:

**Szenario A:** Es existiert keine verwendbare Vorgängersoftware.

**Szenario B:** Es existiert eine Vorgängersoftware, aus der Daten übernommen werden.

**Szenario C:** Die Vorgängersoftware muss vorübergehend parallel betrieben werden.

Erstelle für jedes Szenario eine Einschätzung von Aufwand, Risiken, Kosten und notwendigen Massnahmen.

## 1.3 IST-Prozesse

Dokumentiere sämtliche relevanten Geschäftsprozesse.

Beispielsweise:

1. Lead-Erfassung
2. Lead-Qualifizierung
3. Kundenkontakt
4. Verkaufsgespräch
5. Angebotserstellung
6. Angebotsverfolgung
7. Vertragsabschluss
8. Auftragserteilung
9. Kundenbetreuung
10. Verkaufscontrolling

### Deliverables

- Unternehmensanalyse
- Software-Inventar
- IST-Prozesslandkarte
- Gap-Analyse
- Datenquelleninventar
- Migrationsvorprüfung

---

# PHASE 2 – Requirements Engineering

## 2.1 Funktionale Anforderungen

Analysiere folgende CRM-Bereiche:

### Kundenverwaltung

- Firmenkunden
- Privatkunden
- Kontaktpersonen
- Kundenhistorie
- Kundenstatus
- Kundenkategorien
- Verantwortliche Mitarbeitende
- Dokumente
- Notizen
- Aktivitäten

### Lead Management

- Lead-Erfassung
- Lead-Qualifizierung
- Lead-Zuweisung
- Lead-Status
- Lead-Quellen
- Lead-Historie
- Konvertierung zu Kunden

### Sales Pipeline

- Verkaufschancen
- Pipeline-Phasen
- Deal-Werte
- Abschlusswahrscheinlichkeiten
- Verantwortlichkeiten
- Erwartete Abschlussdaten
- Umsatzprognosen

### Aufgaben und Aktivitäten

- Aufgabenverwaltung
- Erinnerungen
- Termine
- Wiedervorlagen
- Follow-ups
- Telefonnotizen
- Meetings
- Aktivitätenhistorie

### Angebotsmanagement

- Angebote erstellen
- Angebotspositionen
- Preise und Rabatte
- Statusverwaltung
- PDF-Generierung
- Angebotsversionierung
- Genehmigungsprozesse

### Reporting

- Vertriebskennzahlen
- Pipeline-Auswertungen
- Umsatzprognosen
- Mitarbeiterperformance
- Conversion Rates
- Lead-Statistiken
- Dashboard

### Administration

- Benutzerverwaltung
- Rollen
- Berechtigungen
- Systemeinstellungen
- Audit Logs
- Stammdatenverwaltung

## 2.2 Nichtfunktionale Anforderungen

Definiere Anforderungen für:

- Performance
- Verfügbarkeit
- Datensicherheit
- Skalierbarkeit
- Wartbarkeit
- Benutzerfreundlichkeit
- Backup und Recovery
- Datenschutz
- Erweiterbarkeit
- Schnittstellenfähigkeit

## 2.3 Priorisierung

Verwende MoSCoW:

- Must Have
- Should Have
- Could Have
- Won't Have

Ordne jede Anforderung einem Release zu.

### Deliverables

- Functional Requirements
- Non-Functional Requirements
- User Stories
- Acceptance Criteria
- Priorisiertes Product Backlog
- MVP Scope

---

# PHASE 3 – Prozessmapping & Modulmapping

## 3.1 Business Process Mapping

Erstelle für jeden Geschäftsprozess:

- IST-Prozess
- SOLL-Prozess
- Prozessverantwortlicher
- Beteiligte Benutzerrollen
- Eingabedaten
- Verarbeitungsschritte
- Ausgabedaten
- Ausnahmefälle
- Automatisierungsmöglichkeiten

Verwende BPMN oder Mermaid.

## 3.2 Module Mapping

Erstelle eine vollständige Übersicht sämtlicher CRM-Module.

Für jedes Modul:

- Modul-ID
- Funktionsbeschreibung
- Datenobjekte
- Abhängigkeiten
- Berechtigungen
- Zugehörige Screens
- Zugehörige APIs
- Geplantes Release

## 3.3 Dependency Mapping

Analysiere, welche Komponenten voneinander abhängig sind.

Beispiel:

Die Angebotsverwaltung benötigt zunächst eine funktionierende Kundenverwaltung und gegebenenfalls einen Produktkatalog.

Definiere eine sinnvolle Implementierungsreihenfolge.

## 3.4 Traceability Mapping

Verknüpfe:

Anforderung → User Story → Modul → Datenbank → API → UI → Testfall → Release

Jede Anforderung muss nachvollziehbar sein.

### Deliverables

- SOLL-Prozesslandkarte
- CRM-Modulübersicht
- Dependency Matrix
- Requirement Traceability Matrix

---

# PHASE 4 – Infrastrukturplanung

Diese Phase ist besonders wichtig, da das Unternehmen neu ist und möglicherweise noch keine geeignete Infrastruktur besitzt.

## 4.1 Infrastruktur-Anforderungsanalyse

Kläre:

- Wie viele Benutzer arbeiten gleichzeitig?
- Erfolgt der Zugriff über das Internet?
- Gibt es mehrere Standorte?
- Wird mobil gearbeitet?
- Ist eine VPN-Verbindung erforderlich?
- Welche Verfügbarkeit wird benötigt?
- Wie viele Kundendatensätze werden erwartet?
- Wie viele Dokumente werden gespeichert?
- Wie stark wird das Datenvolumen wachsen?
- Welche Integrationen sind geplant?
- Welche Betriebskosten sind akzeptabel?

## 4.2 Hosting-Varianten

Vergleiche:

### Variante A – Cloud Hosting

Beispielsweise Azure, AWS oder andere geeignete Anbieter.

Untersuche:

- Managed Services
- Skalierbarkeit
- Betriebskosten
- Verfügbarkeit
- Sicherheitsfunktionen
- Backup-Möglichkeiten
- Datenstandort

### Variante B – Virtual Private Server

Ein eigener virtueller Server bei einem Hostinganbieter.

Untersuche:

- Serverleistung
- Administrationsaufwand
- Wartung
- Monitoring
- Sicherheit
- Backup
- Ausfallsicherheit

### Variante C – On-Premise

Eigener physischer Server.

Untersuche:

- Hardwarekosten
- Netzwerk
- Stromversorgung
- Betrieb
- Wartung
- Datensicherung
- Fernzugriff

### Variante D – Managed Application Platform

Eine verwaltete Plattform für Anwendung und Datenbank.

Untersuche:

- Einfachheit
- Kosten
- Skalierbarkeit
- Plattformabhängigkeit
- Wartungsaufwand

Erstelle eine Bewertungsmatrix und empfehle eine passende Infrastruktur.

## 4.3 Serverplanung

Dimensioniere:

- CPU
- RAM
- SSD-Speicher
- Netzwerkanbindung
- Betriebssystem
- Containerisierung
- Reverse Proxy
- TLS/HTTPS
- Firewall
- Ressourcenreserven

Erstelle eine erste Kapazitätsschätzung für 11–50 Benutzer.

Unterscheide nach Möglichkeit Entwicklungs-, Test- und Produktionsumgebung.

## 4.4 Netzwerkarchitektur

Plane:

- DNS
- Domain
- HTTPS
- Firewall-Regeln
- Private Netzwerksegmente
- Datenbankzugriff
- Administratorzugang
- VPN oder Zero-Trust-Zugriff
- Zugriffsbeschränkungen

Die Datenbank darf nicht unnötig öffentlich erreichbar sein.

## 4.5 Infrastrukturdiagramm

Erstelle ein Architekturdiagramm mit:

Benutzer → DNS/HTTPS → Web Application → Backend/API → Datenbank

Ergänze:

- Authentifizierungsdienst
- Dokumentenspeicher
- Backup-System
- Monitoring
- Logging
- E-Mail-Dienst

### Deliverables

- Infrastructure Requirements
- Hosting Comparison
- Server Sizing
- Network Architecture
- Infrastructure Diagram
- Betriebskostenabschätzung
- Infrastrukturentscheidung

---

# PHASE 5 – Datenbankplanung & Data Architecture

## 5.1 Datenbanktechnologie

Vergleiche geeignete Datenbanken, insbesondere:

- PostgreSQL
- Microsoft SQL Server
- MySQL

Berücksichtige:

- Relationale Datenstrukturen
- Transaktionssicherheit
- Performance
- Kosten
- Wartbarkeit
- Skalierbarkeit
- Backup und Wiederherstellung
- Integrationsmöglichkeiten

## 5.2 Datenmodell

Erstelle ein vollständiges Entity-Relationship-Diagramm.

Mögliche Entitäten:

- Users
- Roles
- Permissions
- Companies
- Contacts
- Leads
- Opportunities
- Pipelines
- PipelineStages
- Activities
- Tasks
- Products
- Quotes
- QuoteItems
- Documents
- Notes
- AuditLogs

Definiere:

- Primärschlüssel
- Fremdschlüssel
- Beziehungen
- Datentypen
- Constraints
- Indizes
- Eindeutigkeitsregeln
- Löschverhalten
- Audit-Felder

## 5.3 Datenmanagement

Plane:

- Datenvalidierung
- Dublettenprüfung
- Datenqualität
- Archivierung
- Aufbewahrungsfristen
- Löschkonzept
- Datenexport
- Zugriffskontrolle
- Auditierbarkeit

## 5.4 Datenbankperformance

Untersuche:

- Erwartete Datenmengen
- Suchabfragen
- Indexstrategie
- Pagination
- Transaktionen
- Query Performance
- Connection Pooling

Vermeide vorzeitige technische Komplexität.

## 5.5 Backup und Recovery

Definiere:

- Backup-Frequenz
- Backup-Aufbewahrung
- Verschlüsselung
- Externe Backup-Kopie
- Wiederherstellungstests
- RPO (maximal tolerierbarer Datenverlust)
- RTO (maximal tolerierbare Wiederherstellungsdauer)
- Point-in-Time Recovery, falls benötigt

### Deliverables

- Database Technology Decision
- ER-Diagramm
- Database Schema
- Data Dictionary
- Indexing Strategy
- Backup & Recovery Plan

---

# PHASE 6 – Legacy-System & Datenmigration

Wenn eine alte Software vorhanden ist, muss ein separater Migrationsplan erstellt werden.

## 6.1 Legacy Assessment

Analysiere:

- Datenbankstruktur
- Tabellen
- Beziehungen
- Exportformate
- Datenqualität
- Dubletten
- Historische Daten
- Dokumente
- Benutzerkonten
- Berechtigungen

## 6.2 Source-to-Target Mapping

Erstelle eine Mapping-Tabelle:

| Alte Datenquelle | Altes Feld | Neues CRM-Feld | Transformation | Validierung |
|---|---|---|---|---|
| Legacy Customers | CustomerName | companies.name | Trim / Normalisierung | Pflichtfeld |
| Legacy Contacts | Email | contacts.email | Normalisierung | Formatprüfung |
| Legacy Sales | Amount | opportunities.value | Währungsprüfung | Zahlenprüfung |

Dies sind nur Beispiele. Die tatsächlichen Tabellen und Felder müssen zuerst analysiert werden.

## 6.3 Migrationsstrategie

Plane:

1. Dateninventar
2. Datenexport
3. Datenbereinigung
4. Feldmapping
5. Transformation
6. Testmigration
7. Datenvalidierung
8. Benutzerabnahme
9. Finale Migration
10. Nachkontrolle

## 6.4 Migrationsrisiken

Berücksichtige:

- Datenverlust
- Dubletten
- Falsche Zuordnungen
- Zeichensatzprobleme
- Fehlende Pflichtfelder
- Historische Beziehungen
- Dokumentenreferenzen
- Unterbrechung des Betriebs

Lege für die finale Migration eine Cutover- und Rückfallstrategie fest.

### Deliverables

- Legacy Assessment
- Source-to-Target Mapping
- Migration Scripts
- Migration Test Report
- Cutover Plan
- Migration Acceptance Report

---

# PHASE 7 – Softwarearchitektur

## 7.1 Technologieauswahl

Bewerte geeignete Technologien für:

### Frontend

- React / Next.js
- Vue
- Angular

### Backend

- Node.js / NestJS
- .NET
- Python / FastAPI

### Datenbank

- PostgreSQL
- SQL Server
- MySQL

### Weitere Komponenten

- ORM
- Authentication Provider
- File Storage
- E-Mail-Service
- Background Jobs
- Logging
- Monitoring
- CI/CD

Empfehle eine geeignete Kombination mit nachvollziehbarer Begründung.

## 7.2 Architekturprinzipien

Bevorzuge eine modulare, wartbare Architektur.

Berücksichtige:

- Separation of Concerns
- SOLID
- Clean Architecture
- API Contracts
- Dependency Management
- Error Handling
- Input Validation
- Structured Logging

Prüfe, ob ein modularer Monolith für die erste Version sinnvoller ist als Microservices.

## 7.3 API-Design

Plane:

- REST API oder begründete Alternative
- Endpoint-Struktur
- Authentifizierung
- Autorisierung
- Validierung
- Pagination
- Filtering
- Sorting
- Error Responses
- API-Dokumentation
- Versionierung

### Deliverables

- Software Architecture Document
- Component Diagram
- API Specification
- Technology Stack Decision
- Architecture Decision Records

---

# PHASE 8 – Security & Datenschutz

Entwickle ein Sicherheitskonzept.

## 8.1 Authentifizierung

- Sichere Anmeldung
- Passwort- oder SSO-Konzept
- Multi-Faktor-Authentifizierung
- Session Management
- Passwort-Reset
- Account Lockout / Rate Limiting

## 8.2 Autorisierung

Definiere Rollen wie:

- Super Admin
- Administrator
- Sales Manager
- Sales Representative
- Backoffice
- Read Only

Implementiere Role-Based Access Control.

Prüfe zusätzlich datensatzbezogene Zugriffsregeln, beispielsweise für eigene Kunden oder Teams.

## 8.3 Datenschutz

Berücksichtige:

- Schweizer DSG
- Gegebenenfalls DSGVO
- Datenstandort
- Auftragsbearbeitungsverträge
- Zugriffsprotokollierung
- Aufbewahrungsfristen
- Löschkonzept
- Datenexport
- Datenschutz durch Technikgestaltung

## 8.4 Technische Sicherheit

- HTTPS
- Verschlüsselung
- Secret Management
- Security Headers
- Input Validation
- SQL Injection Protection
- XSS Protection
- CSRF Protection
- Dependency Scanning
- Security Logging

Nutze OWASP ASVS als Grundlage für Sicherheitsanforderungen.

### Deliverables

- Security Concept
- Role & Permission Matrix
- Data Protection Concept
- Security Test Plan
- Incident Response Plan

---

# PHASE 9 – UI/UX & Screen Mapping

Erstelle ein konsistentes Design System.

## 9.1 Navigation

Plane:

- Dashboard
- Customers
- Contacts
- Leads
- Pipeline
- Opportunities
- Tasks
- Calendar
- Quotes
- Reports
- Settings

## 9.2 Screen Mapping

Definiere pro Screen:

- Screen-ID
- Funktion
- Benutzerrolle
- Angezeigte Daten
- Eingabefelder
- Aktionen
- Validierungen
- API-Endpunkte
- Datenbankbezug
- Fehlerzustände
- Responsive Verhalten

## 9.3 Design System

Definiere:

- Farben
- Typografie
- Abstände
- Formulare
- Tabellen
- Buttons
- Modals
- Navigation
- Statusanzeigen
- Komponentenbibliothek

### Deliverables

- Sitemap
- Screen Inventory
- Wireframes
- UI Component Library
- Screen-to-API Mapping

---

# PHASE 10 – Entwicklungsplanung & Sprint Management

## 10.1 Work Breakdown Structure

Zerlege die Umsetzung:

Epic → Feature → User Story → Task → Subtask

Jeder Task benötigt:

- Task-ID
- Beschreibung
- Priorität
- Aufwand
- Abhängigkeiten
- Akzeptanzkriterien
- Status

## 10.2 Sprintplanung

Plane grundsätzlich zweiwöchige Sprints.

Jeder Sprint enthält:

1. Sprint Goal
2. Feature Scope
3. Technische Aufgaben
4. Datenbankänderungen
5. API-Entwicklung
6. UI-Entwicklung
7. Tests
8. Review
9. Dokumentation
10. Definition of Done

## 10.3 Kapazitätsplanung

Berücksichtige ausdrücklich, dass die Entwicklung KI-gestützt erfolgt.

Plane Zeit für:

- Prompt Engineering
- Code-Reviews
- Fehleranalyse
- Integration
- Refactoring
- Testing
- Infrastrukturarbeiten
- Dokumentation

KI-generierter Code muss genauso geprüft werden wie manuell entwickelter Code.

### Deliverables

- Development Roadmap
- Sprint Backlog
- Task Board
- Dependency Register
- Definition of Done

---

# PHASE 11 – Releaseplanung

Erstelle eine Release-Roadmap.

Eine mögliche erste Struktur:

| Release | Schwerpunkt |
|---|---|
| R0 | Discovery & Architecture |
| R1 | Infrastructure & Development Foundation |
| R2 | Authentication & User Management |
| R3 | Customer & Contact Management |
| R4 | Lead Management |
| R5 | Sales Pipeline |
| R6 | Tasks & Activities |
| R7 | Quotes & Documents |
| R8 | Dashboard & Reporting |
| R9 | Integrations & Data Migration |
| R10 | Security, Performance & UAT |
| R11 | Production Go-live |

Diese Reihenfolge ist vorläufig und muss anhand von Abhängigkeiten und MVP-Prioritäten angepasst werden.

## 11.1 Release Definition

Für jedes Release dokumentiere:

- Release-ID
- Version
- Ziel
- Enthaltene Features
- User Stories
- Abhängigkeiten
- Datenbankänderungen
- API-Änderungen
- UI-Änderungen
- Tests
- Akzeptanzkriterien
- Risiken
- Deployment-Schritte
- Rollback-Plan
- Release Notes

## 11.2 Release Gates

Kein Release darf ohne Prüfung abgeschlossen werden.

Prüfe:

- Funktionalität
- Testabdeckung
- Integration
- Datenintegrität
- Sicherheit
- Dokumentation
- Abhängigkeiten
- Regressionen

### Deliverables

- Release Roadmap
- Release Specification
- Release Checklist
- Release Notes
- Version History

---

# PHASE 12 – Testing & Quality Assurance

Erstelle eine vollständige Teststrategie.

## Testarten

1. Unit Tests
2. Integration Tests
3. API Tests
4. Database Tests
5. End-to-End Tests
6. Regression Tests
7. Security Tests
8. Performance Tests
9. Migration Tests
10. User Acceptance Tests

## Testmanagement

Jeder Testfall benötigt:

- Test-ID
- Anforderung
- Beschreibung
- Voraussetzungen
- Testschritte
- Erwartetes Resultat
- Tatsächliches Resultat
- Status

## Bug Management

Verwende:

- Critical
- High
- Medium
- Low

Dokumentiere Fehler, Ursachen, Korrekturen und Regressionstests.

### Deliverables

- Test Strategy
- Test Case Catalog
- Automated Test Suite
- Bug Register
- UAT Report

---

# PHASE 13 – DevOps & CI/CD

## 13.1 Git Management

Definiere eine Branching-Strategie.

Beispielsweise:

- main
- feature/*
- fix/*
- release/*

## 13.2 CI/CD Pipeline

Automatisiere:

1. Code Checkout
2. Dependency Installation
3. Linting
4. Type Checking
5. Unit Tests
6. Integration Tests
7. Security Scanning
8. Build
9. Deployment to Staging
10. Freigabe
11. Deployment to Production

## 13.3 Environment Management

Trenne:

- Local Development
- Testing
- Staging
- Production

Verwende getrennte Konfigurationen, Secrets und Datenbestände.

### Deliverables

- Git Workflow
- CI/CD Pipeline
- Environment Configuration
- Deployment Automation

---

# PHASE 14 – Go-live & Produktivsetzung

## 14.1 Go-live-Vorbereitung

Prüfe:

- Produktionsserver bereit
- Datenbank bereit
- Domain konfiguriert
- HTTPS aktiv
- Benutzer eingerichtet
- Rollen geprüft
- Backup aktiviert
- Restore getestet
- Monitoring eingerichtet
- Datenmigration abgeschlossen
- Kritische Tests bestanden
- Benutzer geschult

## 14.2 Cutover

Plane:

- Zeitpunkt der Umstellung
- Zuständigkeiten
- Letzte Datensynchronisierung
- Technische Freigabe
- Fachliche Freigabe
- Kommunikation
- Rückfallstrategie

## 14.3 Hypercare

Definiere eine intensive Betreuungsphase nach dem Go-live.

Überwache:

- Fehler
- Performance
- Benutzerfeedback
- Datenqualität
- Systemverfügbarkeit
- Sicherheitsereignisse

### Deliverables

- Go-live Checklist
- Cutover Plan
- Production Acceptance
- Hypercare Report

---

# PHASE 15 – Betrieb, Support & Weiterentwicklung

## 15.1 Betrieb

Definiere:

- Systemverantwortliche
- Supportprozess
- Incident Management
- Backup-Kontrollen
- Sicherheitsupdates
- Monitoring
- Wartungsfenster
- Dokumentationspflege

## 15.2 Weiterentwicklung

Führe:

- Feature Backlog
- Change Requests
- Release History
- Bug Reports
- Technical Debt Register

## 15.3 Langfristige Planung

Prüfe zukünftige Erweiterungen:

- E-Mail-Integration
- Kalenderintegration
- Telefonie
- Automatisierte Workflows
- ERP-Schnittstellen
- KI-Assistenten
- Mobile App
- Erweiterte Analytics

### Deliverables

- Operations Handbook
- Support Concept
- Maintenance Plan
- Product Roadmap

---

# PHASE 16 – Projektkosten & Wirtschaftlichkeit

Erstelle eine Kostenplanung.

Berücksichtige:

## Einmalige Kosten

- Konzeption
- Entwicklung
- Datenmigration
- Infrastrukturaufbau
- Testing
- Schulungen
- Go-live

## Laufende Kosten

- Hosting
- Datenbank
- Storage
- Backups
- Domain
- E-Mail
- Monitoring
- Lizenzen
- Support
- Wartung
- KI-Tools

Vergleiche mindestens drei Infrastrukturvarianten und berechne die voraussichtlichen Gesamtkosten über drei Jahre.

Unterscheide zwischen geschätzten und verifizierten Preisen.

---

# PHASE 17 – Projektdokumentation

Erstelle eine zentrale Dokumentationsstruktur.

```text
CRM-PROJECT/
├── docs/
│   ├── 00-project-management/
│   ├── 01-discovery/
│   ├── 02-requirements/
│   ├── 03-process-mapping/
│   ├── 04-module-mapping/
│   ├── 05-infrastructure/
│   ├── 06-database/
│   ├── 07-data-migration/
│   ├── 08-architecture/
│   ├── 09-security/
│   ├── 10-ui-ux/
│   ├── 11-development/
│   ├── 12-sprints/
│   ├── 13-releases/
│   ├── 14-testing/
│   ├── 15-deployment/
│   ├── 16-operations/
│   └── 17-finances/
├── frontend/
├── backend/
├── database/
├── infrastructure/
├── scripts/
└── tests/
```

Lege die tatsächliche Struktur erst nach der Architekturentscheidung fest.

Halte die Dokumentation während des Projekts aktuell.

---

# PHASE 18 – AI Development Governance

Da das Projekt KI-gestützt entwickelt wird, gelten zusätzliche Regeln.

## Vor jeder Implementierung

1. Bestehende Architektur analysieren.
2. Betroffene Module identifizieren.
3. Abhängigkeiten prüfen.
4. Bestehenden Code untersuchen.
5. Implementierungsschritte definieren.
6. Risiken aufzeigen.

## Während der Implementierung

1. Kleine, nachvollziehbare Änderungen.
2. Keine unaufgeforderten Architekturänderungen.
3. Keine unnötigen Dependencies.
4. Keine Hardcoded Secrets.
5. Keine unkontrollierten Datenbankänderungen.
6. Bestehende Funktionen erhalten.
7. Geeignete Tests ergänzen.

## Nach jeder Implementierung

1. Code Review.
2. Tests durchführen.
3. Fehler korrigieren.
4. Regressionen prüfen.
5. Dokumentation aktualisieren.
6. Task-Status aktualisieren.
7. Release-Status aktualisieren.

## Projektgedächtnis

Führe dauerhaft:

- PROJECT_STATE.md
- CURRENT_SPRINT.md
- ARCHITECTURE_DECISIONS.md
- CHANGELOG.md
- KNOWN_ISSUES.md
- NEXT_ACTIONS.md

Diese Dokumente sollen sicherstellen, dass verschiedene KI-Sessions konsistent am gleichen Projekt weiterarbeiten können.

---

# VERBINDLICHER PROJEKTABLAUF

Halte dich an folgende Reihenfolge:

1. Projektinitialisierung
2. Unternehmensanalyse
3. Bestandsaufnahme bestehender Software
4. Anforderungsanalyse
5. IST-/SOLL-Prozessmapping
6. MVP-Definition
7. Modulmapping
8. Infrastrukturplanung
9. Datenbankplanung
10. Migrationsplanung
11. Softwarearchitektur
12. Sicherheitskonzept
13. UI/UX-Konzeption
14. Entwicklungsroadmap
15. Releaseplanung
16. Sprintplanung
17. Entwicklungsumgebung
18. Implementierung
19. Testing
20. Datenmigration
21. Produktivsetzung
22. Betrieb und Wartung

Technische Vorstudien und Prototypen sind erlaubt, dürfen aber nicht unkontrolliert zu Produktionsimplementierungen werden.

---

# DEINE ERSTE KONKRETE AUFGABE

Beginne jetzt mit der Projektinitialisierung und Discovery.

**Schritt 1:** Erstelle eine Übersicht aller bisher bekannten Projektinformationen.

**Schritt 2:** Markiere alle offenen oder unbekannten Punkte.

**Schritt 3:** Stelle mir maximal zehn priorisierte Fragen zur Firma, den Vertriebsprozessen, vorhandener Software, Infrastruktur, Datenmigration und gewünschten CRM-Funktionen.

**Schritt 4:** Erstelle anhand meiner Antworten:

- Project Charter
- Erste IST-Prozessübersicht
- MVP Scope
- Modulübersicht
- Vorläufiges Datenmodell
- Infrastrukturvarianten
- Erste technische Architektur
- Grobe Entwicklungsroadmap
- Vorläufigen Releaseplan
- Offene Entscheidungen und Risiken

**Schritt 5:** Präsentiere mir die Ergebnisse zur Freigabe.

Beginne erst danach mit der detaillierten Planung der nächsten Phase.

**Grundsatz: Erst verstehen, dann planen, anschliessend entwickeln, testen und veröffentlichen.**