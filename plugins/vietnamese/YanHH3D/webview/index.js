// YanHH3D In-Player Resolution Setting for Video.js (hls.js levels API)

(function () {
  var injected = false;

  function injectResolutionMenu(skin, hls) {
    if (injected) return;
    var shadow = skin.shadowRoot;
    if (!shadow) return;

    var cluster =
      shadow.querySelector('.video-controls-secondary') ||
      shadow.querySelector('.video-controls-primary');
    if (!cluster) return;

    var levels = hls.levels || [];
    if (levels.length <= 1) return;

    injected = true;

    // Inject styles into skin shadow root
    var style = document.createElement('style');
    style.textContent = `
      .yan-res-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        margin-right: 6px;
        font-family: inherit;
        z-index: 200;
      }
      .yan-res-btn {
        appearance: none;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 6px;
        color: #ffffff;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        outline: none;
        height: 28px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .yan-res-btn:hover {
        background: rgba(255, 255, 255, 0.25);
        border-color: rgba(255, 255, 255, 0.4);
      }
      .yan-res-menu {
        position: absolute;
        bottom: calc(100% + 6px);
        right: 0;
        background: rgba(20, 20, 24, 0.95);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 4px;
        min-width: 140px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .yan-res-menu[hidden] {
        display: none !important;
      }
      .yan-res-item {
        appearance: none;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: #d1d5db;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        white-space: nowrap;
        outline: none;
      }
      .yan-res-item:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }
      .yan-res-item.active {
        background: #3b82f6;
        color: #ffffff;
        font-weight: 600;
      }
    `;
    shadow.appendChild(style);

    var container = document.createElement('div');
    container.className = 'yan-res-container';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yan-res-btn';
    btn.setAttribute('aria-label', 'Cài đặt độ phân giải');

    function getLevelLabel(idx) {
      if (idx === -1) return 'Auto';
      var lvl = levels[idx];
      if (!lvl) return 'Quality';
      if (lvl.name) return lvl.name;
      if (lvl.height >= 2160) return '4K';
      if (lvl.height >= 1080) return '1080p';
      if (lvl.height) return lvl.height + 'p';
      return 'Level ' + idx;
    }

    var currentIdx = hls.currentLevel >= 0 ? hls.currentLevel : 0;
    btn.textContent = getLevelLabel(currentIdx);

    var menu = document.createElement('div');
    menu.className = 'yan-res-menu';
    menu.hidden = true;

    function renderMenuItems() {
      menu.innerHTML = '';

      levels.forEach(function (lvl, idx) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'yan-res-item' + (hls.currentLevel === idx ? ' active' : '');
        item.textContent = lvl.name || (lvl.height ? lvl.height + 'p' : 'Level ' + idx);
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          hls.currentLevel = idx; // Video.js / hls.js API setting resolution!
          btn.textContent = getLevelLabel(idx);
          menu.hidden = true;
          renderMenuItems();
        });
        menu.appendChild(item);
      });

      var autoItem = document.createElement('button');
      autoItem.type = 'button';
      autoItem.className = 'yan-res-item' + (hls.currentLevel === -1 ? ' active' : '');
      autoItem.textContent = 'Tự động (Auto)';
      autoItem.addEventListener('click', function (e) {
        e.stopPropagation();
        hls.currentLevel = -1;
        btn.textContent = 'Auto';
        menu.hidden = true;
        renderMenuItems();
      });
      menu.appendChild(autoItem);
    }

    renderMenuItems();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });

    document.addEventListener('click', function () {
      menu.hidden = true;
    });

    container.appendChild(btn);
    container.appendChild(menu);
    cluster.prepend(container);

    if (typeof hls.on === 'function') {
      hls.on('hlsLevelSwitched', function (_, data) {
        if (data && typeof data.level === 'number') {
          btn.textContent = getLevelLabel(data.level);
          renderMenuItems();
        }
      });
    }
  }

  function monitorPlayer() {
    var timer = setInterval(function () {
      var skin = document.querySelector('video-skin, live-video-skin');
      var player = window.LNReaderPlayer;
      var hls = player ? player.hlsInstance : null;

      if (skin && hls && hls.levels && hls.levels.length > 0) {
        injectResolutionMenu(skin, hls);
        if (injected) clearInterval(timer);
      }
    }, 400);

    setTimeout(function () {
      clearInterval(timer);
    }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', monitorPlayer);
  } else {
    monitorPlayer();
  }
})();

