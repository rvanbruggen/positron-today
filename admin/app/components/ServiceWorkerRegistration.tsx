"use client";

import { useEffect } from "react";
import { APP_VERSION } from "@/lib/version";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The ?v= query bakes the deployed version into the SW script URL, so the
    // browser sees a new worker on every release and triggers install/activate
    // (which then purges the old cache). When a newly activated worker takes
    // over an already-open tab, reload so the PWA picks up fresh code right
    // away instead of waiting for the browser's ~24h SW refresh window.
    const swUrl = `/sw.js?v=${APP_VERSION}`;
    navigator.serviceWorker.register(swUrl).then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "activated" && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {
      // Service worker registration failed — not critical
    });
  }, []);

  return null;
}
