/**
 * 梧藝 WUYI 下單小幫手 - 預約取貨確認單渲染引擎 (Card Renderer)
 * 規格完全依據附圖 1、2、3 格式：純白底色、清晰字體、需加購粉紫色高亮，圖框圖片即輸出圖片
 * 輸出採用 Retina 2x 高解析度繪製
 */

const CardRenderer = {
  /**
   * 渲染預約取貨確認單
   * @param {Object} orderState 
   * @param {Object} options { canvas, cakeImages, addonImage, flowerImages, rawText }
   * @returns {Promise<HTMLCanvasElement>}
   */
  async renderCard(orderState, options = {}) {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    let canvas = options.canvas;
    if (!canvas) {
      if (isBrowser) {
        canvas = document.createElement('canvas');
      } else {
        throw new Error('Canvas must be provided in non-browser environment');
      }
    }

    // 1. 取得完整訂單文字 (分成花束與蛋糕兩部分)
    let flowerText = '';
    let cakeText = '';

    if (options.flowerText !== undefined || options.cakeText !== undefined) {
      flowerText = (options.flowerText || '').trim();
      cakeText = (options.cakeText || '').trim();
    } else {
      let raw = (options.rawText || (orderState && orderState.rawText) || '').trim();
      if (!raw && orderState && window.Extractor) {
        raw = window.Extractor.formatRawOrder(orderState);
      }
      if (window.Extractor && window.Extractor.splitOrderText) {
        const split = window.Extractor.splitOrderText(raw);
        flowerText = split.flowerText;
        cakeText = split.cakeText;
      } else {
        flowerText = '無';
        cakeText = raw || '預約取貨確認單\n(尚無訂單內容)';
      }
    }

    const hasFlower = Boolean(flowerText && flowerText !== '無');
    const hasCake = Boolean(cakeText && cakeText !== '無');

    // 2. 準備圖片
    let flowerImgs = (options.flowerImages || (options.flowerImage ? [options.flowerImage] : [])).filter(Boolean);
    let cakeImgs = (options.cakeImages || (options.cakeImage ? [options.cakeImage] : [])).filter(Boolean);
    let addonImgs = (Array.isArray(options.addonImages) ? options.addonImages : (Array.isArray(options.addonImage) ? options.addonImage : (options.addonImage ? [options.addonImage] : []))).filter(Boolean);

    // 預載圖片物件
    const loadedFlower = await this._loadImages(flowerImgs);
    const loadedCake = await this._loadImages(cakeImgs);
    const loadedAddon = await this._loadImages(addonImgs);

    // 3. 畫布版面尺寸設定
    const W = 580;
    const paddingX = 36;
    const contentW = W - paddingX * 2;
    const fontMain = '500 18px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const fontBold = 'bold 18px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const fontSection = 'bold 20px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const lineHeight = 30;
    const emptyLineSpacing = 14;

    // 預先測量總高度並規劃圖文排列
    let totalH = 40; // 頂部留白
    const plan = [];

    // 1️⃣ 花束區塊圖文排列
    if (hasFlower) {
      const flowerLines = flowerText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      let placedFlowerImgs = false;
      let startIdx = 0;

      if (flowerLines[0] && flowerLines[0].trim() === '加單') {
        plan.push({ type: 'tag_jiadan', height: 34 });
        totalH += 34;
        startIdx = 1;
      }

      for (let i = startIdx; i < flowerLines.length; i++) {
        const line = flowerLines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          plan.push({ type: 'empty', height: emptyLineSpacing });
          totalH += emptyLineSpacing;
          continue;
        }

        if (/^1️⃣/.test(trimmed)) {
          plan.push({ type: 'section_header', text: trimmed, height: lineHeight + 6 });
          totalH += lineHeight + 6;
          if (loadedFlower.length > 0 && !placedFlowerImgs) {
            const imgH = loadedFlower.length > 1 ? 190 : 230;
            plan.push({ type: 'images', images: loadedFlower, height: imgH + 18 });
            totalH += imgH + 18;
            placedFlowerImgs = true;
          }
          continue;
        }

        if (/💐.*花束.*💐|花束/.test(trimmed) && !/色系|預算|襯紙|提袋/.test(trimmed)) {
          plan.push({ type: 'flower_header', text: trimmed, height: lineHeight + 6 });
          totalH += lineHeight + 6;
          if (loadedFlower.length > 0 && !placedFlowerImgs) {
            const imgH = loadedFlower.length > 1 ? 190 : 230;
            plan.push({ type: 'images', images: loadedFlower, height: imgH + 18 });
            totalH += imgH + 18;
            placedFlowerImgs = true;
          }
          continue;
        }

        if (loadedFlower.length > 0 && !placedFlowerImgs) {
          const imgH = loadedFlower.length > 1 ? 190 : 230;
          plan.push({ type: 'images', images: loadedFlower, height: imgH + 18 });
          totalH += imgH + 18;
          placedFlowerImgs = true;
        }

        plan.push({ type: 'text', text: line, height: lineHeight });
        totalH += lineHeight;
      }
    }

    if (hasFlower && hasCake) {
      plan.push({ type: 'empty', height: 22 });
      totalH += 22;
    }

    // 2️⃣ 蛋糕與蠟燭配件圖文排列
    if (hasCake) {
      const cakeLines = cakeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const cakeHasSec1 = cakeLines.some(l => /^1️⃣/.test(l.trim()));
      const cakeHasSec2 = cakeLines.some(l => /^2️⃣/.test(l.trim()));
      let placedCakeSec1 = false;
      let placedCakeSec2 = false;
      let placedAllCakeImgs = false;
      let startIdx = 0;

      if (!hasFlower && cakeLines[0] && cakeLines[0].trim() === '加單') {
        plan.push({ type: 'tag_jiadan', height: 34 });
        totalH += 34;
        startIdx = 1;
      }

      for (let i = startIdx; i < cakeLines.length; i++) {
        const line = cakeLines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          plan.push({ type: 'empty', height: emptyLineSpacing });
          totalH += emptyLineSpacing;
          continue;
        }

        // 雙蛋糕情況：1️⃣ 放置蛋糕款式1
        if (/^1️⃣/.test(trimmed) && cakeHasSec1 && cakeHasSec2) {
          plan.push({ type: 'section_header', text: trimmed, height: lineHeight + 6 });
          totalH += lineHeight + 6;
          if (loadedCake[0] && !placedCakeSec1) {
            plan.push({ type: 'images', images: [loadedCake[0]], height: 230 + 16 });
            totalH += 230 + 16;
            placedCakeSec1 = true;
          }
          continue;
        }

        // 2️⃣ 段落標題：放置蛋糕款式2 (若有蠟燭配件則並排)
        if (/^2️⃣/.test(trimmed)) {
          plan.push({ type: 'section_header', text: trimmed, height: lineHeight + 6 });
          totalH += lineHeight + 6;

          const sec2Imgs = [];
          if (cakeHasSec1 && loadedCake[1]) {
            sec2Imgs.push(loadedCake[1]);
            if (loadedAddon.length > 0) sec2Imgs.push(...loadedAddon);
          } else if (loadedCake.length > 0 || loadedAddon.length > 0) {
            sec2Imgs.push(...loadedCake, ...loadedAddon);
          }

          if (sec2Imgs.length > 0 && !placedCakeSec2) {
            const imgH = sec2Imgs.length > 1 ? 190 : 230;
            plan.push({ type: 'images', images: sec2Imgs, height: imgH + 18 });
            totalH += imgH + 18;
            placedCakeSec2 = true;
            placedAllCakeImgs = true;
          }
          continue;
        }

        // 單蛋糕或其他情況：在圖款或第一行前置入蛋糕與蠟燭圖片
        if (!cakeHasSec1 && !cakeHasSec2 && !placedAllCakeImgs) {
          const allImgs = [...loadedCake, ...loadedAddon];
          if (allImgs.length > 0) {
            const imgH = allImgs.length > 1 ? 190 : 230;
            plan.push({ type: 'images', images: allImgs, height: imgH + 18 });
            totalH += imgH + 18;
            placedAllCakeImgs = true;
          }
        }

        // 需加購/加購 (粉紫色螢光底框，如附圖 1、2、3)
        if (/^(需加購|加購)[：:]/i.test(trimmed)) {
          plan.push({ type: 'highlight_addon', text: trimmed, height: lineHeight + 12 });
          totalH += lineHeight + 12;
          continue;
        }

        // 一般文字行
        plan.push({ type: 'text', text: line, height: lineHeight });
        totalH += lineHeight;
      }
    }

    if (!hasFlower && !hasCake) {
      plan.push({ type: 'text', text: '預約取貨確認單\n(尚無訂單內容)', height: lineHeight * 2 });
      totalH += lineHeight * 2;
    }

    totalH += 36; // 底部留白

    // 5. 設定 Canvas 2x 超高清解析度
    const scale = 2;
    canvas.width = W * scale;
    canvas.height = totalH * scale;
    canvas.style.width = W + 'px';
    canvas.style.height = totalH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // 繪製純白背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, totalH);

    ctx.textBaseline = 'middle';

    // 6. 依據排版計畫繪製所有內容
    let curY = 36;

    for (const item of plan) {
      if (item.type === 'empty') {
        curY += item.height;
        continue;
      }

      // 「加單」標籤
      if (item.type === 'tag_jiadan') {
        this._drawRoundRect(ctx, paddingX, curY, 48, 24, 4, '#fce7f3');
        ctx.fillStyle = '#e11d48';
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
        ctx.fillText('加單', paddingX + 11, curY + 12);
        curY += item.height;
        continue;
      }

      // 序號 (1️⃣, 2️⃣)
      if (item.type === 'section_header') {
        ctx.fillStyle = '#1e293b';
        ctx.font = fontSection;
        ctx.fillText(item.text, paddingX, curY + 14);
        curY += item.height;
        continue;
      }

      // 花束標題 (💐透明包裝花束💐)
      if (item.type === 'flower_header') {
        ctx.fillStyle = '#0f172a';
        ctx.font = fontBold;
        ctx.fillText(item.text, paddingX, curY + 14);
        curY += item.height;
        continue;
      }

      // 圖片繪製 (截圖圖框對應圖片：單圖、雙圖並排或多圖網格)
      if (item.type === 'images') {
        const imgs = item.images;
        if (imgs.length === 1) {
          // 單張大圖
          const imgW = 230;
          const imgH = 230;
          this._drawPhoto(ctx, imgs[0], paddingX, curY, imgW, imgH);
          curY += item.height;
        } else if (imgs.length === 2) {
          // 兩張圖並排 (如圖 1 中的蛋糕圖與蠟燭圖)
          const imgW = 190;
          const imgH = 190;
          const gap = 12;
          this._drawPhoto(ctx, imgs[0], paddingX, curY, imgW, imgH);
          this._drawPhoto(ctx, imgs[1], paddingX + imgW + gap, curY, imgW, imgH);
          curY += item.height;
        } else if (imgs.length >= 3) {
          // 三張或多張圖
          const imgW = 150;
          const imgH = 150;
          const gap = 10;
          imgs.forEach((img, idx) => {
            this._drawPhoto(ctx, img, paddingX + idx * (imgW + gap), curY, imgW, imgH);
          });
          curY += item.height;
        }
        continue;
      }

      // 需加購行高亮 (粉紫色螢光底框，如附圖 1、2、3)
      if (item.type === 'highlight_addon') {
        ctx.font = fontBold;
        const metrics = ctx.measureText(item.text);
        const bgW = Math.min(contentW, metrics.width + 16);
        const bgH = 28;
        this._drawRoundRect(ctx, paddingX - 4, curY + 1, bgW, bgH, 4, '#fae8ff');

        ctx.fillStyle = '#9333ea';
        ctx.fillText(item.text, paddingX + 4, curY + 15);
        curY += item.height;
        continue;
      }

      // 一般文字行
      if (item.type === 'text') {
        const trimmed = item.text.trim();
        // 關鍵欄位加粗或標題
        if (/^(圖款|蛋糕尺寸|蛋糕口味|取貨日期|取貨時間|自取地點|訂購人)/.test(trimmed)) {
          ctx.font = fontMain;
          ctx.fillStyle = '#1e293b';
        } else {
          ctx.font = fontMain;
          ctx.fillStyle = '#334155';
        }

        ctx.fillText(item.text, paddingX, curY + lineHeight / 2);
        curY += item.height;
      }
    }

    return canvas;
  },

  /**
   * 確保所有圖片連結轉為本地 dataUrl，徹底杜絕跨域 Tainted Canvas 與 Apple 備忘錄圖片遺失
   */
  async ensureDataUrls(urls) {
    if (!urls || urls.length === 0) return [];
    const results = await Promise.all(urls.map(async (url) => {
      if (!url) return null;
      if (typeof url === 'string' && url.startsWith('data:')) return url;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const res = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url }, resolve);
          });
          if (res && res.dataUrl) return res.dataUrl;
        }
      } catch (_) {}
      return url;
    }));
    return results.filter(Boolean);
  },

  /**
   * 載入多張圖片為 Image 物件 (帶 crossOrigin 且預先轉為 dataUrl，絕不 taint canvas)
   */
  async _loadImages(imgUrls) {
    if (typeof Image === 'undefined') return [];
    const safeUrls = await this.ensureDataUrls(imgUrls);
    const promises = safeUrls.map(url => {
      if (!url) return Promise.resolve(null);
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
          const fallback = new Image();
          fallback.onload = () => resolve(fallback);
          fallback.onerror = () => resolve(null);
          fallback.src = url;
        };
        img.src = url;
      });
    });
    const results = await Promise.all(promises);
    return results.filter(Boolean);
  },

  /**
   * 繪製圓角照片
   */
  _drawPhoto(ctx, img, x, y, w, h) {
    if (!img) return;
    const r = 8;
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
    }
    ctx.closePath();
    ctx.clip();

    // 依比例裁切填滿 (object-fit: cover)
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = w / h;
    let sW = img.naturalWidth;
    let sH = img.naturalHeight;
    let sX = 0;
    let sY = 0;

    if (imgRatio > boxRatio) {
      sW = img.naturalHeight * boxRatio;
      sX = (img.naturalWidth - sW) / 2;
    } else {
      sH = img.naturalWidth / boxRatio;
      sY = (img.naturalHeight - sH) / 2;
    }

    ctx.drawImage(img, sX, sY, sW, sH, x, y, w, h);
    ctx.restore();

    // 細微邊框
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  /**
   * 繪製圓角矩形
   */
  _drawRoundRect(ctx, x, y, w, h, r, fillColor, strokeColor, strokeWidth) {
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
    }
    ctx.closePath();

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth || 1;
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * 將 Canvas 以 PNG 寫入剪貼簿 (支援獨立視窗、PiP 浮窗焦點切換)
   */
  async copyCardToClipboard(canvas, preferredWindow) {
    let win = preferredWindow;
    if (!win && typeof document !== 'undefined') {
      if (document.activeElement && document.activeElement.ownerDocument && document.activeElement.ownerDocument.defaultView) {
        win = document.activeElement.ownerDocument.defaultView;
      } else if (canvas && canvas.ownerDocument && canvas.ownerDocument.defaultView) {
        win = canvas.ownerDocument.defaultView;
      }
    }
    if (!win && typeof window !== 'undefined') {
      win = window;
    }

    if (win && win.focus) {
      try { win.focus(); } catch (_) {}
    }

    const nav = (win && win.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav || !nav.clipboard || !nav.clipboard.write) {
      throw new Error('Clipboard API not available');
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          return reject(new Error('Canvas toBlob failed'));
        }
        try {
          if (win && win.focus) {
            try { win.focus(); } catch (_) {}
          }
          const item = new ClipboardItem({ 'image/png': blob });
          await nav.clipboard.write([item]);
          resolve(true);
        } catch (err) {
          // 若 win.navigator 寫入失敗，嘗試使用當前全域 window.navigator
          try {
            if (typeof window !== 'undefined' && window.navigator && window.navigator.clipboard && window.navigator.clipboard.write && window.navigator !== nav) {
              if (window.focus) {
                try { window.focus(); } catch (_) {}
              }
              const item2 = new ClipboardItem({ 'image/png': blob });
              await window.navigator.clipboard.write([item2]);
              resolve(true);
              return;
            }
          } catch (_) {}
          reject(err);
        }
      }, 'image/png');
    });
  },

  /**
   * 生成備忘錄格式 HTML (圖片加原生可編輯文字，格式完全等同「一鍵複製確認小卡」)
   */
  buildRichNotesHtml({ flowerText = '', cakeText = '', flowerImages = [], cakeImages = [], addonImages = [] }) {
    const hasFlower = Boolean(flowerText && flowerText !== '無');
    const hasCake = Boolean(cakeText && cakeText !== '無');
    const fImgs = (flowerImages || []).filter(Boolean);
    const cImgs = (cakeImages || []).filter(Boolean);
    const aImgs = (addonImages || []).filter(Boolean);

    const htmlSections = [];
    const plainSections = [];

    const escapeHtml = (str) => {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };

    // 原生行內圖片段落排版 (完全不使用 table 與 clear:both，保證 Apple 備忘錄不轉為唯讀圖形附件)
    const renderImageParagraph = (imgUrls, alt = '圖片') => {
      if (!imgUrls || imgUrls.length === 0) return '';
      const imgW = imgUrls.length > 1 ? 190 : 230;
      return `
        <p style="margin: 6px 0 10px 0; padding: 0; line-height: 1;">
          ${imgUrls.map((url, idx) => `
            <img src="${url}" width="${imgW}" style="width: ${imgW}px; max-width: ${imgW}px; height: auto; border-radius: 8px; vertical-align: top; ${idx > 0 ? 'margin-left: 10px;' : ''}" alt="${alt}">
          `).join('')}
        </p>
      `;
    };

    // 格式化每一行文字 (採用純行內樣式，絕不使用 display:inline-block，確保貼至備忘錄為 100% 原生可修改文字)
    const formatTextLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<p style="margin: 6px 0; font-size: 15px; line-height: 1.5;">&nbsp;</p>';

      if (trimmed === '加單') {
        return `<p style="margin: 4px 0; font-size: 14px; line-height: 1.5;"><span style="background-color: #fce7f3; color: #e11d48; font-weight: bold;">加單</span></p>`;
      }

      // 需加購/加購：粉紫色螢光底色
      if (/^(需加購|加購)[：:]/i.test(trimmed)) {
        return `<p style="margin: 5px 0; font-size: 15px; line-height: 1.5;"><span style="background-color: #fae8ff; color: #9333ea; font-weight: bold;">${escapeHtml(line)}</span></p>`;
      }

      // 序號標題 (1️⃣, 2️⃣)
      if (/^(1️⃣|2️⃣)/.test(trimmed)) {
        return `<p style="margin: 8px 0 4px 0; font-size: 17px; font-weight: bold; line-height: 1.5; color: #1e293b;"><b>${escapeHtml(line)}</b></p>`;
      }

      // 花束標題
      if (/💐.*花束.*💐|花束/.test(trimmed) && !/色系|預算|襯紙|提袋/.test(trimmed)) {
        return `<p style="margin: 6px 0 4px 0; font-size: 16px; font-weight: bold; line-height: 1.5; color: #0f172a;"><b>${escapeHtml(line)}</b></p>`;
      }

      // 重點欄位標題加粗
      if (/^(圖款|蛋糕尺寸|蛋糕口味|取貨日期|取貨時間|自取地點|訂購人)/.test(trimmed)) {
        return `<p style="margin: 2px 0; font-size: 15px; font-weight: bold; line-height: 1.5; color: #1e293b;"><b>${escapeHtml(line)}</b></p>`;
      }

      // 一般訂單文字
      return `<p style="margin: 2px 0; font-size: 15px; line-height: 1.5; color: #334155;">${escapeHtml(line)}</p>`;
    };

    // 1️⃣ 花束部分圖文排列
    if (hasFlower) {
      const fLines = flowerText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      let placedFImgs = false;
      let startIdx = 0;

      if (fLines[0] && fLines[0].trim() === '加單') {
        htmlSections.push(formatTextLine(fLines[0]));
        startIdx = 1;
      }

      for (let i = startIdx; i < fLines.length; i++) {
        const line = fLines[i];
        const trimmed = line.trim();

        if (/^1️⃣/.test(trimmed) || (/💐.*花束.*💐|花束/.test(trimmed) && !/色系|預算|襯紙|提袋/.test(trimmed))) {
          htmlSections.push(formatTextLine(line));
          if (fImgs.length > 0 && !placedFImgs) {
            htmlSections.push(renderImageParagraph(fImgs, '花束圖'));
            placedFImgs = true;
          }
          continue;
        }

        if (fImgs.length > 0 && !placedFImgs) {
          htmlSections.push(renderImageParagraph(fImgs, '花束圖'));
          placedFImgs = true;
        }

        htmlSections.push(formatTextLine(line));
      }

      plainSections.push(flowerText);
    }

    // 2️⃣ 蛋糕與蠟燭配件圖文排列
    if (hasCake) {
      if (hasFlower) {
        htmlSections.push('<p style="margin: 10px 0;">&nbsp;</p>');
      }

      const cLines = cakeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const cakeHasSec1 = cLines.some(l => /^1️⃣/.test(l.trim()));
      const cakeHasSec2 = cLines.some(l => /^2️⃣/.test(l.trim()));
      let placedCakeSec1 = false;
      let placedCakeSec2 = false;
      let placedAllCakeImgs = false;
      let startIdx = 0;

      if (!hasFlower && cLines[0] && cLines[0].trim() === '加單') {
        htmlSections.push(formatTextLine(cLines[0]));
        startIdx = 1;
      }

      for (let i = startIdx; i < cLines.length; i++) {
        const line = cLines[i];
        const trimmed = line.trim();

        // 雙蛋糕情況：1️⃣ 放置蛋糕款式1
        if (/^1️⃣/.test(trimmed) && cakeHasSec1 && cakeHasSec2) {
          htmlSections.push(formatTextLine(line));
          if (cImgs[0] && !placedCakeSec1) {
            htmlSections.push(renderImageParagraph([cImgs[0]], '蛋糕款式1'));
            placedCakeSec1 = true;
          }
          continue;
        }

        // 2️⃣ 段落標題：放置蛋糕款式2 (若有蠟燭配件則並排)
        if (/^2️⃣/.test(trimmed)) {
          htmlSections.push(formatTextLine(line));
          const sec2Imgs = [];
          if (cakeHasSec1 && cImgs[1]) {
            sec2Imgs.push(cImgs[1]);
            if (aImgs.length > 0) sec2Imgs.push(...aImgs);
          } else if (cImgs.length > 0 || aImgs.length > 0) {
            sec2Imgs.push(...cImgs, ...aImgs);
          }
          if (sec2Imgs.length > 0 && !placedCakeSec2) {
            htmlSections.push(renderImageParagraph(sec2Imgs, '蛋糕/配件圖'));
            placedCakeSec2 = true;
            placedAllCakeImgs = true;
          }
          continue;
        }

        // 單蛋糕情況：在圖款或開頭放置蛋糕與配件圖
        if (!placedAllCakeImgs && !cakeHasSec1 && (cImgs.length > 0 || aImgs.length > 0)) {
          const allImgs = [...cImgs, ...aImgs];
          htmlSections.push(renderImageParagraph(allImgs, '蛋糕/配件圖'));
          placedAllCakeImgs = true;
        }

        htmlSections.push(formatTextLine(line));
      }

      plainSections.push(cakeText);
    }

    const fullHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif; font-size: 15px; line-height: 1.5; color: #1e293b; text-align: left;" align="left">
        ${htmlSections.join('\n')}
      </div>
    `;

    return {
      html: fullHtml,
      plainText: plainSections.join('\n\n')
    };
  },

  /**
   * 下載小卡圖檔
   */
  downloadCard(canvas, filename = '梧藝預約取貨確認單.png') {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

if (typeof window !== 'undefined') {
  window.CardRenderer = CardRenderer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CardRenderer = CardRenderer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CardRenderer;
}
