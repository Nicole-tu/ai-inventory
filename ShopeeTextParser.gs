/**
 * ShopeeTextParser.gs (V2.6)
 * 修正：物流單號抓取邏輯 (支援英數字混合的後4碼)。
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

      // 1. 訂單編號
      var orderIdMatch = fullBlock.match(/訂單編號[:\s]*([A-Z0-9]+)/);
      if (!orderIdMatch) return;
      var orderId = orderIdMatch[1].trim();

      // 2. 物流方式
      var logistics = "Unknown";
      if (fullBlock.includes("7-ELEVEN")) logistics = "7-ELEVEN";
      else if (fullBlock.includes("全家")) logistics = "全家";
      else if (fullBlock.includes("萊爾富")) logistics = "萊爾富";
      else if (fullBlock.includes("OK")) logistics = "OK";
      else if (fullBlock.includes("蝦皮店到店")) logistics = "蝦皮店到店";
      else if (fullBlock.includes("店到家宅配")) logistics = "店到家宅配";
      else if (fullBlock.includes("黑貓")) logistics = "黑貓";
      else if (fullBlock.includes("隔日到貨")) logistics = "蝦皮店到店 - 隔日到貨";

      // 3. 物流單號 (關鍵修正)
      var trackingNumber = "";
      // 找 TW 開頭
      var twMatch = fullBlock.match(/(TW[A-Z0-9]{10,})/);
      if (twMatch) {
        trackingNumber = twMatch[1];
      } else {
        // 找純英數長碼 (排除訂單號)
        var candidates = fullBlock.match(/\b([A-Z0-9]{10,})\b/g);
        if (candidates) {
          var validCandidates = candidates.filter(function(c) { return c !== orderId; });
          if (validCandidates.length > 0) {
            trackingNumber = validCandidates[validCandidates.length - 1];
          }
        }
      }

      // 4. 商品解析
      var lines = fullBlock.split('\n');
      var foundItems = false;

      lines.forEach(function(line) {
        if (line.includes("訂單編號") || line.includes("寄送方式") || line.includes("合計") || line.includes("已完成")) return;

        var qtyMatch = line.match(/[xX*]\s*(\d+)\s*$/);
        
        if (qtyMatch) {
           var qty = parseInt(qtyMatch[1], 10);
           var rawName = line.substring(0, line.lastIndexOf(qtyMatch[0])).trim();
           rawName = rawName.replace("商品規格:", "").trim();
           
           if (rawName.length > 2) {
             foundItems = true;
             var mapped = ShopeeTextParser._findSkuInfo(rawName, skuMap);
             orders.push({
                date: new Date(),
                orderId: orderId,
                platform: 'Shopee',
                productName: rawName,
                sku: mapped.sku,
                abbr: mapped.abbr,
                qty: qty,
                logistics: logistics,
                trackingNumber: trackingNumber,
                raw: rawName
             });
           }
        }
      });
      
      // 備援 Regex
      if (!foundItems) {
         var fallbackRegex = /商品規格:\s*(.+?)\s*[xX*]\s*(\d+)/g;
         var match;
         while ((match = fallbackRegex.exec(fullBlock)) !== null) {
            var rawName = match[1].trim();
            var qty = parseInt(match[2], 10) || 1;
            var mapped = ShopeeTextParser._findSkuInfo(rawName, skuMap);
            orders.push({
                date: new Date(),
                orderId: orderId,
                platform: 'Shopee',
                productName: rawName,
                sku: mapped.sku,
                abbr: mapped.abbr,
                qty: qty,
                logistics: logistics,
                trackingNumber: trackingNumber,
                raw: rawName
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
    return { sku: "Unknown", abbr: "?" };
  }
};