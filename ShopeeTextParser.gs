/**
 * ShopeeTextParser.gs (V2.7.3)
 * 修正：
 * 1. 解決訂單編號結尾含 "X2" 導致誤判數量與商品 (產生 2? 幽靈商品)。
 * 2. 強化單行多商品的切割能力。
 */

var ShopeeTextParser = {
  
  parseShopeeData: function(textData) {
    var skuMap = this._getSkuMap();
    var cleanText = textData.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    
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

      // 3. 抓取物流單號
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

      // 4. 解析商品 (V2.7.3)
      
      // 【關鍵修正】遮蔽訂單編號，避免 "...KX2" 被誤判為 "x2"
      var safeBlock = fullBlock.split(orderId).join("__________");

      // Regex: [xX*] 匹配乘號, \s* 允許空白, (\d+) 抓取數字
      var itemRegex = /[xX*]\s*(\d+)/g;
      var match;
      var lastIndex = 0;
      
      while ((match = itemRegex.exec(safeBlock)) !== null) {
        var qty = parseInt(match[1], 10) || 1;
        var endIndex = match.index;
        
        // 抓取「上一次游標」到「這次 x數量」中間的文字
        var rawSegment = safeBlock.substring(lastIndex, endIndex).trim();
        
        // 更新游標
        lastIndex = endIndex + match[0].length; 

        // --- 清洗與過濾 ---
        
        if (rawSegment.length < 2) continue;

        if (rawSegment.includes("商品規格:")) {
          var parts = rawSegment.split("商品規格:");
          rawSegment = parts[parts.length - 1].trim();
        }
        
        if (rawSegment.includes("訂單編號")) {
           var lines = rawSegment.split('\n');
           rawSegment = lines[lines.length - 1].trim();
        }

        // 切除 NT$
        if (rawSegment.includes("NT$")) {
           rawSegment = rawSegment.replace(/^(件折\s*)?NT\$[\d,]+\s*/, "");
        }
        
        if (rawSegment.includes("件折")) {
           var parts = rawSegment.split("件折");
           rawSegment = parts[parts.length - 1].replace(/^\s*NT\$[\d,]+\s*/, "").trim();
        }

        // 關鍵字比對
        var mapped = ShopeeTextParser._findSkuInfo(rawSegment, skuMap);
        
        // 嚴格模式：過濾雜訊
        var isNoise = rawSegment.includes("信用卡") || 
                      rawSegment.includes("待出貨") || 
                      rawSegment.includes("___") || // 被遮蔽的訂單號
                      /^[0-9,.]+$/.test(rawSegment); // 純數字

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
    var ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
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
    for (var i = 0; i < map.length; i++) {
      if (rawName.includes(map[i].keyword)) {
        return { sku: map[i].sku, abbr: map[i].abbr };
      }
    }
    // 寬鬆比對 (去空白)
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