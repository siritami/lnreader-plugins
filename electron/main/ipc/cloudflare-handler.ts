import { ipcMain, BrowserWindow } from 'electron';
import { customSession } from '../main';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getIframeRectViaCDP(win: BrowserWindow) {
  try {
    const { root } = await win.webContents.debugger.sendCommand(
      'DOM.getDocument',
      { depth: -1, pierce: true },
    );

    let targetNodeId: number | null = null;
    function traverse(node: any) {
      if (node.nodeName.toLowerCase() === 'iframe' && node.attributes) {
        const srcIdx = node.attributes.indexOf('src');
        if (srcIdx !== -1) {
          const src = node.attributes[srcIdx + 1];
          if (
            src.includes('challenges.cloudflare.com') ||
            src.includes('turnstile')
          ) {
            targetNodeId = node.nodeId;
            return;
          }
        }
      }
      if (node.children) {
        for (const child of node.children) traverse(child);
      }
      if (node.shadowRoots) {
        for (const shadow of node.shadowRoots) traverse(shadow);
      }
    }
    traverse(root);

    if (targetNodeId) {
      const { model } = await win.webContents.debugger.sendCommand(
        'DOM.getBoxModel',
        { nodeId: targetNodeId },
      );
      const content = model.content;
      return {
        x: Math.round(content[0]),
        y: Math.round(content[1]),
        width: Math.round(content[2] - content[0]),
        height: Math.round(content[5] - content[1]),
      };
    }
  } catch (e) {
    console.error('[CDP Error]', e);
  }
  return null;
}

export async function solveCloudflare(
  url: string,
  type: 'interstitial' | 'turnstile' = 'turnstile',
): Promise<boolean> {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: true,
    webPreferences: {
      session: customSession,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  try {
    win.webContents.debugger.attach('1.3');
  } catch (err) {
    console.error('[solveCloudflare] Debugger attach failed:', err);
  }

  try {
    await win.loadURL(url);

    let iframeRect = null;
    let attempts = 0;
    while (attempts < 15) {
      if (type === 'interstitial') {
        const scriptExists = await win.webContents.executeJavaScript(`
            !!document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')
         `);
        if (!scriptExists) {
          console.log(
            '[solveCloudflare] Interstitial challenge passed automatically.',
          );
          win.webContents.debugger.detach();
          win.close();
          return true;
        }
      }

      iframeRect = await getIframeRectViaCDP(win);
      if (iframeRect && iframeRect.width > 5 && iframeRect.height > 5) {
        break;
      }
      iframeRect = null;
      await sleep(1000);
      attempts++;
    }

    if (!iframeRect) {
      console.error(
        '[solveCloudflare] Cloudflare iframe not found or not visible.',
      );
      win.webContents.debugger.detach();
      win.close();
      return false;
    }

    console.log('[solveCloudflare] Found iframe at:', iframeRect);

    const clickX = iframeRect.x + Math.floor(iframeRect.width / 2);
    const clickY = iframeRect.y + Math.floor(iframeRect.height / 2);

    let solved = false;

    // Wait for the Cloudflare widget to finish its initial animation/spinner
    await sleep(4000);

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(`[solveCloudflare] Retrying click (attempt ${attempt + 1})...`);
        await sleep(2000);
      }

      // Simulate mouse move, press, release via CDP
      try {
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: clickX,
          y: clickY,
        });
        await sleep(50);
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: clickX,
          y: clickY,
          button: 'left',
          clickCount: 1,
        });
        await sleep(50);
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: clickX,
          y: clickY,
          button: 'left',
          clickCount: 1,
        });
        console.log(
          '[solveCloudflare] CDP Clicked iframe center:',
          clickX,
          clickY,
        );
      } catch (e) {
        console.error('[solveCloudflare] CDP Click failed:', e);
      }

      // Wait up to 7 seconds to see if solved
      for (let i = 0; i < 7; i++) {
        await sleep(1000);

        if (type === 'turnstile') {
          const rect = await getIframeRectViaCDP(win);
          if (!rect) {
            solved = true;
            break;
          }

          const responseValue = await win.webContents.executeJavaScript(`
             (function() {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                return input ? input.value : null;
             })();
           `);

          if (responseValue && responseValue.length > 0) {
            solved = true;
            console.log('[solveCloudflare] Turnstile response token found.');
            break;
          }
        } else {
          const scriptExists = await win.webContents.executeJavaScript(`
              !!document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')
           `);
          if (!scriptExists) {
            solved = true;
            console.log('[solveCloudflare] Interstitial challenge passed.');
            break;
          }
        }
      }

      if (solved) {
        break;
      }
    }

    if (solved) {
      console.log('[solveCloudflare] Challenge solved successfully.');
    } else {
      console.error('[solveCloudflare] Failed to solve challenge (timeout).');
    }

    await sleep(2000);
    win.webContents.debugger.detach();
    win.close();
    return solved;
  } catch (err) {
    console.error('[solveCloudflare] Error:', err);
    if (!win.isDestroyed()) {
      try {
        win.webContents.debugger.detach();
      } catch (e) {}
      win.close();
    }
    return false;
  }
}

ipcMain.handle('cloudflare:solve', (_, url, type) =>
  solveCloudflare(url, type),
);
