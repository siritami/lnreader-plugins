// YanHH3D In-Player Server Switcher Component

async function doFetch(url, init) {
  var w = window;
  if (w.reader && typeof w.reader.fetch === 'function') {
    return w.reader.fetch(url, init);
  }
  return fetch(url, init);
}

var FALLBACK_TYPES = {
  vip4k: ['vip4k', 'vip4k_v2', 'pro', 'tiktik'],
  pro: ['pro', 'tiktik', 'vip4k', 'vip4k_v2'],
  vip4ktm: ['vip4ktm', 'vip4ktm_v2', 'pro_tm', 'tiktm'],
  pro_tm: ['pro_tm', 'tiktm', 'vip4ktm', 'vip4ktm_v2'],
};

async function resolveCdnForVid(vid, candidateHosts) {
  for (var i = 0; i < candidateHosts.length; i++) {
    try {
      var res = await doFetch('https://' + candidateHosts[i] + '/' + vid + '/index.m3u8', { method: 'HEAD' });
      if (res.status === 200) return 'https://' + candidateHosts[i];
    } catch (e) {
      // ignore
    }
  }
  return 'https://' + candidateHosts[0];
}

function initServerBar() {
  var bar = document.getElementById('yan-server-bar');
  if (!bar) return;

  var postId = bar.getAttribute('data-post-id');
  var ep = bar.getAttribute('data-ep');
  var site = bar.getAttribute('data-site') || 'https://yanhh3d.ee';
  var cdnHostsStr = bar.getAttribute('data-cdn-hosts') || '';
  var cdnHosts = cdnHostsStr.split(',').filter(Boolean);
  var statusEl = document.getElementById('yan-server-status');

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#ef4444' : '#60a5fa';
  }

  var buttons = bar.querySelectorAll('.yan-btn');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var targetType = btn.getAttribute('data-type');
      if (!targetType || !postId || !ep) return;
      if (btn.classList.contains('active')) return;

      var player = window.LNReaderPlayer;
      if (!player) {
        setStatus('Trình phát chưa sẵn sàng', true);
        return;
      }

      buttons.forEach(function (b) { b.classList.add('loading'); });
      setStatus('Đang tải server ' + (btn.textContent ? btn.textContent.trim() : '') + '...');

      try {
        var candidates = FALLBACK_TYPES[targetType] || [targetType];
        var foundVid = null;

        for (var i = 0; i < candidates.length; i++) {
          var type = candidates[i];
          var playerUrl = site + '/player/player.php?action=dox_ajax_player&post_id=' + postId + '&chapter_st=tap-' + ep + '&type=' + type + '&sv=1';
          var res = await doFetch(playerUrl, {
            headers: { Referer: site + '/' },
          });
          var text = await res.text();
          var match = text.match(/embed\/vt?\/([A-Za-z0-9]+)/);
          if (match && match[1]) {
            foundVid = match[1];
            break;
          }
        }

        if (!foundVid) {
          throw new Error('Không tìm thấy nguồn stream cho server này.');
        }

        var cdn = await resolveCdnForVid(foundVid, cdnHosts);
        var m3u8Url = cdn + '/' + foundVid + '/index.m3u8';

        player.log('[YanHH3D] Switch to: ' + m3u8Url);
        player.playHls(m3u8Url);

        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        setStatus('Đang phát: ' + (btn.textContent ? btn.textContent.trim() : ''));
      } catch (err) {
        setStatus('Lỗi: ' + (err.message || err), true);
        if (player) player.log('[YanHH3D] Switch error: ' + (err.message || err));
      } finally {
        buttons.forEach(function (b) { b.classList.remove('loading'); });
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initServerBar);
} else {
  initServerBar();
}
