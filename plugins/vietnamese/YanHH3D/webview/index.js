// YanHH3D Player Master Playlist Bootstrap for Video.js

(function () {
  var started = false;

  function initPlayerWithBlob() {
    if (started) return;
    var dataEl = document.getElementById('yan-master-data');
    if (!dataEl) return;

    var rawBase64 = dataEl.getAttribute('data-master');
    if (!rawBase64) return;

    var player = window.LNReaderPlayer;
    if (!player) return;

    started = true;
    try {
      var decodedText = atob(rawBase64);
      var blob = new Blob([decodedText], {
        type: 'application/vnd.apple.mpegurl',
      });
      var blobUrl = URL.createObjectURL(blob);
      player.log('[YanHH3D] Playing master playlist via blob URL: ' + blobUrl);
      player.playHls(blobUrl);
    } catch (err) {
      player.log('[YanHH3D] Failed to create blob for master playlist: ' + err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayerWithBlob);
  } else {
    initPlayerWithBlob();
  }

  // Backup trigger if player takes time to mount
  var timer = setInterval(function () {
    if (started) {
      clearInterval(timer);
      return;
    }
    initPlayerWithBlob();
  }, 200);

  setTimeout(function () {
    clearInterval(timer);
  }, 10000);
})();

