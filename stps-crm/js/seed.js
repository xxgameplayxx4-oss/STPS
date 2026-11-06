// Beispieldaten: der eine Beispielsatz aus der Excel-Vorlage (nur auf ausdrücklichen Klick in den Einstellungen).
import { create, batch } from "./store.js";
import { uid } from "./util.js";

export function loadSampleData() {
  return batch(() => {
    const customer = create("customers", {
      firma: "Beispiel Kunde AG",
      prioritaet: "B",
      produkt: "Beispielprojekt (Dreh-/Frästeile)",
      phase: "Angebot gesendet",
      potenzial: 67000,
      angebot: 67000,
      naechsterSchritt: "nachfassen",
      termin: "2026-10-23",
      kommentar: "Beispieldatensatz aus der Excel-Vorlage – kann gelöscht werden.",
      owner: "Marco",
      quelle: "Empfehlung Marco",
      chance: 40, // Vorschlag für die Phase «Angebot gesendet» (in der Vorlage leer)
      status: "Prospect",
      contacts: [
        { id: uid(), name: "Anna Beispiel", funktion: "Leiterin Einkauf", email: "anna.beispiel@example.com", telefon: "+41 44 000 00 01", mobile: "", notiz: "", primary: true },
        { id: uid(), name: "Beat Muster", funktion: "Technischer Leiter", email: "beat.muster@example.com", telefon: "", mobile: "+41 79 000 00 02", notiz: "Zeichnungen und Toleranzen", primary: false },
      ],
    });
    const supplier = create("suppliers", {
      firma: "nakaomi",
      ort: "Vietnam",
      status: "Aktiv",
      owner: "Liz",
      notiz: "Beispielnotiz: Präzisions-Dreh- und Frästeile, schnelle Rückmeldung per E-Mail. Muster vor Serienfreigabe anfordern.",
      contacts: [
        { id: uid(), name: "Nguyen Van An", funktion: "Sales Manager", email: "an.nguyen@example.com", telefon: "+84 24 0000 0001", mobile: "", notiz: "", primary: true },
        { id: uid(), name: "Tran Thi Binh", funktion: "Qualitätssicherung", email: "binh.tran@example.com", telefon: "", mobile: "+84 90 000 0002", notiz: "Ansprechperson für Messberichte", primary: false },
      ],
    });
    const deal = create("deals", {
      customerId: customer.id,
      produkt: "Beispielprojekt (Dreh-/Frästeile)",
      wert: 67000,
      phase: "Angebot gesendet",
      chance: 40,
      naechsterSchritt: "nachfassen",
      owner: "Marco",
    });
    create("rfqs", {
      customerId: customer.id,
      supplierId: supplier.id,
      contactId: "",
      dealId: deal.id,
      produkt: "Beispielprojekt (Dreh-/Frästeile)",
      phase: "Lieferant zugeordnet",
      waehrung: "CHF",
    });
    return { customer, supplier, deal };
  });
}
