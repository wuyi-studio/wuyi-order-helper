/**
 * 梧藝 WUYI 下單小幫手 - 訂單與金額解析引擎 (Extractor Engine)
 */

const Extractor = {
  /**
   * 將常見預約取貨日期自動轉換為梧藝 4 碼標準標籤格式 (如 11.2 -> 1102)
   * @param {string} dateStr 
   * @param {boolean} forceShort 若為 true 則連同包含西元年的日期亦強制轉為 4 碼
   * @returns {string} 4 碼格式 (MMDD) 或原字串
   */
  formatWuyiDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const trimmed = dateStr.trim();
    if (/^\d{4}$/.test(trimmed)) return trimmed;

    // 比對各式日期格式：月份 1~12、日期 1~31，支援西元年 (2026)、時間 (11.21/3點)、星期 (如 11/2（六）、週六)
    const match = trimmed.match(/(?:(?:20\d{2})[年\/\-\.\s])?\s*(1[0-2]|0?[1-9])[月\/\-\.]\s*([12]\d|3[01]|0?[1-9])[日號\s\(\（週星期\/]?/);
    if (match) {
      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      return `${month}${day}`;
    }

    return trimmed;
  },

  /**
   * 嚴格檢驗對話訊息是否包含訂單所必須具備的 6 大資訊：
   * 1. 取貨日期
   * 2. 取貨時間
   * 3. 自取地點 (或取貨地點)
   * 4. 訂購人 LINE 名稱
   * 5. 訂購人姓名
   * 6. 訂購人電話
   * 只有六項資訊皆具備才能選入！
   * @param {string} text 
   * @returns {boolean}
   */
  hasAllOrderRequiredFields(text) {
    if (!text || typeof text !== 'string') return false;

    // 1. 取貨日期 (例：取貨日期：2026-11-01、取貨日期：11/1‼️、自取日期、日期)
    const hasPickupDate = /(?:取貨|自取)?日期\s*[：:]/.test(text) || /取貨日期|自取日期/.test(text);

    // 2. 取貨時間 (例：取貨時間：17:00、取貨時間：16:30 (朋友代取)、自取時間)
    const hasPickupTime = /(?:取貨|自取)?時間\s*[：:]/.test(text) || /取貨時間|自取時間/.test(text);

    // 3. 自取地點 (例：自取地點：台南市中西區友愛街93號、取貨地點、自取門市)
    const hasPickupLocation = /(?:自取|取貨)(?:地點|門市)\s*[：:]/.test(text) || /自取地點|取貨地點/.test(text);

    // 4. 訂購人 LINE 名稱 (例：訂購人 LINE 名稱：言均、訂購人的 LINE 名稱、LINE 名稱)
    const hasLineName = /(?:訂購人(?:的)?\s*)?(?:LINE|line)\s*名稱/i.test(text);

    // 5. 訂購人姓名 (例：訂購人姓名：潘言均、姓名：潘言均)
    const hasCustomerName = /訂購人姓名|訂購人\s*姓名/.test(text) || (/(?:訂購人)?姓名\s*[：:]/.test(text) && !/LINE\s*名稱/i.test(text));

    // 6. 訂購人電話 (例：訂購人電話：0970411157、電話：0970411157)
    const hasCustomerPhone = /訂購人電話|訂購人\s*電話/.test(text) || /(?:訂購人|聯絡)?電話\s*[：:]/.test(text);

    return Boolean(hasPickupDate && hasPickupTime && hasPickupLocation && hasLineName && hasCustomerName && hasCustomerPhone);
  },

  /**
   * 計算對話訊息符合訂單格式之權重分數
   * @param {string} text 
   * @param {boolean} hasImage 
   * @returns {number}
   */
  getOrderScore(text, hasImage = false) {
    if (!text || typeof text !== 'string') return 0;
    if (!this.hasAllOrderRequiredFields(text)) return 0;

    let score = 100;
    if (/【蛋糕訂購資訊】|蛋糕訂購資訊/.test(text)) score += 30;
    if (/蛋糕尺寸/.test(text) && /蛋糕口味/.test(text)) score += 20;
    if (/花束|透包花束|精緻包裝花束/.test(text)) score += 20;
    if (hasImage) score += 15;
    return score;
  },

  /**
   * 判斷是否符合客製訂單格式
   * 重新設定：必須同時包含 取貨日期、取貨時間、自取地點、訂購人 LINE 名稱、訂購人姓名、訂購人電話 才能選入！
   * @param {string} text 
   * @param {boolean} hasImage
   * @returns {boolean}
   */
  isOrderFormat(text, hasImage = false) {
    return this.hasAllOrderRequiredFields(text);
  },

  /**
   * 判斷是否符合金額加總格式
   * @param {string} text 
   * @returns {boolean}
   */
  isPricingFormat(text) {
    if (!text || typeof text !== 'string') return false;
    const hasItemPrice = /(蛋糕|漢堡盒|花束|餐具|蠟燭|保冷|襯紙|提袋|鮮花預算)[\$：:]\s*\d+/.test(text);
    const hasTotal = /(總共|合計|＝|=)\s*[\$]?\s*\d+/.test(text);
    return hasItemPrice && hasTotal;
  },

  /**
   * 去除訂單對話末尾的金額加總明細與算式，保留純淨的「完整訂單內容 (無金額加總)」
   * 金額加總一律留在「訂購人電話：09XXXXXXXX」下方作為「金額明細」
   * @param {string} text 
   * @returns {string}
   */
  cleanOrderTextWithoutPricing(text) {
    if (!text || typeof text !== 'string') return '';
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    // 尋找最後一行「電話」所在索引
    let phoneIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/(?:訂購人|聯絡)?電話\s*[：:]/i.test(lines[i])) {
        phoneIdx = i;
        break;
      }
    }

    if (phoneIdx !== -1) {
      const trailingLines = lines.slice(phoneIdx + 1).map(l => l.trim()).filter(Boolean);
      if (trailingLines.length > 0) {
        // 只要電話行之後有內容，且包含算式、金額、收費等，則電話之後皆歸入金額明細
        const hasPricingIndicator = trailingLines.some(l => 
          /[\$＝=＋\+xX\*]|收\s*\d+|\d+\s*[\$元]|\d+\s*[\*xX]\s*\d+|餐具|蠟燭|保冰|保冷|漢堡盒|蛋糕|花束/i.test(l)
        );
        if (hasPricingIndicator) {
          return lines.slice(0, phoneIdx + 1).join('\n').trim();
        }
      }
    }

    return text.trim();
  },

  /**
   * 專門提取「訂購人電話：09XXXXXXXX」下方的金額加總明細
   * @param {string} text 
   * @returns {string} 金額明細內容
   */
  extractPricingFromOrderText(text) {
    if (!text || typeof text !== 'string') return '';
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let phoneIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/(?:訂購人|聯絡)?電話\s*[：:]/i.test(lines[i])) {
        phoneIdx = i;
        break;
      }
    }

    if (phoneIdx !== -1 && phoneIdx + 1 < lines.length) {
      const trailingLines = lines.slice(phoneIdx + 1).map(l => l.trim()).filter(Boolean);
      if (trailingLines.length > 0) {
        return trailingLines.join('\n');
      }
    }

    return '';
  },

  /**
   * 將完整訂單內容切分為「1️⃣ 花束訂單內容」與「2️⃣ 蛋糕訂單內容」兩部分
   * 若無該項目則標註為「無」
   * @param {string} text 
   * @returns {{ flowerText: string, cakeText: string }}
   */
  splitOrderText(text) {
    if (!text || typeof text !== 'string') {
      return { flowerText: '無', cakeText: '無' };
    }
    const cleanText = this.cleanOrderTextWithoutPricing(text).trim();
    if (!cleanText) {
      return { flowerText: '無', cakeText: '無' };
    }

    const lines = cleanText.split('\n');

    const hasFlowerKeyword = /花束|精緻包裝花束|透包花束|透明包裝花束|鮮花色系|花材色系|鮮花預算/.test(cleanText);
    const hasCakeKeyword = /蛋糕尺寸|蛋糕口味|題字|圖款|漢堡盒|托盤寫|蛋糕體|原味戚風|伯爵戚風|可可戚風/.test(cleanText);

    // 情況 1: 沒有花束，純蛋糕 (包含雙蛋糕等)
    if (!hasFlowerKeyword && hasCakeKeyword) {
      return {
        flowerText: '無',
        cakeText: cleanText
      };
    }

    // 情況 2: 純花束，沒有蛋糕
    if (hasFlowerKeyword && !hasCakeKeyword) {
      return {
        flowerText: cleanText,
        cakeText: '無'
      };
    }

    // 情況 3: 同時包含花束與蛋糕 (如 1️⃣ 花束、2️⃣ 蛋糕)
    let cakeStartIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^2️⃣/.test(line)) {
        cakeStartIdx = i;
        break;
      }
      if (/^(圖款|愛心造型|蛋糕體|蛋糕尺寸|托盤寫|托盤題字|英文題字|中文題字|題字)[：:\s]/.test(line) && i > 0) {
        cakeStartIdx = i;
        break;
      }
    }

    if (cakeStartIdx > 0) {
      const flowerLines = lines.slice(0, cakeStartIdx).map(l => l.trimEnd());
      const cakeLines = lines.slice(cakeStartIdx).map(l => l.trimEnd());

      const flowerPart = flowerLines.join('\n').trim();
      const cakePart = cakeLines.join('\n').trim();

      return {
        flowerText: flowerPart || '無',
        cakeText: cakePart || '無'
      };
    }

    if (hasFlowerKeyword) {
      return { flowerText: cleanText, cakeText: '無' };
    } else {
      return { flowerText: '無', cakeText: cleanText };
    }
  },

  /**
   * 剖析顧客下單對話文字
   * @param {string} text 
   * @returns {Object} OrderState
   */
  parseOrderText(text) {
    if (!text || typeof text !== 'string') {
      return this._createEmptyOrderState();
    }

    const cleanText = this.cleanOrderTextWithoutPricing(text);
    const normalizedText = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedText.split('\n');

    // 判斷訂單類型
    const hasFlowerHeader = /花束|精緻包裝花束|透包花束|透明包裝花束|鮮花色系|花材色系/.test(normalizedText);
    const hasCakeHeader = /蛋糕尺寸|蛋糕口味|題字|圖款|漢堡盒|托盤寫/.test(normalizedText);

    let orderType = 'cake';
    if (hasFlowerHeader && hasCakeHeader) {
      orderType = 'combined';
    } else if (hasFlowerHeader && !hasCakeHeader) {
      orderType = 'flower';
    }

    const state = this._createEmptyOrderState();
    state.orderType = orderType;
    state.rawText = normalizedText;

    let inInscription = false;
    let inscriptionLines = [];

    let currentSection = 'general'; // 'flower' | 'cake' | 'general'
    if (orderType === 'flower') currentSection = 'flower';
    if (orderType === 'cake') currentSection = 'cake';

    const isSectionHeader = (str) => {
      if (!str) return false;
      const s = str.trim();
      return /^(【|1️⃣|2️⃣|3️⃣|[1-9][.、:：\s]|圖款|蛋糕|題字|托盤寫|托盤題字|取貨|自取|訂購人|加購|需加購|花束|透包|透明包裝|想要的預算|想要得預算|鮮花預算|預算|鮮花色系|花材色系)/.test(s);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Section switches (e.g. 1️⃣ or 2️⃣ or 花束/蛋糕 headers)
      if (/^1️⃣/.test(trimmed) || (/花束|透包/.test(trimmed) && orderType === 'combined')) {
        currentSection = 'flower';
      } else if (/^2️⃣/.test(trimmed) || (/圖款|蛋糕|托盤/.test(trimmed) && currentSection === 'flower' && orderType === 'combined')) {
        currentSection = 'cake';
      }

      // 題字/托盤開頭檢測
      if (/(托盤寫|托盤題字|盤子寫|盤子題字|英文題字|中文題字|題字|底座題字|表面題字|側面題字|上層題字)[：:]/i.test(trimmed)) {
        inInscription = true;
        const match = trimmed.match(/(托盤寫|托盤題字|盤子寫|盤子題字|英文題字|中文題字|題字|底座題字|表面題字|側面題字|上層題字)[：:]\s*(.*)/i);
        if (match) {
          state.cake.inscriptionLabel = match[1];
          if (match[2]) {
            inscriptionLines.push(match[2].trim());
          }
        }
        continue;
      }

      // 題字模式下的多行收集
      if (inInscription) {
        // 遇到下一個標準標籤則離開題字模式
        if (/^(蛋糕尺寸|尺寸|蛋糕口味|蛋糕體|口味|加購|需加購|取貨日期|取貨時間|自取地點|自取門市|取貨門市|訂購人|訂購人的)[：:]/i.test(trimmed)) {
          inInscription = false;
          state.cake.inscription = inscriptionLines.join('\n').trim();
        } else {
          // 收集題字內容
          if (trimmed || inscriptionLines.length > 0) {
            inscriptionLines.push(line);
          }
          continue;
        }
      }

      // 花束欄位
      if (currentSection === 'flower' || orderType === 'flower' || orderType === 'combined') {
        if (/^(想要的預算|想要得預算|鮮花預算|預算)(\([^)]*\))?[：:]/i.test(trimmed)) {
          state.flower.budget = trimmed.replace(/^(想要的預算|想要得預算|鮮花預算|預算)(\([^)]*\))?[：:]\s*/i, '').trim();
          continue;
        }
        if (/^(花材色系|鮮花色系|色系)[：:]/i.test(trimmed)) {
          state.flower.color = trimmed.replace(/^(花材色系|鮮花色系|色系)[：:]\s*/i, '').trim();
          continue;
        }
        if (/^(包裝紙色系|包裝紙|襯紙|純色襯紙|包裝)[：:]/i.test(trimmed)) {
          state.flower.paper = trimmed.replace(/^(包裝紙色系|包裝紙|襯紙|純色襯紙|包裝)[：:]\s*/i, '').trim();
          continue;
        }
        if (/^(提袋|加購|需加購)[：:]/i.test(trimmed) && currentSection === 'flower') {
          state.flower.paper = state.flower.paper ? `${state.flower.paper} (附提袋)` : '附提袋';
          continue;
        }
        if (/^備註[：:]/i.test(trimmed)) {
          state.flower.note = trimmed.replace(/^備註[：:]\s*/i, '').trim();
          continue;
        }
      }

      // 蛋糕欄位
      if (currentSection === 'cake' || orderType === 'cake' || orderType === 'combined') {
        if (/^圖款[，,：:]?/i.test(trimmed)) {
          const val = trimmed.replace(/^圖款[，,：:]?\s*/i, '').trim();
          if (val) state.cake.style = val;
          continue;
        }
        if (/^(蛋糕尺寸|尺寸)[：:]/i.test(trimmed)) {
          let val = trimmed.replace(/^(蛋糕尺寸|尺寸)[：:]\s*/i, '').trim();
          if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
            val = lines[++i].trim();
          }
          state.cake.size = val;
          continue;
        }
        if (/^(蛋糕口味|蛋糕體|口味)[：:]/i.test(trimmed)) {
          let val = trimmed.replace(/^(蛋糕口味|蛋糕體|口味)[：:]\s*/i, '').trim();
          if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
            val = lines[++i].trim();
          }
          if (val) {
            state.cake.flavor = state.cake.flavor ? `${state.cake.flavor} / ${val}` : val;
          }
          continue;
        }
        if (/^(加購|需加購)[：:]/i.test(trimmed)) {
          let val = trimmed.replace(/^(加購|需加購)[：:]\s*/i, '').trim();
          if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
            val = lines[++i].trim();
          }
          state.cake.addon = val;
          continue;
        }
      }

      // 取貨資訊
      if (/^(取貨日期|自取日期|日期)[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(取貨日期|自取日期|日期)[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        // 保留使用者與顧客原始取貨日期字串 (例如 11/1 (日)、11/1‼️、2026-11-01)
        state.pickup.date = val;
        // 梧藝標準 4 碼標籤格式 (如 1101) 專供新增 LINE 標籤使用
        state.pickup.dateTag = this.formatWuyiDate(val);
        continue;
      }
      if (/^(取貨時間|自取時間|時間)[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(取貨時間|自取時間|時間)[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        state.pickup.time = val;
        continue;
      }
      if (/^(自取地點|取貨地點|地點|自取門市)[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(自取地點|取貨地點|地點|自取門市)[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        state.pickup.location = val;
        continue;
      }

      // 顧客資訊
      if (/^(訂購人|訂購人的)?\s*(LINE|Line|line)\s*名稱[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(訂購人|訂購人的)?\s*(LINE|Line|line)\s*名稱[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        state.customer.lineName = val;
        continue;
      }
      if (/^(訂購人姓名|訂購人|姓名)[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(訂購人姓名|訂購人|姓名)[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        state.customer.name = val;
        continue;
      }
      if (/^(訂購人電話|電話|聯絡電話)[：:]/i.test(trimmed)) {
        let val = trimmed.replace(/^(訂購人電話|電話|聯絡電話)[：:]\s*/i, '').trim();
        if (!val && i + 1 < lines.length && !isSectionHeader(lines[i + 1])) {
          val = lines[++i].trim();
        }
        state.customer.phone = val;
        continue;
      }
    }

    if (inInscription && inscriptionLines.length > 0 && !state.cake.inscription) {
      state.cake.inscription = inscriptionLines.join('\n').trim();
    }

    return state;
  },

  /**
   * 剖析客服回覆中的金額明細
   * @param {string} text 
   * @returns {Object} PricingState
   */
  parsePricingText(text) {
    if (!text || typeof text !== 'string') {
      return { breakdownText: '', total: 0 };
    }

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let capturing = false;
    const capturedLines = [];
    let total = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 起始判定：例如 蛋糕$790、漢堡盒$760、花束$880、鮮花預算：500
      if (!capturing) {
        if (/^(蛋糕|漢堡盒|花束|鮮花預算|預算|商品)[\$：:]\s*\d+/i.test(trimmed) ||
            /^(蛋糕|漢堡盒|花束|2人餐具|5人餐具|蠟燭|保冷|插牌)/.test(trimmed) && /[\$＝=]\s*\d+/.test(trimmed)) {
          capturing = true;
          capturedLines.push(trimmed);
          continue;
        }
      }

      // 捕獲進行中
      if (capturing) {
        if (!trimmed) continue; // 略過中間空行

        // 結束判定：總共$895、＝1400、=1400、合計...
        const totalMatch = trimmed.match(/^(總共|合計|＝|=)\s*[\$]?\s*(\d+[\d,]*)/i);
        if (totalMatch) {
          capturedLines.push(trimmed);
          total = parseInt(totalMatch[2].replace(/,/g, ''), 10) || 0;
          break; // 捕獲完畢
        }

        // 若是算式、加購、配件行
        if (/[\$：:]\s*\d+/.test(trimmed) || /加購|餐具|蠟燭|保冷|襯紙|提袋|插牌/.test(trimmed)) {
          capturedLines.push(trimmed);
        } else {
          // 非金額內容，若尚未到總共但已沒有金額行，則終止
          break;
        }
      }
    }

    return {
      breakdownText: capturedLines.join('\n'),
      total: total
    };
  },

  /**
   * 依據 OrderState 產生完全標準、不改變排版的 Apple 備忘錄純文字
   * @param {Object} state 
   * @returns {string}
   */
  formatRawOrder(state) {
    if (!state) return '';
    const parts = [];

    if (state.orderType === 'flower') {
      parts.push('💐精緻包裝花束💐\n');
      if (state.flower.budget) parts.push(`想要的預算(填金額)：${state.flower.budget}`);
      if (state.flower.color) parts.push(`鮮花色系：${state.flower.color}`);
      if (state.flower.paper) parts.push(`包裝紙色系：${state.flower.paper}`);
      parts.push('＊附提袋喔');
      if (state.flower.note) parts.push(`備註：${state.flower.note}`);
      parts.push('');
    } else if (state.orderType === 'combined') {
      parts.push('1️⃣\n💐精緻包裝花束💐\n(圖片僅供參考)\n');
      if (state.flower.budget) parts.push(`想要的預算(填金額)：${state.flower.budget}`);
      if (state.flower.color) parts.push(`鮮花色系：${state.flower.color}`);
      if (state.flower.paper) parts.push(`包裝紙色系：${state.flower.paper}`);
      parts.push('＊附提袋喔');
      if (state.flower.note) parts.push(`備註：${state.flower.note}`);
      parts.push('\n2️⃣');
    }

    if (state.orderType === 'cake' || state.orderType === 'combined') {
      parts.push('圖款');
      if (state.cake.inscription) {
        const label = state.cake.inscriptionLabel || '題字';
        if (state.cake.inscription.includes('\n')) {
          parts.push(`${label}：\n${state.cake.inscription}\n`);
        } else {
          parts.push(`${label}：${state.cake.inscription}`);
        }
      }
      if (state.cake.size) parts.push(`蛋糕尺寸：${state.cake.size}`);
      if (state.cake.flavor) parts.push(`蛋糕口味：${state.cake.flavor}`);
      parts.push('');
      if (state.cake.addon) {
        parts.push(`加購：${state.cake.addon}\n`);
      }
    }

    // 取貨資訊
    if (state.pickup.date) parts.push(`取貨日期：${state.pickup.date}`);
    if (state.pickup.time) parts.push(`取貨時間：${state.pickup.time}`);
    if (state.pickup.location) parts.push(`自取地點：${state.pickup.location}`);
    parts.push('');

    // 訂購人資訊
    if (state.customer.lineName) parts.push(`訂購人的LINE名稱：${state.customer.lineName}`);
    if (state.customer.name) parts.push(`訂購人姓名：${state.customer.name}`);
    if (state.customer.phone) parts.push(`訂購人電話：${state.customer.phone}`);

    return parts.join('\n').trim();
  },

  _createEmptyOrderState() {
    return {
      orderType: 'cake',
      flower: {
        budget: '',
        color: '',
        paper: '',
        note: ''
      },
      cake: {
        style: '圖款',
        inscriptionLabel: '題字',
        inscription: '',
        size: '',
        flavor: '',
        addon: ''
      },
      pickup: {
        date: '',
        dateTag: '',
        time: '',
        location: '台南市中西區友愛街93號'
      },
      customer: {
        lineName: '',
        name: '',
        phone: ''
      },
      rawText: ''
    };
  }
};

if (typeof window !== 'undefined') {
  window.Extractor = Extractor;
}
if (typeof globalThis !== 'undefined') {
  globalThis.Extractor = Extractor;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Extractor;
}
