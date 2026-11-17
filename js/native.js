/* Nur in der Android-App (Capacitor): Diktat über die Spracherkennung von Android,
   weil die Web-Spracherkennung in der App-Ansicht nicht verfügbar ist.
   Navigation, Standort und Links laufen über die normale Web-Schnittstelle (siehe MainActivity.java). */
(function () {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  document.documentElement.classList.add('native-app');
  const SR = C.Plugins.SpeechRecognition;
  if (!SR || !window.Speech) return;

  class NativeDictation {
    constructor(cb) { this.cb = cb; this.active = false; this.supported = true; this.heard = ''; this.subs = []; }
    toggle() { this.active ? this.stop() : this.start(); }
    async start() {
      try {
        const p = await SR.checkPermissions();
        if (p.speechRecognition !== 'granted' && (await SR.requestPermissions()).speechRecognition !== 'granted') return this.cb.onError('not-allowed');
        if (!(await SR.available()).available) return this.cb.onError('unsupported');
      } catch (e) { return this.cb.onError(e.message || 'unsupported'); }
      if (!this.subs.length) {
        this.subs.push(await SR.addListener('partialResults', d => { this.heard = (d.matches || [])[0] || ''; this.cb.onInterim(this.heard); }));
        this.subs.push(await SR.addListener('listeningState', d => { if (d.status === 'stopped') this.ended(); }));
      }
      this.active = true; this.cb.onState(true); this.listen();
    }
    listen() {
      this.heard = '';
      SR.start({ language: 'de-DE', partialResults: true, popup: false, maxResults: 1 }).catch(e => {
        // „No match“/Pause: einfach weiter zuhören, solange aktiv
        if (this.active && !/permission/i.test(e.message || '')) setTimeout(() => this.active && this.listen(), 250);
        else this.finish();
      });
    }
    ended() {
      const t = this.heard.trim(); this.heard = '';
      if (t) this.cb.onFinal(t);
      this.cb.onInterim('');
      if (this.active) setTimeout(() => this.active && this.listen(), 200);   // Android hört nach Pausen auf → weiter
      else this.finish();
    }
    finish() { if (this.done) return; this.done = true; this.active = false; this.cb.onState(false); this.cb.onInterim(''); if (this.cb.onEnd) this.cb.onEnd(); setTimeout(() => { this.done = false; }, 300); }
    stop() { this.active = false; SR.stop().catch(() => {}); setTimeout(() => { if (this.heard) this.ended(); else this.finish(); }, 400); }
  }
  window.Speech.Dictation = NativeDictation;
  window.Speech.supported = true;
})();
