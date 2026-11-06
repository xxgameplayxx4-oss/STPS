# STPS CRM – Update after the customer meeting

Status (2026-11-05): everything requested in the meeting is built and tested. Not live yet; goes live after KGC says "push". The Outlook sign-in button is part of the same update.

## New features

- **Customers:** country as a dropdown, several delivery addresses (10000.1, .2, …), a separate accounting contact, and a history per contact.
- **Quotes and invoices:** order confirmation added. VAT is set automatically from the country (foreign customers 0% with export note). Currency CHF, EUR or USD; the invoice picks the bank account for its currency (BIC included). Sender printed as "CH-8807 Freienbach" with UID. Sent invoices can only be cancelled, not deleted.
- **Probability:** 20 / 40 / 60 / 80 %; the dashboard shows one line per currency.
- **Categories** with subcategories on customers, suppliers and articles. Suppliers can be marked "vetted"; a "Passende Lieferanten" button finds suppliers matching a customer's categories.
- **Suppliers:** certificates with expiry warnings. Supplier requests get delivery status, dates and tracking. Supplier names never appear on customer documents.
- **Chat:** separate management channel, only for people marked as management.

## Left out

- Admin password and logins (as agreed).
- QR payment slip: Marco wants to set it up with the bank first.

## Open point

- On DHL and other carriers' tracking pages, the customer might see the sender. Raised by Marco in the meeting; still open.

Note: the company name "… AG" in the screenshots is made-up test data.
