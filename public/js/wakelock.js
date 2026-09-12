// ===================================================================
// WAKE LOCK — Bildschirm anlassen
// ===================================================================
// Ohne das sperrt sich das Handy nach 30 Sekunden bis zwei Minuten von
// selbst. Man schaut hoch, ein Tor faellt, das Display ist dunkel -
// entsperren, App suchen, Aktion nachtragen.
//
// Die Sperre gilt nur, solange der Tracker im Vordergrund ist, und wird
// vom Browser automatisch aufgehoben, sobald man wegschaltet. Das ist der
// Unterschied zum Systemweiten "Display-Timeout: nie", das den Akku den
// ganzen Tag leersaugt.
//
// Voraussetzung ist ein sicherer Kontext (HTTPS) - ueber ngrok und spaeter
// ueber den VPS ist das gegeben. Auf iOS gibt es das ab Safari 16.4.
// ===================================================================

(function () {
    'use strict';

    let sentinel = null;
    let wanted = false;
    let announced = false;

    function supported() {
        return 'wakeLock' in navigator && typeof navigator.wakeLock.request === 'function';
    }

    async function acquire(announce) {
        if (!supported() || !wanted) return false;
        if (sentinel && !sentinel.released) return true;
        if (document.visibilityState !== 'visible') return false;

        try {
            sentinel = await navigator.wakeLock.request('screen');
            sentinel.addEventListener('release', function () {
                // Nur merken - das erneute Anfordern passiert ueber
                // visibilitychange, weil der Browser es im Hintergrund
                // ohnehin ablehnen wuerde.
                sentinel = null;
            });

            if (announce && !announced && window.Toast) {
                announced = true;
                window.Toast('Bildschirm bleibt an, solange der Tracker offen ist.',
                    { type: 'info', duration: 4000 });
            }
            return true;
        } catch (e) {
            // Haeufigster Grund: Akkusparmodus. Kein Fehler, nur nicht moeglich.
            console.warn('[WakeLock] nicht moeglich:', e.message);
            return false;
        }
    }

    async function release() {
        wanted = false;
        if (sentinel && !sentinel.released) {
            try { await sentinel.release(); } catch (e) { /* egal */ }
        }
        sentinel = null;
    }

    /** Anfordern und ab jetzt gehalten halten. */
    function enable(announce) {
        wanted = true;
        return acquire(announce !== false);
    }

    // Nach dem Entsperren oder einem Tab-Wechsel ist die Sperre weg -
    // deshalb hier neu anfordern.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && wanted) acquire(false);
    });

    window.WakeLock = {
        supported: supported,
        enable: enable,
        release: release,
        isHeld: function () { return !!(sentinel && !sentinel.released); }
    };
})();
