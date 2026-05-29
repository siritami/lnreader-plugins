export function setupArtplayerEvents(art: any) {
  let hasSeekedInitial = false;
  let lastSaveTime = 0;

  art.on('video:loadedmetadata', () => {
    try {
      if (
        !hasSeekedInitial &&
        art.video.duration > 0 &&
        window.reader &&
        window.reader.chapter
      ) {
        const initialProgress = window.reader.chapter.progress || 0;
        if (initialProgress > 0 && initialProgress < 100) {
          art.video.currentTime = Math.floor(
            (initialProgress / 100) * art.video.duration,
          );
        }
        hasSeekedInitial = true;
      }
    } catch (e) {
      console.warn('[AVS] Lỗi khi khôi phục tiến độ:', e);
    }
  });

  art.on('video:timeupdate', () => {
    try {
      if (
        art.video.duration > 0 &&
        window.reader &&
        typeof window.reader.post === 'function'
      ) {
        const currentTime = art.video.currentTime;
        if (Math.abs(currentTime - lastSaveTime) >= 5) {
          lastSaveTime = currentTime;
          const progressInt = Math.floor(
            (currentTime / art.video.duration) * 100,
          );
          window.reader.post({
            type: 'save',
            data: progressInt,
          });
        }
      }
    } catch (e) {
      //
    }
  });

  art.on('video:ended', () => {
    try {
      if (window.reader && typeof window.reader.post === 'function') {
        window.reader.post({
          type: 'save',
          data: 100,
        });
        if (window.reader.nextChapter) window.reader.post({ type: 'next' });
      }
    } catch (e) {
      //
    }
  });
}
