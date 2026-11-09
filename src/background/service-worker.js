/**
 * 梧藝 WUYI 下單小幫手 - Background Service Worker
 * 主要功能：跨域獲取 LINE 圖片並轉為 Data URL，避免 Canvas 污染 (CORS Taint)
 */

let detachedWindowId = null;

async function fetchImageAsDataUrl(url) {
  try {
    let response = null;
    const isLineInternal = url.includes('.line.biz');

    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: isLineInternal ? 'include' : 'omit'
      });
    } catch (e1) {
      // 容錯切換重試
      try {
        response = await fetch(url, {
          method: 'GET',
          credentials: isLineInternal ? 'omit' : 'include'
        });
      } catch (e2) {
        throw new Error(e1.message || e2.message || 'Network fetch failed');
      }
    }

    if (!response || !response.ok) {
      const retry = await fetch(url, { method: 'GET' });
      if (!retry.ok) {
        throw new Error(`HTTP ${retry.status}: ${retry.statusText}`);
      }
      response = retry;
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert ArrayBuffer to binary string in chunks to avoid stack overflow
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }

    const base64 = (typeof btoa !== 'undefined')
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');

    return {
      success: true,
      dataUrl: `data:${contentType};base64,${base64}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Failed to fetch image'
    };
  }
}

function handleMessage(message, sender, sendResponse) {
  if (message && message.action === 'fetchImageAsDataUrl') {
    if (!message.url) {
      sendResponse({ success: false, error: 'Missing image URL' });
      return false;
    }

    fetchImageAsDataUrl(message.url)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // Keep channel open for async sendResponse
  }

  // 下載小卡圖檔並跳出「另存新檔」詢問下載路徑
  if (message && message.action === 'downloadCardWithSaveAs') {
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename || '梧藝取貨確認小卡.png',
        saveAs: true // 詢問使用者要下載到哪裡
      }, (downloadId) => {
        sendResponse({ success: !!downloadId });
      });
      return true;
    }
  }

  // 移出為獨立小視窗 (單一實例且永遠置頂：若已開啟則聚焦既有視窗，不重複多開)
  if (message && message.action === 'openDetachedWindow') {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.windows) {
      const popupUrl = chrome.runtime.getURL('src/popup/popup.html');
      chrome.tabs.query({ url: popupUrl }, (tabs) => {
        if (tabs && tabs.length > 0) {
          // 已存在獨立小視窗：直接將既有視窗移至最前並聚焦
          const existingTab = tabs[0];
          detachedWindowId = existingTab.windowId;
          chrome.windows.update(existingTab.windowId, { focused: true }, (win) => {
            chrome.tabs.update(existingTab.id, { active: true });
            sendResponse({ success: true, windowId: existingTab.windowId, reused: true });
          });
        } else {
          // 尚未開啟：建立新的獨立小視窗 (預設適合 MacBook 13吋舒適尺寸 460x760)
          chrome.windows.create({
            url: popupUrl,
            type: 'popup',
            width: 460,
            height: 760,
            focused: true
          }, (win) => {
            if (win && win.id) {
              detachedWindowId = win.id;
            }
            sendResponse({ success: true, windowId: win ? win.id : null, created: true });
          });
        }
      });
      return true;
    }
  }

  // 調整獨立視窗大小 (適合 27吋、MacBook 13吋、iPad 11吋)
  if (message && message.action === 'resizeDetachedWindow') {
    const { width, height } = message;
    if (typeof chrome !== 'undefined' && chrome.windows) {
      const winId = message.windowId || detachedWindowId;
      if (winId) {
        chrome.windows.update(winId, { width: parseInt(width, 10), height: parseInt(height, 10) }, (win) => {
          sendResponse({ success: !!win });
        });
        return true;
      }
    }
    sendResponse({ success: false });
    return false;
  }

  // 重新將獨立視窗置頂
  if (message && message.action === 'refocusDetachedWindow') {
    if (typeof chrome !== 'undefined' && chrome.windows && detachedWindowId) {
      chrome.windows.update(detachedWindowId, { focused: true }, () => {
        sendResponse({ success: true });
      });
      return true;
    }
  }

  // 同步至 Google 試算表 (透過 Background Service Worker 突破 CSP 與 CORS 限制)
  if (message && message.action === 'syncToGoogleSheets') {
    const { url, payload } = message;
    if (!url) {
      sendResponse({ success: false, error: '缺少 Webhook 網址' });
      return false;
    }

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload || {})
    })
      .then(async (res) => {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          sendResponse({ success: true, data: json });
        } catch (e) {
          if (text.includes('accounts.google.com') || text.includes('Google Drive – Access Denied') || text.includes('<html')) {
            sendResponse({
              success: false,
              error: 'Google Apps Script 權限未設為「所有人 (Anyone)」，請至 Apps Script 部署設定中修改存取權限。'
            });
          } else {
            sendResponse({ success: true, raw: text });
          }
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || '連線失敗' });
      });

    return true; // Keep message channel open for async response
  }

  return false;
}

// Register message listener in Chrome Extension environment
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
}

// 監聽獨立視窗關閉與置頂維持
if (typeof chrome !== 'undefined' && chrome.windows) {
  if (chrome.windows.onRemoved) {
    chrome.windows.onRemoved.addListener((winId) => {
      if (winId === detachedWindowId) {
        detachedWindowId = null;
      }
    });
  }
}

// 點擊擴充功能圖示 (Action) 快速鍵處理
if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;

    const url = tab.url || '';
    if (url.includes('chat.line.biz') || url.includes('manager.line.biz')) {
      // 在 LINE 後台：切換下單小幫手面板
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
      } catch (e) {
        // 若該分頁是在安裝外掛前就已打開，動態注入腳本
        try {
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['src/content/content.css']
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'src/content/extractor.js',
              'src/content/card-renderer.js',
              'src/content/content.js'
            ]
          });
        } catch (err) {
          console.warn('Script injection error:', err);
        }
      }
    } else {
      // 若不在 LINE 後台：直接替使用者開新分頁前往 LINE 客服聊天室
      chrome.tabs.create({ url: 'https://chat.line.biz/' });
    }
  });
}

// Export for unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchImageAsDataUrl,
    handleMessage
  };
}
