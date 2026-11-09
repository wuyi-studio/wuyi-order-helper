document.addEventListener('DOMContentLoaded', () => {
  const webhookInput = document.getElementById('webhookUrl');
  const btnSave = document.getElementById('btnSave');
  const btnTest = document.getElementById('btnTest');
  const statusMsg = document.getElementById('statusMessage');

  // 讀取既有設定
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['googleSheetsWebhookUrl'], (res) => {
      if (res && res.googleSheetsWebhookUrl) {
        webhookInput.value = res.googleSheetsWebhookUrl;
      }
    });
  }

  // 儲存設定
  btnSave.addEventListener('click', () => {
    const url = webhookInput.value.trim();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ googleSheetsWebhookUrl: url }, () => {
        showStatus('✅ 設定已成功儲存！', 'success');
      });
    } else {
      localStorage.setItem('googleSheetsWebhookUrl', url);
      showStatus('✅ 設定已儲存！', 'success');
    }
  });

  // 測試連線
  btnTest.addEventListener('click', async () => {
    const url = webhookInput.value.trim();
    if (!url) {
      showStatus('⚠️ 請先輸入 Webhook 網址', 'warning');
      return;
    }

    showStatus('📡 正在測試連線中...', 'info');

    const testPayload = {
      pickupDate: '2026-11-12',
      customerName: '連線測試員',
      customerPhone: '0900000000',
      lineName: '測試帳號',
      orderType: 'cake',
      cakeSize: '4吋',
      cakeFlavor: '原味戚風',
      cakeInscription: 'Connection Test',
      addon: '測試配件',
      totalPrice: 100,
      rawText: '連線測試'
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'syncToGoogleSheets',
        url: url,
        payload: testPayload
      }, (res) => {
        if (chrome.runtime.lastError || !res) {
          directFetchTest(url, testPayload);
          return;
        }

        if (res.success) {
          const json = res.data || {};
          if (json.status === 'success') {
            showStatus(`🎉 連線成功！已於試算表「${json.sheet}」建立/更新第 ${json.row} 列資料。`, 'success');
          } else {
            showStatus('🎉 連線成功！Google 試算表已順利接收資料。', 'success');
          }
        } else {
          showStatus('❌ 連線失敗：' + (res.error || '請確認 GAS 權限需設為「所有人 (Anyone)」'), 'error');
        }
      });
    } else {
      directFetchTest(url, testPayload);
    }
  });

  async function directFetchTest(url, testPayload) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(testPayload)
      });
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json && json.status === 'success') {
          showStatus(`🎉 連線成功！已於試算表「${json.sheet}」建立/更新第 ${json.row} 列資料。`, 'success');
        } else {
          showStatus('🎉 連線成功！Google 試算表已接收。', 'success');
        }
      } catch (e) {
        if (text.includes('accounts.google.com') || text.includes('Google Drive')) {
          showStatus('❌ 連線失敗：請將 Apps Script 部署設定中的「誰可以存取」設為「所有人 (Anyone)」。', 'error');
        } else {
          showStatus('🎉 連線成功！已送達。', 'success');
        }
      }
    } catch (err) {
      showStatus('❌ 連線失敗，請檢查網址與 Google Apps Script 權限（需設為所有人可存取）：' + err.message, 'error');
    }
  }

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = 'status-msg ' + type;
  }
});
