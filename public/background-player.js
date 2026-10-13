// Keep the outgoing image fully visible until the incoming image covers it.
// Fading both layers out together would expose the page color between images.
export class BackgroundPlayer {
  constructor(element) {
    this.layers = [...element.children];
    this.active = 0;
    this.current = '/backgrounds/mist.svg';
    this.layers[0].dataset.backgroundUrl = this.current;
    this.views = {};
    this.urls = [this.current];
    this.interval = 30000;
    this.signature = '';
    this.version = 0;
    this.timer = null;
    this.transition = null;
    this.loads = new Map();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', () => {
      clearTimeout(this.timer);
      if (!document.hidden) {
        this.nextAt = performance.now() + this.interval;
        this.schedule(this.version);
      }
    });
  }

  configure(urls, intervalSeconds, views = {}) {
    this.views = views;
    for (const layer of this.layers) {
      if (layer.dataset.backgroundUrl) this.applyView(layer, layer.dataset.backgroundUrl);
    }
    const signature = JSON.stringify([urls, intervalSeconds]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.urls = [...new Set(urls)];
    this.interval = intervalSeconds * 1000;
    const version = ++this.version;
    clearTimeout(this.timer);
    this.nextAt = performance.now() + this.interval;
    const visible = this.incoming || this.current;
    const target = this.urls.includes(visible) ? visible : this.urls[0];
    this.start(target, version);
  }

  applyView(layer, url) {
    const view = this.views[url] || { x: 50, y: 50, fit: 'cover' };
    layer.style.backgroundPosition = `${view.x}% ${view.y}%`;
    layer.style.backgroundSize = view.fit;
  }

  load(url) {
    if (this.loads.has(url)) return this.loads.get(url);
    const promise = new Promise((resolve, reject) => {
      const picture = new Image();
      const timeout = setTimeout(() => finish(new Error('背景加载超时')), 15000);
      const finish = error => {
        clearTimeout(timeout);
        picture.onload = picture.onerror = null;
        if (error) reject(error); else resolve();
      };
      picture.onload = async () => {
        try { await picture.decode(); finish(); }
        catch { finish(new Error('背景无法显示')); }
      };
      picture.onerror = () => finish(new Error('背景无法显示'));
      picture.src = url;
    });
    this.loads.set(url, promise);
    // Keep only a few decoded images ready; the browser manages its disk cache.
    if (this.loads.size > 4) this.loads.delete(this.loads.keys().next().value);
    promise.catch(() => { if (this.loads.get(url) === promise) this.loads.delete(url); });
    return promise;
  }

  async show(url, version) {
    try { await this.load(url); } catch { return false; }
    while (this.transition) await this.transition;
    if (version !== this.version) return false;
    if (url === this.current) return true;
    const outgoing = this.layers[this.active];
    const next = 1 - this.active;
    const incoming = this.layers[next];
    incoming.style.backgroundImage = `url("${url}")`;
    incoming.dataset.backgroundUrl = url;
    this.applyView(incoming, url);
    incoming.style.zIndex = '1';
    outgoing.style.zIndex = '0';
    incoming.style.willChange = 'opacity';
    this.incoming = url;
    const animation = incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: this.reducedMotion.matches || document.hidden ? 0 : 1600,
      easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards',
    });
    this.transition = animation.finished.then(() => {
      incoming.style.opacity = '1';
      outgoing.style.opacity = '0';
      incoming.style.willChange = '';
      animation.cancel();
      this.active = next;
      this.current = url;
      this.incoming = null;
      this.transition = null;
    });
    await this.transition;
    return true;
  }

  async start(target, version) {
    const candidates = [target, ...this.urls.filter(url => url !== target)];
    for (const url of candidates) {
      if (version !== this.version) return;
      if (await this.show(url, version)) break;
    }
    this.schedule(version);
  }

  schedule(version) {
    if (version !== this.version || this.urls.length < 2 || document.hidden) return;
    const next = (this.urls.indexOf(this.current) + 1) % this.urls.length;
    this.load(this.urls[next]).catch(() => {});
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rotate(version), Math.max(0, this.nextAt - performance.now()));
  }

  async rotate(version) {
    if (version !== this.version || document.hidden) return;
    this.nextAt = performance.now() + this.interval;
    const index = this.urls.indexOf(this.current);
    for (let offset = 1; offset <= this.urls.length; offset++) {
      if (version !== this.version) return;
      const url = this.urls[(index + offset) % this.urls.length];
      if (await this.show(url, version)) break;
    }
    // A slow or failed image must not cause a burst of catch-up transitions.
    if (this.nextAt < performance.now()) this.nextAt = performance.now() + this.interval;
    this.schedule(version);
  }
}
