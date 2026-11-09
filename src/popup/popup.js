/**
 * 梧藝 WUYI 下單小幫手 - 獨立小視窗邏輯
 */

document.addEventListener('DOMContentLoaded', () => {
  const Ext = window.Extractor;
  const Renderer = window.CardRenderer;

  const state = {
    orderState: Ext._createEmptyOrderState(),
    pricingState: { breakdownText: '', total: 0 },
    images: {
      flower: [null, null],
      cake: [null, null, null],
      addon: [null]
    }
  };

  const btnCloseWindow = document.getElementById('btnCloseWindow');
  const btnScrapeChat = document.getElementById('btnScrapeChat');
  const btnPrevOrder = document.getElementById('btnPrevOrder');
  const navCounter = document.getElementById('navCounter');
  const btnNextOrder = document.getElementById('btnNextOrder');
  const btnRefresh = document.getElementById('btnRefresh');

  const btnClearFlower = document.getElementById('btnClearFlower');
  const btnClearCake = document.getElementById('btnClearCake');
  const btnClearAddon = document.getElementById('btnClearAddon');

  const inputDateTag = document.getElementById('inputDateTag');
  const btnAddLineTag = document.getElementById('btnAddLineTag');
  const btnCopyFlowerDirect = document.getElementById('btnCopyFlowerDirect');
  const btnCopyCakeDirect = document.getElementById('btnCopyCakeDirect');
  const btnCopyPricingDirect = document.getElementById('btnCopyPricingDirect');

  const txtFlowerOrder = document.getElementById('txtFlowerOrder');
  const txtCakeOrder = document.getElementById('txtCakeOrder');
  const txtPricing = document.getElementById('txtPricing');

  const btnCopyCard = document.getElementById('btnCopyCard');
  const btnCopyOrder = document.getElementById('btnCopyOrder');
  const btnAddLineNote = document.getElementById('btnAddLineNote');
  const btnDownloadCard = document.getElementById('btnDownloadCard');
  const toast = document.getElementById('wuyiToast');

  if (btnCloseWindow) {
    btnCloseWindow.addEventListener('click', () => window.close());
  }

  // 輔助函式：文字寫入剪貼簿 (雙重保險：現代 Clipboard API + 離屏 textarea 回退機制，杜絕 Document not focused 報錯)
  async function copyTextToClipboard(text) {
    if (!text && text !== '') return false;

    // 1. 嘗試主動獲取視窗焦點
    try {
      if (typeof window !== 'undefined' && window.focus) {
        window.focus();
      }
    } catch (_) {}

    // 2. 優先嘗試現代 Clipboard API
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('navigator.clipboard.writeText 失敗 (可能因未聚焦)，切換至 execCommand 回退機制:', err);
      }
    }

    // 3. 回退方案：建立離屏 textarea 執行 document.execCommand('copy')
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '2em';
      ta.style.height = '2em';
      ta.style.padding = '0';
      ta.style.border = 'none';
      ta.style.outline = 'none';
      ta.style.boxShadow = 'none';
      ta.style.background = 'transparent';
      ta.style.opacity = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const successful = document.execCommand('copy');
      document.body.removeChild(ta);
      return successful;
    } catch (fallbackErr) {
      console.error('所有剪貼簿寫入方式皆失敗:', fallbackErr);
      return false;
    }
  }

  // 視窗尺寸切換 (適合 27吋、MacBook 13吋、iPad 11吋、6吋手機)
  const WINDOW_SIZES = {
    phone6: { width: 340, height: 580, label: '6吋手機' },
    ipad: { width: 390, height: 680, label: 'iPad 11吋' },
    macbook: { width: 460, height: 760, label: 'MacBook 13吋' },
    desktop: { width: 560, height: 880, label: '27吋大螢幕' }
  };

  function setWindowSize(sizeKey) {
    const target = WINDOW_SIZES[sizeKey];
    if (!target) return;

    document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === sizeKey);
    });

    try {
      localStorage.setItem('wuyi_window_size', sizeKey);
    } catch (e) {}

    if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
      chrome.windows.getCurrent((win) => {
        if (win && win.id) {
          chrome.windows.update(win.id, { width: target.width, height: target.height });
        } else {
          window.resizeTo(target.width, target.height);
        }
      });
    } else {
      window.resizeTo(target.width, target.height);
    }
    showToast('📐 已設定為 ' + target.label + ' 視窗尺寸 (' + target.width + 'x' + target.height + ')');
  }

  document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const sizeKey = btn.getAttribute('data-size');
      setWindowSize(sizeKey);
    });
  });

  try {
    const savedSize = localStorage.getItem('wuyi_window_size');
    if (savedSize && WINDOW_SIZES[savedSize]) {
      document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-size') === savedSize);
      });
    }
  } catch (e) {}

  // 1. 動態圖框事件綁定與管理 (支援點擊「新增」增加空格、點擊空白框選檔、拖曳換位、單圖刪除)
  const GROUP_LABELS = {
    flower: '花束',
    cake: '蛋糕',
    addon: '蠟燭'
  };

  const hiddenFileInput = document.getElementById('wuyiHiddenFileInput');
  let currentUploadTarget = null; // { group, index }
  let currentDraggingBox = null; // { group, index }

  function renderGroupBoxes(group) {
    const rowId = 'row' + group.charAt(0).toUpperCase() + group.slice(1);
    const row = document.getElementById(rowId);
    if (!row) return;

    row.innerHTML = '';
    const list = state.images[group];

    list.forEach((dataUrl, idx) => {
      const box = document.createElement('div');
      box.className = 'wuyi-box-dropzone' + (dataUrl ? ' wuyi-has-image' : '');
      box.id = 'box_' + group + '_' + idx;
      box.dataset.group = group;
      box.dataset.index = idx;

      let placeholderText = '';
      if (group === 'flower') placeholderText = '+ 圖' + (idx + 1);
      else if (group === 'cake') placeholderText = '+ 款式' + (idx + 1);
      else if (group === 'addon') placeholderText = idx === 0 ? '+ 蠟燭圖' : '+ 蠟燭' + (idx + 1);

      if (dataUrl) {
        box.setAttribute('draggable', 'true');
        const hasPrev = idx > 0;
        const hasNext = idx < list.length - 1;

        box.innerHTML = `
          <img src="${dataUrl}" class="wuyi-box-thumb" alt="預覽圖" draggable="false">
          <div class="wuyi-box-overlay">
            <div class="wuyi-box-actions-left">
              ${hasPrev ? '<button type="button" class="wuyi-box-btn-shift" data-dir="prev" title="移至上一個圖框">◀</button>' : ''}
              ${hasNext ? '<button type="button" class="wuyi-box-btn-shift" data-dir="next" title="移至下一個圖框">▶</button>' : ''}
              <span class="wuyi-box-move-hint" title="按住可拖曳移動">按住移動 ✥</span>
            </div>
            <button type="button" class="wuyi-box-btn-del" title="清除此圖">✕</button>
          </div>
        `;

        box.querySelectorAll('.wuyi-box-btn-shift').forEach(b => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const dir = b.dataset.dir;
            const targetIdx = dir === 'prev' ? idx - 1 : idx + 1;
            if (targetIdx >= 0 && targetIdx < list.length) {
              const temp = list[idx];
              list[idx] = list[targetIdx];
              list[targetIdx] = temp;
              renderGroupBoxes(group);
            }
          });
        });

        const btnDel = box.querySelector('.wuyi-box-btn-del');
        if (btnDel) {
          btnDel.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            list[idx] = null;
            renderGroupBoxes(group);
            showToast('已清除 ' + GROUP_LABELS[group] + ' 截圖');
          });
        }
      } else {
        box.innerHTML = '<div class="wuyi-box-placeholder">' + placeholderText + '</div>';
        box.addEventListener('click', () => {
          currentUploadTarget = { group, index: idx };
          if (hiddenFileInput) {
            hiddenFileInput.value = '';
            hiddenFileInput.click();
          }
        });
      }

      setupBoxDragAndDrop(box, group, idx);
      row.appendChild(box);
    });
  }

  function setupBoxDragAndDrop(box, group, idx) {
    box.addEventListener('dragstart', (e) => {
      if (!state.images[group][idx]) {
        e.preventDefault();
        return;
      }
      currentDraggingBox = { group, index: idx };
      box.classList.add('wuyi-dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', group + ':' + idx);
    });

    box.addEventListener('dragend', () => {
      box.classList.remove('wuyi-dragging');
      setTimeout(() => { currentDraggingBox = null; }, 150);
      document.querySelectorAll('.wuyi-box-dropzone').forEach(b => b.classList.remove('wuyi-drag-over'));
    });

    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      box.classList.add('wuyi-drag-over');
    });

    box.addEventListener('dragleave', (e) => {
      e.preventDefault();
      box.classList.remove('wuyi-drag-over');
    });

    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      box.classList.remove('wuyi-drag-over');

      // 1. 內部圖框互換
      if (currentDraggingBox) {
        const fromGroup = currentDraggingBox.group;
        const fromIdx = currentDraggingBox.index;
        currentDraggingBox = null;
        if (fromGroup === group && fromIdx === idx) return;

        const fromVal = state.images[fromGroup][fromIdx];
        const toVal = state.images[group][idx];
        state.images[group][idx] = fromVal;
        state.images[fromGroup][fromIdx] = toVal || null;

        renderGroupBoxes(fromGroup);
        if (fromGroup !== group) renderGroupBoxes(group);
        showToast('已調整截圖位置');
        return;
      }

      // 2. 本地圖片檔案拖曳
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const f = e.dataTransfer.files[0];
        if (f.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            state.images[group][idx] = evt.target.result;
            renderGroupBoxes(group);
            showToast('✅ ' + GROUP_LABELS[group] + ' 截圖已加入！');
          };
          reader.readAsDataURL(f);
          return;
        }
      }

      // 3. 網頁或 LINE 對話圖片拖曳
      let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) {
          const m = html.match(/src=["']([^"']+)["']/i);
          if (m) url = m[1];
        }
      }

      if (url && (url.startsWith('http') || url.startsWith('data:'))) {
        showToast('⏳ 正在載入圖片...');
        let finalUrl = url;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            const res = await new Promise(resolve => {
              chrome.runtime.sendMessage({ action: 'fetchImageBlob', url: url }, resolve);
            });
            if (res && res.dataUrl) finalUrl = res.dataUrl;
          } catch (e) {}
        }
        state.images[group][idx] = finalUrl;
        renderGroupBoxes(group);
        showToast('✅ ' + GROUP_LABELS[group] + ' 截圖已加入！');
      }
    });
  }

  // 初始渲染三個分類圖框
  renderGroupBoxes('flower');
  renderGroupBoxes('cake');
  renderGroupBoxes('addon');

  function applySyncedStateFromContent(synced) {
    if (!synced) return;
    if (synced.flowerText !== undefined && txtFlowerOrder) {
      txtFlowerOrder.value = synced.flowerText;
    }
    if (synced.cakeText !== undefined && txtCakeOrder) {
      txtCakeOrder.value = synced.cakeText;
    }
    if (synced.pricingText !== undefined && txtPricing) {
      txtPricing.value = synced.pricingText;
    }
    if (synced.dateTag !== undefined && inputDateTag) {
      inputDateTag.value = synced.dateTag;
    }
    if (synced.orderState) {
      state.orderState = synced.orderState;
    }
    if (synced.pricingState) {
      state.pricingState = synced.pricingState;
    }
    if (synced.images) {
      state.images = synced.images;
      renderGroupBoxes('flower');
      renderGroupBoxes('cake');
      renderGroupBoxes('addon');
    }
  }

  // 獨立視窗啟動時：自動向 LINE OA 頁面請求目前同步的訂單資料 (達成側欄與獨立視窗無縫同步)
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      const lineTab = tabs.find(t => t.url && (t.url.includes('chat.line.biz') || t.url.includes('manager.line.biz')));
      if (lineTab && lineTab.id) {
        chrome.tabs.sendMessage(lineTab.id, { action: 'getCurrentOrderHelperState' }, (res) => {
          if (res && res.success && res.state) {
            applySyncedStateFromContent(res.state);
          }
        });
      }
    });
  }

  // 「新增」按鈕：多加一個截圖空格 (花束、蛋糕、蠟燭)
  document.querySelectorAll('.wuyi-btn-add-slot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.getAttribute('data-group');
      if (!group || !state.images[group]) return;
      state.images[group].push(null);
      renderGroupBoxes(group);
      showToast('➕ 已為【' + GROUP_LABELS[group] + '】多加一個截圖空格！');
    });
  });

  // 「清除」按鈕：清除該分類的所有截圖
  document.querySelectorAll('.wuyi-btn-clear-slot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.getAttribute('data-group');
      if (!group || !state.images[group]) return;
      state.images[group] = state.images[group].map(() => null);
      renderGroupBoxes(group);
      showToast('已清除 ' + GROUP_LABELS[group] + ' 截圖');
    });
  });

  if (hiddenFileInput) {
    hiddenFileInput.addEventListener('change', () => {
      if (!hiddenFileInput.files || hiddenFileInput.files.length === 0) return;
      const file = hiddenFileInput.files[0];
      if (!file.type.startsWith('image/')) {
        showToast('⚠️ 請選擇圖片檔案');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        if (currentUploadTarget) {
          const { group, index } = currentUploadTarget;
          state.images[group][index] = dataUrl;
          renderGroupBoxes(group);
          showToast('✅ 已新增【' + GROUP_LABELS[group] + '】圖片！');
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // 2. 一鍵抓取與候選對話導覽
  let orderCandidates = [];
  let currentCandidateIndex = -1;

  function updateNavUI() {
    const total = orderCandidates.length;
    if (total === 0) {
      navCounter.textContent = '-/-';
      btnPrevOrder.disabled = true;
      btnNextOrder.disabled = true;
      return;
    }
    const currentNum = currentCandidateIndex + 1;
    navCounter.textContent = `${currentNum}/${total}`;
    btnPrevOrder.disabled = currentCandidateIndex <= 0;
    btnNextOrder.disabled = currentCandidateIndex >= total - 1;
  }

  btnScrapeChat.addEventListener('click', triggerScrape);
  btnRefresh.addEventListener('click', triggerScrape);

  async function triggerScrape() {
    showToast('🔍 正在搜尋具備完整取貨與訂購人資訊的訂單對話...');

    chrome.tabs.query({}, async (tabs) => {
      const lineTab = tabs.find(t => t.url && (t.url.includes('chat.line.biz') || t.url.includes('manager.line.biz')));
      if (!lineTab || !lineTab.id) {
        showToast('⚠️ 未找到開啟的 LINE 官方客服聊天分頁 (chat.line.biz)');
        return;
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: lineTab.id },
          func: scrapeLineChatInPage
        });

        if (results && results[0] && results[0].result) {
          const res = results[0].result;
          orderCandidates = res.candidates || [];
          if (res.pricingText) {
            state.pricingState = Ext.parsePricingText(res.pricingText);
            txtPricing.value = state.pricingState.breakdownText;
          }

          if (orderCandidates.length === 0) {
            currentCandidateIndex = -1;
            updateNavUI();
            showToast('⚠️ 未在對話框中找到包含【訂購人 LINE 名稱】或訂單格式的訊息');
            return;
          }

          // 預設套用最新一筆 (最後一筆)
          await applyCandidate(orderCandidates.length - 1);
        } else {
          showToast('⚠️ 未偵測到對話資料');
        }
      } catch (err) {
        console.error(err);
        showToast('❌ 抓取失敗：' + err.message);
      }
    });
  }

  async function applyCandidate(index) {
    if (index < 0 || index >= orderCandidates.length) return;
    currentCandidateIndex = index;
    updateNavUI();

    const cand = orderCandidates[index];
    if (cand.text) {
      // 1. 依需求分成 1️⃣花束 與 2️⃣蛋糕 兩大部分填入對應文字框 (無該項目則填寫「無」)
      const cleanText = Ext.cleanOrderTextWithoutPricing(cand.text);
      const split = Ext.splitOrderText(cleanText);
      if (txtFlowerOrder) txtFlowerOrder.value = split.flowerText;
      if (txtCakeOrder) txtCakeOrder.value = split.cakeText;

      state.orderState = Ext.parseOrderText(cleanText);
      if (inputDateTag) {
        inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date || '';
      }

      // 2. 金額明細：優先提取「訂購人電話」下方的內容
      const trailingPricing = Ext.extractPricingFromOrderText(cand.text);
      if (trailingPricing) {
        txtPricing.value = trailingPricing;
        state.pricingState = Ext.parsePricingText(trailingPricing);
      }
    }

    // 自動依序分配圖片進各圖框
    if (cand.imageUrls && cand.imageUrls.length > 0) {
      const flowerVal = txtFlowerOrder ? txtFlowerOrder.value : '';
      const cakeVal = txtCakeOrder ? txtCakeOrder.value : '';
      const hasFlower = flowerVal && flowerVal !== '無';
      const hasCake = cakeVal && cakeVal !== '無';

      if (hasFlower && !hasCake) {
        // 純花束
        for (let idx = 0; idx < cand.imageUrls.length; idx++) {
          const r = await fetchViaServiceWorker(cand.imageUrls[idx]);
          if (r && r.dataUrl) {
            if (idx < state.images.flower.length) {
              state.images.flower[idx] = r.dataUrl;
            } else {
              state.images.flower.push(r.dataUrl);
            }
          }
        }
        renderGroupBoxes('flower');
      } else if (hasFlower && hasCake) {
        // 花束 + 蛋糕混和
        const rFlower = await fetchViaServiceWorker(cand.imageUrls[0]);
        if (rFlower && rFlower.dataUrl) {
          state.images.flower[0] = rFlower.dataUrl;
          renderGroupBoxes('flower');
        }
        if (cand.imageUrls.length > 1) {
          const rCake = await fetchViaServiceWorker(cand.imageUrls[1]);
          if (rCake && rCake.dataUrl) {
            state.images.cake[0] = rCake.dataUrl;
            renderGroupBoxes('cake');
          }
        }
        if (cand.imageUrls.length > 2) {
          const rAddon = await fetchViaServiceWorker(cand.imageUrls[2]);
          if (rAddon && rAddon.dataUrl) {
            state.images.addon[0] = rAddon.dataUrl;
            renderGroupBoxes('addon');
          }
        }
        if (cand.imageUrls.length > 3) {
          for (let idx = 3; idx < cand.imageUrls.length; idx++) {
            const rExtra = await fetchViaServiceWorker(cand.imageUrls[idx]);
            if (rExtra && rExtra.dataUrl) {
              state.images.cake.push(rExtra.dataUrl);
            }
          }
          renderGroupBoxes('cake');
        }
      } else {
        // 純蛋糕/配件
        for (let idx = 0; idx < Math.min(3, cand.imageUrls.length); idx++) {
          const r = await fetchViaServiceWorker(cand.imageUrls[idx]);
          if (r && r.dataUrl) {
            if (idx < state.images.cake.length) {
              state.images.cake[idx] = r.dataUrl;
            } else {
              state.images.cake.push(r.dataUrl);
            }
          }
        }
        renderGroupBoxes('cake');

        if (cand.imageUrls.length > 3) {
          for (let idx = 3; idx < cand.imageUrls.length; idx++) {
            const addonIdx = idx - 3;
            const rAddon = await fetchViaServiceWorker(cand.imageUrls[idx]);
            if (rAddon && rAddon.dataUrl) {
              if (addonIdx < state.images.addon.length) {
                state.images.addon[addonIdx] = rAddon.dataUrl;
              } else {
                state.images.addon.push(rAddon.dataUrl);
              }
            }
          }
          renderGroupBoxes('addon');
        }
      }
    }

    showToast(`📋 已載入第 ${currentCandidateIndex + 1}/${orderCandidates.length} 則訂單對話！`);
  }

  btnPrevOrder.addEventListener('click', () => {
    if (currentCandidateIndex > 0) {
      applyCandidate(currentCandidateIndex - 1);
    }
  });

  btnNextOrder.addEventListener('click', () => {
    if (currentCandidateIndex < orderCandidates.length - 1) {
      applyCandidate(currentCandidateIndex + 1);
    }
  });

  // 3. 文字與標籤編輯雙向同步
  if (inputDateTag) {
    inputDateTag.addEventListener('input', () => {
      const val = inputDateTag.value.trim();
      state.orderState.pickup.dateTag = val;
      // 維持完整訂單內容原始文字，不自動覆寫 txtRawOrder
    });
  }

  if (btnAddLineTag) {
    btnAddLineTag.addEventListener('click', async () => {
      const rawDate = (inputDateTag ? inputDateTag.value : state.orderState.pickup.date) || '';
      if (!rawDate.trim()) {
        showToast('⚠️ 請先輸入或抓取取貨日期');
        return;
      }
      const tag = Ext.formatWuyiDate(rawDate) || rawDate.trim();
      if (inputDateTag) inputDateTag.value = tag;
      state.orderState.pickup.dateTag = tag;
      // 點擊新增標籤不覆寫完整訂單內容，維持顧客原始格式 (如 11/1 (日)、11/1‼️)

      await copyTextToClipboard(tag);

      // 向 LINE 官方帳號分頁執行自動新增標籤 (優先使用 executeScript 確保不需重整網頁亦必定生效)
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const allTabs = await chrome.tabs.query({});
          const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
          const lineTab = lineTabs.find(t => t.active) || lineTabs[0];

          if (lineTab && chrome.scripting && chrome.scripting.executeScript) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: lineTab.id },
              func: addLineOfficialTagInPage,
              args: [tag]
            });
            if (results && results[0] && results[0].result && results[0].result.message) {
              showToast(results[0].result.message);
              return;
            }
          }

          if (lineTab) {
            chrome.tabs.sendMessage(lineTab.id, { action: 'addLineOfficialTag', tag: tag }, (res) => {
              if (res && res.message) {
                showToast(res.message);
              } else {
                showToast(`🏷️ 已複製標籤「${tag}」！`);
              }
            });
          } else {
            showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
          }
        } catch (err) {
          showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
        }
      } else {
        showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
      }
    });
  }

  function getFlowerOrderText() {
    return (txtFlowerOrder ? txtFlowerOrder.value : '').trim();
  }

  function getCakeOrderText() {
    return (txtCakeOrder ? txtCakeOrder.value : '').trim();
  }

  function getCombinedOrderText() {
    const f = getFlowerOrderText();
    const c = getCakeOrderText();
    const parts = [];
    if (f && f !== '無') parts.push(f);
    if (c && c !== '無') parts.push(c);
    return parts.join('\n\n');
  }

  function onOrderInputChanged() {
    const combined = getCombinedOrderText();
    state.orderState = Ext.parseOrderText(combined);
    if (inputDateTag && (state.orderState.pickup.dateTag || state.orderState.pickup.date)) {
      inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date;
    }
  }

  if (txtFlowerOrder) txtFlowerOrder.addEventListener('input', onOrderInputChanged);
  if (txtCakeOrder) txtCakeOrder.addEventListener('input', onOrderInputChanged);

  txtPricing.addEventListener('input', () => {
    state.pricingState = Ext.parsePricingText(txtPricing.value);
  });

  // 4. 快捷按鈕

  if (btnCopyFlowerDirect) {
    btnCopyFlowerDirect.addEventListener('click', async () => {
      const text = getFlowerOrderText();
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });
  }

  if (btnCopyCakeDirect) {
    btnCopyCakeDirect.addEventListener('click', async () => {
      const text = getCakeOrderText();
      if (!text) return showToast('⚠️ 目前沒有蛋糕文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製蛋糕訂單內容！');
    });
  }

  if (btnCopyPricingDirect) {
    btnCopyPricingDirect.addEventListener('click', async () => {
      const text = txtPricing.value.trim();
      if (!text) return showToast('⚠️ 目前沒有金額明細');
      await copyTextToClipboard(text);
      showToast('📋 已複製金額明細！');
    });
  }

  // 複製備忘錄格式 (富文字 HTML：按 1️⃣花束照片->花束文字、2️⃣蛋糕/蠟燭照片->蛋糕文字 排列，照片靠左且無多餘標題)
  btnCopyOrder.addEventListener('click', async () => {
    const flowerText = getFlowerOrderText();
    const cakeText = getCakeOrderText();
    const hasFlower = Boolean(flowerText && flowerText !== '無');
    const hasCake = Boolean(cakeText && cakeText !== '無');

    if (!hasFlower && !hasCake) return showToast('⚠️ 目前沒有訂單文字');

    showToast('⏳ 正在生成備忘錄格式...');

    const flowerImgs = await Renderer.ensureDataUrls(state.images.flower.filter(Boolean));
    const cakeImgs = await Renderer.ensureDataUrls(state.images.cake.filter(Boolean));
    const addonImgs = await Renderer.ensureDataUrls(Array.isArray(state.images.addon) ? state.images.addon.filter(Boolean) : (state.images.addon ? [state.images.addon] : []));

    const { html, plainText } = Renderer.buildRichNotesHtml({
      flowerText,
      cakeText,
      flowerImages: flowerImgs,
      cakeImages: cakeImgs,
      addonImages: addonImgs
    });

    const activeWin = typeof window !== 'undefined' ? window : null;
    if (activeWin && activeWin.focus) {
      try { activeWin.focus(); } catch (_) {}
    }

    const nav = (activeWin && activeWin.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && nav.clipboard && nav.clipboard.write) {
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        await nav.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob
          })
        ]);
        showToast('📋 已複製備忘錄格式 (含照片與可編輯文字，格式同一鍵複製確認小卡)！');
        return;
      } catch (err) {
        console.warn('ClipboardItem HTML copy failed:', err);
      }
    }

    // 回退機制：使用 oncopy 事件寫入富文字至 NSPasteboard
    try {
      const onCopy = (e) => {
        e.clipboardData.setData('text/html', html);
        e.clipboardData.setData('text/plain', plainText);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy, { once: true });
      if (document.execCommand('copy')) {
        showToast('📋 已複製備忘錄格式 (含照片與可編輯文字，格式同一鍵複製確認小卡)！');
        return;
      }
    } catch (_) {}

    await copyTextToClipboard(plainText);
    showToast('📋 已複製備忘錄純文字格式！');
  });

  // 點擊「📝 ＋ 新增記事本」直接將訂單內容（含取貨日期）複製並填入 LINE 記事本
  if (btnAddLineNote) {
    btnAddLineNote.addEventListener('click', async () => {
      let textToCopy = getCombinedOrderText();
      if (!textToCopy && state.orderState && state.orderState.pickup && state.orderState.pickup.date) {
        textToCopy = Ext.formatRawOrder(state.orderState);
      }
      if (!textToCopy && inputDateTag && inputDateTag.value.trim()) {
        textToCopy = `取貨日期：${Ext.formatWuyiDate(inputDateTag.value.trim())}`;
      }
      if (!textToCopy) return showToast('⚠️ 目前沒有訂單或日期內容可新增');

      await copyTextToClipboard(textToCopy);

      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const allTabs = await chrome.tabs.query({});
          const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
          const lineTab = lineTabs.find(t => t.active) || lineTabs[0];

          if (lineTab && chrome.scripting && chrome.scripting.executeScript) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: lineTab.id },
              func: addLineOfficialNoteInPage,
              args: [textToCopy]
            });
            if (results && results[0] && results[0].result && results[0].result.message) {
              showToast(results[0].result.message);
              return;
            }
          }

          if (lineTab) {
            chrome.tabs.sendMessage(lineTab.id, { action: 'addLineOfficialNote', text: textToCopy }, (res) => {
              if (res && res.message) {
                showToast(res.message);
              } else {
                showToast('📝 已將訂單複製至剪貼簿！');
              }
            });
          } else {
            showToast('📝 已將訂單複製至剪貼簿！');
          }
        } catch (err) {
          showToast('📝 已將訂單複製至剪貼簿！');
        }
      } else {
        showToast('📝 已將訂單複製至剪貼簿！');
      }
    });
  }

  // 記錄最後一次成功同步的訂單 Key，杜絕連點或重複點擊小卡重複寫入試算表
  let lastSyncedOrderKey = null;

  btnCopyCard.addEventListener('click', async () => {
    showToast('🎨 正在生成預約取貨確認單...');
    try {
      const flowerText = getFlowerOrderText();
      const cakeText = getCakeOrderText();
      const canvas = await Renderer.renderCard(state.orderState, {
        flowerText,
        cakeText,
        flowerImages: state.images.flower.filter(Boolean),
        cakeImages: state.images.cake.filter(Boolean),
        addonImages: Array.isArray(state.images.addon) ? state.images.addon.filter(Boolean) : (state.images.addon ? [state.images.addon] : []),
        addonImage: Array.isArray(state.images.addon) ? (state.images.addon.filter(Boolean)[0] || null) : state.images.addon
      });
      let copiedToClipboard = false;
      const currentWin = typeof window !== 'undefined' ? window : null;
      try {
        await Renderer.copyCardToClipboard(canvas, currentWin);
        copiedToClipboard = true;
      } catch (clipErr) {
        console.warn('Image copy to clipboard failed, downloading card image instead:', clipErr);
        const name = (state.orderState.customer && state.orderState.customer.name) || '客戶';
        const date = (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
        const filename = `梧藝取貨單_${name}_${date}.png`;
        const dataUrl = canvas.toDataURL('image/png');
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'downloadCardWithSaveAs',
            dataUrl: dataUrl,
            filename: filename
          });
        } else {
          Renderer.downloadCard(canvas, filename);
        }
        showToast('💾 因瀏覽器焦點限制，已為您自動下載確認單圖檔！');
      }

      // 自動同步至 Google 試算表（含防重複記錄機制）
      const syncRes = await autoSyncToGoogleSheets();
      if (syncRes && !syncRes.skipped && syncRes.success) {
        showToast('✨ 預約取貨確認單已處理！(訂單已自動同步至試算表)');
      } else if (syncRes && syncRes.error) {
        showToast('✨ 預約取貨確認單已處理！(試算表提醒：' + syncRes.error + ')');
      } else if (copiedToClipboard) {
        showToast('✨ 預約取貨確認單已複製！可在 LINE 直接貼上 (Ctrl+V)');
      }
    } catch (err) {
      showToast('❌ 複製確認單失敗：' + err.message);
    }
  });

  // 🎂 蛋糕 與 💐 花束 快速發送/編輯確認訊息功能
  // 按 1 下：傳送確認訊息給客人；快速連按 3 下：編輯要輸入的自訂訊息
  const btnQuickMsgCake = document.getElementById('btnQuickMsgCake');
  const btnQuickMsgFlower = document.getElementById('btnQuickMsgFlower');

  const DEFAULT_QUICK_MSG = {
    cake: '您好！這是為您安排的蛋糕預約取貨確認單，請核對上方圖片中的品項、日期與訂購資訊是否無誤喔！取貨當天請向門市夥伴出示確認小卡即可，感謝您！🍰',
    flower: '您好！這是為您安排的花束預約確認單，請核對上方圖片中的花材色系、包裝與取貨時間是否正確喔！感謝您的訂購，祝您有美好的一天！💐'
  };

  function setupQuickMsgButtonPopup(btn, type, label, defaultText) {
    if (!btn) return;
    let clickCount = 0;
    let clickTimer = null;
    const storageKey = `wuyi_custom_msg_${type}`;

    const handleEdit = () => {
      clearTimeout(clickTimer);
      clickCount = 0;
      const currentMsg = localStorage.getItem(storageKey) || defaultText;
      const newMsg = prompt(`請編輯按【${label}】後傳送給客人的確認訊息內容：`, currentMsg);
      if (newMsg !== null && newMsg.trim()) {
        localStorage.setItem(storageKey, newMsg.trim());
        showToast(`✅ 已儲存自訂【${label}】訊息！`);
      }
    };

    // 支援滑鼠右鍵直接編輯，100% 穩定必出
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEdit();
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 原生三連擊偵測
      if (e.detail >= 3) {
        handleEdit();
        return;
      }

      clickCount++;
      if (clickCount >= 3) {
        handleEdit();
        return;
      }

      // 按 1 下：傳給客人訊息 (尋找 LINE 分頁執行發送)
      clearTimeout(clickTimer);
      clickTimer = setTimeout(async () => {
        if (clickCount === 1) {
          const currentMsg = localStorage.getItem(storageKey) || defaultText;
          showToast(`⏳ 正在傳送【${label}】確認訊息...`);

          if (typeof chrome !== 'undefined' && chrome.tabs) {
            try {
              const allTabs = await chrome.tabs.query({});
              const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
              const lineTab = lineTabs.find(t => t.active) || lineTabs[0];

              if (lineTab) {
                chrome.tabs.sendMessage(lineTab.id, { action: 'sendLineChatMessage', text: currentMsg }, (res) => {
                  if (res && res.message) {
                    showToast(res.message);
                  } else {
                    showToast(`🚀 已傳送【${label}】訊息！`);
                  }
                });
              } else {
                await copyTextToClipboard(currentMsg);
                showToast(`📋 已複製【${label}】訊息至剪貼簿！`);
              }
            } catch (err) {
              await copyTextToClipboard(currentMsg);
              showToast(`📋 已複製【${label}】訊息至剪貼簿！`);
            }
          } else {
            await copyTextToClipboard(currentMsg);
            showToast(`📋 已複製【${label}】訊息至剪貼簿！`);
          }
        }
        clickCount = 0;
      }, 450);
    });
  }

  setupQuickMsgButtonPopup(btnQuickMsgCake, 'cake', '🎂 蛋糕', DEFAULT_QUICK_MSG.cake);
  setupQuickMsgButtonPopup(btnQuickMsgFlower, 'flower', '💐 花束', DEFAULT_QUICK_MSG.flower);

  async function autoSyncToGoogleSheets() {
    try {
      const cfg = await new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(['googleSheetsWebhookUrl'], resolve);
        } else {
          resolve({});
        }
      });

      if (!cfg || !cfg.googleSheetsWebhookUrl) {
        return { skipped: true, reason: 'no_webhook' };
      }

      const currentOrderKey = [
        state.orderState.pickup.date || '',
        state.orderState.customer.name || '',
        state.orderState.customer.phone || '',
        state.orderState.customer.lineName || '',
        state.pricingState.total || '0'
      ].join('__');

      if (lastSyncedOrderKey === currentOrderKey) {
        return { skipped: true, reason: 'already_synced' };
      }

      const payload = {
        pickupDate: state.orderState.pickup.date,
        pickupTime: state.orderState.pickup.time,
        location: state.orderState.pickup.location,
        customerName: state.orderState.customer.name,
        customerPhone: state.orderState.customer.phone,
        lineName: state.orderState.customer.lineName,
        orderType: state.orderState.orderType,
        cakeSize: state.orderState.cake.size,
        cakeFlavor: state.orderState.cake.flavor,
        cakeInscription: state.orderState.cake.inscription,
        addon: state.orderState.cake.addon,
        flowerBudget: state.orderState.flower.budget,
        flowerColor: state.orderState.flower.color,
        flowerPaper: state.orderState.flower.paper,
        totalPrice: state.pricingState.total,
        rawText: state.orderState.rawText
      };

      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'syncToGoogleSheets',
            url: cfg.googleSheetsWebhookUrl,
            payload: payload
          }, (res) => {
            if (res && res.success) {
              lastSyncedOrderKey = currentOrderKey;
              resolve({ success: true });
            } else if (res && res.error) {
              resolve({ error: res.error });
            } else {
              lastSyncedOrderKey = currentOrderKey;
              resolve({ success: true });
            }
          });
        } else {
          lastSyncedOrderKey = currentOrderKey;
          resolve({ success: true });
        }
      });
    } catch (err) {
      console.warn('Auto sync sheets error:', err);
      return { error: err.message };
    }
  }

  // 下載小卡 (詢問儲存路徑)
  btnDownloadCard.addEventListener('click', async () => {
    try {
      showToast('🎨 正在生成小卡...');
      const canvas = await Renderer.renderCard(state.orderState, {
        flowerText: getFlowerOrderText(),
        cakeText: getCakeOrderText(),
        flowerImages: state.images.flower.filter(Boolean),
        cakeImages: state.images.cake.filter(Boolean),
        addonImages: Array.isArray(state.images.addon) ? state.images.addon.filter(Boolean) : (state.images.addon ? [state.images.addon] : []),
        addonImage: Array.isArray(state.images.addon) ? (state.images.addon.filter(Boolean)[0] || null) : state.images.addon
      });
      const name = state.orderState.customer.name || '客戶';
      const date = (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
      const filename = `梧藝取貨單_${name}_${date}.png`;
      const dataUrl = canvas.toDataURL('image/png');

      chrome.runtime.sendMessage({
        action: 'downloadCardWithSaveAs',
        dataUrl: dataUrl,
        filename: filename
      }, (res) => {
        if (res && res.success) {
          showToast('💾 已開啟下載路徑選擇！');
        } else {
          Renderer.downloadCard(canvas, filename);
          showToast('💾 已下載小卡圖檔！');
        }
      });
    } catch (e) {
      showToast('❌ 下載失敗：' + e.message);
    }
  });

  function fetchViaServiceWorker(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url }, (res) => {
        resolve(res || { success: false, dataUrl: url });
      });
    });
  }

  let toastTimer = null;
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('wuyi-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('wuyi-show'), 2800);
  }
});

function scrapeLineChatInPage() {
  const isPricingFormat = (text) => {
    if (!text) return false;
    return /(蛋糕|漢堡盒|花束|餐具|蠟燭|保冷|襯紙|提袋|鮮花預算)[\$：:]\s*\d+/.test(text) &&
           /(總共|合計|＝|=)\s*[\$]?\s*\d+/.test(text);
  };

  const isValidChatImage = (src) => {
    if (!src || typeof src !== 'string') return false;
    if (src.startsWith('data:image/svg')) return false;
    const lower = src.toLowerCase();
    if (lower.includes('avatar') || lower.includes('profile') || lower.includes('emoji') || lower.includes('icon') || lower.includes('sticker')) {
      return false;
    }
    return true;
  };

  const isInsideChatDialogue = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root, #wuyi-helper-root')) return false;
    if (el.closest('[role="dialog"], [class*="modal" i], [class*="dialog" i], .modal, .dialog')) return false;
    if (el.closest('aside, [class*="drawer" i], [class*="sidebar-right" i], [class*="user-info" i], [class*="customer-profile" i], [class*="note" i], [class*="memo" i], [id*="note" i], [id*="memo" i], [class*="right" i], [role="tabpanel"], [class*="tabpanel" i]')) return false;
    if (el.closest('[class*="chat-list" i], [class*="chatList"], [class*="room-list" i], nav')) return false;

    // 幾何位置檢驗：確保元素必定落在中間對話串區域（嚴禁落在右側記事本欄位）
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      // 若元素在可視區域最右側 380px 以內，直接視為右側記事本/面板排除
      if (window.innerWidth > 800 && rect.left > window.innerWidth - 380) {
        return false;
      }

      // 若有找到對話輸入框 (textarea)，所有聊天泡泡水平位置必定與輸入框對齊
      const chatInput = document.querySelector('textarea:not(#txtFlowerOrder):not(#txtCakeOrder):not(#txtPricing)');
      if (chatInput) {
        const inputRect = chatInput.getBoundingClientRect();
        if (rect.left > inputRect.right + 20) {
          return false;
        }
        if (rect.right < inputRect.left - 20) {
          return false;
        }
      }
    } catch (e) {}

    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.includes('記錄與用戶之間的互動') || raw.includes('交接備註') || /^(記事本|記事)\s*\d*\/?\d*/.test(raw)) {
      return false;
    }
    if (el.closest('[aria-label*="記事本"], [title*="記事本"], [aria-label*="note" i]')) {
      return false;
    }
    return true;
  };

  const selectors = [
    '[data-testid*="message"]',
    '[class*="bubble"]',
    '[class*="Bubble"]',
    '[class*="message-body"]',
    '[class*="message-text"]',
    '[class*="message"]',
    '[class*="Message"]',
    '[class*="chat-item"]',
    'li',
    'p',
    'div'
  ];

  const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
  const matched = [];

  const hasAllOrderRequiredFields = (str) => {
    if (!str || typeof str !== 'string') return false;
    // 嚴格判定：必須同時具備以下 6 項訂單核心資訊才能選入
    const hasPickupDate = /(?:取貨|自取)?日期\s*[：:]/.test(str) || /取貨日期|自取日期/.test(str);
    const hasPickupTime = /(?:取貨|自取)?時間\s*[：:]/.test(str) || /取貨時間|自取時間/.test(str);
    const hasPickupLocation = /(?:自取|取貨)(?:地點|門市)\s*[：:]/.test(str) || /自取地點|取貨地點/.test(str);
    const hasLineName = /(?:訂購人(?:的)?\s*)?(?:LINE|line)\s*名稱/i.test(str);
    const hasCustomerName = /訂購人姓名|訂購人\s*姓名/.test(str) || (/(?:訂購人)?姓名\s*[：:]/.test(str) && !/LINE\s*名稱/i.test(str));
    const hasCustomerPhone = /訂購人電話|訂購人\s*電話/.test(str) || /(?:訂購人|聯絡)?電話\s*[：:]/.test(str);
    return Boolean(hasPickupDate && hasPickupTime && hasPickupLocation && hasLineName && hasCustomerName && hasCustomerPhone);
  };

  for (const el of elements) {
    if (!isInsideChatDialogue(el)) continue;
    const text = (el.innerText || '').trim();
    if (!text) continue;

    // 重新設定：必須同時具備 取貨日期、取貨時間、自取地點、訂購人 LINE 名稱、訂購人姓名、訂購人電話 才能選入！
    if (hasAllOrderRequiredFields(text)) {
      matched.push({ el, text });
    }
  }

  // 剔除包含其他候選者的超大外層容器
  const filtered = matched.filter(item => {
    const containsChildOrder = matched.some(other => {
      return other.el !== item.el &&
             item.el.contains(other.el) &&
             (/LINE/i.test(other.text) || /取貨/.test(other.text) || /蛋糕/.test(other.text) || other.text.length > 40);
    });
    if (containsChildOrder) return false;

    const hasContent = /LINE|取貨|自取|蛋糕|口味|尺寸|題字|訂購人|加購|預算|花束/i.test(item.text);
    if (!hasContent && item.text.length < 20) {
      return false;
    }

    return true;
  });

  // 去重並按 DOM 順序排列（舊至新）
  const unique = [];
  const seenTexts = new Set();
  for (const item of filtered) {
    const key = item.text.replace(/\s+/g, ' ').substring(0, 100);
    if (!seenTexts.has(key)) {
      seenTexts.add(key);
      unique.push(item);
    }
  }

  unique.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  // 整理所有候選對話的文字與圖片
  const candidates = unique.map(item => {
    const images = [];
    item.el.querySelectorAll('img').forEach(img => {
      if (isValidChatImage(img.src) && !images.includes(img.src)) {
        images.push(img.src);
      }
    });
    const parentContainer = item.el.parentElement;
    if (parentContainer) {
      parentContainer.querySelectorAll('img').forEach(img => {
        if (isValidChatImage(img.src) && !images.includes(img.src)) {
          images.push(img.src);
        }
      });
    }
    return {
      text: item.text,
      imageUrls: images
    };
  });

  // 搜尋最新金額
  let latestPricingText = '';
  const allDivs = Array.from(document.querySelectorAll('.chat-content, .message-content, [data-testid*="message"], div, p'));
  for (let i = allDivs.length - 1; i >= 0; i--) {
    if (!isInsideChatDialogue(allDivs[i])) continue;
    const t = (allDivs[i].innerText || '').trim();
    if (isPricingFormat(t)) {
      latestPricingText = t;
      break;
    }
  }

  return {
    candidates: candidates,
    pricingText: latestPricingText
  };
}

// 供獨立視窗直接注入 LINE 頁面執行「＋ 新增標籤」
async function addLineOfficialTagInPage(tag) {
  if (!tag) return { success: false, message: '⚠️ 請先輸入取貨日期標籤' };

  const isVisibleOnScreen = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  };

  // 檢查右側顧客資訊欄中是否已存在日期標籤 (例如 4 碼數字 1010 等)
  // 依需求允許新增多個日期標籤 (如第二個、第三個日期)

  const triggerRealClick = (el) => {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    ['pointerdown', 'mouseenter', 'mouseover', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtName => {
      try { el.dispatchEvent(new MouseEvent(evtName, opts)); } catch (e) {}
    });
    if (typeof el.click === 'function') {
      try { el.click(); } catch (e) {}
    }
  };

  const findTagInput = (beforeInputs) => {
    const allInputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
      .filter(inp => {
        if (!isVisibleOnScreen(inp)) return false;
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(type)) return false;
        return true;
      });

    const newlyAppeared = allInputs.find(inp => !beforeInputs.has(inp));
    if (newlyAppeared) return newlyAppeared;

    if (document.activeElement && allInputs.includes(document.activeElement)) {
      const inLeftList = document.activeElement.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
      if (!inLeftList) return document.activeElement;
    }

    return allInputs.find(inp => {
      const inLeftList = inp.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
      if (inLeftList) return false;
      const ph = (inp.placeholder || inp.getAttribute('aria-label') || '').toLowerCase();
      if (ph.includes('標籤') || ph.includes('tag')) return true;
      return Boolean(inp.closest('[role="dialog"], [class*="modal"], [class*="popover"], [class*="dropdown"], [class*="tag"], aside, [class*="drawer"], [class*="profile"]'));
    }) || null;
  };

  const beforeInputs = new Set(
    Array.from(document.querySelectorAll('input, [contenteditable="true"]')).filter(isVisibleOnScreen)
  );

  const all = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!isVisibleOnScreen(el)) return false;
    if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
    const t = (el.textContent || '').replace(/\s+/g, '');
    return t === '新增標籤' || t === '+新增標籤' || t === '＋新增標籤';
  });

  let addTagBtn = null;
  let deepest = null;

  if (all.length > 0) {
    all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    deepest = all[0];
    addTagBtn = deepest.closest('button, a, [role="button"]') || deepest;
    triggerRealClick(addTagBtn);
    if (addTagBtn !== deepest) triggerRealClick(deepest);
  }

  let input = null;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 100));
    input = findTagInput(beforeInputs);
    if (input) break;
    if (i === 2 && deepest && deepest.parentElement && !deepest.parentElement.closest('#wuyi-helper-root')) {
      triggerRealClick(deepest.parentElement);
    }
  }

  if (!input && all.length === 0) {
    return {
      success: false,
      message: `🏷️ 已複製標籤「${tag}」至剪貼簿！(未偵測到 LINE「＋ 新增標籤」按鈕)`
    };
  }

  if (input) {
    input.focus();
    if (typeof input.select === 'function') input.select();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, tag);
    else input.value = tag;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, tag);
    } catch (e) {}

    if (input.value !== tag) {
      if (nativeSetter) nativeSetter.call(input, tag);
      else input.value = tag;
    }

    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tag }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: tag.slice(-1), bubbles: true }));
  }

  await new Promise(r => setTimeout(r, 250));

  const optionCandidates = Array.from(document.querySelectorAll('li, label, button, a, span, [role="option"], [role="menuitem"], [class*="item"], [class*="tag"]'))
    .filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el === addTagBtn || el === deepest || el === input) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"]')) return false;
      if (el.querySelectorAll('*').length > 6) return false;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 35) return false;
      return t === tag ||
             t === `+${tag}` || t === `＋${tag}` || t === `+ ${tag}` || t === `＋ ${tag}` ||
             (t.includes(tag) && (t.includes('新增') || t.includes('建立') || t.includes('「') || t.includes('+') || t.includes('＋')));
    });

  if (optionCandidates.length > 0) {
    optionCandidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    const bestOpt = optionCandidates[0];
    const optTarget = bestOpt.closest('li, label, button, a, [role="option"], [role="menuitem"]') || bestOpt;
    const checkbox = optTarget.querySelector('input[type="checkbox"]');
    if (checkbox && !checkbox.checked) triggerRealClick(checkbox);
    else triggerRealClick(optTarget);
  }

  if (input) {
    ['keydown', 'keypress', 'keyup'].forEach(type => {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      }));
    });
  }

  await new Promise(r => setTimeout(r, 200));
  const confirmBtns = Array.from(document.querySelectorAll('button, [role="button"], a'))
    .filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el === addTagBtn || el === deepest || el.disabled) return false;
      if (el.querySelectorAll('*').length > 4) return false;
      const t = (el.textContent || '').trim();
      return t === '儲存' || t === '確定' || t === '完成' || t === '新增';
    });
  if (confirmBtns.length > 0) {
    triggerRealClick(confirmBtns[confirmBtns.length - 1]);
  }

  return {
    success: true,
    message: `🏷️ 已成功為此客戶新增 LINE 標籤：${tag}！`
  };
}

// 供獨立視窗直接注入 LINE 頁面執行「📝 ＋ 新增記事本」
async function addLineOfficialNoteInPage(noteText) {
  if (!noteText) return { success: false, message: '⚠️ 無訂單內容可新增' };

  let safeText = noteText.trim();
  if (safeText.length > 298) safeText = safeText.substring(0, 298);

  const isVisibleOnScreen = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  };

  const triggerRealClick = (el) => {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    ['pointerdown', 'mouseenter', 'mouseover', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtName => {
      try { el.dispatchEvent(new MouseEvent(evtName, opts)); } catch (e) {}
    });
    if (typeof el.click === 'function') {
      try { el.click(); } catch (e) {}
    }
  };

  const findNoteModalTextarea = () => {
    const allTextareas = Array.from(document.querySelectorAll('textarea')).filter(isVisibleOnScreen);
    if (allTextareas.length === 0) return null;

    const exactMatch = allTextareas.find(t => {
      const ph = t.placeholder || '';
      return ph.includes('相關資訊') || ph.includes('不會向對方公開') || ph.includes('記事本中的資訊') || ph.includes('記事本');
    });
    if (exactMatch) return exactMatch;

    const modalWithTitle = allTextareas.find(t => {
      let p = t.parentElement;
      for (let depth = 0; depth < 6 && p && p !== document.body; depth++) {
        const txt = p.textContent || '';
        if (txt.includes('新增記事本') || /\d+\s*\/\s*300/.test(txt)) return true;
        p = p.parentElement;
      }
      return false;
    });
    if (modalWithTitle) return modalWithTitle;

    const inDialog = allTextareas.find(t => {
      if (t.closest('[class*="chat-room"], [class*="chat-footer"], [class*="message-input"], [class*="editor"]')) return false;
      return Boolean(t.closest('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
    });
    return inDialog || null;
  };

  const findLineAddNotePlusButton = () => {
    const noteTitleEls = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return (t === '記事本' || /^記事本\s*\d+\s*\/\s*\d+/.test(t)) && !t.includes('記錄與用戶') && !t.includes('負責人員') && t.length <= 30;
    });

    noteTitleEls.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

    const isInGrayInfoBox = (el) => {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('info')) return true;
      let p = el;
      for (let d = 0; d < 3 && p && p !== document.body; d++) {
        const pt = (p.textContent || '').trim();
        if (pt.includes('記錄與用戶') || pt.includes('不會看見記事本')) {
          if (!pt.includes('記事本 0/') && !/記事本\s*\d+\s*\/\s*\d+/.test(pt)) return true;
        }
        p = p.parentElement;
      }
      return false;
    };

    const isOnSameHeaderLine = (el, labelRect) => {
      if (!labelRect || labelRect.height === 0 || labelRect.width === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return true;
      const labelCy = labelRect.top + labelRect.height / 2;
      const elCy = r.top + r.height / 2;
      return Math.abs(elCy - labelCy) <= 30 && r.left >= labelRect.left;
    };

    for (const labelEl of noteTitleEls) {
      const labelRect = labelEl.getBoundingClientRect();
      let headerRow = labelEl;

      for (let depth = 0; depth < 5 && headerRow && headerRow !== document.body; depth++) {
        const rowText = headerRow.textContent || '';
        if (rowText.includes('負責人員') || rowText.includes('新增標籤')) break;

        const explicitBtns = Array.from(headerRow.querySelectorAll('button, a, [role="button"]')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          const bt = (b.textContent || '').trim();
          return !bt.includes('記事本') && !bt.includes('記錄與用戶') && isOnSameHeaderLine(b, labelRect);
        });
        if (explicitBtns.length > 0) return explicitBtns[0];

        const iconCandidates = Array.from(headerRow.querySelectorAll('svg, i, span, div')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          if (b === labelEl || b.contains(labelEl)) return false;
          const bt = (b.textContent || '').trim();
          if (bt.includes('記事本') || bt.includes('記錄與用戶') || /^\d+\s*\/\s*\d+$/.test(bt)) return false;
          if (!isOnSameHeaderLine(b, labelRect)) return false;

          const cls = (b.className || '').toString().toLowerCase();
          const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
          const tag = b.tagName.toLowerCase();

          if (bt === '+' || bt === '＋') return true;
          if (cls.includes('plus') || cls.includes('add') || aria.includes('新增') || aria.includes('add')) return true;
          if ((tag === 'svg' || tag === 'i') && b.getBoundingClientRect().height <= 40) return true;
          return false;
        });

        if (iconCandidates.length > 0) {
          const icon = iconCandidates[0];
          return icon.closest('button, a, [role="button"]') || icon.parentElement || icon;
        }

        headerRow = headerRow.parentElement;
      }

      let flexRow = labelEl.parentElement;
      for (let d = 0; d < 3 && flexRow && flexRow !== document.body; d++) {
        const rt = flexRow.textContent || '';
        if (rt.includes('負責人員') || rt.includes('新增標籤') || rt.includes('記錄與用戶')) break;
        if (flexRow.children && flexRow.children.length >= 2) {
          const lastChild = flexRow.lastElementChild;
          const lastText = (lastChild.textContent || '').trim();
          if (
            lastChild !== labelEl &&
            !lastChild.contains(labelEl) &&
            !lastText.includes('記事本') &&
            !/^\d+\s*\/\s*\d+$/.test(lastText) &&
            isOnSameHeaderLine(lastChild, labelRect)
          ) {
            return lastChild.querySelector('button, a, [role="button"]') || lastChild;
          }
        }
        flexRow = flexRow.parentElement;
      }
    }
    return null;
  };

  let modalTextarea = findNoteModalTextarea();

  if (!modalTextarea) {
    const plusBtn = findLineAddNotePlusButton();
    if (plusBtn) {
      triggerRealClick(plusBtn);
      const innerIcon = plusBtn.querySelector('button, a, i, svg, span');
      if (innerIcon && innerIcon !== plusBtn) triggerRealClick(innerIcon);
    }

    for (let i = 0; i < 22; i++) {
      await new Promise(r => setTimeout(r, 100));
      modalTextarea = findNoteModalTextarea();
      if (modalTextarea) break;
      if (i === 2 && plusBtn && plusBtn.parentElement && !plusBtn.parentElement.closest('#wuyi-helper-root')) {
        triggerRealClick(plusBtn.parentElement);
      }
    }
  }

  if (modalTextarea) {
    modalTextarea.focus();
    if (typeof modalTextarea.select === 'function') modalTextarea.select();

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(modalTextarea, safeText);
    else modalTextarea.value = safeText;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, safeText);
    } catch (e) {}

    if (modalTextarea.value !== safeText) {
      if (nativeSetter) nativeSetter.call(modalTextarea, safeText);
      else modalTextarea.value = safeText;
    }

    modalTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeText }));
    modalTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    modalTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    modalTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: safeText.slice(-1), bubbles: true }));

    return {
      success: true,
      message: '📝 已自動開啟並將內容填入「＋ 新增記事本」！請確認後點擊儲存'
    };
  }

  return {
    success: false,
    message: '📋 內容已複製至剪貼簿！(未偵測到記事本彈窗，請點選 LINE 記事本 ＋ 貼上)'
  };
}
