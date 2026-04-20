/**
 * Install-helper — bridges the browser's PWA install capabilities to UI
 * elements on the page.
 *
 * Handles three platform modes:
 *   • "deferred-prompt" — the browser fired beforeinstallprompt (Android
 *     Chrome, desktop Chrome/Edge). We can call prompt() from a click handler.
 *   • "ios"             — iOS Safari; no programmatic install, user must tap
 *     Share → Add to Home Screen. We show an instructional modal.
 *   • "installed"       — already running as a PWA (display-mode:standalone)
 *     or the appinstalled event fired this session. Install UI is hidden.
 *   • "unsupported"     — everything else (e.g. Firefox on desktop). Generic
 *     fallback: point user to the /install page.
 *
 * Public API on window.PositronInstall:
 *   - mode: "deferred-prompt" | "ios" | "installed" | "unsupported"
 *   - canPrompt: boolean      — shortcut for mode === "deferred-prompt"
 *   - showPrompt(): Promise   — trigger the right UX for the current mode
 *   - onChange(cb): () => void — subscribe to mode transitions
 *
 * Designed to run on every page via base.njk. Side effects are limited to:
 *   - toggling [data-install-mode] attribute on <html> for CSS hooks
 *   - toggling .hidden / .visible on [data-install-cta] elements
 *   - auto-opening the install modal when ?install=1 is present in the URL
 */
(function () {
  "use strict";

  var deferredPrompt = null;
  // Sentinel so the first setMode() call always fires (even when the
  // detected mode happens to match the default).
  var mode = null;
  var listeners = [];

  function isStandalone() {
    // iOS Safari sets navigator.standalone; modern browsers use display-mode.
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    var ua = window.navigator.userAgent || "";
    var isIPhoneOrIPad = /iP(ad|hone|od)/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS masquerades as Mac
    var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isIPhoneOrIPad && isSafari;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    document.documentElement.setAttribute("data-install-mode", mode);
    window.PositronInstall.mode = mode;
    window.PositronInstall.canPrompt = mode === "deferred-prompt";
    listeners.forEach(function (cb) { try { cb(mode); } catch (_) { /* noop */ } });
    // Toggle any CTAs on the page.
    document.querySelectorAll("[data-install-cta]").forEach(function (el) {
      var wants = el.getAttribute("data-install-cta"); // "any" | "deferred-prompt" | "ios"
      var shown = wants === "any" ? mode !== "installed" : wants === mode;
      if (shown) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
  }

  function initialMode() {
    if (isStandalone()) return "installed";
    if (isIos())        return "ios";
    return "unsupported";
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  window.PositronInstall = {
    mode: "unsupported",
    canPrompt: false,

    showPrompt: function () {
      if (mode === "deferred-prompt" && deferredPrompt) {
        var evt = deferredPrompt;
        deferredPrompt = null;
        return evt.prompt().then(function () {
          return evt.userChoice.then(function (choice) {
            if (choice && choice.outcome !== "accepted") {
              // User dismissed — next beforeinstallprompt will refire, but
              // not immediately. For now, leave mode as "unsupported" so
              // the button doesn't flicker back on; it'll re-arm if the
              // browser decides to offer the prompt again.
              setMode("unsupported");
            }
            return choice && choice.outcome;
          });
        });
      }
      if (mode === "ios") {
        showIosModal();
        return Promise.resolve("ios-modal");
      }
      // Unsupported / already installed — route to the /install page so at
      // least the user sees manual instructions.
      if (mode !== "installed" && window.location.pathname !== "/install/") {
        window.location.href = "/install/";
      }
      return Promise.resolve(mode);
    },

    onChange: function (cb) {
      listeners.push(cb);
      return function () {
        listeners = listeners.filter(function (c) { return c !== cb; });
      };
    },
  };

  // ─── Event wiring ──────────────────────────────────────────────────────────
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    setMode("deferred-prompt");
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    setMode("installed");
  });

  // ─── iOS modal ─────────────────────────────────────────────────────────────
  // Rendered on-demand so every page doesn't pay for it unless the user hits
  // the install CTA. Kept intentionally minimal — just the Share icon + the
  // two-step instruction.
  function showIosModal() {
    if (document.getElementById("positron-install-modal")) return;

    var overlay = document.createElement("div");
    overlay.id = "positron-install-modal";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;" +
      "align-items:center;justify-content:center;padding:20px;z-index:9999;" +
      "font-family:system-ui,-apple-system,sans-serif;";

    overlay.innerHTML =
      "<div style=\"background:#fffbeb;border-radius:16px;max-width:360px;" +
      "width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.25);\">" +
        "<h2 style=\"margin:0 0 8px;font-size:22px;color:#78350f;\">Install Positron Today</h2>" +
        "<p style=\"margin:0 0 16px;font-size:14px;color:#92400e;\">" +
          "iOS can't install this automatically — here's how to add it to your home screen:" +
        "</p>" +
        "<ol style=\"margin:0 0 20px;padding-left:20px;color:#78350f;font-size:15px;line-height:1.6;\">" +
          "<li>Tap the <strong>Share</strong> button " +
            "<span style=\"display:inline-block;vertical-align:middle;color:#2563eb;\">⬆️</span> " +
            "(a square with an arrow pointing up)." +
          "</li>" +
          "<li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>" +
          "<li>Tap <strong>Add</strong> in the top-right corner.</li>" +
        "</ol>" +
        "<button id=\"positron-install-modal-close\" " +
          "style=\"width:100%;padding:12px;background:#f59e0b;color:white;border:0;" +
          "border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;\">" +
          "Got it" +
        "</button>" +
      "</div>";

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.id === "positron-install-modal-close") {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────
  setMode(initialMode());

  // Re-check installed state after load (iOS navigator.standalone sometimes
  // updates late).
  if (document.readyState !== "complete") {
    window.addEventListener("load", function () {
      if (isStandalone()) setMode("installed");
    });
  }

  // Auto-open the install flow when ?install=1 is in the URL. Runs after DOM
  // is ready so the iOS modal has a body to attach to.
  function maybeAutoTrigger() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("install") !== "1") return;
      // Defer to the next tick so beforeinstallprompt has a chance to fire
      // first — many Chrome versions fire it shortly after load.
      setTimeout(function () { window.PositronInstall.showPrompt(); }, 400);
    } catch (_) { /* noop */ }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeAutoTrigger);
  } else {
    maybeAutoTrigger();
  }
})();
