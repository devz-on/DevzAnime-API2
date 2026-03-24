const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('DAniApi/stream-4-player.min.js', 'utf8');

const noOp = () => {};
const chainProxy = new Proxy(function () {}, {
  get() { return chainProxy; },
  apply() { return chainProxy; },
});

const appended = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  fetch,
  URL,
  Date,
  Math,
  Promise,
  settings: {
    time: 0,
    autoPlay: '1',
    playOriginalAudio: '1',
    autoSkipIntro: '0',
    vast: 0,
    base_url: 'https://megaplay.buzz/',
    domain2_url: 'https://mewcdn.online/',
    type: 'sub',
    cid: '494e',
  },
  window: null,
  document: {
    body: {
      innerHTML: '',
      appendChild(node) { appended.push(node); },
    },
    querySelector(sel) {
      if (sel === '#megaplay-player') {
        return {
          getAttribute(name) {
            if (name === 'data-ep-id') return '162345';
            if (name === 'data-fileversion') return '0';
            return '';
          },
          style: {},
        };
      }
      if (sel === '.error-content') {
        return { style: {} };
      }
      if (sel === '.mg3-player') {
        return { style: {} };
      }
      return { style: {}, getAttribute: () => '' };
    },
    createElement(tag) {
      return {
        tag,
        style: {},
        set src(v) { this._src = v; },
        get src() { return this._src; },
        set frameBorder(v) { this._frameBorder = v; },
        set allowFullscreen(v) { this._allowFullscreen = v; },
      };
    },
  },
  navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32' },
  location: {
    protocol: 'https:',
    host: 'megaplay.buzz',
    pathname: '/stream/s-4/162345/sub',
    search: '',
    href: 'https://megaplay.buzz/stream/s-4/162345/sub',
    replace(v) { this.href = v; },
  },
  jwplayer() { return chainProxy; },
  $() {
    return {
      attr(name) {
        if (name === 'data-ep-id') return '162345';
        if (name === 'data-fileversion') return '0';
        return '';
      },
      on: noOp,
      hide: noOp,
      show: noOp,
      html: noOp,
      text: noOp,
      addClass: noOp,
      removeClass: noOp,
      css: noOp,
    };
  },
  DOMParser: class {
    parseFromString(html) {
      return {
        querySelectorAll(sel) {
          if (sel !== '.server-btn') return [];
          const re = /class="server-btn"[^>]*data-server="([^"]+)"[^>]*data-id="([^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g;
          const out = [];
          let m;
          while ((m = re.exec(html))) {
            const server = m[1];
            const id = m[2];
            const label = m[3];
            out.push({
              getAttribute(attr) {
                if (attr === 'data-server') return server;
                if (attr === 'data-id') return id;
                return null;
              },
              querySelector() {
                return { textContent: label };
              },
            });
          }
          return out;
        },
      };
    }
  },
};
context.window = context;

(async () => {
  try {
    const script = new vm.Script(src, { filename: 'stream-4-player.min.js' });
    const vmContext = vm.createContext(context);
    script.runInContext(vmContext);
    if (typeof vmContext.cCokc !== 'function') {
      console.log('cCokc missing');
      return;
    }
    const result = await vmContext.cCokc('162345', 'sub');
    console.log('resolver result', result);
    if (appended.length) {
      console.log('appended iframe src', appended.map((n) => n._src).filter(Boolean));
    }
  } catch (e) {
    console.error('run error', e && e.stack ? e.stack : e);
  }
})();
