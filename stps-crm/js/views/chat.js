// Chat: Kanal «Team» (alle) und «Geschäftsleitung» (nur Team-Admins + Benutzer mit Management-Kennzeichen; Reiter nur für diese sichtbar, der Server erzwingt es). Eigene Nachrichten rechts (in der Farbe des Teams), die der anderen links mit Name und Uhrzeit.
// Nur Text: alles läuft durch html`` (escaped), Zeilenumbrüche zeigt CSS (white-space: pre-wrap) – kein HTML aus Nachrichten.
// Zustand und Abfrage im Hintergrund: js/chat.js. Der Entwurf bleibt erhalten, wenn die Seite neu gezeichnet wird.
import * as store from "../store.js";
import * as chat from "../chat.js";
import * as push from "../push.js";
import { avatarClass } from "../presence.js";
import { html, fmtDate, initials } from "../util.js";
import { t, locale } from "../i18n.js";
import { icon, toast } from "../ui.js";
import { roleLabel } from "./team.js";

export const pageTitle = () => t("nav.chat");

const GROUP_MS = 5 * 60 * 1000; // Nachrichten derselben Person innerhalb von 5 Minuten bilden einen Block

const dayKey = (iso) => iso.slice(0, 10);
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const timeOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }); };

function dayLabel(iso) {
  const day = localDay(iso);
  const now = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === ymd(now)) return t("rel.today");
  if (day === ymd(new Date(now.getTime() - 86400000))) return t("rel.yesterday");
  return fmtDate(day);
}

function bubble(m, prev, myId) {
  const mine = m.uid === myId;
  const who = m.sa && !store.isSuper() ? t("chat.administrator") : m.name; // Mitglieder sehen den Superadmin nur als «Administrator»
  const sameDay = prev && localDay(prev.at) === localDay(m.at);
  const grouped = prev && sameDay && prev.uid === m.uid && Date.parse(m.at) - Date.parse(prev.at) < GROUP_MS;
  const sep = !sameDay ? html`<li class="chat-day" role="separator"><span>${dayLabel(m.at)}</span></li>` : "";
  const time = html`<time datetime="${m.at}" title="${new Date(m.at).toLocaleString(locale())}">${timeOf(m.at)}</time>`;
  return html`${sep}<li class="chat-msg ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""}" data-id="${m.id}">
    ${mine ? "" : html`<span class="av ${avatarClass(m.uid)} ${grouped ? "ghost" : ""}" aria-hidden="true">${initials(who)}</span>`}
    <div class="chat-bubble">
      ${mine || grouped ? "" : html`<div class="chat-author">${who}${m.sa && store.isSuper() ? html` <span class="badge t-navy">${roleLabel("superadmin")}</span>` : ""}</div>`}
      <div class="chat-text">${m.text}</div>
      <div class="chat-time">${time}</div>
    </div>
  </li>`;
}

export function render(root) {
  if (store.S.mode !== "server" || store.S.noTeam) {
    root.innerHTML = html`<div class="page-head"><h1>${t("nav.chat")}</h1></div><p class="muted">${t("chat.onlyServer")}</p>`.toString();
    return;
  }
  const team = store.getTeam();
  const myId = store.getMe()?.id;
  const shown = chat.channel; // Kanal dieser Darstellung
  const tabsKey = chat.available.join();
  const tabs = chat.available.length > 1
    ? html`<div class="tabs chat-tabs" role="tablist" aria-label="${t("chat.channels")}">${chat.available.map((c) => html`<button type="button" class="tab ${c === shown ? "on" : ""}" role="tab" aria-selected="${c === shown}" data-chat-channel="${c}">${t(`chat.ch.${c}`)}${chat.unreadOf(c) && c !== shown ? html` <span class="badge t-amber">${chat.unreadOf(c)}</span>` : ""}</button>`)}</div>`
    : "";
  root.innerHTML = html`
    <div class="page-head chat-head"><div><h1>${t("nav.chat")}${team ? html` <span class="muted">· ${team.name}</span>` : ""}</h1><p class="intro">${t(shown === "mgmt" ? "chat.introMgmt" : "chat.intro")}</p></div></div>
    ${tabs}
    ${push.controlHtml()}
    <section class="card chat-card" aria-label="${t(`chat.ch.${shown}`)}">
      <div class="chat-list" data-chat-list role="log" aria-live="polite" aria-relevant="additions" aria-label="${t("chat.log")}" tabindex="0"></div>
      <form class="chat-form" data-chat-form>
        <label class="sr" for="q-chat-input">${t("chat.label")}</label>
        <textarea id="q-chat-input" rows="1" maxlength="${chat.MAX_TEXT}" placeholder="${t("chat.placeholder")}" enterkeyhint="send" autocomplete="off"></textarea>
        <button type="submit" class="btn btn-primary chat-send" data-chat-send>${icon("chatlines")}<span>${t("chat.send")}</span></button>
      </form>
    </section>`.toString();

  const list = root.querySelector("[data-chat-list]");
  const form = root.querySelector("[data-chat-form]");
  const input = root.querySelector("#q-chat-input");
  input.value = chat.st.draft;
  let sending = false;
  let initial = true; // erstes Zeichnen dieser Seite: Position von vorher wiederherstellen (Neuzeichnen durch Sprachwechsel o. Ä.)
  let forceBottom = false;
  const restore = chat.st.fromBottom || 0;

  const grow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  };
  grow();

  const gap = () => list.scrollHeight - list.scrollTop - list.clientHeight;
  list.addEventListener("scroll", () => { chat.st.fromBottom = gap(); }, { passive: true });

  function paint({ older = false } = {}) {
    const st = chat.st;
    const atBottom = forceBottom || (initial ? restore < 90 : gap() < 90);
    const prevHeight = list.scrollHeight;
    const prevTop = list.scrollTop;
    let body;
    if (!st.loaded) {
      body = html`<p class="chat-empty muted">${st.error ? html`${t("chat.loadFailed", { err: st.error })} <button type="button" class="btn btn-sm" data-chat-retry>${t("auth.retry")}</button>` : t("common.loading")}</p>`;
    } else if (!st.messages.length) {
      body = html`<p class="chat-empty muted">${t("chat.empty")}</p>`;
    } else {
      body = html`<ul class="chat-msgs">${st.hasMore ? html`<li class="chat-more"><button type="button" class="btn btn-sm" data-chat-older>${t("chat.older")}</button></li>` : ""}${st.messages.map((m, i) => bubble(m, st.messages[i - 1], myId))}</ul>`;
    }
    list.innerHTML = body.toString();
    if (older) list.scrollTop = prevTop + (list.scrollHeight - prevHeight);
    else if (atBottom) list.scrollTop = list.scrollHeight;
    else if (initial) list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - restore);
    else list.scrollTop = prevTop;
    forceBottom = false;
    if (st.loaded) initial = false;
  }

  paint();
  let dead = false;
  const off = chat.subscribe(() => {
    if (!root.isConnected || dead) { off(); return; } // die Seite wurde ersetzt (neu gezeichnet oder verlassen)
    if (chat.channel !== shown || chat.available.join() !== tabsKey) { dead = true; off(); render(root); return; } // Kanal gewechselt oder Zugang geändert
    paint();
  });
  root.querySelector(".chat-tabs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chat-channel]");
    if (!b || b.dataset.chatChannel === shown) return;
    chat.st.draft = input.value;
    chat.setChannel(b.dataset.chatChannel);
    if (chat.channel !== shown) { dead = true; off(); render(root); }
  });

  input.addEventListener("input", () => { chat.st.draft = input.value; grow(); });
  input.addEventListener("keydown", (e) => {
    // Enter sendet (Umschalt+Enter = neue Zeile); auf Touch-Geräten ist Enter ein Zeilenumbruch
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    form.querySelector("[data-chat-send]").disabled = true;
    try {
      await chat.send(text);
      chat.st.draft = "";
      input.value = "";
      grow();
      forceBottom = true; // eigene Nachricht: ans Ende springen
      paint();
    } catch (err) {
      if (!store.handleAuthError(err)) toast(err.message || t("chat.sendFailed"), { type: "error", ms: 8000 });
    } finally {
      sending = false;
      form.querySelector("[data-chat-send]").disabled = false;
      input.focus({ preventScroll: true });
    }
  });
  list.addEventListener("click", async (e) => {
    if (e.target.closest("[data-chat-retry]")) { chat.poll(); return; }
    const older = e.target.closest("[data-chat-older]");
    if (!older) return;
    older.disabled = true;
    try { await chat.loadOlder(); paint({ older: true }); } catch (err) { if (!store.handleAuthError(err)) toast(err.message, { type: "error" }); older.disabled = false; }
  });
  push.mount(root);
}
