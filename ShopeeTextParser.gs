/**
 * ShopeeTextParser.gs (V2.7.3)
 * 修正：
 * 1. 【關鍵】解決訂單編號結尾含 "X2" 被誤判為商品數量 (例如 ...KX2) 的問題。
 * 2. 優化 "x2NT$560" 這種沾黏格式的解析。
 * 3. 提升多商品擠在同一行的辨識率。
 */

var ShopeeTextParser = {
  
  parseShopeeData: function(textData) {
    var skuMap = this._getSkuMap();
    // 移除空行，統一換行符號
    var cleanText = textData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    
    // 依 "訂單編號" 切割
    var rawOrders = cleanText.split(/訂單編號/);
    var orders = [];

    rawOrders.forEach(function(block) {
      if (!block || block.trim().length < 5) return;
      var fullBlock = "訂單編號" + block;

      // 1. 抓取訂單編號
      var orderIdMatch = fullBlock.match(/訂單編號[:\s]*([A-Z0-9]+)/);
      if (!orderIdMatch) return;
      var orderId = orderIdMatch[1].trim();

      // 2. 抓取物流方式
      var logistics = "Unknown";
      if (fullBlock.includes("7-ELEVEN")) logistics = "7-ELEVEN";
      else if (fullBlock.includes("全家")) logistics = "全家";
      else if (fullBlock.includes("萊爾富")) logistics = "萊爾富";
      else if (fullBlock.includes("OK")) logistics = "OK";
      else if (fullBlock.includes("蝦皮店到店")) logistics = "蝦皮店到店";
      else if (fullBlock.includes("店到家宅配")) logistics = "店到家宅配";
      else if (fullBlock.includes("黑貓")) logistics = "黑貓";
      else if (fullBlock.includes("隔日到貨")) logistics = "蝦皮店到店 - 隔日到貨";

      // 3. 抓取物流單號 (支援英數混合)
      var trackingNumber = "";
      var twMatch = fullBlock.match(/(TW[A-Z0-9]{10,})/);
      if (twMatch) {
        trackingNumber = twMatch[1];
      } else {
        var candidates = fullBlock.match(/\b([A-Z0-9]{10,})\b/g);
        if (candidates) {
          var validCandidates = candidates.filter(function(c) { return c !== orderId; });
          if (validCandidates.length > 0) {
            trackingNumber = validCandidates[validCandidates.length - 1];
          }
        }
      }

      // 4. 解析商品 (V2.7.3 核心修正)
      
      // 【步驟A】遮蔽訂單編號，防止 "...KX2" 被誤判為 "x2"
      // 我們把內文中的 OrderID 替換成等長的底線，避免 Regex 抓到它
      var safeBlock = fullBlock.split(orderId).join("__________");

      // 【步驟B】游標掃描
      // Regex: [xX*] 匹配乘號, \s* 允許空白, (\d+) 抓取數字
      var itemRegex = /[xX*]\s*(\d+)/g;
      var match;
      var lastIndex = 0;
      
      while ((match = itemRegex.exec(safeBlock)) !== null) {
        var qty = parseInt(match[1], 10) || 1;
        var endIndex = match.index;
        
        // 抓取「上一次游標」到「這次 x數量」中間的文字
        var rawSegment = safeBlock.substring(lastIndex, endIndex).trim();
        
        // 更新游標：移動到 "x數量" 的後面
        lastIndex = endIndex + match[0].length; 

        // --- 資料清洗 (Cleaning Pipeline) ---
        
        // 1. 過短跳過
        if (rawSegment.length < 2) continue;

        // 2. 切除 "商品規格:"
        if (rawSegment.includes("商品規格:")) {
          var parts = rawSegment.split("商品規格:");
          rawSegment = parts[parts.length - 1].trim();
        }
        
        // 3. 切除 "訂單編號" 行 (即使被遮蔽了，可能還有 "訂單編號" 字樣)
        if (rawSegment.includes("訂單編號")) {
           var lines = rawSegment.split('\n');
           // 取最後一行，通常是商品名
           rawSegment = lines[lines.length - 1].trim();
        }

        // 4. 切除 "NT$xxxx" (解決 x2NT$560 沾黏問題)
        // 同時處理 "件折 NT$3" 這種出現在前面的雜訊
        if (rawSegment.includes("NT$")) {
           // 策略：用 NT$ 分割，取最後一段 (假設商品名在價格之前，但如果沾黏，商品名會跟著前一段)
           // 修正策略：
           // 如果 "NT$" 在開頭 (如 "NT$233 商品名") -> 切除開頭
           rawSegment = rawSegment.replace(/^(件折\s*)?NT\$[\d,]+\s*/, "");
           
           // 如果 "NT$" 在中間或結尾 (如 "商品名 NT$233") -> 可能是上一個商品的價格殘留
           // 這裡比較危險，我們改用「關鍵字比對」來過濾
        }
        
        // 額外清洗：如果開頭有 "件折"，切掉
        if (rawSegment.includes("件折")) {
           var parts = rawSegment.split("件折");
           rawSegment = parts[parts.length - 1].replace(/^\s*NT\$[\d,]+\s*/, "").trim();
        }

        // 5. 關鍵字比對
        var mapped = ShopeeTextParser._findSkuInfo(rawSegment, skuMap);
        
        // 嚴格模式：過濾掉明顯的雜訊
        // 如果對應不到 SKU，且文字包含 "信用卡"、"待出貨" 或看起來像價格
        var isNoise = rawSegment.includes("信用卡") || 
                      rawSegment.includes("待出貨") || 
                      rawSegment.includes("___") || // 被遮蔽的訂單號
                      /^[0-9,.]+$/.test(rawSegment); // 只有數字

        if (mapped.sku !== "Unknown" || (rawSegment.length > 2 && !isNoise)) {
           orders.push({
              date: new Date(),
              orderId: orderId,
              platform: 'Shopee',
              productName: rawSegment, // 原始名稱
              sku: mapped.sku,
              abbr: mapped.abbr,
              qty: qty,
              logistics: logistics,
              trackingNumber: trackingNumber,
              raw: rawSegment
           });
        }
      }
    });
    
    return orders;
  },

  _getSkuMap: function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('[04_SKU對照表]');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    return data.map(function(row) {
      return {
        sku: String(row[0]).trim(),
        abbr: String(row[2]).trim(), 
        keyword: String(row[3]).trim()
      };
    }).filter(function(i) { return i.sku && i.keyword; });
  },

  _findSkuInfo: function(rawName, map) {
    // 1. 標準比對
    for (var i = 0; i < map.length; i++) {
      if (rawName.includes(map[i].keyword)) {
        return { sku: map[i].sku, abbr: map[i].abbr };
      }
    }
    
    // 2. 寬鬆比對 (去除所有空白後再比)
    var normalizedName = rawName.replace(/\s+/g, "");
    for (var j = 0; j < map.length; j++) {
      var normalizedKeyword = map[j].keyword.replace(/\s+/g, "");
      if (normalizedName.includes(normalizedKeyword)) {
        return { sku: map[j].sku, abbr: map[j].abbr };
      }
    }

    return { sku: "Unknown", abbr: "?" };
  }
};