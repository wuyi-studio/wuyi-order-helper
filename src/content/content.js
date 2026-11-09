/**
 * 梧藝 WUYI 下單小幫手 - Content Script 主程式
 * 注入至 chat.line.biz 頁面
 */

(function () {
  if (document.getElementById('wuyi-helper-root')) {
    return; // 避免重複注入
  }

  const Ext = window.Extractor || globalThis.Extractor || (typeof Extractor !== 'undefined' ? Extractor : null);
  const Renderer = window.CardRenderer || globalThis.CardRenderer || (typeof CardRenderer !== 'undefined' ? CardRenderer : null);

  // 核心狀態 (預設關閉，顯示右側「🍰 梧藝下單」懸浮把手，避免遮擋聊天室)
  const state = {
    isOpen: false,
    isFloating: false,
    orderState: Ext ? Ext._createEmptyOrderState() : {
      orderType: 'cake',
      flower: { budget: '', color: '', paper: '', note: '' },
      cake: { style: '圖款', inscriptionLabel: '題字', inscription: '', size: '', flavor: '', addon: '' },
      pickup: { date: '', time: '', location: '台南市中西區友愛街93號' },
      customer: { lineName: '', name: '', phone: '' },
      rawText: ''
    },
    pricingState: { breakdownText: '', total: 0 },
    images: {
      flower: [null, null],
      cake: [null, null, null],
      addon: [null]
    },
    pos: { x: 20, y: 80 }
  };

  // 1. 建立 UI 根節點 (掛載於 document.body，確保固定於畫面右側懸浮與最左側展開)
  const root = document.createElement('div');
  root.id = 'wuyi-helper-root';

  function mountRoot() {
    if (!document.body) return;
    if (!root.isConnected || root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
  }

  if (document.body) {
    mountRoot();
  } else {
    document.addEventListener('DOMContentLoaded', mountRoot, { once: true });
  }

  // 2. 渲染 UI HTML (懸浮鈕在右邊，跳出面板在畫面最左側且自動將網頁往右推)
  root.innerHTML = `
    <!-- 右側懸浮把手 -->
    <div class="wuyi-handle-pill" id="wuyiHandle">
      🍰 梧藝下單
    </div>

    <!-- 主面板 -->
    <div class="wuyi-helper-panel wuyi-panel wuyi-sidebar" id="wuyiPanel">
      <!-- 頂部標題與控制 -->
      <div class="wuyi-header" id="wuyiHeader">
        <div class="wuyi-title-row">
          <span class="wuyi-brand-badge">WUYI</span>
          <span class="wuyi-title">下單小幫手</span>
        </div>
        <div class="wuyi-header-actions">
          <button class="wuyi-icon-btn" id="btnPopoutWindow" title="移出為獨立小視窗 (可任意拖至其他螢幕或桌面)">↗ 獨立視窗</button>
          <button class="wuyi-icon-btn" id="btnToggleMode" title="切換側欄/浮窗">⧉ 浮窗</button>
          <button class="wuyi-icon-btn" id="btnClose" title="收合面板">✖</button>
        </div>
      </div>

      <!-- 滾動內容 -->
      <div class="wuyi-body">
        <!-- 視窗大小切換按鈕列 (適合 27吋、MacBook 13吋、iPad 11吋、6吋手機) -->
        <div class="wuyi-window-size-bar">
          <span class="wuyi-size-label">📐 尺寸：</span>
          <div class="wuyi-size-group">
            <button type="button" class="wuyi-size-pill" data-size="phone6" title="適合 6吋手機螢幕 (340 x 580)">📱 6吋</button>
            <button type="button" class="wuyi-size-pill" data-size="ipad" title="適合 iPad 11吋 (390 x 680)">📱 11吋</button>
            <button type="button" class="wuyi-size-pill active" data-size="macbook" title="適合 MacBook 13吋 (460 x 760)">💻 13吋</button>
            <button type="button" class="wuyi-size-pill" data-size="desktop" title="適合 27吋大螢幕 (560 x 880)">🖥️ 27吋</button>
          </div>
        </div>

        <!-- 抓取動作列 -->
        <div class="wuyi-scrape-bar">
          <button class="wuyi-btn-primary" id="btnScrapeChat" title="抓取最新符合訂購資訊的對話">
            ⚡ 一鍵抓取訂單
          </button>
          <div class="wuyi-scrape-nav">
            <button type="button" class="wuyi-nav-btn" id="btnPrevOrder" title="上一則符合對話 (較早)" disabled>▲</button>
            <span class="wuyi-nav-counter" id="navCounter" title="目前選中 / 搜尋到的總數">-/-</span>
            <button type="button" class="wuyi-nav-btn" id="btnNextOrder" title="下一則符合對話 (較新)" disabled>▼</button>
          </div>
          <button class="wuyi-btn-refresh" id="btnRefresh" title="重新整理抓取">
            🔄
          </button>
        </div>

        <!-- 圖片與訂單內容管理區 (依需求分成 1️⃣花束 與 2️⃣蛋糕 兩大部分) -->
        <div class="wuyi-images-vertical">
          <!-- 1. 💐花束(截圖) -->
          <div class="wuyi-img-section-slot">
            <div class="wuyi-slot-header">
              <span class="wuyi-slot-title">💐花束(截圖)</span>
              <div class="wuyi-slot-actions">
                <button type="button" class="wuyi-btn-add-slot" data-group="flower" title="多加一個花束截圖空格">新增</button>
                <button type="button" class="wuyi-btn-clear-slot" data-group="flower" id="btnClearFlower">清除</button>
              </div>
            </div>
            <div class="wuyi-boxes-row" id="rowFlower">
              <div class="wuyi-box-dropzone" id="boxFlower0" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 圖1</div>
              </div>
              <div class="wuyi-box-dropzone" id="boxFlower1" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 圖2</div>
              </div>
            </div>
          </div>

          <!-- 1️⃣ 花束訂單內容 (介於花束截圖與蛋糕截圖之間) -->
          <div class="wuyi-form-group" style="margin-top: -4px;">
            <div class="wuyi-label-row">
              <span class="wuyi-label">📝 1️⃣ 花束訂單內容：</span>
              <button type="button" class="wuyi-btn-inline-copy" id="btnCopyFlowerDirect">📋 複製花束</button>
            </div>
            <textarea class="wuyi-textarea" id="txtFlowerOrder" rows="4" placeholder="若無花束訂單請填寫「無」..."></textarea>
          </div>

          <!-- 2. 🎂蛋糕(截圖) -->
          <div class="wuyi-img-section-slot">
            <div class="wuyi-slot-header">
              <span class="wuyi-slot-title">🎂蛋糕(截圖)</span>
              <div class="wuyi-slot-actions">
                <button type="button" class="wuyi-btn-add-slot" data-group="cake" title="多加一個蛋糕款式截圖空格">新增</button>
                <button type="button" class="wuyi-btn-clear-slot" data-group="cake" id="btnClearCake">清除</button>
              </div>
            </div>
            <div class="wuyi-boxes-row" id="rowCake">
              <div class="wuyi-box-dropzone" id="boxCake0" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 款式1</div>
              </div>
              <div class="wuyi-box-dropzone" id="boxCake1" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 款式2</div>
              </div>
              <div class="wuyi-box-dropzone" id="boxCake2" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 款式3</div>
              </div>
            </div>
          </div>

          <!-- 3. 🕯️蠟燭(截圖) -->
          <div class="wuyi-img-section-slot">
            <div class="wuyi-slot-header">
              <span class="wuyi-slot-title">🕯️蠟燭(截圖)</span>
              <div class="wuyi-slot-actions">
                <button type="button" class="wuyi-btn-add-slot" data-group="addon" title="多加一個蠟燭配件截圖空格">新增</button>
                <button type="button" class="wuyi-btn-clear-slot" data-group="addon" id="btnClearAddon">清除</button>
              </div>
            </div>
            <div class="wuyi-boxes-row" id="rowAddon">
              <div class="wuyi-box-dropzone" id="boxAddon0" title="可拖曳圖片至此，或點擊選取檔案">
                <div class="wuyi-box-placeholder">+ 蠟燭圖</div>
              </div>
            </div>
          </div>

          <!-- 2️⃣ 蛋糕訂單內容 (緊接在蛋糕與蠟燭截圖之後) -->
          <div class="wuyi-form-group" style="margin-top: -4px;">
            <div class="wuyi-label-row">
              <span class="wuyi-label">📝 2️⃣ 蛋糕訂單內容：</span>
              <button type="button" class="wuyi-btn-inline-copy" id="btnCopyCakeDirect">📋 複製蛋糕</button>
            </div>
            <textarea class="wuyi-textarea" id="txtCakeOrder" rows="7" placeholder="點擊一鍵抓取自動帶入蛋糕與取貨資訊，無蛋糕則填寫「無」..."></textarea>
          </div>
        </div>

        <!-- 取貨標籤日期 (自動讀取並正規化為 1102 格式) -->
        <div class="wuyi-date-tag-row">
          <span class="wuyi-tag-title">🏷️ 標籤日期：</span>
          <input type="text" class="wuyi-input-date-tag" id="inputDateTag" placeholder="例：1102" maxlength="10">
          <button type="button" class="wuyi-btn-add-line-tag" id="btnAddLineTag" title="直接在 LINE 右側客戶資料新增此日期標籤">
            ＋ 新增標籤
          </button>
        </div>

        <!-- 金額明細預覽與編輯 -->
        <div class="wuyi-form-group">
          <div class="wuyi-label-row">
            <span class="wuyi-label">💰 金額明細：</span>
            <button type="button" class="wuyi-btn-inline-copy" id="btnCopyPricingDirect">📋 複製金額</button>
          </div>
          <textarea class="wuyi-textarea" id="txtPricing" rows="4" placeholder="蛋糕$...\n加購$...\n總共$..."></textarea>
        </div>
      </div>

      <!-- 底部快捷動作按鈕 -->
      <div class="wuyi-footer">
        <!-- 核心輸出：小卡圖片 (不含金額) ＆ 🎂💐 快速訊息發送鈕 -->
        <div class="wuyi-card-copy-row">
          <button class="wuyi-btn-action wuyi-btn-card-copy" id="btnCopyCard">
            🖼️ 一鍵複製取貨確認小卡 (直接貼 LINE)
          </button>
          <button type="button" class="wuyi-btn-quick-msg" id="btnQuickMsgCake" title="按 1 下：傳送蛋糕確認訊息給客人&#10;連按 3 下：編輯自訂訊息內容">
            🎂
          </button>
          <button type="button" class="wuyi-btn-quick-msg" id="btnQuickMsgFlower" title="按 1 下：傳送花束確認訊息給客人&#10;連按 3 下：編輯自訂訊息內容">
            💐
          </button>
        </div>

        <div class="wuyi-action-grid">
          <button class="wuyi-btn-action" id="btnCopyOrder">
            📋 複製備忘錄格式 (含照片與可編輯文字)
          </button>
          <button class="wuyi-btn-action wuyi-btn-add-note" id="btnAddLineNote" title="自動將訂單內容寫入 LINE 右側記事本">
            📝 ＋ 新增記事本
          </button>
          <button class="wuyi-btn-action" id="btnDownloadCard">
            💾 下載小卡圖檔
          </button>
        </div>
      </div>

      <!-- Toast 提示 -->
      <div class="wuyi-toast" id="wuyiToast">已複製！</div>

      <!-- 隱藏的檔案選擇 input -->
      <input type="file" id="wuyiHiddenFileInputContent" accept="image/*" style="display:none">
    </div>
  `;

  // 取得 DOM 元素
  const handlePill = root.querySelector('#wuyiHandle');
  const panel = root.querySelector('#wuyiPanel');
  const header = root.querySelector('#wuyiHeader');
  const btnPopoutWindow = root.querySelector('#btnPopoutWindow');
  const btnToggleMode = root.querySelector('#btnToggleMode');
  const btnClose = root.querySelector('#btnClose');
  const btnScrapeChat = root.querySelector('#btnScrapeChat');
  const btnPrevOrder = root.querySelector('#btnPrevOrder');
  const navCounter = root.querySelector('#navCounter');
  const btnNextOrder = root.querySelector('#btnNextOrder');
  const btnRefresh = root.querySelector('#btnRefresh');

  const btnClearFlower = root.querySelector('#btnClearFlower');
  const btnClearCake = root.querySelector('#btnClearCake');
  const btnClearAddon = root.querySelector('#btnClearAddon');

  const inputDateTag = root.querySelector('#inputDateTag');
  const btnAddLineTag = root.querySelector('#btnAddLineTag');
  const btnCopyFlowerDirect = root.querySelector('#btnCopyFlowerDirect');
  const btnCopyCakeDirect = root.querySelector('#btnCopyCakeDirect');
  const btnCopyPricingDirect = root.querySelector('#btnCopyPricingDirect');
  const txtFlowerOrder = root.querySelector('#txtFlowerOrder');
  const txtCakeOrder = root.querySelector('#txtCakeOrder');
  const txtPricing = root.querySelector('#txtPricing');

  const btnCopyCard = root.querySelector('#btnCopyCard');
  const btnCopyOrder = root.querySelector('#btnCopyOrder');
  const btnAddLineNote = root.querySelector('#btnAddLineNote');
  const btnDownloadCard = root.querySelector('#btnDownloadCard');
  const toast = root.querySelector('#wuyiToast');

  // 3. UI 互動事件綁定

  // 紀錄目前開啟的永遠置頂獨立視窗 (Document Picture-in-Picture)
  let activePipWindow = null;

  // 展開/收合
  handlePill.addEventListener('click', () => {
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.focus();
      showToast('📌 獨立置頂視窗已開啟並聚焦！');
      return;
    }
    state.isOpen = !state.isOpen;
    updatePanelVisibility();
  });

  btnClose.addEventListener('click', () => {
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.close();
      return;
    }
    state.isOpen = false;
    updatePanelVisibility();
  });

  function updatePanelVisibility() {
    if (activePipWindow && !activePipWindow.closed) {
      panel.classList.remove('wuyi-closed');
      handlePill.style.display = 'flex';
      handlePill.textContent = '🍰 梧藝下單';
      handlePill.title = '點擊開啟梧藝下單小幫手';
      handlePill.classList.remove('wuyi-handle-pill-active');
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
      return;
    }
    // 懸浮把手始終保持在右側顯示，永遠不會消失
    handlePill.style.display = 'flex';
    if (state.isOpen) {
      panel.classList.remove('wuyi-closed');
      handlePill.textContent = '◀ 收合';
      handlePill.title = '點擊收合梧藝下單小幫手';
      handlePill.classList.add('wuyi-handle-pill-active');
      if (document.body) {
        if (!state.isFloating) {
          document.body.classList.add('wuyi-sidebar-open');
        } else {
          document.body.classList.remove('wuyi-sidebar-open');
        }
      }
    } else {
      panel.classList.add('wuyi-closed');
      handlePill.textContent = '🍰 梧藝下單';
      handlePill.title = '點擊開啟梧藝下單小幫手';
      handlePill.classList.remove('wuyi-handle-pill-active');
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
    }
  }

  // 套用初始狀態
  updatePanelVisibility();

  // 監聽來自擴充功能圖示快速鍵
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'togglePanel') {
        if (activePipWindow && !activePipWindow.closed) {
          activePipWindow.focus();
          sendResponse({ success: true, isOpen: true, pip: true });
          return;
        }
        state.isOpen = !state.isOpen;
        updatePanelVisibility();
        sendResponse({ success: true, isOpen: state.isOpen });
      } else if (msg && msg.action === 'addLineOfficialTag') {
        addLineOfficialTag(msg.tag).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'addLineOfficialNote') {
        addLineOfficialNote(msg.text).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'sendLineChatMessage') {
        sendTextMessageToLineChat(msg.text).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'getCurrentOrderHelperState') {
        sendResponse({
          success: true,
          state: {
            orderState: state.orderState,
            pricingState: state.pricingState,
            images: state.images,
            flowerText: getFlowerOrderText(),
            cakeText: getCakeOrderText(),
            pricingText: (txtPricing ? txtPricing.value : ''),
            dateTag: (inputDateTag ? inputDateTag.value : '')
          }
        });
        return true;
      }
    });
  }

  // 移出為永遠置頂獨立視窗 (使用 Chrome Document Picture-in-Picture 原生 OS 級別永遠置頂，並將原網頁面板縮為浮動按鈕)
  btnPopoutWindow.addEventListener('click', async () => {
    // 若已在永遠置頂獨立視窗內點擊，則收回回側欄
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.close();
      return;
    }

    // 優先使用 Chrome 原生 Document Picture-in-Picture (保證 100% 系統級永遠置頂 Always-On-Top，預設適合 MacBook 13吋舒適尺寸)
    if (typeof window.documentPictureInPicture !== 'undefined' && typeof window.documentPictureInPicture.requestWindow === 'function') {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 460,
          height: 760
        });
        activePipWindow = pipWin;
        pipWin.document.title = '梧藝 WUYI 下單小幫手 (📌 永遠置頂)';

        // 載入插件樣式表與全視窗排版
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          const link = pipWin.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = chrome.runtime.getURL('src/content/content.css');
          pipWin.document.head.appendChild(link);
        }
        const pipStyle = pipWin.document.createElement('style');
        pipStyle.textContent = `
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            overflow: hidden !important;
            background: #fffdfa !important;
          }
          #wuyiPanel {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
            transform: none !important;
            display: flex !important;
            box-shadow: none !important;
            border: 2px solid #fda4af !important;
            background: #fffdfa !important;
          }
        `;
        pipWin.document.head.appendChild(pipStyle);

        // 將面板與 Toast 移入永遠置頂視窗，原網頁縮為浮動按鈕
        state.isOpen = false;
        updatePanelVisibility();
        pipWin.document.body.appendChild(panel);
        pipWin.document.body.appendChild(toast);
        panel.classList.remove('wuyi-closed');
        btnPopoutWindow.textContent = '📌 置頂中 (收回)';
        btnToggleMode.style.display = 'none';

        showToast('📌 已開啟縮小 50% 永遠置頂獨立視窗！');

        // 當置頂視窗關閉時，自動將面板歸還回原網頁
        pipWin.addEventListener('pagehide', () => {
          activePipWindow = null;
          root.appendChild(panel);
          root.appendChild(toast);
          btnPopoutWindow.textContent = '↗ 獨立視窗';
          btnToggleMode.style.display = '';
          state.isOpen = false;
          updatePanelVisibility();
        });
        return;
      } catch (err) {
        console.warn('Document Picture-in-Picture fallback to chrome.windows:', err);
      }
    }

    // 備援方案：使用 Chrome 獨立彈出視窗
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'openDetachedWindow' });
      // 原本小幫手視窗變成浮動按鈕 (收合面板，保留懸浮把手/按鈕)
      state.isOpen = false;
      updatePanelVisibility();
      showToast('🚀 已開啟獨立視窗！原本視窗已縮為浮動按鈕');
    }
  });

  // 模式切換：側欄 vs 浮動視窗
  btnToggleMode.addEventListener('click', toggleFloating);

  function toggleFloating() {
    state.isFloating = !state.isFloating;
    if (state.isFloating) {
      panel.classList.remove('wuyi-sidebar');
      panel.classList.add('wuyi-floating');
      btnToggleMode.textContent = '⇥ 側欄';
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
      applyFloatingPos();
    } else {
      panel.classList.remove('wuyi-floating');
      panel.classList.add('wuyi-sidebar');
      panel.style.left = '0px';
      panel.style.right = 'auto';
      panel.style.top = '';
      btnToggleMode.textContent = '⧉ 浮窗';
      if (document.body && state.isOpen) {
        document.body.classList.add('wuyi-sidebar-open');
      }
    }
  }

  // 自由浮動位置 (解除邊界限制)
  function applyFloatingPos() {
    if (!state.isFloating) return;
    panel.style.left = state.pos.x + 'px';
    panel.style.top = state.pos.y + 'px';
  }

  // 浮窗拖曳邏輯
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  header.addEventListener('mousedown', (e) => {
    if (!state.isFloating || e.target.tagName === 'BUTTON') return;
    isDragging = true;
    dragOffset.x = e.clientX - panel.offsetLeft;
    dragOffset.y = e.clientY - panel.offsetTop;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    state.pos.x = e.clientX - dragOffset.x;
    state.pos.y = e.clientY - dragOffset.y;
    applyFloatingPos();
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  // 4. 動態圖框事件綁定與管理 (支援點擊「新增」增加空格、點擊空白框選檔、拖曳換位、單圖刪除)
  const GROUP_LABELS = {
    flower: '花束',
    cake: '蛋糕',
    addon: '蠟燭'
  };

  const hiddenFileInputContent = root.querySelector('#wuyiHiddenFileInputContent');
  let currentUploadTarget = null; // { group, index }
  let currentDraggingBox = null; // { group, index }

  function renderGroupBoxes(group) {
    const rowId = 'row' + group.charAt(0).toUpperCase() + group.slice(1);
    const row = panel.querySelector('#' + rowId) || root.querySelector('#' + rowId);
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
          if (hiddenFileInputContent) {
            hiddenFileInputContent.value = '';
            hiddenFileInputContent.click();
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
      panel.querySelectorAll('.wuyi-box-dropzone').forEach(b => b.classList.remove('wuyi-drag-over'));
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
        const res = await fetchImageViaServiceWorker(url);
        const finalUrl = res && res.dataUrl ? res.dataUrl : url;
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

  // 「新增」按鈕：多加一個截圖空格 (花束、蛋糕、蠟燭)
  panel.querySelectorAll('.wuyi-btn-add-slot').forEach(btn => {
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
  panel.querySelectorAll('.wuyi-btn-clear-slot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.getAttribute('data-group');
      if (!group || !state.images[group]) return;
      state.images[group] = state.images[group].map(() => null);
      renderGroupBoxes(group);
      showToast('已清除 ' + GROUP_LABELS[group] + ' 截圖');
    });
  });

  if (hiddenFileInputContent) {
    hiddenFileInputContent.addEventListener('change', () => {
      if (!hiddenFileInputContent.files || hiddenFileInputContent.files.length === 0) return;
      const file = hiddenFileInputContent.files[0];
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

    panel.querySelectorAll('.wuyi-size-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === sizeKey);
    });

    try {
      localStorage.setItem('wuyi_window_size', sizeKey);
    } catch (e) {}

    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.resizeTo(target.width, target.height);
    } else if (state.isFloating) {
      panel.style.width = target.width + 'px';
    }
    showToast('📐 已設定為 ' + target.label + ' 視窗尺寸 (' + target.width + 'x' + target.height + ')');
  }

  panel.querySelectorAll('.wuyi-size-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const sizeKey = btn.getAttribute('data-size');
      setWindowSize(sizeKey);
    });
  });

  // 5. 搜尋 LINE 聊天室符合格式之對話框與上一筆/下一筆切換導覽
  let orderCandidates = [];
  let currentCandidateIndex = -1;

  function isValidChatImage(src) {
    if (!src || typeof src !== 'string') return false;
    if (src.startsWith('data:image/svg')) return false;
    const lower = src.toLowerCase();
    if (lower.includes('avatar') || lower.includes('profile') || lower.includes('emoji') || lower.includes('icon') || lower.includes('sticker')) {
      return false;
    }
    return true;
  }

  // 檢驗是否屬於聊天室「對話訊息泡泡」（嚴禁抓取右側記事本、顧客面板、彈窗等非聊天區域）
  function isInsideChatDialogue(el) {
    if (!el) return false;

    // 1. 嚴格排除小幫手自身面板
    if (el.closest('#wuyi-order-helper-root, #wuyi-helper-root')) {
      return false;
    }

    // 2. 嚴格排除彈出視窗（如新增記事本彈窗、任何 Modal/Dialog）
    if (el.closest('[role="dialog"], [class*="modal" i], [class*="dialog" i], .modal, .dialog')) {
      return false;
    }

    // 3. 嚴格排除右側「記事本」與顧客資訊抽屜 (Drawer / Aside / User Profile / Notes / Memo / Tabs)
    if (el.closest('aside, [class*="drawer" i], [class*="sidebar-right" i], [class*="user-info" i], [class*="customer-profile" i], [class*="note" i], [class*="memo" i], [id*="note" i], [id*="memo" i], [class*="right" i], [role="tabpanel"], [class*="tabpanel" i]')) {
      return false;
    }

    // 4. 嚴格排除左側聊天室列表 (chat list / room list)
    if (el.closest('[class*="chat-list" i], [class*="chatList"], [class*="room-list" i], nav')) {
      return false;
    }

    // 5. 幾何位置檢驗：確保元素必定落在中間對話串區域（嚴禁落在右側記事本欄位）
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
        // 如果元素水平位置在對話輸入框的右側（即右側記事本欄位），絕對不是聊天對話！
        if (rect.left > inputRect.right + 20) {
          return false;
        }
        // 如果元素水平位置在對話輸入框的左側（即左側聊天清單），絕對不是聊天對話！
        if (rect.right < inputRect.left - 20) {
          return false;
        }
      }
    } catch (e) {}

    // 6. 排除含有「記事本」等關鍵字或記事特徵的容器
    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.includes('記錄與用戶之間的互動') || raw.includes('交接備註') || /^(記事本|記事)\s*\d*\/?\d*/.test(raw)) {
      return false;
    }
    if (el.closest('[aria-label*="記事本"], [title*="記事本"], [aria-label*="note" i]')) {
      return false;
    }

    return true;
  }

  function findOrderCandidateBubbles() {
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

    for (const el of elements) {
      if (!isInsideChatDialogue(el)) continue;

      const text = (el.innerText || '').trim();
      if (!text) continue;

      // 嚴格判定：必須同時具備以下 6 項訂單核心資訊才能選入
      const hasPickupDate = /(?:取貨|自取)?日期\s*[：:]/.test(text) || /取貨日期|自取日期/.test(text);
      const hasPickupTime = /(?:取貨|自取)?時間\s*[：:]/.test(text) || /取貨時間|自取時間/.test(text);
      const hasPickupLocation = /(?:自取|取貨)(?:地點|門市)\s*[：:]/.test(text) || /自取地點|取貨地點/.test(text);
      const hasLineName = /(?:訂購人(?:的)?\s*)?(?:LINE|line)\s*名稱/i.test(text);
      const hasCustomerName = /訂購人姓名|訂購人\s*姓名/.test(text) || (/(?:訂購人)?姓名\s*[：:]/.test(text) && !/LINE\s*名稱/i.test(text));
      const hasCustomerPhone = /訂購人電話|訂購人\s*電話/.test(text) || /(?:訂購人|聯絡)?電話\s*[：:]/.test(text);

      const isOrderValid = Boolean(hasPickupDate && hasPickupTime && hasPickupLocation && hasLineName && hasCustomerName && hasCustomerPhone);

      if (isOrderValid) {
        matched.push({ el, text });
      }
    }

    // 剔除包含其他候選者的超大外層容器（例如包了幾十條訊息的聊天列表外框）
    const filtered = matched.filter(item => {
      const containsChildOrder = matched.some(other => {
        return other.el !== item.el &&
               item.el.contains(other.el) &&
               (/LINE/i.test(other.text) || /取貨/.test(other.text) || /蛋糕/.test(other.text) || other.text.length > 40);
      });
      if (containsChildOrder) return false;

      // 剔除過小且只有單行標題的孤立標籤
      const hasContent = /LINE|取貨|自取|蛋糕|口味|尺寸|題字|訂購人|加購|預算|花束/i.test(item.text);
      if (!hasContent && item.text.length < 20) {
        return false;
      }

      return true;
    });

    // 去除重複對話框
    const unique = [];
    const seenTexts = new Set();
    for (const item of filtered) {
      const key = item.text.replace(/\s+/g, ' ').substring(0, 100);
      if (!seenTexts.has(key)) {
        seenTexts.add(key);
        unique.push(item);
      }
    }

    // 依據在網頁中的 DOM 順序排序（由舊至新）
    unique.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return unique;
  }

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

  async function applyOrderCandidate(index) {
    if (index < 0 || index >= orderCandidates.length) return;
    currentCandidateIndex = index;
    updateNavUI();

    const candidate = orderCandidates[index];
    const text = candidate.text;

    // 1. 依需求分成 1️⃣花束 與 2️⃣蛋糕 兩大部分填入對應文字框 (無該項目則填寫「無」)
    const cleanText = Ext.cleanOrderTextWithoutPricing(text);
    const split = Ext.splitOrderText(cleanText);
    if (txtFlowerOrder) txtFlowerOrder.value = split.flowerText;
    if (txtCakeOrder) txtCakeOrder.value = split.cakeText;

    state.orderState = Ext.parseOrderText(cleanText);
    if (inputDateTag) {
      inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date || '';
    }

    // 2. 滾動至該對話框並框線高亮
    try {
      candidate.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      candidate.el.style.outline = '3px solid #0284c7';
      candidate.el.style.borderRadius = '8px';
      setTimeout(() => {
        if (candidate.el) candidate.el.style.outline = '';
      }, 2000);
    } catch (e) {}

    // 3. 尋找金額明細：優先提取「訂購人電話」下方的內容
    let foundPricingText = Ext.extractPricingFromOrderText(text);
    if (!foundPricingText) {
      if (Ext.isPricingFormat(text)) {
        foundPricingText = text;
      } else {
        const allDivs = Array.from(document.querySelectorAll('.chat-content, .message-content, [data-testid*="message"], div, p'));
        for (let i = allDivs.length - 1; i >= 0; i--) {
          if (!isInsideChatDialogue(allDivs[i])) continue;
          const t = (allDivs[i].innerText || '').trim();
          if (Ext.isPricingFormat(t)) {
            foundPricingText = t;
            break;
          }
        }
      }
    }
    if (foundPricingText) {
      state.pricingState = Ext.parsePricingText(foundPricingText);
      txtPricing.value = state.pricingState.breakdownText || foundPricingText;
    } else {
      txtPricing.value = '';
    }

    // 4. 尋找與該對話相關的圖片
    const candidateImages = [];
    candidate.el.querySelectorAll('img').forEach(img => {
      if (isValidChatImage(img.src) && !candidateImages.includes(img.src)) {
        candidateImages.push(img.src);
      }
    });

    const parentContainer = candidate.el.parentElement;
    if (parentContainer) {
      parentContainer.querySelectorAll('img').forEach(img => {
        if (isValidChatImage(img.src) && !candidateImages.includes(img.src)) {
          candidateImages.push(img.src);
        }
      });
    }

    if (candidateImages.length > 0) {
      const hasFlower = split.flowerText && split.flowerText !== '無';
      const hasCake = split.cakeText && split.cakeText !== '無';

      if (hasFlower && !hasCake) {
        // 純花束訂單
        for (let idx = 0; idx < candidateImages.length; idx++) {
          const res = await fetchImageViaServiceWorker(candidateImages[idx]);
          if (res && res.success && res.dataUrl) {
            if (idx < state.images.flower.length) {
              state.images.flower[idx] = res.dataUrl;
            } else {
              state.images.flower.push(res.dataUrl);
            }
          }
        }
        renderGroupBoxes('flower');
      } else if (hasFlower && hasCake) {
        // 花束 + 蛋糕混和訂單：依序填入花束、蛋糕、蠟燭配件
        const resFlower = await fetchImageViaServiceWorker(candidateImages[0]);
        if (resFlower && resFlower.success && resFlower.dataUrl) {
          state.images.flower[0] = resFlower.dataUrl;
          renderGroupBoxes('flower');
        }
        if (candidateImages.length > 1) {
          const resCake = await fetchImageViaServiceWorker(candidateImages[1]);
          if (resCake && resCake.success && resCake.dataUrl) {
            state.images.cake[0] = resCake.dataUrl;
            renderGroupBoxes('cake');
          }
        }
        if (candidateImages.length > 2) {
          const resAddon = await fetchImageViaServiceWorker(candidateImages[2]);
          if (resAddon && resAddon.success && resAddon.dataUrl) {
            state.images.addon[0] = resAddon.dataUrl;
            renderGroupBoxes('addon');
          }
        }
        if (candidateImages.length > 3) {
          for (let idx = 3; idx < candidateImages.length; idx++) {
            const resExtra = await fetchImageViaServiceWorker(candidateImages[idx]);
            if (resExtra && resExtra.success && resExtra.dataUrl) {
              state.images.cake.push(resExtra.dataUrl);
            }
          }
          renderGroupBoxes('cake');
        }
      } else {
        // 純蛋糕/配件
        for (let idx = 0; idx < Math.min(3, candidateImages.length); idx++) {
          const res = await fetchImageViaServiceWorker(candidateImages[idx]);
          if (res && res.success && res.dataUrl) {
            if (idx < state.images.cake.length) {
              state.images.cake[idx] = res.dataUrl;
            } else {
              state.images.cake.push(res.dataUrl);
            }
          }
        }
        renderGroupBoxes('cake');

        if (candidateImages.length > 3) {
          for (let idx = 3; idx < candidateImages.length; idx++) {
            const addonIdx = idx - 3;
            const res = await fetchImageViaServiceWorker(candidateImages[idx]);
            if (res && res.success && res.dataUrl) {
              if (addonIdx < state.images.addon.length) {
                state.images.addon[addonIdx] = res.dataUrl;
              } else {
                state.images.addon.push(res.dataUrl);
              }
            }
          }
          renderGroupBoxes('addon');
        }
      }
    }

    showToast(`📋 已載入第 ${currentCandidateIndex + 1}/${orderCandidates.length} 則訂單對話`);
  }

  btnScrapeChat.addEventListener('click', async () => {
    showToast('🔍 正在搜尋對話框訂單...');
    orderCandidates = findOrderCandidateBubbles();
    if (orderCandidates.length === 0) {
      currentCandidateIndex = -1;
      updateNavUI();
      showToast('⚠️ 未在對話框中找到包含【訂購人 LINE 名稱】或訂單格式的訊息');
      return;
    }
    // 預設選取最新一筆 (最後一筆)
    await applyOrderCandidate(orderCandidates.length - 1);
  });

  btnPrevOrder.addEventListener('click', () => {
    if (currentCandidateIndex > 0) {
      applyOrderCandidate(currentCandidateIndex - 1);
    }
  });

  btnNextOrder.addEventListener('click', () => {
    if (currentCandidateIndex < orderCandidates.length - 1) {
      applyOrderCandidate(currentCandidateIndex + 1);
    }
  });

  btnRefresh.addEventListener('click', () => {
    btnScrapeChat.click();
  });

  // 跨域取得圖片轉換
  function fetchImageViaServiceWorker(url) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url }, (res) => {
          if (res && res.success) {
            resolve(res);
          } else {
            resolve({ success: false, dataUrl: url });
          }
        });
      } else {
        resolve({ success: false, dataUrl: url });
      }
    });
  }

  // 6. 文字與標籤編輯雙向同步 (確保修改能即時連動小卡與備忘錄)
  if (inputDateTag) {
    inputDateTag.addEventListener('input', () => {
      const val = inputDateTag.value.trim();
      state.orderState.pickup.dateTag = val;
      // 維持完整訂單內容原始文字，不自動覆寫 txtRawOrder
    });
  }

  // 點擊「＋ 新增標籤」直接在 LINE 官方帳號右側顧客資料新增此日期標籤 (例如 1102)
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

      // 同時複製至剪貼簿
      await copyTextToClipboard(tag);

      // 自動在 LINE 頁面尋找「＋ 新增標籤」並輸入送出
      const res = await addLineOfficialTag(tag);
      showToast(res.message);
    });
  }

  // 通用可見性與真實點擊輔助函式 (相容 position: fixed 彈窗、SVG 圖示與各類框架)
  function isVisibleOnScreen(el) {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  }

  function triggerRealClick(el) {
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
  }

  // 檢查右側顧客資訊面板中是否已存在日期標籤 (例如 4 碼數字 1010、1102 等)
  function findExistingDateTagInCustomerProfile() {
    const profileContainers = Array.from(document.querySelectorAll('aside, [class*="drawer"], [class*="sidebar-right"], [class*="user-info"], [class*="customer"], [class*="profile"], [class*="client"]'))
      .filter(isVisibleOnScreen);

    const searchRoots = profileContainers.length > 0 ? profileContainers : [document.body];
    for (const rootEl of searchRoots) {
      const tagEls = Array.from(rootEl.querySelectorAll('span, button, a, div, li, [class*="tag"], [class*="Tag"]')).filter(el => {
        if (!isVisibleOnScreen(el)) return false;
        if (el.closest('#wuyi-helper-root, #wuyi-order-helper-root')) return false;
        if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message"], [data-testid*="message"]')) return false;
        if (el.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav')) return false;
        if (el.children.length > 2) return false;
        const txt = (el.textContent || '').trim();
        return /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(txt) || /^\d{4}$/.test(txt);
      });

      if (tagEls.length > 0) {
        return tagEls[0].textContent.trim();
      }
    }
    return null;
  }

  // 自動化操作 LINE 官方帳號右側顧客資料面板之「＋ 新增標籤」
  async function addLineOfficialTag(tag) {
    if (!tag) return { success: false, message: '⚠️ 請先輸入取貨日期標籤' };

    // 依需求允許新增多個日期標籤 (如第二個、第三個日期)

    const findTagInput = (beforeInputs) => {
      const allInputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
        .filter(inp => {
          if (!isVisibleOnScreen(inp)) return false;
          const type = (inp.getAttribute('type') || 'text').toLowerCase();
          if (['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(type)) return false;
          return true;
        });

      // 1. 最優先：點擊「＋ 新增標籤」後畫面上新出現的 input
      const newlyAppeared = allInputs.find(inp => !beforeInputs.has(inp));
      if (newlyAppeared) return newlyAppeared;

      // 2. 次優先：目前獲得焦點的 input (排除左側聊天室列表搜尋框)
      if (document.activeElement && allInputs.includes(document.activeElement)) {
        const inLeftList = document.activeElement.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
        if (!inLeftList) return document.activeElement;
      }

      // 3. 第三優先：placeholder 含「標籤/tag」或位於彈窗/下拉選單/右側顧客欄內的 input
      return allInputs.find(inp => {
        const inLeftList = inp.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
        if (inLeftList) return false;
        const ph = (inp.placeholder || inp.getAttribute('aria-label') || '').toLowerCase();
        if (ph.includes('標籤') || ph.includes('tag')) return true;
        return Boolean(inp.closest('[role="dialog"], [class*="modal"], [class*="popover"], [class*="dropdown"], [class*="tag"], aside, [class*="drawer"], [class*="profile"]'));
      }) || null;
    };

    // 記錄點擊前畫面上已存在的 input
    const beforeInputs = new Set(
      Array.from(document.querySelectorAll('input, [contenteditable="true"]')).filter(isVisibleOnScreen)
    );

    // 1. 尋找 LINE 右側顧客資訊面板中的「＋ 新增標籤」按鈕
    const all = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      if (el.closest('#wuyi-helper-root')) return false;
      const raw = (el.textContent || '').trim();
      const t = raw.replace(/[\s\u200B\uFEFF]+/g, '');
      return t === '新增標籤' || t === '+新增標籤' || t === '＋新增標籤' || raw === '+ 新增標籤' || raw === '＋ 新增標籤';
    });

    let addTagBtn = null;
    let deepest = null;

    if (all.length > 0) {
      // 優先選取最小節點與可點擊容器 (button, a, role=button)
      all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      deepest = all[0];
      addTagBtn = deepest.closest('button, a, [role="button"]') || deepest;

      // 2. 觸發原生滑鼠點擊事件開啟標籤輸入框/選單
      triggerRealClick(addTagBtn);
      if (addTagBtn !== deepest) {
        triggerRealClick(deepest);
      }
    }

    // 3. 等待標籤輸入框或下拉選單出現 (最多 1.8 秒)
    let input = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 100));
      input = findTagInput(beforeInputs);
      if (input) break;

      // 若 300ms 尚未出現，嘗試點擊父容器 (支援將 @click 綁在父層 div 的元件)
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

    // 4. 若找到標籤輸入框，使用 native setter + execCommand 填入 4 碼標籤 (確保 Vue/React 狀態更新)
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, tag);
      } else {
        input.value = tag;
      }

      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, tag);
      } catch (e) {}

      if (input.value !== tag) {
        if (nativeSetter) {
          nativeSetter.call(input, tag);
        } else {
          input.value = tag;
        }
      }

      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tag }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: tag.slice(-1), bubbles: true }));
    }

    // 等待 250ms 讓下拉選單過濾出該標籤或「＋ 新增標籤」選項
    await new Promise(r => setTimeout(r, 250));

    // 5. 檢查下拉選單中的標籤選項 (嚴格限制小型葉節點，絕不誤點外層大 div 容器！)
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
      if (checkbox && !checkbox.checked) {
        triggerRealClick(checkbox);
      } else {
        triggerRealClick(optTarget);
      }
    }

    // 模擬在輸入框按下 Enter 鍵
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

    // 6. 等待 200ms 後檢查是否有「儲存 / 確定 / 完成 / 新增」確認按鈕
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

    if (!input && optionCandidates.length === 0) {
      return {
        success: true,
        message: `🏷️ 已點擊 LINE「＋ 新增標籤」！標籤「${tag}」已複製，可直接貼上儲存`
      };
    }

    return {
      success: true,
      message: `🏷️ 已成功為此客戶新增 LINE 標籤：${tag}！`
    };
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

  // 7. 快捷按鈕事件

  // 花束與蛋糕個別複製按鈕
  if (btnCopyFlowerDirect) {
    btnCopyFlowerDirect.addEventListener('click', () => {
      const text = getFlowerOrderText();
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });
  }

  if (btnCopyCakeDirect) {
    btnCopyCakeDirect.addEventListener('click', () => {
      const text = getCakeOrderText();
      if (!text) return showToast('⚠️ 目前沒有蛋糕文字');
      copyTextToClipboard(text);
      showToast('📋 已複製蛋糕訂單內容！');
    });
  }

  // 金額明細旁邊的直接複製按鈕
  if (btnCopyPricingDirect) {
    btnCopyPricingDirect.addEventListener('click', () => {
      const textToCopy = txtPricing.value.trim();
      if (!textToCopy) return showToast('⚠️ 目前沒有金額明細');
      copyTextToClipboard(textToCopy);
      showToast('📋 已複製金額明細！');
    });
  }

  // 複製備忘錄格式 (富文字 HTML：圖片加可編輯文字，格式完全等同「一鍵複製確認小卡」)
  btnCopyOrder.addEventListener('click', copyRichNotesFormat);
  async function copyRichNotesFormat() {
    const flowerText = getFlowerOrderText();
    const cakeText = getCakeOrderText();
    const hasFlower = Boolean(flowerText && flowerText !== '無');
    const hasCake = Boolean(cakeText && cakeText !== '無');

    if (!hasFlower && !hasCake) {
      showToast('⚠️ 目前沒有訂單內容可複製');
      return;
    }

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

    const activeWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
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
  }

  // 尋找「新增記事本」彈窗內的 textarea (精準鎖定 placeholder 包含「相關資訊」或彈窗標題為「新增記事本」)
  function findNoteModalTextarea() {
    const allTextareas = Array.from(document.querySelectorAll('textarea')).filter(isVisibleOnScreen);
    if (allTextareas.length === 0) return null;

    // 1. 優先精準匹配 LINE 官方截圖中的 placeholder: 「您可於此新增用戶的相關資訊，且記事本中的資訊不會向對方公開。」
    const exactMatch = allTextareas.find(t => {
      const ph = t.placeholder || '';
      return ph.includes('相關資訊') || ph.includes('不會向對方公開') || ph.includes('記事本中的資訊') || ph.includes('記事本');
    });
    if (exactMatch) return exactMatch;

    // 2. 檢查其父容器是否為標題為「新增記事本」或含「0/300」字數計數器的彈出視窗
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

    // 3. 檢查位於 dialog 或 modal 內的 textarea (嚴格排除中間聊天室底部的訊息輸入框，絕不誤傳 allTextareas[0]！)
    const inDialog = allTextareas.find(t => {
      if (t.closest('[class*="chat-room"], [class*="chat-footer"], [class*="message-input"], [class*="editor"]')) {
        return false;
      }
      return Boolean(t.closest('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
    });
    return inDialog || null;
  }

  // 尋找 LINE 右側記事本標題區塊 (記事本 0/1000) 旁的綠色「＋」按鈕
  function findLineAddNotePlusButton() {
    const noteTitleEls = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return (t === '記事本' || /^記事本\s*\d+\s*\/\s*\d+/.test(t)) && !t.includes('記錄與用戶') && !t.includes('負責人員') && t.length <= 30;
    });

    // 由最深層的「記事本」標題節點往外找
    noteTitleEls.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

    // 判斷是否為下方灰色提示框「ⓘ 記錄與用戶之間的互動」內的元素（嚴格排除！）
    const isInGrayInfoBox = (el) => {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('info')) return true;
      let p = el;
      for (let d = 0; d < 3 && p && p !== document.body; d++) {
        const pt = (p.textContent || '').trim();
        if (pt.includes('記錄與用戶') || pt.includes('不會看見記事本')) {
          if (!pt.includes('記事本 0/') && !/記事本\s*\d+\s*\/\s*\d+/.test(pt)) {
            return true;
          }
        }
        p = p.parentElement;
      }
      return false;
    };

    // 判斷是否與「記事本 0/1000」在同一水平標題列上
    const isOnSameHeaderLine = (el, labelRect) => {
      if (!labelRect || labelRect.height === 0 || labelRect.width === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return true;
      const labelCy = labelRect.top + labelRect.height / 2;
      const elCy = r.top + r.height / 2;
      return Math.abs(elCy - labelCy) <= 45 && r.left >= labelRect.left - 5;
    };

    for (const labelEl of noteTitleEls) {
      const labelRect = labelEl.getBoundingClientRect();
      let headerRow = labelEl;

      // 向上查找記事本標題列 (最多 5 層，且絕不跨越到上方的「負責人員」或「新增標籤」區塊)
      for (let depth = 0; depth < 5 && headerRow && headerRow !== document.body; depth++) {
        const rowText = headerRow.textContent || '';
        if (rowText.includes('負責人員') || rowText.includes('新增標籤')) {
          break;
        }

        // 策略 A：標題列內的 button / a / [role="button"] (不含「記事本」文字本身與灰色提示框)
        const explicitBtns = Array.from(headerRow.querySelectorAll('button, a, [role="button"]')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          const bt = (b.textContent || '').trim();
          return !bt.includes('記事本') && !bt.includes('記錄與用戶') && isOnSameHeaderLine(b, labelRect);
        });
        if (explicitBtns.length > 0) {
          return explicitBtns[0];
        }

        // 策略 B：標題列內的 + 號圖示 (svg, i, span, div)
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
          if ((tag === 'svg' || tag === 'i') && b.getBoundingClientRect().height <= 40) {
            return true;
          }
          return false;
        });

        if (iconCandidates.length > 0) {
          const icon = iconCandidates[0];
          return icon.closest('button, a, [role="button"]') || icon.parentElement || icon;
        }

        headerRow = headerRow.parentElement;
      }

      // 策略 C：若「記事本 0/1000」標題列為左右並排 flex 橫列，取標題列右側子元素
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
  }

  // 自動化操作 LINE 官方帳號右側顧客資料面板之「新增記事本」彈窗
  async function addLineOfficialNote(noteText) {
    if (!noteText) return { success: false, message: '⚠️ 無訂單內容可新增' };

    // 限制最多 300 字 (LINE 記事本上限為 300 字)
    let safeText = noteText.trim();
    if (safeText.length > 298) {
      safeText = safeText.substring(0, 298);
    }

    // 1. 檢查是否已經打開「新增記事本」彈窗
    let modalTextarea = findNoteModalTextarea();

    // 2. 若尚未開啟彈窗，尋找 LINE 右側記事本旁的「＋」按鈕並點擊開啟彈窗
    if (!modalTextarea) {
      const plusBtn = findLineAddNotePlusButton();
      if (plusBtn) {
        triggerRealClick(plusBtn);
        const innerIcon = plusBtn.querySelector('button, a, i, svg, span');
        if (innerIcon && innerIcon !== plusBtn) {
          triggerRealClick(innerIcon);
        }
      }

      // 等待「新增記事本」彈窗與 textarea 出現 (最多等待 2.2 秒)
      for (let i = 0; i < 22; i++) {
        await new Promise(r => setTimeout(r, 100));
        modalTextarea = findNoteModalTextarea();
        if (modalTextarea) break;

        // 若 300ms 尚未出現，再嘗試點擊 plusBtn 的父容器
        if (i === 2 && plusBtn && plusBtn.parentElement && !plusBtn.parentElement.closest('#wuyi-helper-root')) {
          triggerRealClick(plusBtn.parentElement);
        }
      }
    }

    // 3. 填入內容至「新增記事本」文字框 (使用 native setter 與 execCommand，確保 React/Vue 狀態同步與字數 0/300 更新)
    if (modalTextarea) {
      modalTextarea.focus();
      if (typeof modalTextarea.select === 'function') modalTextarea.select();

      let execSuccess = false;
      try {
        execSuccess = document.execCommand('insertText', false, safeText);
      } catch (e) {}

      if (!execSuccess || modalTextarea.value !== safeText) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(modalTextarea, safeText);
        } else {
          modalTextarea.value = safeText;
        }
      }

      modalTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeText }));
      modalTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      modalTextarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      modalTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: safeText.slice(-1), bubbles: true }));

      // 自動聚焦彈窗內的「儲存」按鈕
      const modal = modalTextarea.closest('[role="dialog"], .modal, [class*="modal"]') || modalTextarea.parentElement;
      if (modal) {
        const saveBtns = Array.from(modal.querySelectorAll('button, a, [role="button"]')).filter(b => {
          const bt = (b.textContent || '').trim();
          return bt === '儲存' || bt === '確定' || bt === '完成';
        });
        if (saveBtns.length > 0) {
          saveBtns[0].focus();
        }
      }

      return {
        success: true,
        message: '📝 已自動開啟並將內容填入「＋ 新增記事本」！請確認後點擊儲存'
      };
    } else {
      return {
        success: false,
        message: '📋 內容已複製至剪貼簿！(未偵測到記事本彈窗，請點選 LINE 記事本 ＋ 貼上)'
      };
    }
  }

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
      if (!textToCopy) {
        showToast('⚠️ 目前沒有訂單或日期內容可新增');
        return;
      }
      await copyTextToClipboard(textToCopy);

      const res = await addLineOfficialNote(textToCopy);
      showToast(res.message);
    });
  }

  // 記錄最後一次成功同步的訂單 Key，杜絕連點或重複點擊小卡重複寫入試算表
  let lastSyncedOrderKey = null;

  // 一鍵產生並複製「預約取貨確認單」圖檔 (寫入剪貼簿)，規格完全依據附圖1、2、3格式
  btnCopyCard.addEventListener('click', copyCardImage);
  async function copyCardImage() {
    showToast('🎨 正在生成預約取貨確認單...');
    try {
      const canvas = await Renderer.renderCard(state.orderState, {
        flowerText: getFlowerOrderText(),
        cakeText: getCakeOrderText(),
        flowerImages: state.images.flower.filter(Boolean),
        cakeImages: state.images.cake.filter(Boolean),
        addonImages: Array.isArray(state.images.addon) ? state.images.addon.filter(Boolean) : (state.images.addon ? [state.images.addon] : []),
        addonImage: Array.isArray(state.images.addon) ? (state.images.addon.filter(Boolean)[0] || null) : state.images.addon
      });

      let copiedToClipboard = false;
      const currentWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
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
      console.error(err);
      showToast('❌ 複製確認單失敗：' + err.message);
    }
  }

  // 下載小卡圖檔 (儲存為 PNG)
  if (btnDownloadCard) {
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
        const name = (state.orderState.customer && state.orderState.customer.name) || '客戶';
        const date = (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
        const filename = `梧藝取貨單_${name}_${date}.png`;
        const dataUrl = canvas.toDataURL('image/png');

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
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
        } else {
          Renderer.downloadCard(canvas, filename);
          showToast('💾 已下載小卡圖檔！');
        }
      } catch (e) {
        showToast('❌ 下載失敗：' + e.message);
      }
    });
  }

  // 自動同步至 Google 試算表 (雙重防重複：前端特徵比對 + 後端覆寫)
  async function autoSyncToGoogleSheets() {
    try {
      const settings = await getSettings();
      if (!settings.googleSheetsWebhookUrl) {
        return { skipped: true, reason: 'no_webhook' };
      }

      // 計算目前訂單的特徵 Key
      const currentOrderKey = [
        state.orderState.pickup.date || '',
        state.orderState.customer.name || '',
        state.orderState.customer.phone || '',
        state.orderState.customer.lineName || '',
        state.pricingState.total || '0'
      ].join('__');

      // 若剛剛才同步過相同訂單，跳過重複發送
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
            url: settings.googleSheetsWebhookUrl,
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
      console.warn('Auto sync error:', err);
      return { error: err.message };
    }
  }

  // 7. 🎂 蛋糕 與 💐 花束 快速發送/編輯確認訊息功能
  // 按 1 下：傳送確認訊息給客人；快速連按 3 下：編輯要輸入的自訂訊息
  const btnQuickMsgCake = root.querySelector('#btnQuickMsgCake');
  const btnQuickMsgFlower = root.querySelector('#btnQuickMsgFlower');

  const DEFAULT_QUICK_MSG = {
    cake: '您好！這是為您安排的蛋糕預約取貨確認單，請核對上方圖片中的品項、日期與訂購資訊是否無誤喔！取貨當天請向門市夥伴出示確認小卡即可，感謝您！🍰',
    flower: '您好！這是為您安排的花束預約確認單，請核對上方圖片中的花材色系、包裝與取貨時間是否正確喔！感謝您的訂購，祝您有美好的一天！💐'
  };

  function setupQuickMsgButton(btn, type, label, defaultText) {
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

      // 原生三連擊偵測 (e.detail >= 3)
      if (e.detail >= 3) {
        handleEdit();
        return;
      }

      clickCount++;
      if (clickCount >= 3) {
        handleEdit();
        return;
      }

      // 按 1 下：傳給客人訊息
      clearTimeout(clickTimer);
      clickTimer = setTimeout(async () => {
        if (clickCount === 1) {
          const currentMsg = localStorage.getItem(storageKey) || defaultText;
          showToast(`⏳ 正在傳送【${label}】確認訊息...`);
          const res = await sendTextMessageToLineChat(currentMsg);
          showToast(res.message);
        }
        clickCount = 0;
      }, 450);
    });
  }

  setupQuickMsgButton(btnQuickMsgCake, 'cake', '🎂 蛋糕', DEFAULT_QUICK_MSG.cake);
  setupQuickMsgButton(btnQuickMsgFlower, 'flower', '💐 花束', DEFAULT_QUICK_MSG.flower);

  // 自動將確認訊息填入 LINE 聊天室輸入框並送出
  async function sendTextMessageToLineChat(text) {
    if (!text || !text.trim()) return { success: false, message: '⚠️ 訊息內容為空' };

    const inputSelectors = [
      'textarea[placeholder*="輸入"]',
      'textarea[placeholder*="訊息"]',
      'textarea',
      '[contenteditable="true"]'
    ];

    const allInputs = Array.from(document.querySelectorAll(inputSelectors.join(', '))).filter(isVisibleOnScreen);
    const chatInput = allInputs.find(inp => {
      if (inp.closest('#wuyi-helper-root, #wuyi-order-helper-root')) return false;
      if (inp.closest('[role="dialog"], [class*="modal"], aside, [class*="drawer"]')) return false;
      if (inp.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav')) return false;
      return true;
    });

    if (!chatInput) {
      await copyTextToClipboard(text);
      return { success: false, message: '📋 已複製訊息至剪貼簿！(未偵測到 LINE 訊息輸入框)' };
    }

    chatInput.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(chatInput, text);
    } else {
      chatInput.value = text;
    }
    if (chatInput.isContentEditable) {
      chatInput.textContent = text;
    }
    chatInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    chatInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 150));

    const allBtns = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(isVisibleOnScreen);
    const sendBtn = allBtns.find(b => {
      if (b.closest('#wuyi-helper-root, #wuyi-order-helper-root')) return false;
      const t = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      return t === '傳送' || t === '送出' || aria.includes('傳送') || aria.includes('send');
    });

    if (sendBtn && !sendBtn.disabled) {
      triggerRealClick(sendBtn);
    } else {
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        chatInput.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        }));
      });
    }

    return { success: true, message: '🚀 已傳送確認訊息給客人！' };
  }

  // 輔助函式：文字寫入剪貼簿 (雙重保險：現代 Clipboard API + 離屏 textarea 回退機制，解決 Document not focused 報錯)
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

  // 讀取設定
  function getSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['googleSheetsWebhookUrl'], (res) => {
          resolve(res || {});
        });
      } else {
        resolve({});
      }
    });
  }

  // Toast 提示
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('wuyi-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('wuyi-show');
    }, 2800);
  }
})();
