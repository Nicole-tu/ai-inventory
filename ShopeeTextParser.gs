/**
 * ShopeeTextParser.gs (V3.1_Hotfix)
 * 修正：
 * 1. 移除對 "*" 作為乘號的支援，避免 "10*7cm" 的尺寸規格被誤判為數量。
 * 2. 僅使用 "x" 或 "X" 作為數量切割點 (符合蝦皮格式)。
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

      // 4. 解析商品
      // 遮蔽訂單編號
      var safeBlock = fullBlock.split(orderId).join("__________");

      // 【關鍵修正】只抓 x 或 X，不抓 * (避免 10*7cm 被切斷)
      var itemRegex = /[xX]\s*(\d+)/g; 
      var match;
      var lastIndex = 0;
      
      while ((match = itemRegex.exec(safeBlock)) !== null) {
        var qty = parseInt(match[1], 10) || 1;
        var endIndex = match.index;
        
        var rawSegment = safeBlock.substring(lastIndex, endIndex).trim();
        lastIndex = endIndex + match[0].length; 

        // --- 清洗邏輯 ---
        if (rawSegment.length < 2) continue;

        if (rawSegment.includes("商品規格:")) {
          var parts = rawSegment.split("商品規格:");
          rawSegment = parts[parts.length - 1].trim();
        }
        
        if (rawSegment.includes("訂單編號")) {
           var lines = rawSegment.split('\n');
           rawSegment = lines[lines.length - 1].trim();
        }

        // 切除 NT$ (及前面的件折)
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
                      rawSegment.includes("___") || 
                      /^[0-9,.]+$/.test(rawSegment); 

        if (mapped.sku !== "Unknown" || (rawSegment.length > 2 && !isNoise)) {
           orders.push({
              date: new Date(),
              orderId: orderId,
              platform: 'Shopee',
              productName: rawSegment,
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